const ExcelJS = require('exceljs');
const fs = require('fs/promises');
const path = require('path');
const fsp = require('fs/promises');

/**
 * Find mesure Excel file in launch directory or parent directories (flexible search)
 * Searches in: LT directory, parent directory, and up to 2 levels up
 * 
 * @param {string} launchNumber - Launch number (e.g., "LT2501132")
 * @param {string} traceRoot - Root traceability directory (e.g., "X:/Tracabilité")
 * @returns {Promise<string|null>} Path to Excel file or null if not found
 */
async function findMesureFileInLaunch(launchNumber, traceRoot) {
    if (!launchNumber || !traceRoot) {
        return null;
    }

    try {
        // Import resolveLtRoot from fsopWordService
        const { resolveLtRoot } = require('./fsopWordService');
        
        // Resolve launch directory
        const rootLt = await resolveLtRoot(traceRoot, launchNumber);
        if (!rootLt) {
            return null;
        }

        // Search strategy: check multiple locations
        const searchDirs = [rootLt];
        
        // Add parent directories (up to 2 levels up, but not beyond traceRoot)
        let currentDir = rootLt;
        for (let i = 0; i < 2; i++) {
            const parentDir = path.dirname(currentDir);
            // Stop if we've reached traceRoot or if parent is same as current (root reached)
            if (parentDir === traceRoot || parentDir === currentDir || !parentDir) {
                break;
            }
            searchDirs.push(parentDir);
            currentDir = parentDir;
        }

        // Search in all directories (in order of priority)
        for (const searchDir of searchDirs) {
            try {
                const excelFiles = await listExcelFiles(searchDir);
                const mesureFiles = excelFiles.filter(f => 
                    f.name.toLowerCase().includes('mesure')
                );

                if (mesureFiles.length > 0) {
                    // Use the most recent mesure file if multiple exist
                    const sortedFiles = mesureFiles.sort((a, b) => b.mtime - a.mtime);
                    console.log(`✅ Fichier mesure trouvé: ${sortedFiles[0].path}`);
                    return sortedFiles[0].path;
                }
            } catch (error) {
                // Continue to next directory if this one fails
                console.debug(`⚠️ Impossible de lire le répertoire ${searchDir}:`, error.message);
                continue;
            }
        }

        console.warn(`⚠️ Aucun fichier mesure trouvé pour ${launchNumber} dans les répertoires: ${searchDirs.join(', ')}`);
        return null;
    } catch (error) {
        console.error(`❌ Erreur lors de la recherche du fichier mesure pour ${launchNumber}:`, error.message);
        return null;
    }
}

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
 * Normalise un texte d'en-tête de colonne pour le comparer à un tag généré
 * Cette fonction doit rester cohérente avec generateTagFromColumnHeader côté frontend.
 */
function normalizeHeaderToTagLike(text) {
    if (!text) return '';
    let tag = String(text).trim();

    // Convertir "1er", "2ème" → "1", "2", etc.
    tag = tag.replace(/(\d+)(er|eme|ème|e)/gi, '$1');

    // Supprimer le contenu entre parenthèses, mais garder les unités courantes sous forme de suffixe
    tag = tag.replace(/\(([^)]+)\)/g, (match, content) => {
        if (/mm|db|°c|°f|°|kg|g|m|cm/i.test(content)) {
            return '_' + content.toUpperCase().trim();
        }
        return '';
    });

    // Supprimer les accents
    tag = tag.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Passer en majuscules
    tag = tag.toUpperCase();

    // Supprimer la ponctuation sauf underscore
    tag = tag.replace(/[^\w\s]/g, '');

    // Espaces → underscore, compresser les underscores
    tag = tag.replace(/\s+/g, '_').replace(/_+/g, '_');

    // Trim underscores
    tag = tag.replace(/^_+|_+$/g, '');

    return tag;
}

/**
 * Trouver l'index de colonne (1-based) correspondant à un tag, en utilisant la première ligne comme en-têtes.
 */
function findColumnByName(worksheet, tagName) {
    if (!worksheet || !tagName) return null;
    const normalizedTag = normalizeHeaderToTagLike(tagName);
    if (!normalizedTag) return null;

    const headerRow = worksheet.getRow(1);
    if (!headerRow) return null;

    for (let col = 1; col <= headerRow.cellCount; col++) {
        const cellValue = headerRow.getCell(col).value;
        if (!cellValue) continue;
        const normalizedHeader = normalizeHeaderToTagLike(cellValue);
        if (!normalizedHeader) continue;

        // Match strict ou partiel (tag contenu dans l'en-tête ou inversement)
        if (
            normalizedHeader === normalizedTag ||
            normalizedHeader.includes(normalizedTag) ||
            normalizedTag.includes(normalizedHeader)
        ) {
            return col;
        }
    }
    return null;
}

