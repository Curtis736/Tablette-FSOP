const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');

async function safeExists(targetPath) {
    try {
        await fsp.access(targetPath, fs.constants.F_OK);
        return true;
    } catch (_) {
        return false;
    }
}

async function safeIsDirectory(targetPath) {
    try {
        const stat = await fsp.stat(targetPath);
        return stat.isDirectory();
    } catch (_) {
        return false;
    }
}

async function safeIsFile(targetPath) {
    try {
        const stat = await fsp.stat(targetPath);
        return stat.isFile();
    } catch (_) {
        return false;
    }
}

/**
 * Find template file by code (e.g., F571) in FSOP directory and subdirectories.
 * Searches for files starting with the template code.
 */
async function findTemplateFile(fsopDir, templateCode, depthLimit = 3) {
    const normalizedTemplate = String(templateCode || '').toUpperCase();
    const stack = [{ dir: fsopDir, depth: 0 }];
    const candidates = [];
    const allDocxFiles = []; // Pour le débogage
    let filesChecked = 0;

    console.log(`🔍 Recherche template ${normalizedTemplate} dans ${fsopDir} (profondeur max: ${depthLimit})`);

    // Accept both:
    // - "F479-..." / "F479 ... " / "F479.docx"
    // - "F 479 ..." / "F-479 ..." / "F_479 ..."
    // - "TEMPLATE_F479..." / "TEMPLATE F 479 ..." (legacy)
    // Also, some files include the code later in the name (e.g. "TBL6 - F 479 ind A ...").
    const templateLetter = normalizedTemplate.slice(0, 1);
    const templateDigits = normalizedTemplate.slice(1);
    const templateFlexible = `${templateLetter}[\\s._-]*${templateDigits}`;
    const templateRegex = new RegExp(`^${templateFlexible}(?:$|[\\s._-])`);
    const legacyTemplateRegex = new RegExp(`^TEMPLATE[\\s._-]*${templateFlexible}(?:$|[\\s._-])`);
    const templateAnywhereRegex = new RegExp(`(?:^|[^A-Z0-9])${templateFlexible}(?:$|[^A-Z0-9])`);

    while (stack.length > 0) {
        const { dir, depth } = stack.pop();

        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch (err) {
            console.warn(`⚠️ Impossible de lire le répertoire ${dir}:`, err.message);
            continue;
        }

        for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (depth < depthLimit) {
                    stack.push({ dir: entryPath, depth: depth + 1 });
                }
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            const fileName = entry.name;
            const lowerName = fileName.toLowerCase();
            
            if (!lowerName.endsWith('.docx')) {
                continue;
            }
            
            filesChecked++;
            allDocxFiles.push(fileName); // Pour le débogage
            
            // Chercher les fichiers qui commencent par le code template (ex: F571)
            // Gérer les espaces encodés (%20) et les caractères spéciaux
            let decodedName;
            try {
                decodedName = decodeURIComponent(fileName);
            } catch (_) {
                decodedName = fileName; // Si le décodage échoue, utiliser le nom original
            }
            const upperName = decodedName.toUpperCase().trim();
            const upperTemplate = normalizedTemplate;
            
            // Accept template files that start with:
            // - "Fxxx..." (preferred)
            // - "TEMPLATE_Fxxx..." (legacy)
            const matchesTemplateStart =
                templateRegex.test(upperName) ||
                legacyTemplateRegex.test(upperName);
            const matchesTemplateAnywhere = templateAnywhereRegex.test(upperName);
            
            // Prefer strict matches (start of filename). If none exist at all, we'll fall back to "anywhere".
            if (matchesTemplateStart) {
                console.log(`✅✅✅ CANDIDAT TROUVÉ: ${entryPath}`);
                console.log(`   📄 Nom original: "${fileName}"`);
                console.log(`   📄 Nom décodé: "${decodedName}"`);
                console.log(`   📄 Nom en majuscules: "${upperName}"`);
                console.log(`   🔍 Template recherché: "${upperTemplate}"`);
                try {
                    const stat = await fsp.stat(entryPath);
                    candidates.push({ path: entryPath, mtimeMs: stat.mtimeMs, name: fileName, match: 'start' });
                    console.log(`   ✅ Fichier ajouté aux candidats (${candidates.length} candidat(s))`);
                } catch (err) {
                    console.warn(`   ⚠️ Impossible d'accéder au fichier:`, err.message);
                }
            } else if (matchesTemplateAnywhere) {
                // Store as a fallback candidate; we'll only use these if no "start" candidates exist.
                try {
                    const stat = await fsp.stat(entryPath);
                    candidates.push({ path: entryPath, mtimeMs: stat.mtimeMs, name: fileName, match: 'anywhere' });
                } catch (_) {
                    // ignore
                }
            } else {
                // Log seulement les fichiers qui commencent par F pour le débogage
                if (upperName.startsWith('F') && filesChecked <= 100) {
                    console.log(`   ⏭️  Ignoré: "${fileName}" (ne commence pas par "${upperTemplate}")`);
                }
            }
        }
    }

    console.log(`📊 Recherche terminée: ${filesChecked} fichiers .docx vérifiés, ${candidates.length} candidat(s) trouvé(s)`);
    
    // Si aucun candidat trouvé, afficher tous les fichiers Fxxx pour le débogage
    if (candidates.length === 0 && filesChecked > 0) {
        const fFiles = allDocxFiles.filter(f => f.toUpperCase().startsWith('F'));
        console.log(`⚠️ Aucun candidat trouvé. Fichiers commençant par "F" trouvés (${fFiles.length}):`, fFiles.slice(0, 20));
        console.log(`⚠️ Template recherché: "${normalizedTemplate}"`);
    }

    if (candidates.length === 0) {
        return null;
    }

    // Prefer "start" matches; fallback to "anywhere" matches if needed.
    const startCandidates = candidates.filter(c => c.match === 'start');
    const pool = startCandidates.length > 0 ? startCandidates : candidates;

    // Retourner le plus récent
    pool.sort((a, b) => b.mtimeMs - a.mtimeMs);
    console.log(`✅ Template sélectionné (${startCandidates.length > 0 ? 'start' : 'anywhere'} match): ${pool[0].path}`);
    return pool[0].path;
}

