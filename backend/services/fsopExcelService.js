const ExcelJS = require('exceljs');
const fs = require('fs/promises');
const path = require('path');
const fsp = require('fs/promises');

/**
 * Find Excel file by reference in the traceability directory
 * Searches in: X:/Tracabilité/reference/ or X:/Tracabilité/reference/*.xlsx
 * 
 * @param {string} reference - Reference code (e.g., "RETA-697-HOI-23.199")
 * @param {string} traceRoot - Root traceability directory (e.g., "X:/Tracabilité")
 * @returns {Promise<string|null>} Path to Excel file or null if not found
 */
async function findExcelFileByReference(reference, traceRoot) {
    if (!reference || !traceRoot) {
        return null;
    }

    try {
        // Try pattern 1: X:/Tracabilité/reference/mesure*.xlsx
        const refDir = path.join(traceRoot, reference);
        if (await safeIsDirectory(refDir)) {
            const files = await listExcelFiles(refDir);
            if (files.length > 0) {
                // Return the most recent file if multiple matches
                const sortedFiles = files.sort((a, b) => {
                    return b.mtime - a.mtime;
                });
                console.log(`✅ Fichier Excel trouvé dans ${refDir}: ${sortedFiles[0].name}`);
                return sortedFiles[0].path;
            }
        }

        // Try pattern 2: X:/Tracabilité/*/mesure*reference*.xlsx (search in subdirectories)
        const subdirs = await listDirectories(traceRoot);
        for (const subdir of subdirs) {
            const subdirPath = path.join(traceRoot, subdir);
            const files = await listExcelFiles(subdirPath);
            const matchingFiles = files.filter(f => 
                f.name.toLowerCase().includes(reference.toLowerCase()) ||
                f.name.toLowerCase().includes('mesure')
            );
            if (matchingFiles.length > 0) {
                const sortedFiles = matchingFiles.sort((a, b) => b.mtime - a.mtime);
                console.log(`✅ Fichier Excel trouvé dans ${subdirPath}: ${sortedFiles[0].name}`);
                return sortedFiles[0].path;
            }
        }

        // Try pattern 3: X:/Tracabilité/mesure*reference*.xlsx (directly in root)
        const rootFiles = await listExcelFiles(traceRoot);
        const matchingRootFiles = rootFiles.filter(f => 
            f.name.toLowerCase().includes(reference.toLowerCase()) ||
            f.name.toLowerCase().includes('mesure')
        );
        if (matchingRootFiles.length > 0) {
            const sortedFiles = matchingRootFiles.sort((a, b) => b.mtime - a.mtime);
            console.log(`✅ Fichier Excel trouvé dans ${traceRoot}: ${sortedFiles[0].name}`);
            return sortedFiles[0].path;
        }

        console.warn(`⚠️ Aucun fichier Excel trouvé pour la référence ${reference} dans ${traceRoot}`);
        return null;
    } catch (error) {
        console.error(`❌ Erreur lors de la recherche du fichier Excel pour ${reference}:`, error.message);
        return null;
    }
}

/**
 * Update Excel file with tagged measures using named ranges
 * 
 * @param {string} excelPath - Path to Excel file
 * @param {Object} taggedMeasures - Object with tag names as keys and values as values
 * @param {Object} options - Options (retryAttempts, retryDelayMs, lockRetryMs, lockMaxRetries)
 * @returns {Promise<{success: boolean, updated: number, missing: string[]}>}
 */
