/**
 * Repairs an inconsistent Excel table definition (xl/tables/table1.xml) where:
 * - ref width != tableColumns count
 * - missing tableColumn entries for columns in the ref range
 * - headerRowCount is 0
 *
 * This matches the repair log Excel shows ("removed table and autofilter in table1.xml").
 *
 * Usage:
 *   node scripts/repair-excel-table1.js <xlsx-path>
 */
const yauzl = require('yauzl');
const yazl = require('yazl');
const fs = require('fs/promises');
const fss = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

function openZip(p) {
  return new Promise((resolve, reject) => {
    yauzl.open(p, { lazyEntries: true }, (err, zip) => (err ? reject(err) : resolve(zip)));
  });
}

function readEntryBuffer(zip, entry) {
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

async function readAllEntries(zipPath) {
  const zip = await openZip(zipPath);
  const entries = [];
  const dataMap = new Map();
  await new Promise((resolve, reject) => {
    zip.readEntry();
    zip.on('entry', async (entry) => {
      entries.push(entry);
      if (entry.fileName.endsWith('/')) {
        zip.readEntry();
        return;
      }
      try {
        const buf = await readEntryBuffer(zip, entry);
        dataMap.set(entry.fileName, buf);
        zip.readEntry();
      } catch (e) {
        reject(e);
      }
    });
    zip.on('end', resolve);
    zip.on('error', reject);
  });
  zip.close();
  return { entries, dataMap };
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

function xmlEscapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extractSharedStrings(sharedXml) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const obj = parser.parse(sharedXml);
  const si = obj?.sst?.si;
  const list = Array.isArray(si) ? si : si ? [si] : [];
  const strings = [];
  for (const item of list) {
    if (typeof item?.t === 'string') {
      strings.push(item.t);
      continue;
    }
    const ts = [];
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

function extractRow4Headers(sheetXml, sharedStrings) {
  const rowMatch = sheetXml.match(/<row[^>]*\sr="4"[^>]*>([\s\S]*?)<\/row>/i);
  if (!rowMatch) throw new Error('Row 4 not found in sheet1.xml');
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
  return byCol;
}

function buildRepairedTableXmlShrink(tableXml, ref, desiredCount) {
  const r = parseA1Range(ref);
  if (!r) throw new Error(`Cannot parse table ref: ${ref}`);
  if (!desiredCount || desiredCount <= 0) throw new Error(`Invalid desiredCount: ${desiredCount}`);

  const endCol = numToCol(colToNum(r.startCol) + desiredCount - 1);
  const newRef = `${r.startCol}${r.startRow}:${endCol}${r.endRow}`;

  // Extract existing <tableColumn .../> tags, keep first desiredCount and normalize ids
  const colBlockMatch = tableXml.match(/<tableColumns\b[^>]*>[\s\S]*?<\/tableColumns>/i);
  if (!colBlockMatch) throw new Error('tableColumns block not found');

  const colTags = [...colBlockMatch[0].matchAll(/<tableColumn\b[^>]*\/>/gi)].map((m) => m[0]);
  if (colTags.length === 0) throw new Error('No tableColumn tags found');

  const kept = colTags.slice(0, desiredCount).map((tag, idx) => {
    // Ensure id="idx+1"
    if (/\sid="/i.test(tag)) {
      return tag.replace(/\sid="(\d+)"/i, ` id="${idx + 1}"`);
    }
    return tag.replace(/<tableColumn\b/i, `<tableColumn id="${idx + 1}"`);
  });

  const newTableColumns = `<tableColumns count="${desiredCount}">${kept.join('')}</tableColumns>`;

  let out = tableXml;

  // Ensure headerRowCount is 1 (Excel expects a header row for tables)
  if (out.includes('headerRowCount="0"')) out = out.replace(/headerRowCount="0"/, 'headerRowCount="1"');
  else if (!/headerRowCount="/.test(out)) out = out.replace(/<table\b/, '<table headerRowCount="1"');

  // Ensure ref + autoFilter ref are consistent and match desiredCount width
  out = out.replace(/\sref="[^"]+"/, ` ref="${newRef}"`);
  out = out.replace(/<autoFilter\b([^>]*?)\sref="[^"]+"/, `<autoFilter$1 ref="${newRef}"`);

  // Replace tableColumns block with truncated/normalized version
  out = out.replace(/<tableColumns\b[\s\S]*?<\/tableColumns>/i, newTableColumns);

  return out;
}

async function writeZipWithReplacement(zipPath, replacementName, replacementBuffer, replacementCompressionMethod) {
  const { entries, dataMap } = await readAllEntries(zipPath);
  const tempPath = zipPath + '.repaired.tmp.' + Date.now();

  const zipOut = new yazl.ZipFile();
  const outStream = fss.createWriteStream(tempPath);
  zipOut.outputStream.pipe(outStream);

  for (const e of entries) {
    if (e.fileName.endsWith('/')) continue;
    const isReplacement = e.fileName === replacementName;
    const buf = isReplacement ? replacementBuffer : dataMap.get(e.fileName);
    if (!buf) continue;

    const compressionMethod = isReplacement ? replacementCompressionMethod : e.compressionMethod;
    zipOut.addBuffer(buf, e.fileName, {
      mtime: e.getLastModDate(),
      mode: e.externalFileAttributes >>> 16,
      compress: compressionMethod !== 0, // 0=store
    });
  }

  zipOut.end();
  await new Promise((resolve, reject) => {
    outStream.on('close', resolve);
    outStream.on('finish', resolve);
    outStream.on('error', reject);
  });

  await fs.rename(tempPath, zipPath);
}

async function main() {
  const xlsxPath = process.argv[2];
  const forceCount = process.argv[3] ? Number(process.argv[3]) : null;
  if (!xlsxPath) {
    console.error('Usage: node scripts/repair-excel-table1.js <xlsx-path> [forceCount]');
    process.exit(1);
  }
  await fs.access(xlsxPath);

  const { entries, dataMap } = await readAllEntries(xlsxPath);
  const tableBuf = dataMap.get('xl/tables/table1.xml');
  const sheetBuf = dataMap.get('xl/worksheets/sheet1.xml');
  const sharedBuf = dataMap.get('xl/sharedStrings.xml');
  if (!tableBuf || !sheetBuf) {
    throw new Error('Missing xl/tables/table1.xml or xl/worksheets/sheet1.xml');
  }
  const tableEntry = entries.find((e) => e.fileName === 'xl/tables/table1.xml');
  if (!tableEntry) throw new Error('table1.xml entry not found');

  const tableXml = tableBuf.toString('utf8');
  const ref = tableXml.match(/\sref="([^"]+)"/)?.[1];
  if (!ref) throw new Error('table1.xml missing ref attribute');

  const r = parseA1Range(ref);
  if (!r) throw new Error(`Cannot parse ref: ${ref}`);
  const width = colToNum(r.endCol) - colToNum(r.startCol) + 1;
  const declared = Number(tableXml.match(/<tableColumns[^>]*\scount="(\d+)"/)?.[1] || 0);
  const headerRowCount = Number(tableXml.match(/\sheaderRowCount="(\d+)"/)?.[1] || 0);

  console.log('🔎 Current table1.xml:');
  console.log({ ref, width, declared, headerRowCount });

  if (!forceCount && declared > 0 && declared === width && headerRowCount === 1) {
    console.log('✅ Table definition already consistent. Nothing to do.');
    return;
  }

  // Minimal, safe repair:
  // - keep existing tableColumn definitions
  // - shrink ref/autofilter to match declared tableColumns count
  // - set headerRowCount=1
  const desiredCount = Number.isFinite(forceCount) && forceCount > 0 ? forceCount : (declared > 0 ? declared : 20);
  const repaired = buildRepairedTableXmlShrink(tableXml, ref, desiredCount);

  // Keep same compression method as original table entry
  await writeZipWithReplacement(
    xlsxPath,
    'xl/tables/table1.xml',
    Buffer.from(repaired, 'utf8'),
    tableEntry.compressionMethod
  );

  console.log('✅ Repaired table1.xml written. Please re-open in Excel to confirm no repair message.');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});

