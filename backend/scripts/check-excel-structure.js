/**
 * Script pour vérifier la structure d'un fichier Excel après modification
 */

const AdmZip = require('adm-zip');
const fs = require('fs/promises');
const path = require('path');

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.error('Usage: node scripts/check-excel-structure.js <excel-path>');
        process.exit(1);
    }

    const excelPath = args[0];

    try {
        await fs.access(excelPath);
        console.log(`✅ Fichier trouvé: ${excelPath}\n`);
    } catch (error) {
        console.error(`❌ Fichier non trouvé: ${excelPath}`);
        process.exit(1);
    }

    const zip = new AdmZip(excelPath);
    const allEntries = zip.getEntries();
    
    console.log(`📊 Structure du fichier Excel:\n`);
    
    // Vérifier les fichiers de tableaux
    const tableFiles = allEntries.filter(e => 
        e.entryName.startsWith('xl/tables/table') && 
        e.entryName.endsWith('.xml')
    );
    
    console.log(`📋 Fichiers de tableaux (${tableFiles.length}):`);
    for (const tableFile of tableFiles) {
        console.log(`   ✅ ${tableFile.entryName} (${tableFile.header.size} bytes)`);
        const tableXml = tableFile.getData().toString('utf8');
        // Vérifier le contenu
        if (tableXml.includes('autoFilter')) {
            console.log(`      - Contient autoFilter`);
        }
        if (tableXml.includes('table')) {
            console.log(`      - Contient définition de tableau`);
        }
    }
    
    // Vérifier les feuilles
    const sheetFiles = allEntries.filter(e => 
        e.entryName.startsWith('xl/worksheets/sheet') && 
        e.entryName.endsWith('.xml')
    );
    
    console.log(`\n📋 Feuilles de calcul (${sheetFiles.length}):`);
    for (const sheetFile of sheetFiles) {
        console.log(`   ✅ ${sheetFile.entryName} (${sheetFile.header.size} bytes)`);
    }
    
    // Vérifier workbook.xml
    const workbookEntry = zip.getEntry('xl/workbook.xml');
    if (workbookEntry) {
        console.log(`\n📋 Workbook: ✅ xl/workbook.xml`);
    } else {
        console.log(`\n📋 Workbook: ❌ xl/workbook.xml manquant`);
    }
}

main().catch(error => {
    console.error('❌ Erreur:', error);
    process.exit(1);
});