/**
 * Normaliser un numéro de série pour comparaison (enlever séparateurs)
 */
function normalizeSerialNumberForCompare(sn) {
    if (!sn) return '';
    return String(sn).replace(/[^0-9]/g, '');
}

/**
 * Trouver la ligne correspondant au numéro de série dans un worksheet.
 * On cherche une colonne \"SN\" (S/N, N° de S/N, Numéro de série, etc.) puis on parcourt les lignes.
 */
function findRowBySerialNumber(worksheet, serialNumber) {
    if (!worksheet || !serialNumber) return null;

    const normalizedTarget = normalizeSerialNumberForCompare(serialNumber);
    if (!normalizedTarget) return null;

    const headerRow = worksheet.getRow(1);
    if (!headerRow) return null;

    const candidateCols = [];

    for (let col = 1; col <= headerRow.cellCount; col++) {
        const headerVal = headerRow.getCell(col).value;
        if (!headerVal) continue;
        const headerText = String(headerVal).toLowerCase();

        // Chercher mots-clés typiques pour SN
        if (
            /s\/?n/.test(headerText) ||
            /num.*serie/.test(headerText) ||
            /no.*serie/.test(headerText) ||
            /\b(sn|serial)\b/.test(headerText)
        ) {
            candidateCols.push(col);
        }
    }

    if (candidateCols.length === 0) {
        return null;
    }

    for (let rowIdx = 2; rowIdx <= worksheet.rowCount; rowIdx++) {
        const row = worksheet.getRow(rowIdx);
        for (const col of candidateCols) {
            const cellVal = row.getCell(col).value;
            if (!cellVal) continue;
            const normalizedCell = normalizeSerialNumberForCompare(cellVal);
            if (normalizedCell && normalizedCell === normalizedTarget) {
                return rowIdx;
            }
        }
    }

    return null;
}

/**
 * Update Excel file with tagged measures.
 * Étapes :
 * - Si un numéro de série est fourni, tenter de trouver (ligne, colonne) automatiquement.
 * - Sinon (ou en fallback), utiliser les named ranges existants.
 * 
 * @param {string} excelPath - Path to Excel file
 * @param {Object} taggedMeasures - Object with tag names as keys and values as values
 * @param {Object} options - Options (serialNumber, retryAttempts, retryDelayMs, lockRetryMs, lockMaxRetries)
 * @returns {Promise<{success: boolean, updated: number, missing: string[]}>}
 */
