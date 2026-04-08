/**
 * Analyse table1.xml in an XLSX and prints key attributes + basic consistency checks.
 *
 * Usage:
 *   node scripts/analyze-excel-table1.js <xlsx-path>
 */
const yauzl = require('yauzl');
const fs = require('fs/promises');

function openZip(p) {
  return new Promise((resolve, reject) => {
    yauzl.open(p, { lazyEntries: true }, (err, zip) => (err ? reject(err) : resolve(zip)));
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

function colToNum(col) {
  // A=1, Z=26, AA=27...
  let n = 0;
  for (const ch of col.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

function parseA1Range(range) {
  const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!m) return null;
  return {
    startCol: m[1].toUpperCase(),
    startRow: Number(m[2]),
    endCol: m[3].toUpperCase(),
    endRow: Number(m[4]),
  };
}

async function getEntry(zipPath, name) {
  const zip = await openZip(zipPath);
  return new Promise((resolve, reject) => {
    zip.readEntry();
    zip.on('entry', async (entry) => {
      if (entry.fileName !== name) {
        zip.readEntry();
        return;
      }
      try {
        const text = await readEntryText(zip, entry);
        resolve(text);
      } catch (e) {
        reject(e);
      } finally {
        try { zip.close(); } catch (_) {}
      }
    });
    zip.on('end', () => {
      try { zip.close(); } catch (_) {}
      resolve(null);
    });
    zip.on('error', (e) => {
      try { zip.close(); } catch (_) {}
      reject(e);
    });
  });
}

async function main() {
  const xlsxPath = process.argv[2];
  if (!xlsxPath) {
    console.error('Usage: node scripts/analyze-excel-table1.js <xlsx-path>');
    process.exit(1);
  }
  await fs.access(xlsxPath);

  const tableXml = await getEntry(xlsxPath, 'xl/tables/table1.xml');
  if (!tableXml) {
    console.log('❌ xl/tables/table1.xml not found');
    process.exit(2);
  }

  const get = (re) => (tableXml.match(re)?.[1] ?? '');
  const ref = get(/\sref="([^"]+)"/);
  const autoFilterRef = get(/<autoFilter[^>]*\sref="([^"]+)"/);
  const headerRowCount = get(/\sheaderRowCount="(\d+)"/);
  const totalsRowShown = get(/\stotalsRowShown="(\d+)"/);
  const tableColumnsCount = get(/<tableColumns[^>]*\scount="(\d+)"/);
  const tableColTags = [...tableXml.matchAll(/<tableColumn\b/gi)].length;

  console.log('✅ table1.xml attributes:');
  console.log({ ref, autoFilterRef, headerRowCount, totalsRowShown, tableColumnsCount, tableColTags });

  const r = ref ? parseA1Range(ref) : null;
  if (r) {
    const width = colToNum(r.endCol) - colToNum(r.startCol) + 1;
    const height = r.endRow - r.startRow + 1;
    console.log('\n✅ ref parsed:');
    console.log({ ...r, width, height });

    const declaredCount = Number(tableColumnsCount || 0);
    if (declaredCount && declaredCount !== width) {
      console.log(`\n⚠️ INCOHERENCE: tableColumns count (${declaredCount}) != ref width (${width})`);
    } else {
      console.log('\n✅ ref width matches tableColumns count (or count missing).');
    }
  } else {
    console.log('\n⚠️ Could not parse ref range');
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});

