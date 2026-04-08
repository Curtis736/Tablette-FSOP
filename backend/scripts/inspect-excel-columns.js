/**
 * Script pour inspecter les colonnes d'un fichier Excel
 * Aide à identifier les noms de colonnes et leur normalisation
 */

const ExcelJS = require('exceljs');
const fs = require('fs/promises');
const path = require('path');

const { detectHeaderRowIndex, findColumnByName, normalizeHeaderToTagLike } = require('../services/fsopExcelService').__test;

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        console.error('Usage: node scripts/inspect-excel-columns.js <excel-path> <serial-number>');
        console.error('Exemple: node scripts/inspect-excel-columns.js "X:/Tracabilite/CP-MUXISH-ELIO25.004/mesures AGS 25.004.xlsx" 1000');
        process.exit(1);
    }

    const excelPath = args[0];
    const serialNumber = args[1];

    try {
        await fs.access(excelPath);
        console.log(`✅ Fichier trouvé: ${excelPath}\n`);
    } catch (error) {
        console.error(`❌ Fichier non trouvé: ${excelPath}`);
        process.exit(1);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(excelPath);

    console.log(`📊 Feuilles dans le fichier:\n`);
    for (const worksheet of workbook.worksheets) {
        console.log(`   - ${worksheet.name} (${worksheet.rowCount} lignes, ${worksheet.columnCount} colonnes)`);
        
        // Détecter la ligne d'en-tête
        const headerRowIndex = detectHeaderRowIndex(worksheet, 10);
        console.log(`     Ligne d'en-tête détectée automatiquement: ${headerRowIndex}`);
        
        // Afficher aussi les lignes 3 et 4 pour vérification
        for (let checkRow = 2; checkRow <= 4; checkRow++) {
            const checkHeaderRow = worksheet.getRow(checkRow);
            console.log(`\n     Ligne ${checkRow}:`);
            let hasContent = false;
            for (let col = 1; col <= Math.min(checkHeaderRow.cellCount, 25); col++) {
                const cell = checkHeaderRow.getCell(col);
                const value = cell.value;
                if (value && String(value).trim() !== '') {
                    const normalized = normalizeHeaderToTagLike(String(value));
                    console.log(`       Col ${col}: "${String(value).substring(0, 50)}" → "${normalized}"`);
                    hasContent = true;
                }
            }
            if (!hasContent) {
                console.log(`       (vide)`);
            }
        }
        
        // Utiliser la ligne détectée ou la ligne 4
        const actualHeaderRow = headerRowIndex || 4;
        console.log(`\n     Utilisation de la ligne ${actualHeaderRow} comme en-tête`);
        
        // Chercher le numéro de série
        if (headerRowIndex) {
            const { findRowBySerialNumber } = require('../services/fsopExcelService').__test;
            const rowIndex = findRowBySerialNumber(worksheet, serialNumber, headerRowIndex);
            if (rowIndex) {
                console.log(`\n     ✅ Ligne trouvée pour SN ${serialNumber}: ligne ${rowIndex}`);
                const dataRow = worksheet.getRow(rowIndex);
                console.log(`     Valeurs dans cette ligne:`);
                for (let col = 1; col <= Math.min(dataRow.cellCount, 20); col++) {
                    const cell = dataRow.getCell(col);
                    if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
                        const headerCell = worksheet.getRow(headerRowIndex).getCell(col);
                        const headerValue = headerCell.value ? String(headerCell.value) : `Col ${col}`;
                        console.log(`       ${headerValue}: ${cell.value}`);
                    }
                }
            } else {
                console.log(`\n     ⚠️ Ligne non trouvée pour SN ${serialNumber}`);
            }
        }
        
        console.log('');
    }
}

main().catch(error => {
    console.error('❌ Erreur:', error);
    process.exit(1);
});
