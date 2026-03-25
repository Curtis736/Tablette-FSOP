/**
 * Fonction pour modifier directement le XML Excel afin de préserver les structures
 * (tableaux, auto-filters, etc.) tout en mettant à jour uniquement les valeurs des cellules
 */

const AdmZip = require('adm-zip');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');

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

/**
 * Trouve et met à jour une cellule dans le XML Excel en préservant la structure
 */
function updateCellInSheetXml(sheetXml, rowNum, colNum, newValue) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        preserveOrder: true
    });
    
    const builder = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        preserveOrder: true,
        format: true
    });

    try {
        const xmlObj = parser.parse(sheetXml);
        
        // Trouver la feuille de calcul dans la structure
        // Structure Excel: <worksheet><sheetData><row><c>...</c></row></sheetData></worksheet>
        const worksheet = Array.isArray(xmlObj) ? xmlObj.find(item => item.worksheet) : xmlObj.worksheet;
        if (!worksheet) {
            throw new Error('Structure XML Excel non reconnue');
        }

        const sheetData = Array.isArray(worksheet) 
            ? worksheet.find(item => item.sheetData)?.sheetData
            : worksheet.sheetData;
        
        if (!sheetData) {
            throw new Error('sheetData non trouvé dans le XML');
        }

        const rows = Array.isArray(sheetData) 
            ? sheetData.find(item => Array.isArray(item.row))?.row || []
            : Array.isArray(sheetData.row) ? sheetData.row : [sheetData.row].filter(Boolean);

        // Trouver la ligne correspondante (r="rowNum")
        const targetRow = rows.find(row => {
            const rowAttrs = Array.isArray(row) ? row.find(item => item['@_r']) : row;
            if (Array.isArray(rowAttrs)) {
                const rAttr = rowAttrs.find(item => item['@_r']);
                return rAttr && parseInt(rAttr['@_r']) === rowNum;
            }
            return rowAttrs && parseInt(rowAttrs['@_r']) === rowNum;
        });

        if (!targetRow) {
            // Si la ligne n'existe pas, on doit la créer (cas complexe, à éviter si possible)
            console.warn(`⚠️ Ligne ${rowNum} non trouvée dans le XML, création nécessaire`);
            return sheetXml; // Retourner le XML inchangé pour l'instant
        }

        // Trouver la cellule dans la ligne (r="A5", "B5", etc.)
        const colLetter = columnNumberToLetter(colNum);
        const cellRef = `${colLetter}${rowNum}`;
        
        const cells = Array.isArray(targetRow) 
            ? targetRow.filter(item => item.c || (Array.isArray(item) && item.find(sub => sub.c)))
            : [targetRow].filter(item => item.c);

        let cellFound = false;
        for (let i = 0; i < cells.length; i++) {
            const cell = Array.isArray(cells[i]) ? cells[i].find(item => item.c) : cells[i];
            if (!cell || !cell.c) continue;

            const cellData = Array.isArray(cell.c) ? cell.c[0] : cell.c;
            if (cellData['@_r'] === cellRef) {
                // Mettre à jour la valeur de la cellule
                // Les cellules Excel peuvent avoir: <v>value</v> (inline) ou <v>0</v> avec référence à sharedStrings
                if (typeof newValue === 'number') {
                    // Valeur numérique inline
                    cellData.v = [{ '#text': String(newValue) }];
                    // Supprimer la référence à sharedStrings si elle existe
                    delete cellData['@_t'];
                } else {
                    // Valeur texte - utiliser sharedStrings serait mieux, mais pour simplifier on met inline
                    cellData.v = [{ '#text': String(newValue) }];
                    cellData['@_t'] = 'inlineStr';
                }
                cellFound = true;
                break;
            }
        }

        if (!cellFound) {
            // La cellule n'existe pas, on doit la créer dans la ligne
            console.warn(`⚠️ Cellule ${cellRef} non trouvée, création nécessaire`);
            // Pour l'instant, on retourne le XML inchangé
            return sheetXml;
        }

        // Reconstruire le XML
        return builder.build(xmlObj);
    } catch (error) {
        console.error(`❌ Erreur lors de la modification du XML Excel:`, error.message);
        throw error;
    }
}

/**
 * Met à jour une cellule dans un fichier Excel en modifiant directement le XML
 * Préserve toutes les structures (tableaux, auto-filters, etc.)
 */
async function updateExcelCellByXml(excelPath, sheetName, rowNum, colNum, newValue) {
    const zip = new AdmZip(excelPath);
    
    // Trouver le fichier XML de la feuille
    // Les fichiers Excel stockent les feuilles dans xl/worksheets/sheet1.xml, sheet2.xml, etc.
    // On doit trouver le bon fichier en fonction du nom de la feuille
    const sheetEntry = zip.getEntry(`xl/worksheets/${sheetName}.xml`);
    if (!sheetEntry) {
        // Essayer avec un numéro si le nom ne fonctionne pas
        const allEntries = zip.getEntries();
        const sheetFiles = allEntries.filter(e => e.entryName.startsWith('xl/worksheets/sheet') && e.entryName.endsWith('.xml'));
        if (sheetFiles.length === 0) {
            throw new Error('Aucune feuille de calcul trouvée dans le fichier Excel');
        }
        // Pour simplifier, utiliser la première feuille
        const firstSheet = sheetFiles[0];
        const sheetXml = firstSheet.getData().toString('utf8');
        const updatedXml = updateCellInSheetXml(sheetXml, rowNum, colNum, newValue);
        zip.updateFile(firstSheet.entryName, Buffer.from(updatedXml, 'utf8'));
    } else {
        const sheetXml = sheetEntry.getData().toString('utf8');
        const updatedXml = updateCellInSheetXml(sheetXml, rowNum, colNum, newValue);
        zip.updateFile(sheetEntry.entryName, Buffer.from(updatedXml, 'utf8'));
    }
    
    // Sauvegarder le fichier modifié
    zip.writeZip(excelPath);
}

module.exports = {
    updateExcelCellByXml,
    columnNumberToLetter
};