/**
 * Depth-limited search for an existing FSOP docx for a given template code.
 * Constraints:
 * - Only searches within the LT root (and optionally LT/FSOP first)
 * - Only *.docx
 * - Excludes templates (basename starting with excludePrefix)
 * - Filename must contain templateCode (case-insensitive)
 * - Chooses most recent (mtime desc) if multiple candidates
 */
async function findExistingDocx(rootDir, templateCode, depthLimit = 3, excludePrefix = 'TEMPLATE_') {
    const normalizedTemplate = String(templateCode || '').toLowerCase();
    const stack = [{ dir: rootDir, depth: 0 }];
    const candidates = [];

    while (stack.length > 0) {
        const { dir, depth } = stack.pop();

        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch (_) {
            continue;
        }

        for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (depth < depthLimit) {
                    stack.push({ dir: entryPath, depth: depth + 1 });
                }
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            const lowerName = entry.name.toLowerCase();
            if (!lowerName.endsWith('.docx')) {
                continue;
            }
            if (entry.name.startsWith(excludePrefix)) {
                continue;
            }
            if (!lowerName.includes(normalizedTemplate)) {
                continue;
            }

            try {
                const stat = await fsp.stat(entryPath);
                candidates.push({ path: entryPath, mtimeMs: stat.mtimeMs });
            } catch (_) {
                // ignore
            }
        }
    }

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0].path;
}

/**
 * Resolve the LT root directory by searching at depth 1 under traceRoot.
 * Tries:
 * 1. <traceRoot>/<launchNumber> (direct, for compatibility)
 * 2. <traceRoot>/<child>/<launchNumber> (depth 1, for nested structure)
 * Returns the resolved path if found, null otherwise.
 */
async function resolveLtRoot(traceRoot, launchNumber) {
    // Try 1: Direct path (compatibility)
    const directPath = path.join(traceRoot, launchNumber);
    if (await safeIsDirectory(directPath)) {
        return directPath;
    }

    // Try 2: Search at depth 1
    try {
        const entries = await fsp.readdir(traceRoot, { withFileTypes: true });
        
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            
            const childPath = path.join(traceRoot, entry.name);
            const ltPath = path.join(childPath, launchNumber);
            
            if (await safeIsDirectory(ltPath)) {
                return ltPath;
            }
        }
    } catch (error) {
        // If we can't read the directory, return null
        console.warn(`⚠️ Cannot read traceRoot directory: ${traceRoot}`, error.message);
        return null;
    }

    // Not found
    return null;
}

