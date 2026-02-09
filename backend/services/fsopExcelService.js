const ExcelJS = require('exceljs');
const AdmZip = require('adm-zip');
const yauzl = require('yauzl');
const yazl = require('yazl');
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
 * Trouver la ligne d'en-tête la plus probable dans une feuille.
 * Certains fichiers ont un titre sur les lignes 1-2 et les vrais en-têtes sur la ligne 3 (comme sur ton screenshot).
 * Heuristique: chercher une ligne contenant des libellés SN et/ou "Lancement".
 */
function detectHeaderRowIndex(worksheet, maxScanRows = 10) {
    if (!worksheet) return 1;
    const max = Math.min(maxScanRows, worksheet.rowCount || maxScanRows);

    let bestRow = null;
    let bestScore = 0;

    for (let rowIdx = 1; rowIdx <= max; rowIdx++) {
        const row = worksheet.getRow(rowIdx);
        if (!row || row.cellCount === 0) continue;

        let hitSN = false;
        let hitLaunch = false;
        let hitMeasureTag = false; // Détecter les tags de mesures (IL_, RL_, etc.)
        let nonEmpty = 0;

        for (let col = 1; col <= row.cellCount; col++) {
            const v = row.getCell(col).value;
            if (v === null || v === undefined || v === '') continue;
            nonEmpty++;
            const t = String(v).toLowerCase();
            if (/s\/?n/.test(t) || /num.*serie/.test(t) || /no.*serie/.test(t) || /\b(sn|serial)\b/.test(t)) hitSN = true;
            if (t.includes('lancement')) hitLaunch = true;
            // Détecter les tags de mesures (ex: **IL_940_A**, **RL_COEUR_V940**, etc.)
            if (/\*\*[ilr][l_].*\*\*/.test(t) || /il_|rl_|pi_/.test(t)) hitMeasureTag = true;
        }

        // Score: ligne avec tags de mesures > ligne avec SN/Lancement > autres
        let score = 0;
        if (nonEmpty >= 3) {
            if (hitMeasureTag) {
                score = 100; // Priorité maximale aux lignes avec tags de mesures
            } else if (hitSN || hitLaunch) {
                score = 50; // Priorité moyenne aux lignes avec SN/Lancement
            }
        }

        if (score > bestScore) {
            bestScore = score;
            bestRow = rowIdx;
        }
    }

    // Si on a trouvé une ligne avec tags de mesures, l'utiliser
    // Sinon, utiliser la première ligne avec SN/Lancement (compatibilité)
    if (bestRow !== null) {
        return bestRow;
    }

    // Fallback: chercher la première ligne avec SN/Lancement (ancien comportement)
    for (let rowIdx = 1; rowIdx <= max; rowIdx++) {
        const row = worksheet.getRow(rowIdx);
        if (!row || row.cellCount === 0) continue;

        let hitSN = false;
        let hitLaunch = false;
        let nonEmpty = 0;

        for (let col = 1; col <= row.cellCount; col++) {
            const v = row.getCell(col).value;
            if (v === null || v === undefined || v === '') continue;
            nonEmpty++;
            const t = String(v).toLowerCase();
            if (/s\/?n/.test(t) || /num.*serie/.test(t) || /no.*serie/.test(t) || /\b(sn|serial)\b/.test(t)) hitSN = true;
            if (t.includes('lancement')) hitLaunch = true;
        }

        if (nonEmpty >= 3 && (hitSN || hitLaunch)) {
            return rowIdx;
        }
    }
    return 1;
}

/**
 * Trouver l'index de colonne (1-based) correspondant à un tag, en utilisant la première ligne comme en-têtes.
 */
