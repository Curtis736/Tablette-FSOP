/**
 * Vérifie les parties critiques d'un XLSX (tables/relations/content types) souvent impliquées
 * lorsque Excel affiche un message de réparation.
 *
 * Usage:
 *   node scripts/check-excel-critical-parts.js <excel-path>
 */

const yauzl = require('yauzl');
const fs = require('fs/promises');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) reject(err);
      else resolve(zip);
    });
  });
}

function readEntryText(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
  });
}

async function readZipTextByName(zip, name) {
  return new Promise((resolve, reject) => {
    let found = false;
    zip.readEntry();
    zip.on('entry', async (entry) => {
      if (entry.fileName === name) {
        found = true;
        try {
          const text = await readEntryText(zip, entry);
          resolve(text);
        } catch (e) {
          reject(e);
        } finally {
          zip.close();
        }
        return;
      }
      zip.readEntry();
    });
    zip.on('end', () => {
      if (!found) {
        zip.close();
        resolve(null);
      }
    });
    zip.on('error', (e) => {
      try { zip.close(); } catch (_) {}
      reject(e);
    });
  });
}

async function listZipEntries(zipPath) {
  const zip = await openZip(zipPath);
  return new Promise((resolve, reject) => {
    const names = [];
    zip.readEntry();
    zip.on('entry', (entry) => {
      names.push(entry.fileName);
      zip.readEntry();
    });
    zip.on('end', () => {
      zip.close();
      resolve(names);
    });
    zip.on('error', (e) => {
      try { zip.close(); } catch (_) {}
      reject(e);
    });
  });
}

function safeParseXml(name, xmlText) {
  try {
    return parser.parse(xmlText);
  } catch (e) {
    return { __parseError: `${name}: ${e.message}` };
  }
}

async function main() {
  const excelPath = process.argv[2];
  if (!excelPath) {
    console.error('Usage: node scripts/check-excel-critical-parts.js <excel-path>');
    process.exit(1);
  }

  await fs.access(excelPath);
  console.log(`✅ Fichier: ${excelPath}\n`);

  const entries = await listZipEntries(excelPath);
  const mustExist = [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/worksheets/sheet1.xml',
    'xl/worksheets/_rels/sheet1.xml.rels',
  ];

  console.log('## Présence des fichiers critiques');
  for (const f of mustExist) {
    console.log(`- ${entries.includes(f) ? '✅' : '❌'} ${f}`);
  }
  console.log('');

  // Lire XML clés
  const contentTypes = await readZipTextByName(await openZip(excelPath), '[Content_Types].xml');
  const sheet1 = await readZipTextByName(await openZip(excelPath), 'xl/worksheets/sheet1.xml');
  const sheet1Rels = await readZipTextByName(await openZip(excelPath), 'xl/worksheets/_rels/sheet1.xml.rels');
  const workbookRels = await readZipTextByName(await openZip(excelPath), 'xl/_rels/workbook.xml.rels');

  console.log('## Parsing XML');
  const ctObj = contentTypes ? safeParseXml('[Content_Types].xml', contentTypes) : null;
  const sheetObj = sheet1 ? safeParseXml('sheet1.xml', sheet1) : null;
  const sheetRelsObj = sheet1Rels ? safeParseXml('sheet1.xml.rels', sheet1Rels) : null;
  const wbRelsObj = workbookRels ? safeParseXml('workbook.xml.rels', workbookRels) : null;

  const parseErrors = [ctObj, sheetObj, sheetRelsObj, wbRelsObj]
    .filter(Boolean)
    .map((o) => o?.__parseError)
    .filter(Boolean);
  if (parseErrors.length) {
    console.log('❌ Erreurs XML:');
    for (const e of parseErrors) console.log(`- ${e}`);
    process.exit(2);
  }
  console.log('✅ XML OK\n');

  // Vérifier tableParts dans sheet1.xml
  const hasTableParts = sheet1?.includes('<tableParts') || sheet1?.includes(':tableParts');
  console.log('## TableParts dans sheet1.xml');
  console.log(`- ${hasTableParts ? '✅' : '⚠️'} tableParts présent`);

  // Vérifier présence des tables
  const tableFiles = entries.filter((n) => n.startsWith('xl/tables/table') && n.endsWith('.xml'));
  console.log('\n## Tables déclarées dans le ZIP');
  if (tableFiles.length === 0) {
    console.log('- ⚠️ Aucun fichier xl/tables/table*.xml');
  } else {
    for (const f of tableFiles) console.log(`- ✅ ${f}`);
  }

  // Vérifier relations sheet1 -> table*.xml
  console.log('\n## Relations sheet1.xml.rels vers les tables');
  if (!sheet1Rels) {
    console.log('- ❌ sheet1.xml.rels manquant');
  } else {
    const relTargets = [];
    const rels = sheetRelsObj?.Relationships?.Relationship;
    const relList = Array.isArray(rels) ? rels : rels ? [rels] : [];
    for (const r of relList) {
      const type = r['@_Type'] || '';
      const target = r['@_Target'] || '';
      if (type.includes('/table') || target.includes('/tables/')) {
        relTargets.push(target);
      }
    }
    if (relTargets.length === 0) {
      console.log('- ⚠️ Aucune relation de table trouvée dans sheet1.xml.rels');
    } else {
      for (const t of relTargets) console.log(`- ✅ ${t}`);
    }
  }

  console.log('\n✅ Diagnostic terminé.');
}

main().catch((e) => {
  console.error('❌ Erreur:', e.message);
  process.exit(1);
});

