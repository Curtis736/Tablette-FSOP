/**
 * Calcule des hashes + infos ZIP (compressionMethod, sizes) pour des entrées critiques d'un XLSX
 *
 * Usage:
 *   node scripts/hash-excel-parts.js <excel-path>
 */
const yauzl = require('yauzl');
const crypto = require('crypto');
const fs = require('fs/promises');

const IMPORTANT = new Set([
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  'xl/worksheets/sheet1.xml',
  'xl/worksheets/_rels/sheet1.xml.rels',
  'xl/tables/table1.xml',
]);

function openZip(p) {
  return new Promise((resolve, reject) => {
    yauzl.open(p, { lazyEntries: true }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

function readEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

async function main() {
  const excelPath = process.argv[2];
  if (!excelPath) {
    console.error('Usage: node scripts/hash-excel-parts.js <excel-path>');
    process.exit(1);
  }
  await fs.access(excelPath);

  const zip = await openZip(excelPath);
  const results = [];

  await new Promise((resolve, reject) => {
    zip.readEntry();
    zip.on('entry', async (entry) => {
      try {
        if (IMPORTANT.has(entry.fileName)) {
          const buf = await readEntry(zip, entry);
          const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
          results.push({
            name: entry.fileName,
            compressionMethod: entry.compressionMethod, // 0=store, 8=deflate
            compressedSize: entry.compressedSize,
            uncompressedSize: entry.uncompressedSize,
            crc32: entry.crc32 >>> 0,
            sha16: sha,
          });
        }
        zip.readEntry();
      } catch (e) {
        reject(e);
      }
    });
    zip.on('end', resolve);
    zip.on('error', reject);
  });

  zip.close();

  results.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`✅ ${excelPath}`);
  for (const r of results) {
    console.log(
      `${r.name}\n` +
        `  method=${r.compressionMethod} comp=${r.compressedSize} uncomp=${r.uncompressedSize} crc=${r.crc32} sha16=${r.sha16}`
    );
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});

