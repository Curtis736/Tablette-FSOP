const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const ExcelJS = require('exceljs');

const LAUNCH = 'LT2500133';
const TEMPLATE = 'F469';
const SERIAL = '23.199';
const OPERATOR = 'OP001';

function createMinimalDocx(filePath) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`));
  zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>{{LT}} / {{SN}}</w:t></w:r></w:p></w:body>
</w:document>`));
  zip.writeZip(filePath);
}

async function createTemplatesXlsx(filePath) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Liste des formulaires');
  ws.getRow(3).getCell(2).value = 'N°';
  ws.getRow(3).getCell(3).value = 'Désignation';
  ws.getRow(3).getCell(4).value = 'Processus';
  ws.getRow(4).getCell(2).value = TEMPLATE;
  ws.getRow(4).getCell(3).value = 'Formulaire test';
  ws.getRow(4).getCell(4).value = 'Processus test';
  await wb.xlsx.writeFile(filePath);
}

async function createFsopFilesystemLayout(baseDir) {
  const traceRoot = path.join(baseDir, 'trace');
  const templatesDir = path.join(baseDir, 'templates');
  const ltRoot = path.join(traceRoot, LAUNCH);
  const fsopDir = path.join(ltRoot, 'FSOP');

  await fs.mkdir(fsopDir, { recursive: true });
  await fs.mkdir(templatesDir, { recursive: true });

  const templateDocx = path.join(templatesDir, `${TEMPLATE}-Ind A FSOP test.docx`);
  const templatesXlsx = path.join(templatesDir, 'Liste des formulaires.xlsx');

  createMinimalDocx(templateDocx);
  await createTemplatesXlsx(templatesXlsx);

  return { traceRoot, templatesDir, ltRoot, fsopDir, templateDocx, templatesXlsx };
}

async function createTempFsopEnv() {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsop-test-'));
  const layout = await createFsopFilesystemLayout(baseDir);
  return { baseDir, ...layout };
}

async function cleanupTempDir(baseDir) {
  if (!baseDir) return;
  await fs.rm(baseDir, { recursive: true, force: true });
}

function activeSessionQueryResult() {
  return [{ SessionId: 'test-session-1' }];
}

function lotsQueryResult() {
  return [
    { CodeOperation: 'OP1', CodeRubrique: 'R1', Phase: 'P', CodeLot: 'LOT-A' },
    { CodeOperation: 'OP1', CodeRubrique: 'R1', Phase: 'P', CodeLot: 'LOT-B' }
  ];
}

module.exports = {
  LAUNCH,
  TEMPLATE,
  SERIAL,
  OPERATOR,
  createMinimalDocx,
  createTemplatesXlsx,
  createFsopFilesystemLayout,
  createTempFsopEnv,
  cleanupTempDir,
  activeSessionQueryResult,
  lotsQueryResult
};