async function updateExcelWithTaggedMeasures(excelPath, taggedMeasures, options = {}) {
    const {
        retryAttempts = 3,
        retryDelayMs = 2000,
        lockRetryMs = 1000,
        lockMaxRetries = 10
    } = options;

    if (!taggedMeasures || Object.keys(taggedMeasures).length === 0) {
        return {
            success: true,
            updated: 0,
            missing: [],
            message: 'Aucune mesure taguée à transférer'
        };
    }

    let attempt = 0;
    let lastError = null;

    while (attempt < retryAttempts) {
        try {
            // Check if file exists
            try {
                await fs.access(excelPath);
            } catch (_) {
                throw new Error(`Excel file not found: ${excelPath}`);
            }

            // Try to open the file (with retry if locked)
            let workbook;
            let lockAttempt = 0;
            
            while (lockAttempt < lockMaxRetries) {
                try {
                    workbook = new ExcelJS.Workbook();
                    await workbook.xlsx.readFile(excelPath);
                    break; // Successfully opened
                } catch (error) {
                    if (error.message && (error.message.includes('EBUSY') || error.message.includes('locked'))) {
                        // File is locked, wait and retry
                        lockAttempt++;
                        if (lockAttempt >= lockMaxRetries) {
                            throw new Error(`Excel file is locked after ${lockMaxRetries} attempts: ${excelPath}`);
                        }
                        await new Promise(resolve => setTimeout(resolve, lockRetryMs));
                        continue;
                    }
                    throw error; // Other error, rethrow
                }
            }

            if (!workbook) {
                throw new Error('Failed to open workbook');
            }

            // Update named ranges
            let updatedCount = 0;
            let missingRanges = [];

            for (const [tagName, value] of Object.entries(taggedMeasures)) {
                try {
                    const namedRange = workbook.definedNames.get(tagName);
                    
                    if (!namedRange) {
                        missingRanges.push(tagName);
                        continue;
                    }

                    // Get the range reference
                    const range = namedRange.ranges[0];
                    if (!range) {
                        console.warn(`Named range "${tagName}" has no range reference`);
                        continue;
                    }

                    // Parse the range (e.g., "Sheet1!$A$1" or "Sheet1!A1:B2")
                    const rangeMatch = range.match(/^([^!]+)!(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?$/);
                    if (!rangeMatch) {
                        console.warn(`Could not parse range for "${tagName}": ${range}`);
                        continue;
                    }

                    const sheetName = rangeMatch[1];
                    const startCell = rangeMatch[2].replace(/\$/g, ''); // Remove $ signs
                    const endCell = rangeMatch[3] ? rangeMatch[3].replace(/\$/g, '') : startCell;

                    const worksheet = workbook.getWorksheet(sheetName);
                    if (!worksheet) {
                        console.warn(`Worksheet "${sheetName}" not found for range "${tagName}"`);
                        continue;
                    }

                    // Update the cell(s)
                    const cell = worksheet.getCell(startCell);
                    cell.value = value;
                    updatedCount++;

                    console.log(`✅ Mis à jour "${tagName}" = "${value}" dans ${excelPath}`);

                } catch (error) {
                    console.error(`❌ Erreur lors de la mise à jour de la plage nommée "${tagName}":`, error.message);
                }
            }

            // Save the workbook (with retry if locked)
            lockAttempt = 0;
            while (lockAttempt < lockMaxRetries) {
                try {
                    await workbook.xlsx.writeFile(excelPath);
                    break; // Successfully saved
                } catch (error) {
                    if (error.message && (error.message.includes('EBUSY') || error.message.includes('locked'))) {
                        lockAttempt++;
                        if (lockAttempt >= lockMaxRetries) {
                            throw new Error(`Excel file is locked during save after ${lockMaxRetries} attempts`);
                        }
                        await new Promise(resolve => setTimeout(resolve, lockRetryMs));
                        continue;
                    }
                    throw error;
                }
            }

            return {
                success: true,
                updated: updatedCount,
                missing: missingRanges,
                message: `Mis à jour ${updatedCount} mesure(s) dans Excel`
            };

        } catch (error) {
            lastError = error;
            attempt++;
            
            if (attempt < retryAttempts) {
                console.warn(`⚠️ Tentative ${attempt} échouée, nouvelle tentative dans ${retryDelayMs}ms...`, error.message);
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            }
        }
    }

    throw new Error(`Failed to update Excel after ${retryAttempts} attempts: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Helper: Check if path is a directory (safe)
 */
async function safeIsDirectory(dirPath) {
    try {
        const stat = await fsp.stat(dirPath);
        return stat.isDirectory();
    } catch (_) {
        return false;
    }
}

/**
 * Helper: List Excel files in a directory
 */
async function listExcelFiles(dirPath) {
    const files = [];
    try {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.toLowerCase().endsWith('.xlsx')) {
                const fullPath = path.join(dirPath, entry.name);
                const stat = await fsp.stat(fullPath);
                files.push({
                    name: entry.name,
                    path: fullPath,
                    mtime: stat.mtime
                });
            }
        }
    } catch (error) {
        // Directory doesn't exist or can't be read
        console.debug(`Cannot read directory ${dirPath}:`, error.message);
    }
    return files;
}

/**
 * Helper: List subdirectories in a directory
 */
async function listDirectories(dirPath) {
    const dirs = [];
    try {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                dirs.push(entry.name);
            }
        }
    } catch (error) {
        // Directory doesn't exist or can't be read
        console.debug(`Cannot read directory ${dirPath}:`, error.message);
    }
    return dirs;
}

module.exports = {
    findExcelFileByReference,
    updateExcelWithTaggedMeasures
};