/**
 * Inject replacements into a docx by replacing raw placeholders in word/document.xml.
 * Requires templates to contain placeholders as a single contiguous string (not split across runs).
 * 
 * @param {string} docxPath - Path to the .docx file
 * @param {Object} replacements - Object with placeholder replacements (e.g., {'{{LT}}': 'LT2400182'})
 * @param {Object} tableData - Optional: Object with table data { tableId: { rowId: { columnIndex: value } } }
 * @param {Object} passFailData - Optional: Object with PASS/FAIL selections { sectionId: { field: 'PASS'|'FAIL' } }
 * @param {Object} checkboxData - Optional: Object with checkbox states { sectionId: { checkboxId: true|false } }
 * @param {Object} textFieldsData - Optional: Object with text field values { sectionId: { fieldIndex: value } }
 */
async function injectIntoDocx(docxPath, replacements = {}, tableData = {}, passFailData = {}, checkboxData = {}, textFieldsData = {}) {
    let zip;
    let backupPath = null;
    try {
        // Create a backup of the original file before modification
        backupPath = docxPath + '.backup';
        try {
            await fsp.copyFile(docxPath, backupPath);
            console.log(`📦 Sauvegarde créée: ${backupPath}`);
        } catch (backupError) {
            console.warn(`⚠️ Impossible de créer une sauvegarde: ${backupError.message}`);
            // Continue anyway, but we won't be able to restore
        }
        
        // Load the DOCX file
        zip = new AdmZip(docxPath);
        const entry = zip.getEntry('word/document.xml');
        if (!entry) {
            throw new Error('DOCX_DOCUMENT_XML_NOT_FOUND');
        }

        let xml = entry.getData().toString('utf8');
        
        // Validate that we have valid XML before modifications
        if (!xml || xml.trim().length === 0) {
            throw new Error('DOCX_DOCUMENT_XML_EMPTY');
        }
        
        // Store original length for validation
        const originalLength = xml.length;
        
        // Replace placeholders (existing functionality)
        // Escape replacement values to prevent XML corruption
        for (const [needle, value] of Object.entries(replacements)) {
            const escapedValue = escapeXml(String(value || ''));
            xml = xml.split(String(needle)).join(escapedValue);
        }
        
        // Inject table data
        if (Object.keys(tableData).length > 0) {
            xml = injectTableData(xml, tableData);
        }
        
        // Inject PASS/FAIL selections
        if (Object.keys(passFailData).length > 0) {
            xml = injectPassFailData(xml, passFailData);
        }
        
        // Inject checkbox states
        if (Object.keys(checkboxData).length > 0) {
            xml = injectCheckboxData(xml, checkboxData);
        }
        
        // Inject text field values
        if (Object.keys(textFieldsData).length > 0) {
            xml = injectTextFieldsData(xml, textFieldsData);
        }
        
        // Enhanced XML validation: check for well-formed structure
        // Ensure XML is not empty
        if (!xml || xml.trim().length === 0) {
            throw new Error('DOCX_DOCUMENT_XML_BECAME_EMPTY');
        }
        
        // Check for balanced tags (basic validation)
        const openTags = (xml.match(/</g) || []).length;
        const closeTags = (xml.match(/>/g) || []).length;
        if (openTags === 0 || closeTags === 0) {
            throw new Error('DOCX_XML_MALFORMED: Missing tags');
        }
        
        // Check for unclosed tags (more strict validation)
        const tagStack = [];
        const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9:]*)[^>]*>/g;
        let tagMatch;
        let validationErrors = [];
        
        while ((tagMatch = tagRegex.exec(xml)) !== null) {
            const fullTag = tagMatch[0];
            const tagName = tagMatch[1];
            const isClosing = fullTag.startsWith('</');
            
            if (!isClosing && !fullTag.endsWith('/>')) {
                // Opening tag
                tagStack.push(tagName);
            } else if (isClosing) {
                // Closing tag
                if (tagStack.length === 0) {
                    validationErrors.push(`Unmatched closing tag: ${tagName}`);
                } else {
                    const lastOpen = tagStack.pop();
                    if (lastOpen !== tagName) {
                        validationErrors.push(`Mismatched tags: expected ${lastOpen}, got ${tagName}`);
                    }
                }
            }
        }
        
        if (tagStack.length > 0) {
            validationErrors.push(`Unclosed tags: ${tagStack.join(', ')}`);
        }
        
        if (validationErrors.length > 0) {
            console.error(`⚠️ XML validation errors detected:`, validationErrors);
            // Don't throw immediately, but log - some Word documents have non-standard XML
            // that still works in Word
        }
        
        // Check for common XML corruption patterns
        if (xml.includes('&lt;&lt;') || xml.includes('&gt;&gt;') || xml.includes('&amp;&amp;')) {
            console.warn(`⚠️ Potential double-escaped XML entities detected`);
        }
        
        // Ensure we have the essential Word document structure
        if (!xml.includes('<w:document') && !xml.includes('<w:body')) {
            throw new Error('DOCX_XML_MALFORMED: Missing essential Word document structure');
        }

        // Update the ZIP entry
        zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'));
        
        // Write to a temporary file first to avoid corruption if write fails
        const tempPath = docxPath + '.tmp';
        try {
            zip.writeZip(tempPath);
            
            // Verify the temp file was created and has content
            const tempStats = await fsp.stat(tempPath);
            if (tempStats.size === 0) {
                throw new Error('DOCX_TEMP_FILE_EMPTY');
            }
            
            // Replace original file with temp file atomically
            await fsp.rename(tempPath, docxPath);
            
            // Verify the final file exists and has content
            const finalStats = await fsp.stat(docxPath);
            if (finalStats.size === 0) {
                throw new Error('DOCX_FINAL_FILE_EMPTY');
            }
            
            // Verify the file is a valid ZIP (DOCX files are ZIP archives)
            try {
                const verifyZip = new AdmZip(docxPath);
                const verifyEntry = verifyZip.getEntry('word/document.xml');
                if (!verifyEntry) {
                    throw new Error('DOCX_INVALID: Missing word/document.xml after write');
                }
                // Try to read the XML to ensure it's valid
                const verifyXml = verifyEntry.getData().toString('utf8');
                if (!verifyXml || verifyXml.trim().length === 0) {
                    throw new Error('DOCX_INVALID: Empty word/document.xml after write');
                }
                console.log(`✅ DOCX validé: ${docxPath} (${finalStats.size} bytes)`);
            } catch (verifyError) {
                console.error(`❌ DOCX invalide après écriture:`, verifyError.message);
                // Try to restore from backup if possible
                if (backupPath) {
                    try {
                        await fsp.copyFile(backupPath, docxPath);
                        console.log(`🔄 Fichier restauré depuis la sauvegarde`);
                        await fsp.unlink(backupPath).catch(() => {});
                    } catch (restoreError) {
                        console.error(`❌ Impossible de restaurer depuis la sauvegarde:`, restoreError.message);
                    }
                }
                throw new Error(`DOCX_INVALID: Le fichier généré est corrompu: ${verifyError.message}`);
            }
            
            // Remove backup if everything is OK
            if (backupPath) {
                try {
                    await fsp.unlink(backupPath).catch(() => {});
                } catch (_) {
                    // Ignore cleanup errors
                }
            }
            
            console.log(`✅ DOCX modifié avec succès: ${docxPath} (${finalStats.size} bytes)`);
        } catch (writeError) {
            // Clean up temp file if it exists
            try {
                await fsp.unlink(tempPath).catch(() => {});
            } catch (_) {
                // Ignore cleanup errors
            }
            
            // If rename failed, try direct write as fallback
            if (writeError.code === 'EACCES' || writeError.code === 'EPERM' || writeError.code === 'EBUSY') {
                console.warn(`⚠️ Impossible d'écrire le fichier temporaire, tentative d'écriture directe...`);
                zip.writeZip(docxPath);
            } else {
                throw writeError;
            }
        }
    } catch (error) {
        console.error(`❌ Erreur lors de l'injection dans le DOCX: ${docxPath}`, error.message);
        
        // Try to restore from backup if available
        if (backupPath) {
            try {
                const backupExists = await safeIsFile(backupPath);
                if (backupExists) {
                    await fsp.copyFile(backupPath, docxPath);
                    console.log(`🔄 Fichier restauré depuis la sauvegarde après erreur`);
                    await fsp.unlink(backupPath).catch(() => {});
                }
            } catch (restoreError) {
                console.error(`❌ Impossible de restaurer depuis la sauvegarde:`, restoreError.message);
            }
        }
        
        throw new Error(`Impossible de modifier le fichier DOCX: ${error.message}`);
    }
}

