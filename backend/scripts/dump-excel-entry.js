/**
 * Dump a ZIP entry from an XLSX to stdout (utf8).
 *
 * Usage:
 *   node scripts/dump-excel-entry.js <xlsx-path> <entry-name>
 *
 * Example:
 *   node scripts/dump-excel-entry.js "X:\\...\\file.xlsx" "xl/tables/table1.xml"
 */
const yauzl = require('yauzl');
const fs = require('fs/promises');

async function main() {
  const xlsxPath = process.argv[2];
  const entryName = process.argv[3];
  if (!xlsxPath || !entryName) {
    console.error('Usage: node scripts/dump-excel-entry.js <xlsx-path> <entry-name>');
    process.exit(1);
  }

  await fs.access(xlsxPath);

  const zip = await new Promise((resolve, reject) => {
    yauzl.open(xlsxPath, { lazyEntries: true }, (err, z) => (err ? reject(err) : resolve(z)));
  });

  await new Promise((resolve, reject) => {
    let found = false;
    zip.readEntry();
    zip.on('entry', (entry) => {
      if (entry.fileName !== entryName) {
        zip.readEntry();
        return;
      }
      found = true;
      zip.openReadStream(entry, (err, stream) => {
        if (err) return reject(err);
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => {
          process.stdout.write(Buffer.concat(chunks).toString('utf8'));
          resolve();
        });
        stream.on('error', reject);
      });
    });
    zip.on('end', () => {
      if (!found) reject(new Error(`Entry not found: ${entryName}`));
      else resolve();
    });
    zip.on('error', reject);
  }).finally(() => {
    try { zip.close(); } catch (_) {}
  });
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});

