const AdmZip = require('adm-zip');
const path = require('path');

const excelPath = process.argv[2];

if (!excelPath) {
    console.error('Usage: node inspect-excel-table.js <excel-file>');
    process.exit(1);
}

try {
    const zip = new AdmZip(excelPath);
    const entries = zip.getEntries();
    
    // Trouver tous les fichiers de tableaux
    const tableFiles = entries.filter(e => 
        e.entryName.startsWith('xl/tables/table') && 
        e.entryName.endsWith('.xml')
    );
    
    console.log(`📊 Fichiers de tableaux trouvés: ${tableFiles.length}\n`);
    
    for (const tableFile of tableFiles) {
        console.log(`📋 ${tableFile.entryName}:`);
        const xml = tableFile.getData().toString('utf8');
        
        // Extraire les informations importantes
        const refMatch = xml.match(/ref="([^"]+)"/);
        const autoFilterMatch = xml.match(/<autoFilter[^>]*>/);
        const tableStyleMatch = xml.match(/tableStyleInfo[^>]*name="([^"]+)"/);
        
        if (refMatch) {
            console.log(`   ✅ Référence de plage: ${refMatch[1]}`);
        }
        
        if (autoFilterMatch) {
            console.log(`   ✅ AutoFilter présent`);
        } else {
            console.log(`   ⚠️ AutoFilter absent`);
        }
        
        if (tableStyleMatch) {
            console.log(`   ✅ Style de tableau: ${tableStyleMatch[1]}`);
        }
        
        // Afficher les colonnes du tableau
        const columnMatches = xml.matchAll(/<tableColumn[^>]*id="(\d+)"[^>]*name="([^"]+)"/g);
        const columns = Array.from(columnMatches);
        if (columns.length > 0) {
            console.log(`   📊 Colonnes (${columns.length}):`);
            columns.forEach(col => {
                console.log(`      - ${col[2]} (id: ${col[1]})`);
            });
        }
        
        // Afficher un extrait du XML pour debug
        console.log(`\n   📄 Extrait XML (premiers 500 caractères):`);
        console.log(`   ${xml.substring(0, 500)}...\n`);
    }
    
    // Vérifier aussi la feuille de calcul
    const sheetFiles = entries.filter(e => 
        e.entryName.startsWith('xl/worksheets/sheet') && 
        e.entryName.endsWith('.xml')
    );
    
    if (sheetFiles.length > 0) {
        const sheetXml = sheetFiles[0].getData().toString('utf8');
        const cellQ5 = sheetXml.match(/<c[^>]*r="Q5"[^>]*>.*?<\/c>/s);
        if (cellQ5) {
            console.log(`\n📋 Cellule Q5 dans ${sheetFiles[0].entryName}:`);
            console.log(`   ${cellQ5[0]}\n`);
        }
    }
    
} catch (error) {
    console.error(`❌ Erreur: ${error.message}`);
    process.exit(1);
}