async function updateExcelWithTaggedMeasures(excelPath, taggedMeasures, options = {}) {
    const {
        serialNumber = null,
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

            // Si possible, préparer la localisation de la ligne SN une seule fois
            let snWorksheet = null;
            let snRowIndex = null;

            if (serialNumber) {
                for (const ws of workbook.worksheets) {
                    const rowIdx = findRowBySerialNumber(ws, serialNumber);
                    if (rowIdx !== null) {
                        snWorksheet = ws;
                        snRowIndex = rowIdx;
                        console.log(`✅ Ligne SN trouvée pour ${serialNumber} dans la feuille "${ws.name}" (ligne ${rowIdx})`);
                        break;
                    }
                }

                if (!snWorksheet) {
                    console.warn(`⚠️ Aucune ligne trouvée pour le numéro de série ${serialNumber} dans ${excelPath}. Fallback sur les named ranges.`);
                }
            }

            // Mise à jour des valeurs (priorité 1: SN+colonne, priorité 2: named ranges)
            let updatedCount = 0;
            let missingRanges = [];
            const existingValues = {}; // Stocker les valeurs existantes pour confirmation

            for (const [tagName, value] of Object.entries(taggedMeasures)) {
                try {
                    let updatedHere = false;
                    let existingValue = null;
                    let cellLocation = null;

                    // Priorité 1 : si on a trouvé une ligne SN, essayer de trouver la colonne correspondante
                    if (snWorksheet && snRowIndex !== null) {
                        const colIdx = findColumnByName(snWorksheet, tagName);
                        if (colIdx !== null) {
                            const row = snWorksheet.getRow(snRowIndex);
                            const cell = row.getCell(colIdx);
                            
                            // Vérifier si la cellule contient déjà une valeur
                            if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
                                existingValue = String(cell.value).trim();
                                cellLocation = { sheet: snWorksheet.name, row: snRowIndex, col: colIdx };
                            }
                            
                            // Si forceReplace n'est pas activé et qu'il y a une valeur existante, stocker pour confirmation
                            if (!options.forceReplace && existingValue) {
                                existingValues[tagName] = {
                                    existing: existingValue,
                                    new: value,
                                    location: cellLocation
                                };
                                console.log(`⚠️ Valeur existante détectée pour "${tagName}": "${existingValue}" → "${value}"`);
                                continue; // Ne pas mettre à jour pour l'instant
                            }
                            
                            // Mettre à jour la cellule
                            cell.value = value;
                            updatedCount++;
                            updatedHere = true;
                            console.log(`✅ Mis à jour "${tagName}" = "${value}" par SN/colonne dans ${excelPath} (feuille "${snWorksheet.name}", ligne ${snRowIndex}, colonne ${colIdx})`);
                        }
                    }

                    // Priorité 2 : fallback sur named range si la mise à jour par colonne n'a pas fonctionné
                    if (!updatedHere) {
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

                        // Vérifier si la cellule contient déjà une valeur
                        const cell = worksheet.getCell(startCell);
                        if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
                            existingValue = String(cell.value).trim();
                            cellLocation = { sheet: sheetName, cell: startCell };
                        }
                        
                        // Si forceReplace n'est pas activé et qu'il y a une valeur existante, stocker pour confirmation
                        if (!options.forceReplace && existingValue) {
                            existingValues[tagName] = {
                                existing: existingValue,
                                new: value,
                                location: cellLocation
                            };
                            console.log(`⚠️ Valeur existante détectée pour "${tagName}" (named range): "${existingValue}" → "${value}"`);
                            continue; // Ne pas mettre à jour pour l'instant
                        }

                        // Update the cell(s)
                        cell.value = value;
                        updatedCount++;

                        console.log(`✅ Mis à jour "${tagName}" = "${value}" via named range dans ${excelPath}`);
                    }

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

            // Si des valeurs existantes ont été détectées et qu'on n'a pas forcé le remplacement
            if (Object.keys(existingValues).length > 0 && !options.forceReplace) {
                return {
                    success: false,
                    updated: updatedCount,
                    missing: missingRanges,
                    existingValues: existingValues,
                    needsConfirmation: true,
                    message: `${Object.keys(existingValues).length} valeur(s) existante(s) détectée(s). Confirmation requise avant remplacement.`
                };
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
            // Exclure les fichiers temporaires Excel (commencent par ~$)
            if (entry.isFile() && 
                entry.name.toLowerCase().endsWith('.xlsx') &&
                !entry.name.startsWith('~$')) {
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

/**
 * Find mesure Excel file in launch directory and validate serial number exists
 * 
 * @param {string} launchNumber - Launch number (e.g., "LT2501132")
 * @param {string} serialNumber - Serial number to search for (e.g., "20-24-30")
 * @param {string} traceRoot - Root traceability directory (e.g., "X:/Tracabilité")
 * @returns {Promise<{exists: boolean, excelPath: string|null, message: string}>}
 */
async function validateSerialNumberInMesure(launchNumber, serialNumber, traceRoot) {
    if (!launchNumber || !serialNumber || !traceRoot) {
        return {
            exists: false,
            excelPath: null,
            message: 'Paramètres manquants'
        };
    }

    try {
        // Import resolveLtRoot from fsopWordService
        const { resolveLtRoot } = require('./fsopWordService');
        
        // Resolve launch directory
        const rootLt = await resolveLtRoot(traceRoot, launchNumber);
        if (!rootLt) {
            return {
                exists: false,
                excelPath: null,
                message: `Répertoire du lancement ${launchNumber} introuvable`
            };
        }

        // Search strategy: check multiple locations (LT directory and parent directories)
        const searchDirs = [rootLt];
        
        // Add parent directories (up to 2 levels up, but not beyond traceRoot)
        let currentDir = rootLt;
        for (let i = 0; i < 2; i++) {
            const parentDir = path.dirname(currentDir);
            // Stop if we've reached traceRoot or if parent is same as current (root reached)
            if (parentDir === traceRoot || parentDir === currentDir || !parentDir) {
                break;
            }
            searchDirs.push(parentDir);
            currentDir = parentDir;
        }

        // Search in all directories (in order of priority)
        let mesureFiles = [];
        for (const searchDir of searchDirs) {
            try {
                const excelFiles = await listExcelFiles(searchDir);
                const foundFiles = excelFiles.filter(f => 
                    f.name.toLowerCase().includes('mesure')
                );
                mesureFiles.push(...foundFiles);
            } catch (error) {
                // Continue to next directory if this one fails
                console.debug(`⚠️ Impossible de lire le répertoire ${searchDir}:`, error.message);
                continue;
            }
        }

        if (mesureFiles.length === 0) {
            return {
                exists: false,
                excelPath: null,
                message: `Aucun fichier mesure trouvé dans le répertoire du lancement ${launchNumber} ou ses dossiers parents`
            };
        }

        // Use the most recent mesure file if multiple exist
        const sortedFiles = mesureFiles.sort((a, b) => b.mtime - a.mtime);
        const excelPath = sortedFiles[0].path;

        console.log(`🔍 Recherche du numéro de série "${serialNumber}" dans ${excelPath}`);

        // Vérifier que le fichier existe et est accessible
        try {
            const stats = await fs.stat(excelPath);
            if (stats.size === 0) {
                return {
                    exists: false,
                    excelPath: excelPath,
                    message: `Le fichier Excel est vide (0 octets). Le fichier est peut-être corrompu.`
                };
            }
            if (stats.size < 100) {
                return {
                    exists: false,
                    excelPath: excelPath,
                    message: `Le fichier Excel est trop petit (${stats.size} octets). Le fichier est probablement corrompu.`
                };
            }
        } catch (statError) {
            if (statError.code === 'ENOENT') {
                return {
                    exists: false,
                    excelPath: excelPath,
                    message: `Le fichier Excel n'existe pas ou a été déplacé.`
                };
            }
            if (statError.code === 'EACCES') {
                return {
                    exists: false,
                    excelPath: excelPath,
                    message: `Accès refusé au fichier Excel. Vérifiez les permissions.`
                };
            }
            // Continue si autre erreur (on essaiera quand même de lire)
        }

        // Open Excel file and search for serial number
        let workbook;
        try {
            workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(excelPath);
        } catch (error) {
            // Gérer les erreurs spécifiques
            if (error.message && (error.message.includes('EBUSY') || error.message.includes('locked'))) {
                return {
                    exists: false,
                    excelPath: excelPath,
                    message: `Le fichier Excel est verrouillé. Veuillez le fermer et réessayer.`
                };
            }
            // Erreurs JSZip (fichier corrompu)
            if (error.message && (
                error.message.includes('Can\'t find end of') ||
                error.message.includes('end of central directory') ||
                error.message.includes('corrupted') ||
                error.message.includes('invalid')
            )) {
                return {
                    exists: false,
                    excelPath: excelPath,
                    message: `Le fichier Excel est corrompu ou incomplet. Vérifiez que le fichier n'est pas en cours de téléchargement ou d'écriture, puis réessayez.`
                };
            }
            throw error;
        }

        // Search for serial number in all worksheets and cells
        // Format can be "20-24-30" or variations
        const serialNumberNormalized = serialNumber.trim();
        // Also try variations: with/without spaces, different separators
        const searchPatterns = [
            serialNumberNormalized,
            serialNumberNormalized.replace(/-/g, ' '),
            serialNumberNormalized.replace(/-/g, '.'),
            serialNumberNormalized.replace(/\s+/g, '-')
        ];

        let found = false;
        let foundLocation = null;

        for (const worksheet of workbook.worksheets) {
            worksheet.eachRow((row, rowNumber) => {
                row.eachCell((cell, colNumber) => {
                    if (cell.value !== null && cell.value !== undefined) {
                        const cellValue = String(cell.value).trim();
                        
                        // Check if any pattern matches
                        for (const pattern of searchPatterns) {
                            if (cellValue === pattern || cellValue.includes(pattern)) {
                                found = true;
                                foundLocation = {
                                    sheet: worksheet.name,
                                    row: rowNumber,
                                    col: colNumber
                                };
                                return false; // Stop iteration
                            }
                        }
                    }
                });
                
                if (found) {
                    return false; // Stop row iteration
                }
            });
            
            if (found) {
                break; // Stop worksheet iteration
            }
        }

        if (found) {
            console.log(`✅ Numéro de série "${serialNumber}" trouvé dans ${excelPath} à ${foundLocation.sheet}!${foundLocation.row}:${foundLocation.col}`);
            return {
                exists: true,
                excelPath: excelPath,
                message: `Numéro de série trouvé dans le fichier mesure`
            };
        } else {
            console.log(`❌ Numéro de série "${serialNumber}" non trouvé dans ${excelPath}`);
            return {
                exists: false,
                excelPath: excelPath,
                message: `Le numéro de série "${serialNumber}" n'existe pas dans le fichier mesure. Il doit être créé au préalable avant de continuer.`
            };
        }

    } catch (error) {
        console.error(`❌ Erreur lors de la validation du numéro de série:`, error.message);
        return {
            exists: false,
            excelPath: null,
            message: `Erreur lors de la validation: ${error.message}`
        };
    }
}

module.exports = {
    findExcelFileByReference,
    findMesureFileInLaunch,
    updateExcelWithTaggedMeasures,
    validateSerialNumberInMesure
};




