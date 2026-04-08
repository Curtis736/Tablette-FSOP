/**
 * Extract header texts from sheet1 row 4 (A4..AL4) using sharedStrings.xml.
 *
 * Usage:
 *   node scripts/extract-excel-headers-row4.js <xlsx-path>
 */
const yauzl = require('yauzl');
const fs = require('fs/promises');
const { XMLParser } = require('fast-xml-parser');

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

async function getEntryText(zipPath, name) {
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

function colToNum(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function numToCol(num) {
  let s = '';
  let n = num;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function extractSharedStrings(xml) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const obj = parser.parse(xml);
  const sst = obj?.sst;
  const si = sst?.si;
  const list = Array.isArray(si) ? si : si ? [si] : [];
  const strings = [];
  for (const item of list) {
    // si can be {t:"..."} or {r:[{t:"..."}...]}
    if (typeof item?.t === 'string') {
      strings.push(item.t);
      continue;
    }
    const ts = [];
    if (Array.isArray(item?.t)) {
      for (const t of item.t) ts.push(typeof t === 'string' ? t : (t?.['#text'] ?? ''));
    }
    if (Array.isArray(item?.r)) {
      for (const run of item.r) {
        const t = run?.t;
        if (typeof t === 'string') ts.push(t);
        else if (typeof t?.['#text'] === 'string') ts.push(t['#text']);
      }
    }
    strings.push(ts.join(''));
  }
  return strings;
}

async function main() {
  const xlsxPath = process.argv[2];
  if (!xlsxPath) {
    console.error('Usage: node scripts/extract-excel-headers-row4.js <xlsx-path>');
    process.exit(1);
  }
  await fs.access(xlsxPath);

  const shared = await getEntryText(xlsxPath, 'xl/sharedStrings.xml');
  const sheet = await getEntryText(xlsxPath, 'xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('sheet1.xml not found');
  const sharedStrings = shared ? extractSharedStrings(shared) : [];

  // Find row r="4"
  const rowMatch = sheet.match(/<row[^>]*\sr="4"[^>]*>([\s\S]*?)<\/row>/i);
  if (!rowMatch) throw new Error('Row 4 not found');
  const rowXml = rowMatch[1];

  const cells = [...rowXml.matchAll(/<c\b[^>]*\sr="([A-Z]+)4"[^>]*>([\s\S]*?)<\/c>/gi)];
  const byCol = new Map();
  for (const m of cells) {
    const col = m[1];
    const cellXml = m[0];
    const tAttr = (cellXml.match(/\st="([^"]+)"/i)?.[1]) || '';
    const v = (cellXml.match(/<v[^>]*>([^<]*)<\/v>/i)?.[1]) || '';
    let text = v;
    if (tAttr === 's') {
      const idx = Number(v);
      text = Number.isFinite(idx) ? (sharedStrings[idx] ?? '') : '';
    }
    byCol.set(col, text);
  }

  const start = colToNum('A');
  const end = colToNum('AL');
  for (let n = start; n <= end; n++) {
    const col = numToCol(n);
    const txt = byCol.get(col) ?? '';
    console.log(`${col}4\t${txt.replace(/\s+/g, ' ').trim()}`);
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});