function findColumnByName(worksheet, tagName, headerRowIndex = 1) {
    if (!worksheet || !tagName) return null;
    const normalizedTag = normalizeHeaderToTagLike(tagName);
    if (!normalizedTag) return null;

    const headerRow = worksheet.getRow(headerRowIndex || 1);
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
function findRowBySerialNumber(worksheet, serialNumber, headerRowIndex = 1) {
    if (!worksheet || !serialNumber) return null;

    const normalizedTarget = normalizeSerialNumberForCompare(serialNumber);
    if (!normalizedTarget) return null;

    const headerRow = worksheet.getRow(headerRowIndex || 1);
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

    for (let rowIdx = (headerRowIndex || 1) + 1; rowIdx <= worksheet.rowCount; rowIdx++) {
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
 * Convertit un numéro de colonne (1-based) en référence Excel (A, B, ..., Z, AA, AB, ...)
 */
function columnNumberToLetter(colNum) {
    let result = '';
    while (colNum > 0) {
        colNum--;
        result = String.fromCharCode(65 + (colNum % 26)) + result;
        colNum = Math.floor(colNum / 26);
    }
    return result;
}

function colLetterToNumber(col) {
    let n = 0;
    const s = String(col || '').toUpperCase();
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code < 65 || code > 90) return null;
        n = n * 26 + (code - 64);
    }
    return n || null;
}

function numToColLetter(num) {
    let result = '';
    let n = Number(num);
    while (n > 0) {
        n--;
        result = String.fromCharCode(65 + (n % 26)) + result;
        n = Math.floor(n / 26);
    }
    return result;
}

function parseA1Range(range) {
    const m = String(range || '').match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
    if (!m) return null;
    return {
        startCol: m[1].toUpperCase(),
        startRow: Number(m[2]),
        endCol: m[3].toUpperCase(),
        endRow: Number(m[4])
    };
}

function buildRepairedTableXmlShrink(tableXml, desiredCount) {
    const get = (re) => tableXml.match(re)?.[1] ?? null;
    const ref = get(/\sref="([^"]+)"/);
    if (!ref) throw new Error('TABLE_REPAIR: Missing ref attribute');
    const r = parseA1Range(ref);
    if (!r) throw new Error(`TABLE_REPAIR: Cannot parse ref: ${ref}`);
    if (!desiredCount || desiredCount <= 0) throw new Error(`TABLE_REPAIR: Invalid desiredCount: ${desiredCount}`);

    const startColNum = colLetterToNumber(r.startCol);
    if (!startColNum) throw new Error(`TABLE_REPAIR: Invalid startCol: ${r.startCol}`);
    const endCol = numToColLetter(startColNum + desiredCount - 1);
    const newRef = `${r.startCol}${r.startRow}:${endCol}${r.endRow}`;

    const colBlockMatch = tableXml.match(/<tableColumns\b[^>]*>[\s\S]*?<\/tableColumns>/i);
    if (!colBlockMatch) throw new Error('TABLE_REPAIR: tableColumns block not found');
    const colTags = [...colBlockMatch[0].matchAll(/<tableColumn\b[^>]*\/>/gi)].map((m) => m[0]);
    if (colTags.length === 0) throw new Error('TABLE_REPAIR: No tableColumn tags found');

    const kept = colTags.slice(0, desiredCount).map((tag, idx) => {
        if (/\sid="/i.test(tag)) return tag.replace(/\sid="(\d+)"/i, ` id="${idx + 1}"`);
        return tag.replace(/<tableColumn\b/i, `<tableColumn id="${idx + 1}"`);
    });

    const newTableColumns = `<tableColumns count="${desiredCount}">${kept.join('')}</tableColumns>`;

    let out = tableXml;
    // headerRowCount must be 1 for a normal table
    if (out.includes('headerRowCount="0"')) out = out.replace(/headerRowCount="0"/, 'headerRowCount="1"');
    else if (!/headerRowCount="/.test(out)) out = out.replace(/<table\b/, '<table headerRowCount="1"');

    out = out.replace(/\sref="[^"]+"/, ` ref="${newRef}"`);
    out = out.replace(/<autoFilter\b([^>]*?)\sref="[^"]+"/, `<autoFilter$1 ref="${newRef}"`);
    out = out.replace(/<tableColumns\b[\s\S]*?<\/tableColumns>/i, newTableColumns);
    return out;
}

async function repairExcelTablesIfNeededByXmlDirect(excelPath, options = {}) {
    const lockRetryMs = options.lockRetryMs || 500;
    const lockMaxRetries = options.lockMaxRetries || 5;

    // Open ZIP and read all entries to find tables
    const zip = await new Promise((resolve, reject) => {
        let attempt = 0;
        const tryOpen = () => {
            yauzl.open(excelPath, { lazyEntries: true }, (err, z) => {
                if (err) {
                    if ((err.code === 'EBUSY' || err.code === 'EPERM' || err.message?.includes('locked')) && attempt < lockMaxRetries) {
                        attempt++;
                        setTimeout(tryOpen, lockRetryMs);
                        return;
                    }
                    reject(err);
                    return;
                }
                resolve(z);
            });
        };
        tryOpen();
    });

    const entries = [];
    const dataMap = new Map();

    const readEntry = (entry) =>
        new Promise((resolve, reject) => {
            zip.openReadStream(entry, (err, stream) => {
                if (err) return reject(err);
                const chunks = [];
                stream.on('data', (c) => chunks.push(c));
                stream.on('end', () => resolve(Buffer.concat(chunks)));
                stream.on('error', reject);
            });
        });

    await new Promise((resolve, reject) => {
        zip.readEntry();
        zip.on('entry', async (entry) => {
            try {
                entries.push(entry);
                if (!entry.fileName.endsWith('/')) {
                    const buf = await readEntry(entry);
                    dataMap.set(entry.fileName, buf);
                }
                zip.readEntry();
            } catch (e) {
                reject(e);
            }
        });
        zip.on('end', resolve);
        zip.on('error', reject);
    }).finally(() => {
        try { zip.close(); } catch (_) {}
    });

    const tableNames = entries
        .map((e) => e.fileName)
        .filter((n) => n.startsWith('xl/tables/table') && n.endsWith('.xml'));

    if (tableNames.length === 0) return { repaired: 0 };

    const replacements = new Map();
    for (const name of tableNames) {
        const xml = dataMap.get(name)?.toString('utf8');
        if (!xml) continue;
        const ref = xml.match(/\sref="([^"]+)"/)?.[1];
        const r = ref ? parseA1Range(ref) : null;
        const count = Number(xml.match(/<tableColumns[^>]*\scount="(\d+)"/i)?.[1] || 0);
        if (!r || !count) continue;
        const width = (colLetterToNumber(r.endCol) - colLetterToNumber(r.startCol) + 1);
        const headerRowCount = Number(xml.match(/\sheaderRowCount="(\d+)"/i)?.[1] || 0);
        if (width !== count || headerRowCount === 0) {
            const repairedXml = buildRepairedTableXmlShrink(xml, count);
            replacements.set(name, Buffer.from(repairedXml, 'utf8'));
        }
    }

    if (replacements.size === 0) return { repaired: 0 };

    // Write new ZIP keeping everything else identical (same strategy as updateExcelCellByXmlDirect)
    const tempPath = excelPath + '.tmp.tables.' + Date.now();
    const outZip = new yazl.ZipFile();
    const outStream = require('fs').createWriteStream(tempPath);
    outZip.outputStream.pipe(outStream);

    for (const e of entries) {
        if (e.fileName.endsWith('/')) continue;
        const buf = replacements.get(e.fileName) || dataMap.get(e.fileName);
        if (!buf) continue;
        outZip.addBuffer(buf, e.fileName, {
            mtime: e.getLastModDate(),
            mode: e.externalFileAttributes >>> 16,
            compress: e.compressionMethod !== 0
        });
    }
    outZip.end();
    await new Promise((resolve, reject) => {
        outStream.on('close', resolve);
        outStream.on('finish', resolve);
        outStream.on('error', reject);
    });

    let attempt = 0;
    while (attempt < lockMaxRetries) {
        try {
            await fsp.rename(tempPath, excelPath);
            break;
        } catch (e) {
            if (e.code === 'EBUSY' || e.code === 'EPERM' || e.message?.includes('locked')) {
                attempt++;
                if (attempt >= lockMaxRetries) throw e;
                await new Promise((r) => setTimeout(r, lockRetryMs));
                continue;
            }
            throw e;
        }
    }
    return { repaired: replacements.size };
}

/**
 * Met à jour une cellule dans un fichier Excel en modifiant directement le XML
 * Préserve toutes les structures (tableaux, auto-filters, etc.)
 * 
 * ⚠️ NOTE IMPORTANTE : 
 * Excel peut afficher un avertissement de corruption lors de l'ouverture du fichier modifié.
 * C'est un comportement normal dû à la réécriture du ZIP qui change les métadonnées (CRC, timestamps).
 * Le fichier fonctionne correctement après réparation automatique par Excel (cliquer sur "Oui").
 * Le contenu et la structure sont préservés, seule la détection d'intégrité ZIP change.
 * 
 * @param {string} excelPath - Chemin du fichier Excel
 * @param {string} sheetName - Nom de la feuille
 * @param {number} rowNum - Numéro de ligne (1-based)
 * @param {number} colNum - Numéro de colonne (1-based)
 * @param {any} newValue - Nouvelle valeur
 * @param {Object} options - Options (lockRetryMs, lockMaxRetries)
 */
async function updateExcelCellByXmlDirect(excelPath, sheetName, rowNum, colNum, newValue, options = {}) {
    const lockRetryMs = options.lockRetryMs || 500;
    const lockMaxRetries = options.lockMaxRetries || 5;
    
    // Réparer automatiquement les définitions de tableaux incohérentes avant écriture,
    // sinon Excel peut "réparer" et supprimer tableau/filtre.
    try {
        await repairExcelTablesIfNeededByXmlDirect(excelPath, { lockRetryMs, lockMaxRetries });
    } catch (e) {
        // Non bloquant: on tente quand même l'écriture cellule
        console.warn(`⚠️ Table repair skipped: ${e.message}`);
    }

    // ⚡ Utiliser yauzl/yazl pour préserver la structure du ZIP
    
    // Convertir le numéro de colonne en lettre Excel
    const colLetter = columnNumberToLetter(colNum);
    const cellRef = `${colLetter}${rowNum}`;
    
    // Convertir la valeur en nombre si possible
    let valueToWrite = newValue;
    if (typeof newValue === 'number') {
        valueToWrite = String(newValue);
    } else {
        const numValue = parseFloat(String(newValue).replace(',', '.'));
        if (!isNaN(numValue) && isFinite(numValue)) {
            valueToWrite = String(numValue);
        } else {
            valueToWrite = String(newValue);
        }
    }
    
    // Trouver le fichier XML de la feuille à modifier
    let targetSheetPath = null;
    let sheetXml = null;
    
    // Ouvrir le ZIP avec yauzl (lecture seule, préserve l'ordre)
    const zipFile = await new Promise((resolve, reject) => {
        let lockAttempt = 0;
        const tryOpen = () => {
            yauzl.open(excelPath, { lazyEntries: true }, (err, zip) => {
                if (err) {
                    if ((err.code === 'EBUSY' || err.code === 'EPERM' || err.message?.includes('locked')) && lockAttempt < lockMaxRetries) {
                        lockAttempt++;
                        setTimeout(tryOpen, lockRetryMs);
                        return;
                    }
                    reject(err);
                    return;
                }
                resolve(zip);
            });
        };
        tryOpen();
    });
    
    // Parcourir les entrées pour trouver la feuille et lire son contenu
    await new Promise((resolve, reject) => {
        zipFile.readEntry();
        zipFile.on('entry', (entry) => {
            if (entry.fileName.startsWith('xl/worksheets/sheet') && entry.fileName.endsWith('.xml')) {
                if (!targetSheetPath) {
                    // Utiliser la première feuille trouvée
                    targetSheetPath = entry.fileName;
                    zipFile.openReadStream(entry, (err, readStream) => {
                        if (err) {
                            zipFile.close();
                            reject(err);
                            return;
                        }
                        const chunks = [];
                        readStream.on('data', (chunk) => chunks.push(chunk));
                        readStream.on('end', () => {
                            sheetXml = Buffer.concat(chunks).toString('utf8');
                            zipFile.readEntry(); // Continuer à lire les autres entrées
                        });
                        readStream.on('error', (err) => {
                            zipFile.close();
                            reject(err);
                        });
                    });
                } else {
                    zipFile.readEntry();
                }
            } else {
                zipFile.readEntry();
            }
        });
        
        zipFile.on('end', () => {
            zipFile.close();
            if (!targetSheetPath || !sheetXml) {
                reject(new Error('Aucune feuille de calcul trouvée dans le fichier Excel'));
            } else {
                resolve();
            }
        });
        zipFile.on('error', (err) => {
            zipFile.close();
            reject(err);
        });
    });
    
    if (!targetSheetPath || !sheetXml) {
        throw new Error('Aucune feuille de calcul trouvée dans le fichier Excel');
    }
    
    // Modifier le XML de la feuille
    const cellPattern = new RegExp(
        `(<c[^>]*r="${cellRef}"[^>]*>)([\\s\\S]*?)(</c>)`,
        'i'
    );
    
    const match = sheetXml.match(cellPattern);
    if (!match) {
        throw new Error(`Cellule ${cellRef} non trouvée dans le XML`);
    }
    
    // Extraire les parties de la cellule
    let cellOpenTag = match[1];
    const cellContent = match[2];
    const cellCloseTag = match[3];
    
    // Supprimer t="s" si présent (shared string)
    cellOpenTag = cellOpenTag.replace(/\s+t="s"/, '');
    
    // Modifier la valeur
    let newCellContent = cellContent;
    const valuePattern = /<v[^>]*>([^<]*)<\/v>/;
    const valueMatch = cellContent.match(valuePattern);
    
    if (valueMatch) {
        newCellContent = cellContent.replace(valuePattern, `<v>${valueToWrite}</v>`);
    } else {
        newCellContent = cellContent.trim() + `<v>${valueToWrite}</v>`;
    }
    
    const updatedCell = cellOpenTag + newCellContent + cellCloseTag;
    const updatedXml = sheetXml.replace(cellPattern, updatedCell);
    
    // ⚡ APPROCHE: Utiliser yauzl/yazl pour préserver la structure
    // La modification en place est désactivée car elle corrompt la central directory
    // TODO: Corriger la fonction modifyZipEntryInPlace pour gérer correctement les offsets
    
    const tempPath = excelPath + '.tmp.' + Date.now();
    const outputZip = new yazl.ZipFile();
    const outputStream = require('fs').createWriteStream(tempPath);

    // ⚠️ IMPORTANT: yazl s'utilise en "pipe" (ZipFile.outputStream -> file stream)
    // Ne pas écraser outputStream, sinon le ZIP généré peut être invalide pour Excel.
    outputZip.outputStream.pipe(outputStream);
        
        // Réouvrir le ZIP pour copier toutes les entrées dans le même ordre
        const sourceZip = await new Promise((resolve, reject) => {
            yauzl.open(excelPath, { lazyEntries: true }, (err, zip) => {
                if (err) reject(err);
                else resolve(zip);
            });
        });
        
        // Lire toutes les entrées et leurs données
        const entries = [];
        const entryDataMap = new Map();
        
        sourceZip.readEntry();
        sourceZip.on('entry', async (entry) => {
            entries.push(entry);
            
            // Ignorer les répertoires (se terminent par /)
            if (entry.fileName.endsWith('/')) {
                sourceZip.readEntry();
                return;
            }
            
            // Lire immédiatement les données de cette entrée (pendant que le ZIP est ouvert)
            if (entry.fileName === targetSheetPath) {
                // Utiliser le XML modifié pour cette entrée
                entryDataMap.set(entry.fileName, Buffer.from(updatedXml, 'utf8'));
                sourceZip.readEntry();
            } else {
                // Lire les données de l'entrée originale
                try {
                    const entryData = await new Promise((resolve, reject) => {
                        sourceZip.openReadStream(entry, (err, stream) => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            const chunks = [];
                            stream.on('data', (chunk) => chunks.push(chunk));
                            stream.on('end', () => resolve(Buffer.concat(chunks)));
                            stream.on('error', reject);
                        });
                    });
                    entryDataMap.set(entry.fileName, entryData);
                    sourceZip.readEntry();
                } catch (err) {
                    sourceZip.emit('error', err);
                }
            }
        });
        
        await new Promise((resolve, reject) => {
            sourceZip.on('end', () => {
                sourceZip.close();
                resolve();
            });
            sourceZip.on('error', (err) => {
                sourceZip.close();
                reject(err);
            });
        });
        
        // Ajouter toutes les entrées dans le même ordre (ignorer les répertoires)
        for (const entry of entries) {
            // Ignorer les entrées de répertoire (se terminent par /)
            if (entry.fileName.endsWith('/')) {
                continue;
            }
            
            const entryData = entryDataMap.get(entry.fileName);
            if (!entryData) {
                // Si les données n'ont pas été lues (peut arriver pour les répertoires), ignorer
                continue;
            }
            
            // ⚡ CRITIQUE: Préserver la méthode de compression originale (Excel utilise souvent 'store' pour les XML)
            // yazl utilise 'deflate' par défaut, mais Excel peut utiliser 'store' (pas de compression)
            const compressionMethod = entry.compressionMethod === 0 ? 'store' : 'deflate';
            
            outputZip.addBuffer(entryData, entry.fileName, {
                mtime: entry.getLastModDate(),
                mode: entry.externalFileAttributes >>> 16,
                compress: compressionMethod === 'deflate' // yazl: true = deflate, false = store
            });
        }
        
        // Finaliser le ZIP de sortie
        outputZip.end();
        await new Promise((resolve, reject) => {
            outputStream.on('close', resolve);
            outputStream.on('error', reject);
            // Au cas où le stream se termine sans 'close' (rare), on écoute aussi 'finish'
            outputStream.on('finish', resolve);
        });
        
        // Remplacer atomiquement le fichier original
        let lockAttempt = 0;
        while (lockAttempt < lockMaxRetries) {
            try {
                await fsp.rename(tempPath, excelPath);
                break;
            } catch (error) {
                if (error.code === 'EBUSY' || error.code === 'EPERM' || error.message?.includes('locked')) {
                    lockAttempt++;
                    if (lockAttempt >= lockMaxRetries) {
                        await fsp.unlink(tempPath).catch(() => {});
                        throw new Error(`Excel file is locked during save after ${lockMaxRetries} attempts: ${excelPath}`);
                    }
                    await new Promise(resolve => setTimeout(resolve, lockRetryMs));
                    continue;
                }
                await fsp.unlink(tempPath).catch(() => {});
                throw error;
            }
        }
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

    // Vérifier dès le début si le fichier est modifiable (évite des retries inutiles)
    // Sur Windows / lecteurs réseau, un fichier "Lecture seule" provoque souvent EPERM lors du rename/write.
    try {
        const fh = await require('fs/promises').open(excelPath, 'r+');
        await fh.close();
    } catch (e) {
        if (e && (e.code === 'EPERM' || e.code === 'EACCES')) {
            throw new Error(
                `EXCEL_FILE_NOT_WRITABLE: Le fichier n'est pas modifiable (Lecture seule ou droits insuffisants): ${excelPath}. ` +
                `Décochez "Lecture seule" dans Propriétés et réessayez.`
            );
        }
        // Si le fichier n'existe pas ou autre erreur, on laisse la logique existante gérer
    }

    // ⚠️ IMPORTANT: ExcelJS ne préserve pas les structures de tableaux Excel (tables, auto-filters)
    // Créer une sauvegarde avant modification
    let backupPath = null;
    try {
        backupPath = excelPath + '.backup.' + Date.now();
        await fs.copyFile(excelPath, backupPath);
        console.log(`📦 Sauvegarde créée: ${backupPath}`);
    } catch (backupError) {
        console.warn(`⚠️ Impossible de créer une sauvegarde: ${backupError.message}`);
        // Continue quand même, mais on ne pourra pas restaurer
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
            // Utiliser les options pour préserver les structures de tableaux
            let workbook;
            let lockAttempt = 0;
            
            while (lockAttempt < lockMaxRetries) {
                try {
                    workbook = new ExcelJS.Workbook();
                    // Options pour préserver les structures Excel (tableaux, filtres, etc.)
                    await workbook.xlsx.readFile(excelPath, {
                        ignoreNodes: [] // Ne pas ignorer de nœuds pour préserver la structure
                    });
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
            let snHeaderRowIndex = 1;

            if (serialNumber) {
                for (const ws of workbook.worksheets) {
                    const headerIdx = detectHeaderRowIndex(ws, 10);
                    const rowIdx = findRowBySerialNumber(ws, serialNumber, headerIdx);
                    if (rowIdx !== null) {
                        snWorksheet = ws;
                        snRowIndex = rowIdx;
                        snHeaderRowIndex = headerIdx;
                        console.log(`✅ Ligne SN trouvée pour ${serialNumber} dans la feuille "${ws.name}" (en-tête ligne ${headerIdx}, données ligne ${rowIdx})`);
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
            let usedXmlDirect = false; // Suivre si on a utilisé la modification XML directe
            let usedExcelJS = false; // Suivre si on a utilisé ExcelJS (nécessite sauvegarde)

            for (const [tagName, value] of Object.entries(taggedMeasures)) {
                try {
                    let updatedHere = false;
                    let existingValue = null;
                    let cellLocation = null;

                    // Priorité 1 : si on a trouvé une ligne SN, essayer de trouver la colonne correspondante
                    if (snWorksheet && snRowIndex !== null) {
                        const colIdx = findColumnByName(snWorksheet, tagName, snHeaderRowIndex);
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
                            
                            // Mettre à jour la cellule - convertir en nombre si possible
                            let cellValue = value;
                            // Essayer de convertir en nombre si c'est un nombre valide
                            if (typeof value === 'string') {
                                const numValue = parseFloat(value.replace(',', '.'));
                                if (!isNaN(numValue) && isFinite(numValue)) {
                                    cellValue = numValue;
                                }
                            }
                            
                            // ⚡ NOUVELLE APPROCHE: Modifier directement le XML pour préserver les structures
                            // Au lieu d'utiliser ExcelJS pour réécrire, on modifie juste la valeur dans le XML
                            try {
                                await updateExcelCellByXmlDirect(excelPath, snWorksheet.name, snRowIndex, colIdx, cellValue);
                                updatedCount++;
                                updatedHere = true;
                                usedXmlDirect = true;
                                console.log(`✅ Mis à jour "${tagName}" = "${cellValue}" par SN/colonne dans ${excelPath} (feuille "${snWorksheet.name}", ligne ${snRowIndex}, colonne ${colIdx}) - Structure préservée`);
                            } catch (xmlError) {
                                // Fallback sur ExcelJS si la modification XML échoue
                                console.warn(`⚠️ Modification XML échouée, fallback sur ExcelJS: ${xmlError.message}`);
                                cell.value = cellValue;
                                updatedCount++;
                                updatedHere = true;
                                usedExcelJS = true;
                                console.log(`✅ Mis à jour "${tagName}" = "${cellValue}" par SN/colonne (fallback ExcelJS)`);
                            }
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

                        // Update the cell(s) - convertir en nombre si possible
                        let cellValue = value;
                        if (typeof value === 'string') {
                            const numValue = parseFloat(value.replace(',', '.'));
                            if (!isNaN(numValue) && isFinite(numValue)) {
                                cellValue = numValue;
                            }
                        }
                        cell.value = cellValue;
                        updatedCount++;
                        usedExcelJS = true;

                        console.log(`✅ Mis à jour "${tagName}" = "${cellValue}" via named range dans ${excelPath}`);
                    }

                } catch (error) {
                    console.error(`❌ Erreur lors de la mise à jour de la plage nommée "${tagName}":`, error.message);
                }
            }

            // ⚡ Les modifications XML directes ont déjà été sauvegardées dans updateExcelCellByXmlDirect
            // Pas besoin de réécrire le fichier avec ExcelJS, ce qui préserve toutes les structures
            // Si on a utilisé ExcelJS, alors on doit sauvegarder
            const needsExcelJSSave = usedExcelJS; // Si on a utilisé ExcelJS pour certaines cellules
            
            if (needsExcelJSSave) {
                // Save the workbook (with retry if locked) - seulement si on a utilisé ExcelJS
                const tempPath = excelPath + '.tmp';
                lockAttempt = 0;
                while (lockAttempt < lockMaxRetries) {
                    try {
                        await workbook.xlsx.writeFile(tempPath);
                        const tempStats = await fs.stat(tempPath);
                        if (tempStats.size === 0) {
                            throw new Error('Le fichier temporaire est vide');
                        }
                        await fs.rename(tempPath, excelPath);
                        const finalStats = await fs.stat(excelPath);
                        if (finalStats.size === 0) {
                            throw new Error('Le fichier final est vide après sauvegarde');
                        }
                        break;
                    } catch (error) {
                        try {
                            await fs.unlink(tempPath).catch(() => {});
                        } catch (_) {}
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

            // Nettoyer la sauvegarde si tout s'est bien passé ET si on a utilisé la modification XML (qui préserve les structures)
            if (backupPath && usedXmlDirect && !usedExcelJS) {
                try {
                    await fs.unlink(backupPath).catch(() => {});
                    console.log(`🧹 Sauvegarde nettoyée: ${backupPath}`);
                } catch (_) {
                    // Ignorer les erreurs de nettoyage
                }
            } else if (backupPath) {
                // Garder la sauvegarde si on a utilisé ExcelJS (qui peut corrompre)
                console.log(`📦 Sauvegarde conservée: ${backupPath} (modification via ExcelJS détectée)`);
            }

            return {
                success: true,
                updated: updatedCount,
                missing: missingRanges,
                message: usedXmlDirect && !usedExcelJS 
                    ? `Mis à jour ${updatedCount} mesure(s) dans Excel (structure préservée)`
                    : `Mis à jour ${updatedCount} mesure(s) dans Excel`,
                warning: usedExcelJS 
                    ? 'Note: Les structures de tableaux Excel (tables, auto-filters) peuvent être perdues. Une sauvegarde a été créée avant modification.'
                    : undefined,
                backupPath: backupPath || undefined
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

    // En cas d'échec, essayer de restaurer depuis la sauvegarde
    if (backupPath) {
        try {
            const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
            if (backupExists) {
                await fs.copyFile(backupPath, excelPath);
                console.log(`🔄 Fichier restauré depuis la sauvegarde: ${backupPath}`);
                await fs.unlink(backupPath).catch(() => {});
            }
        } catch (restoreError) {
            console.error(`❌ Impossible de restaurer depuis la sauvegarde:`, restoreError.message);
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
    validateSerialNumberInMesure,
    __test: {
        detectHeaderRowIndex,
        findRowBySerialNumber,
        findColumnByName,
        normalizeHeaderToTagLike
    }
};