/**
 * Inject table data into XML by finding table cells and replacing their content
 */
function injectTableData(xml, tableData) {
    // For each table in tableData
    for (const [tableId, rows] of Object.entries(tableData)) {
        // Find tables in XML (simplified approach - match by position/index)
        const tableRegex = /<w:tbl[^>]*>([\s\S]*?)<\/w:tbl>/g;
        const tables = [];
        let match;
        let tableIndex = 0;
        
        while ((match = tableRegex.exec(xml)) !== null) {
            tables.push({
                index: tableIndex++,
                xml: match[0],
                content: match[1],
                startIndex: match.index,
                endIndex: match.index + match[0].length
            });
        }
        
        // If we have data for this table, inject it
        const targetTableIndex = parseInt(tableId, 10);
        if (targetTableIndex >= 0 && targetTableIndex < tables.length) {
            const table = tables[targetTableIndex];
            let tableXml = table.content;
            
            // Extract rows
            const rowRegex = /<w:tr[^>]*>([\s\S]*?)<\/w:tr>/g;
            const tableRows = [];
            let rowMatch;
            let rowIndex = 0;
            
            while ((rowMatch = rowRegex.exec(tableXml)) !== null) {
                tableRows.push({
                    index: rowIndex++,
                    xml: rowMatch[0],
                    content: rowMatch[1],
                    startIndex: rowMatch.index,
                    endIndex: rowMatch.index + rowMatch[0].length
                });
            }
            
            // Inject data into rows (skip header row, index 0)
            for (const [rowId, cells] of Object.entries(rows)) {
                const targetRowIndex = parseInt(rowId, 10) + 1; // +1 to skip header
                if (targetRowIndex > 0 && targetRowIndex < tableRows.length) {
                    const row = tableRows[targetRowIndex];
                    let rowXml = row.content;
                    
                    // Extract cells
                    const cellRegex = /<w:tc[^>]*>([\s\S]*?)<\/w:tc>/g;
                    const rowCells = [];
                    let cellMatch;
                    let cellIndex = 0;
                    
                    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
                        rowCells.push({
                            index: cellIndex++,
                            xml: cellMatch[0],
                            content: cellMatch[1],
                            startIndex: cellMatch.index,
                            endIndex: cellMatch.index + cellMatch[0].length
                        });
                    }
                    
                    // Replace cell content - use safer approach to preserve XML structure
                    // Build a map of cell indices to their original XML for safe replacement
                    const cellReplacements = new Map();
                    
                    for (const [columnIndex, value] of Object.entries(cells)) {
                        const targetCellIndex = parseInt(columnIndex, 10);
                        if (targetCellIndex >= 0 && targetCellIndex < rowCells.length) {
                            const cell = rowCells[targetCellIndex];
                            const escapedValue = escapeXml(String(value || ''));
                            
                            // Replace only the text content, preserving all other XML structure
                            // Use a more specific pattern that matches the text run content
                            let updatedCellXml = cell.xml;
                            
                            // Find all text runs in the cell and replace the first one (or all if needed)
                            const textRunPattern = /<w:t[^>]*>([^<]*)<\/w:t>/;
                            const textRunMatch = updatedCellXml.match(textRunPattern);
                            
                            if (textRunMatch) {
                                // Replace only the first text run content, preserving attributes
                                updatedCellXml = updatedCellXml.replace(
                                    textRunPattern,
                                    (match, content) => {
                                        // Preserve any attributes from the original w:t tag
                                        const tagMatch = match.match(/<w:t([^>]*)>/);
                                        const attrs = tagMatch ? tagMatch[1] : '';
                                        return `<w:t${attrs}>${escapedValue}</w:t>`;
                                    }
                                );
                            } else {
                                // If no text run found, add one (shouldn't happen in valid Word docs)
                                console.warn(`⚠️ No text run found in cell ${targetCellIndex}, adding one`);
                                updatedCellXml = updatedCellXml.replace(
                                    /<\/w:tc>/,
                                    `<w:t>${escapedValue}</w:t></w:tc>`
                                );
                            }
                            
                            cellReplacements.set(targetCellIndex, {
                                original: cell.xml,
                                updated: updatedCellXml
                            });
                        }
                    }
                    
                    // Apply replacements in reverse order to preserve indices
                    const sortedReplacements = Array.from(cellReplacements.entries()).sort((a, b) => b[0] - a[0]);
                    for (const [_, replacement] of sortedReplacements) {
                        // Use replace with the exact original XML to avoid multiple matches
                        const index = rowXml.indexOf(replacement.original);
                        if (index !== -1) {
                            rowXml = rowXml.substring(0, index) + 
                                    replacement.updated + 
                                    rowXml.substring(index + replacement.original.length);
                        }
                    }
                    
                    // Update table XML with modified row - use index-based replacement for safety
                    // Replace using the exact position to avoid multiple matches
                    const rowIndexInTable = tableXml.indexOf(row.xml);
                    if (rowIndexInTable !== -1) {
                        tableXml = tableXml.substring(0, rowIndexInTable) + 
                                  `<w:tr>${rowXml}</w:tr>` + 
                                  tableXml.substring(rowIndexInTable + row.xml.length);
                    } else {
                        console.warn(`⚠️ Could not find row XML in table, skipping update for row ${targetRowIndex}`);
                    }
                }
            }
            
            // Update main XML with modified table - use index-based replacement for safety
            // Replace using the exact position to avoid multiple matches
            const tableIndexInXml = xml.indexOf(table.xml);
            if (tableIndexInXml !== -1) {
                xml = xml.substring(0, tableIndexInXml) + 
                      `<w:tbl>${tableXml}</w:tbl>` + 
                      xml.substring(tableIndexInXml + table.xml.length);
            } else {
                console.warn(`⚠️ Could not find table XML in document, skipping update for table ${targetTableIndex}`);
            }
        }
    }
    
    return xml;
}

