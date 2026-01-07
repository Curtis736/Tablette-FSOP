const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs/promises');
const { extractTagsFromDocx, isDocxLocked, isDocxStable } = require('./lib/docxTags');
const { updateExcelNamedRanges, excelFileExists } = require('./lib/excelNamedRanges');
const { glob } = require('glob');

// Load configuration
let config;
try {
    config = require('./agent.config.json');
} catch (error) {
    console.error('Failed to load agent.config.json. Please copy agent.config.example.json to agent.config.json and configure it.');
    process.exit(1);
}

// Ensure log directory exists (synchronous for startup)
const logDir = path.dirname(config.logFile || 'logs/fsop-sync-agent.log');
try {
    require('fs').mkdirSync(logDir, { recursive: true });
} catch (_) {
    // Ignore if already exists
}

// Simple file logger
function log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message} ${args.length > 0 ? JSON.stringify(args) : ''}\n`;
    
    // Console output
    console.log(logMessage.trim());
    
    // File output
    try {
        require('fs').appendFileSync(config.logFile || 'logs/fsop-sync-agent.log', logMessage);
    } catch (error) {
        console.error('Failed to write to log file:', error.message);
    }
}

// Track files being processed to avoid duplicate processing
const processingFiles = new Set();
const fileStabilityTimers = new Map();

/**
 * Find Excel file in mesure directory structure.
 * Searches recursively: mesure/**/{SN}/*.xlsx
 * 
 * @param {string} excelBaseDir - Base directory (e.g., "X:\Tracabilite\mesure")
 * @param {string} pattern - Glob pattern with {SN} placeholder (e.g., "**/{SN}/*.xlsx")
 * @param {string} sn - Serial number to replace {SN} in pattern
 * @returns {Promise<string|null>} Path to Excel file or null if not found
 */
async function findExcelFile(excelBaseDir, pattern, sn) {
    try {
        // Check if base directory exists
        try {
            await fs.access(excelBaseDir);
        } catch (_) {
            return null;
        }

        // Replace {SN} placeholder in pattern
        const resolvedPattern = pattern.replace('{SN}', sn);
        const searchPath = path.join(excelBaseDir, resolvedPattern);
        
        const files = await glob(searchPath, { 
            absolute: true,
            nodir: true,
            ignore: ['**/~$*', '**/.*'] // Ignore temp files and hidden files
        });

        if (files.length === 0) {
            return null;
        }

        // If multiple files, prefer the most recent one
        if (files.length > 1) {
            const stats = await Promise.all(
                files.map(async (file) => ({
                    path: file,
                    mtime: (await fs.stat(file)).mtimeMs
                }))
            );
            stats.sort((a, b) => b.mtime - a.mtime);
            return stats[0].path;
        }

        return files[0];
    } catch (error) {
        log('error', `Error finding Excel file in ${excelBaseDir} with pattern ${pattern}:`, error.message);
        return null;
    }
}

/**
 * Process a FSOP docx file: extract tags and update Excel.
 */
async function processFsopFile(docxPath) {
    if (processingFiles.has(docxPath)) {
        log('debug', `File already being processed: ${docxPath}`);
        return;
    }

    // Skip if file doesn't match FSOP pattern
    const basename = path.basename(docxPath);
    if (!basename.startsWith('FSOP_') || !basename.endsWith('.docx')) {
        return;
    }

    // Skip templates
    if (basename.startsWith('TEMPLATE_')) {
        return;
    }

    processingFiles.add(docxPath);

    try {
        log('info', `Processing FSOP file: ${docxPath}`);

        // Check if file is locked (being edited)
        const locked = await isDocxLocked(docxPath);
        if (locked) {
            log('debug', `File is locked (being edited): ${docxPath}`);
            processingFiles.delete(docxPath);
            return;
        }

        // Check if file is stable (not recently modified)
        const stable = await isDocxStable(docxPath, config.stabilityDelayMs || 5000);
        if (!stable) {
            log('debug', `File is not stable yet (recently modified): ${docxPath}`);
            processingFiles.delete(docxPath);
            return;
        }

        // Extract tags from docx
        const tagPattern = config.tagPattern ? new RegExp(config.tagPattern) : /\{\{([A-Z0-9_]+)\}\}/;
        const tags = await extractTagsFromDocx(docxPath, tagPattern);
        
        if (Object.keys(tags).length === 0) {
            log('warn', `No tags found in file: ${docxPath}`);
            processingFiles.delete(docxPath);
            return;
        }

        log('info', `Extracted ${Object.keys(tags).length} tag(s) from ${docxPath}:`, tags);

        // Extract SN from docx filename (format: FSOP_F469_SN123_LT2501132.docx or FSOP_F469_23.199_LT2501132.docx)
        // SN can be in format "SN123" or "23.199" (with dots)
        // Try multiple patterns to extract the serial number
        let sn = null;
        
        // Pattern 1: SN followed by alphanumeric (e.g., "SN123")
        const snPattern1 = basename.match(/FSOP_[^_]+_(SN[A-Z0-9]+)/i);
        if (snPattern1) {
            sn = snPattern1[1]; // e.g., "SN123"
        } else {
            // Pattern 2: Number with dots (e.g., "23.199")
            const snPattern2 = basename.match(/FSOP_[^_]+_(\d+\.\d+)/);
            if (snPattern2) {
                sn = snPattern2[1]; // e.g., "23.199"
            } else {
                // Pattern 3: Any alphanumeric between FSOP_XXX_ and _LT
                const snPattern3 = basename.match(/FSOP_[^_]+_([A-Z0-9.]+)_LT\d+/i);
                if (snPattern3) {
                    sn = snPattern3[1];
                }
            }
        }
        
        if (!sn) {
            log('warn', `Could not extract SN from filename: ${basename}`);
            processingFiles.delete(docxPath);
            return;
        }
        
        log('debug', `Extracted SN: ${sn} from filename: ${basename}`);

        // Determine Excel base directory and pattern
        const excelBaseDir = config.excelBaseDir || config.excelDir || config.excelPath?.replace(/[^/\\]*\.xlsx$/, '');
        if (!excelBaseDir) {
            log('error', 'excelBaseDir not configured in agent.config.json');
            processingFiles.delete(docxPath);
            return;
        }

        // Pattern should contain {SN} placeholder (e.g., "mesure *{SN}*.xlsx")
        const excelPattern = config.excelPattern || 'mesure *{SN}*.xlsx';
        
        // Find Excel file in Tracabilite directory (file name contains SN)
        const excelPath = await findExcelFile(excelBaseDir, excelPattern, sn);
        
        if (!excelPath) {
            log('warn', `No Excel file found in ${excelBaseDir} matching pattern ${excelPattern.replace('{SN}', sn)}`);
            processingFiles.delete(docxPath);
            return;
        }

        log('info', `Using Excel file: ${excelPath}`);

        // Update Excel with tag values
        await updateExcelNamedRanges(excelPath, tags, {
            retryAttempts: config.retryAttempts || 3,
            retryDelayMs: config.retryDelayMs || 2000,
            lockRetryMs: config.excelLockRetryMs || 1000,
            lockMaxRetries: config.excelLockMaxRetries || 10
        });

        log('info', `Successfully synchronized ${docxPath} → ${excelPath}`);

    } catch (error) {
        log('error', `Error processing file ${docxPath}:`, error.message);
        if (error.stack) {
            log('error', 'Stack trace:', error.stack);
        }
    } finally {
        processingFiles.delete(docxPath);
    }
}

/**
 * Handle file change events with debouncing.
 */
function handleFileChange(filePath) {
    // Clear existing timer for this file
    if (fileStabilityTimers.has(filePath)) {
        clearTimeout(fileStabilityTimers.get(filePath));
    }

    // Set a new timer to process the file after stability delay
    const timer = setTimeout(async () => {
        fileStabilityTimers.delete(filePath);
        await processFsopFile(filePath);
    }, config.stabilityDelayMs || 5000);

    fileStabilityTimers.set(filePath, timer);
}

/**
 * Main function: start watching the FSOP directory.
 */
async function startWatcher() {
    const fsopDir = config.fsopDir;

    if (!fsopDir) {
        log('error', 'fsopDir not configured in agent.config.json');
        process.exit(1);
    }

    // Check if directory exists
    try {
        await fs.access(fsopDir);
    } catch (error) {
        log('error', `FSOP directory not accessible: ${fsopDir}`, error.message);
        process.exit(1);
    }

    log('info', `Starting FSOP sync agent, watching: ${fsopDir}`);
    log('info', `Excel base directory: ${config.excelBaseDir || config.excelDir || config.excelPath || 'not configured'}`);
    log('info', `Excel pattern: ${config.excelPattern || '**/{SN}/*.xlsx'}`);
    log('info', `Stability delay: ${config.stabilityDelayMs || 5000}ms`);

    // Watch for changes in the FSOP directory
    const watcher = chokidar.watch(fsopDir, {
        ignored: /(^|[\/\\])\../, // Ignore hidden files
        persistent: true,
        ignoreInitial: false, // Process existing files on startup
        awaitWriteFinish: {
            stabilityThreshold: config.stabilityDelayMs || 5000,
            pollInterval: 1000
        }
    });

    watcher
        .on('add', (filePath) => {
            if (filePath.endsWith('.docx') && path.basename(filePath).startsWith('FSOP_')) {
                log('debug', `File added: ${filePath}`);
                handleFileChange(filePath);
            }
        })
        .on('change', (filePath) => {
            if (filePath.endsWith('.docx') && path.basename(filePath).startsWith('FSOP_')) {
                log('debug', `File changed: ${filePath}`);
                handleFileChange(filePath);
            }
        })
        .on('unlink', (filePath) => {
            // Clear timer if file is deleted
            if (fileStabilityTimers.has(filePath)) {
                clearTimeout(fileStabilityTimers.get(filePath));
                fileStabilityTimers.delete(filePath);
            }
        })
        .on('error', (error) => {
            log('error', `Watcher error:`, error.message);
        })
        .on('ready', () => {
            log('info', 'Watcher ready, monitoring for changes...');
        });

    // Graceful shutdown
    process.on('SIGINT', () => {
        log('info', 'Shutting down...');
        watcher.close().then(() => {
            log('info', 'Watcher closed');
            process.exit(0);
        });
    });

    process.on('SIGTERM', () => {
        log('info', 'Shutting down...');
        watcher.close().then(() => {
            log('info', 'Watcher closed');
            process.exit(0);
        });
    });
}

// Start the agent
startWatcher().catch((error) => {
    log('error', 'Failed to start watcher:', error.message);
    if (error.stack) {
        log('error', 'Stack trace:', error.stack);
    }
    process.exit(1);
});

