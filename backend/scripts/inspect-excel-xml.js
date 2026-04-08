/**
 * Script pour inspecter le XML d'une cellule Excel
 * Aide à comprendre la structure et préserver les attributs
 */

const AdmZip = require('adm-zip');
const fs = require('fs/promises');
const path = require('path');

function columnNumberToLetter(colNum) {
    let result = '';
    while (colNum > 0) {
        colNum--;
        result = String.fromCharCode(65 + (colNum % 26)) + result;
        colNum = Math.floor(colNum / 26);
    }
    return result;
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
        console.error('Usage: node scripts/inspect-excel-xml.js <excel-path> <row> <col>');
        console.error('Exemple: node scripts/inspect-excel-xml.js "X:/Tracabilite/CP-MUXISH-ELIO25.004/mesures AGS 25.004.xlsx" 5 17');
        process.exit(1);
    }

    const excelPath = args[0];
    const rowNum = parseInt(args[1], 10);
    const colNum = parseInt(args[2], 10);

    try {
        await fs.access(excelPath);
        console.log(`✅ Fichier trouvé: ${excelPath}\n`);
    } catch (error) {
        console.error(`❌ Fichier non trouvé: ${excelPath}`);
        process.exit(1);
    }

    const zip = new AdmZip(excelPath);
    const allEntries = zip.getEntries();
    
    // Trouver les fichiers XML de feuilles
    const sheetFiles = allEntries.filter(e => 
        e.entryName.startsWith('xl/worksheets/sheet') && 
        e.entryName.endsWith('.xml')
    );
    
    if (sheetFiles.length === 0) {
        console.error('❌ Aucune feuille de calcul trouvée');
        process.exit(1);
    }

    const sheetEntry = sheetFiles[0];
    const sheetXml = sheetEntry.getData().toString('utf8');
    
    const colLetter = columnNumberToLetter(colNum);
    const cellRef = `${colLetter}${rowNum}`;
    
    console.log(`🔍 Recherche de la cellule: ${cellRef} (ligne ${rowNum}, colonne ${colNum})\n`);
    
    // Trouver la cellule dans le XML
    const cellPattern = new RegExp(
        `(<c[^>]*r="${cellRef}"[^>]*>)([\\s\\S]*?)(</c>)`,
        'i'
    );
    
    const match = sheetXml.match(cellPattern);
    if (!match) {
        console.error(`❌ Cellule ${cellRef} non trouvée dans le XML`);
        process.exit(1);
    }
    
    console.log(`✅ Cellule trouvée!\n`);
    console.log(`📋 Structure complète de la cellule:`);
    console.log(`\n${match[0]}\n`);
    
    console.log(`📋 Balise ouvrante (avec tous les attributs):`);
    console.log(`${match[1]}\n`);
    
    console.log(`📋 Contenu de la cellule:`);
    console.log(`${match[2]}\n`);
    
    // Vérifier si la cellule fait partie d'un tableau
    // Les cellules dans un tableau Excel ont souvent des attributs spéciaux
    const hasTableRef = match[1].includes('table') || match[1].includes('s=');
    if (hasTableRef) {
        console.log(`⚠️ Cette cellule semble faire partie d'un tableau Excel`);
    }
    
    // Vérifier les fichiers de tableaux
    const tableFiles = allEntries.filter(e => 
        e.entryName.startsWith('xl/tables/table') && 
        e.entryName.endsWith('.xml')
    );
    
    if (tableFiles.length > 0) {
        console.log(`\n📊 Fichiers de tableaux trouvés:`);
        for (const tableFile of tableFiles) {
            console.log(`   - ${tableFile.entryName}`);
            const tableXml = tableFile.getData().toString('utf8');
            // Chercher si cette cellule est référencée dans le tableau
            if (tableXml.includes(cellRef)) {
                console.log(`     ⚠️ La cellule ${cellRef} est référencée dans ce tableau!`);
            }
        }
    }
}

main().catch(error => {
    console.error('❌ Erreur:', error);
    process.exit(1);
});