/**
 * Inject PASS/FAIL selections into XML
 */
function injectPassFailData(xml, passFailData) {
    // For each section with PASS/FAIL data
    for (const [sectionId, fields] of Object.entries(passFailData)) {
        // Find text patterns like "Connecteur 1: PASS" or "Connecteur 1: FAIL"
        for (const [field, value] of Object.entries(fields)) {
            const passPattern = new RegExp(`(${escapeRegex(field)}:\\s*)PASS`, 'gi');
            const failPattern = new RegExp(`(${escapeRegex(field)}:\\s*)FAIL`, 'gi');
            
            if (value === 'PASS') {
                xml = xml.replace(passPattern, `$1PASS`);
                xml = xml.replace(failPattern, `$1PASS`);
            } else if (value === 'FAIL') {
                xml = xml.replace(passPattern, `$1FAIL`);
                xml = xml.replace(failPattern, `$1FAIL`);
            }
        }
    }
    
    return xml;
}

/**
 * Inject text field values into XML
 * Text fields are simple input fields like "Voie du cordon sur connecteur 38999 : _______"
 */
function injectTextFieldsData(xml, textFieldsData) {
    // For each section with text field data
    for (const [sectionId, fields] of Object.entries(textFieldsData)) {
        // We need to find the label pattern and replace the placeholder (underscores)
        // Since we don't have the exact label stored, we'll search for patterns like "Label : _______"
        // and replace the underscores with the value
        for (const [fieldIndex, value] of Object.entries(fields)) {
            if (value && value.trim()) {
                // Pattern: find text followed by colon and underscores, replace underscores with value
                // This is a simplified approach - in a more sophisticated implementation,
                // we would store the label and match it exactly
                const underscorePattern = /([^:]+):\s*_{3,}/g;
                let match;
                let matchCount = 0;
                const matches = [];
                
                // Collect all matches first
                while ((match = underscorePattern.exec(xml)) !== null) {
                    matches.push({
                        fullMatch: match[0],
                        label: match[1].trim(),
                        index: match.index
                    });
                }
                
                // Replace the match at the specified fieldIndex
                if (fieldIndex < matches.length) {
                    const targetMatch = matches[parseInt(fieldIndex, 10)];
                    if (targetMatch) {
                        const replacement = `${targetMatch.label}: ${value}`;
                        xml = xml.replace(targetMatch.fullMatch, replacement);
                    }
                }
            }
        }
    }
    
    return xml;
}

/**
 * Inject checkbox states into XML
 */
function injectCheckboxData(xml, checkboxData) {
    // For each section with checkbox data
    for (const [sectionId, checkboxes] of Object.entries(checkboxData)) {
        // Find checkbox symbols (☐, ☑) and replace them
        for (const [checkboxId, checked] of Object.entries(checkboxes)) {
            if (checked) {
                // Replace ☐ with ☑ (checked)
                xml = xml.replace(/☐/g, '☑');
                // Also handle [ ] -> [x]
                xml = xml.replace(/\[\s*\]/g, '[x]');
            } else {
                // Replace ☑ with ☐ (unchecked)
                xml = xml.replace(/☑/g, '☐');
                // Also handle [x] -> [ ]
                xml = xml.replace(/\[x\]/g, '[ ]');
            }
        }
    }
    
    return xml;
}

/**
 * Escape XML special characters
 */
function escapeXml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Escape regex special characters
 */
function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    safeExists,
    safeIsDirectory,
    safeIsFile,
    findExistingDocx,
    findTemplateFile,
    injectIntoDocx,
    resolveLtRoot
};


