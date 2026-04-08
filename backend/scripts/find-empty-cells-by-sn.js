/**
 * Find empty cells for a given Serial Number (SN) in the mesures XLSX.
 *
 * Usage:
 *   node scripts/find-empty-cells-by-sn.js "<xlsx-path>" <sn>
 */
const ExcelJS = require('exceljs');
const { __test } = require('../services/fsopExcelService');

function columnNumberToLetter(colNum) {
  let result = '';
  let n = colNum;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function isEmptyCellValue(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  return false;
}

async function main() {
  const xlsxPath = process.argv[2];
  const sn = process.argv[3];
  if (!xlsxPath || !sn) {
    console.error('Usage: node scripts/find-empty-cells-by-sn.js "<xlsx-path>" <sn>');
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath, { ignoreNodes: [] });

  const snStr = String(sn);
  for (const ws of workbook.worksheets) {
    const headerIdx = __test.detectHeaderRowIndex(ws, 15);
    const rowIdx = __test.findRowBySerialNumber(ws, snStr, headerIdx);
    if (rowIdx === null || rowIdx === undefined) continue;

    console.log(`✅ Feuille="${ws.name}" headerRow=${headerIdx} dataRow=${rowIdx}`);
    const headerRow = ws.getRow(headerIdx);
    const dataRow = ws.getRow(rowIdx);

    const empties = [];
    const maxCol = Math.max(headerRow.cellCount || 0, dataRow.cellCount || 0);
    for (let c = 1; c <= maxCol; c++) {
      const headerVal = headerRow.getCell(c).value;
      const headerText = headerVal === null || headerVal === undefined ? '' : String(headerVal).replace(/\s+/g, ' ').trim();
      const v = dataRow.getCell(c).value;

      // Only consider columns that have a header label
      if (!headerText) continue;
      if (isEmptyCellValue(v)) {
        const colLetter = columnNumberToLetter(c);
        empties.push({
          cell: `${colLetter}${rowIdx}`,
          col: c,
          header: headerText,
          tagLike: __test.normalizeHeaderToTagLike(headerText),
        });
      }
    }

    if (empties.length === 0) {
      console.log('  ℹ️ Aucune cellule vide détectée sur les colonnes avec en-tête.');
    } else {
      console.log(`  ⚠️ Cellules vides (${empties.length}):`);
      for (const e of empties) {
        console.log(`   - ${e.cell}\t${e.tagLike}\t"${e.header}"`);
      }
    }
    return;
  }

  console.log(`❌ SN ${sn} non trouvé dans les feuilles du classeur.`);
  process.exit(2);
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});

