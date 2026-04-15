const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const fsp = fs; // Alias for consistency with other parts of the codebase
const AdmZip = require('adm-zip');

const {
    safeIsDirectory,
    safeIsFile,
    findExistingDocx,
    findTemplateFile,
    injectIntoDocx,
    resolveLtRoot
} = require('../services/fsopWordService');
const { readTemplatesFromExcel } = require('../services/fsopTemplatesExcelService');
const { parseWordStructure } = require('../services/fsopWordParser');

// Verrou par clé de fichier pour éviter les sauvegardes simultanées corrompant le même FSOP
const _saveLocks = new Map();
async function withSaveLock(key, fn) {
    while (_saveLocks.has(key)) {
        await _saveLocks.get(key);
    }
    let resolve;
    const lock = new Promise(r => { resolve = r; });
    _saveLocks.set(key, lock);
    try {
        return await fn();
    } finally {
        _saveLocks.delete(key);
        resolve();
    }
}
const { executeQuery } = require('../config/database');
const { requireDebugMode } = require('../middleware/auth');

const router = express.Router();

/**
 * Middleware léger pour les routes FSOP : vérifie qu'un operatorId est fourni
 * et qu'il possède une session active (TTL glissant).
 * L'operatorId peut venir de req.body.operatorId ou du header X-Operator-Code.
 */
async function requireFsopSession(req, res, next) {
    try {
        const operatorId = (req.body && req.body.operatorId) || req.headers['x-operator-code'];
        if (!operatorId) {
            return res.status(401).json({
                success: false,
                error: 'OPERATOR_REQUIRED',
                message: 'Code opérateur requis pour accéder aux FSOP.'
            });
        }

        const ttlHoursRaw = parseInt(process.env.OPERATOR_SESSION_TTL_HOURS || '12', 10);
        const ttlHours = Number.isFinite(ttlHoursRaw) && ttlHoursRaw > 0 ? Math.min(ttlHoursRaw, 72) : 12;

        const sessions = await executeQuery(
            `SELECT TOP 1 SessionId FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
             WHERE OperatorCode = @operatorId
               AND SessionStatus = 'ACTIVE'
               AND COALESCE(LastActivityTime, LoginTime, DateCreation) >= DATEADD(hour, -@ttlHours, GETDATE())`,
            { operatorId, ttlHours }
        );

        if (!sessions || sessions.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'SESSION_REQUIRED',
                security: 'SESSION_REQUIRED',
                message: 'Opérateur non connecté ou session expirée.'
            });
        }

        req.fsopOperatorId = operatorId;
        next();
    } catch (err) {
        console.error('requireFsopSession error:', err);
        res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
    }
}

const DEFAULT_TEMPLATES_DIR_WIN = 'X:\\Qualite\\4_Public\\A disposition\\DOSSIER SMI\\Formulaires';
const DEFAULT_TEMPLATES_XLSX_WIN = 'X:\\Qualite\\4_Public\\A disposition\\DOSSIER SMI\\Formulaires\\Liste des formulaires.xlsx';

// Common Linux/container locations we support out of the box (VM/Docker).
const DEFAULT_TEMPLATES_DIR_LINUX = '/mnt/templates/Qualite/4_Public/A disposition/DOSSIER SMI/Formulaires';
// Some environments mount a top-level "Services" directory (e.g. /mnt/templates/Services/Qualite/...)
const DEFAULT_TEMPLATES_DIR_LINUX_SERVICES = '/mnt/templates/Services/Qualite/4_Public/A disposition/DOSSIER SMI/Formulaires';
const DEFAULT_TEMPLATES_DIR_LINUX_ALT = '/mnt/services/Qualite/4_Public/A disposition/DOSSIER SMI/Formulaires';
const DEFAULT_TEMPLATES_XLSX_LINUX = '/mnt/templates/Qualite/4_Public/A disposition/DOSSIER SMI/Formulaires/Liste des formulaires.xlsx';
const DEFAULT_TEMPLATES_XLSX_LINUX_SERVICES = '/mnt/templates/Services/Qualite/4_Public/A disposition/DOSSIER SMI/Formulaires/Liste des formulaires.xlsx';
const DEFAULT_TEMPLATES_XLSX_LINUX_ALT = '/mnt/services/Qualite/4_Public/A disposition/DOSSIER SMI/Formulaires/Liste des formulaires.xlsx';

function dedupeNonEmpty(values) {
    return [...new Set((values || []).filter(Boolean))];
}

function withServicesPathFallbacks(rawPath) {
    const p = String(rawPath || '').trim();
    if (!p) return [];
    const normalized = p.replace(/\\/g, '/');
    const out = [p];
    if (normalized.includes('/Services/')) {
        out.push(normalized.replace('/Services/', '/'));
    } else if (normalized.includes('/mnt/templates/')) {
        out.push(normalized.replace('/mnt/templates/', '/mnt/templates/Services/'));
    }
    return dedupeNonEmpty(out);
}

async function resolveFirstExistingDir(candidates) {
    for (const p of candidates) {
        if (!p) continue;
        if (await safeIsDirectory(p)) return p;
    }
    return null;
}

async function resolveFirstExistingFile(candidates) {
    for (const p of candidates) {
        if (!p) continue;
        if (await safeIsFile(p)) return p;
    }
    return null;
}

let _lastTemplatesResolveLog = 0;
function logTemplatesResolution(kind, chosen, candidates) {
    const now = Date.now();
    // Throttle periodic logs to reduce noise in hot routes.
    if (now - _lastTemplatesResolveLog < 60_000) return;
    _lastTemplatesResolveLog = now;
    if (chosen) {
        console.log(`✅ FSOP ${kind} resolved: ${chosen}`);
    } else {
        console.warn(`❌ FSOP ${kind} unresolved. Candidates tried:`, candidates);
    }
}

// Cache pour findTemplateFile (TTL 5 min) — évite les parcours SMB répétés
const _templateFileCache = new Map(); // key: `${dir}|${code}` -> { path, expiresAt }
const TEMPLATE_CACHE_TTL = 5 * 60 * 1000;
async function findTemplateFileCached(dir, code, depth) {
    const key = `${dir}|${code}`;
    const cached = _templateFileCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.path;
    const result = await findTemplateFile(dir, code, depth);
    _templateFileCache.set(key, { path: result, expiresAt: Date.now() + TEMPLATE_CACHE_TTL });
    return result;
}

// Cache pour resolveLtRoot (TTL 2 min)
const _ltRootCache = new Map(); // key: `${traceRoot}|${launchNumber}` -> { path, expiresAt }
const LT_ROOT_CACHE_TTL = 2 * 60 * 1000;
async function resolveLtRootCached(traceRoot, launchNumber) {
    const key = `${traceRoot}|${launchNumber}`;
    const cached = _ltRootCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.path;
    const result = await resolveLtRoot(traceRoot, launchNumber);
    if (result) _ltRootCache.set(key, { path: result, expiresAt: Date.now() + LT_ROOT_CACHE_TTL });
    return result;
}

// Résout le répertoire des templates (appelé une fois, résultat mis en cache)
let _templatesDirCache = null;
let _templatesDirCandidatesCache = [];
async function resolveTemplatesDir() {
    if (_templatesDirCache && await safeIsDirectory(_templatesDirCache)) return _templatesDirCache;
    const candidates = dedupeNonEmpty([
        ...withServicesPathFallbacks(process.env.FSOP_TEMPLATES_DIR),
        DEFAULT_TEMPLATES_DIR_LINUX,
        DEFAULT_TEMPLATES_DIR_LINUX_SERVICES,
        DEFAULT_TEMPLATES_DIR_LINUX_ALT,
        DEFAULT_TEMPLATES_DIR_WIN
    ]);
    _templatesDirCandidatesCache = candidates;
    _templatesDirCache = await resolveFirstExistingDir(candidates);
    logTemplatesResolution('templates directory', _templatesDirCache, candidates);
    return _templatesDirCache;
}

// Résout le fichier Excel des templates (appelé une fois, résultat mis en cache)
let _templatesXlsxCache = null;
let _templatesXlsxCandidatesCache = [];
async function resolveTemplatesXlsx() {
    if (_templatesXlsxCache && await safeIsFile(_templatesXlsxCache)) return _templatesXlsxCache;
    const candidates = dedupeNonEmpty([
        ...withServicesPathFallbacks(process.env.FSOP_TEMPLATES_XLSX_PATH),
        DEFAULT_TEMPLATES_XLSX_LINUX,
        DEFAULT_TEMPLATES_XLSX_LINUX_SERVICES,
        DEFAULT_TEMPLATES_XLSX_LINUX_ALT,
        DEFAULT_TEMPLATES_XLSX_WIN
    ]);
    _templatesXlsxCandidatesCache = candidates;
    _templatesXlsxCache = await resolveFirstExistingFile(candidates);
    logTemplatesResolution('templates xlsx', _templatesXlsxCache, candidates);
    return _templatesXlsxCache;
}

// Garantit l'existence du répertoire FSOP dans le dossier LT
// Retourne { ok: true, fsopDir } ou { ok: false, response } (à retourner directement)
async function ensureFsopDirectory(rootLt, res) {
    const fsopDir = path.join(rootLt, 'FSOP');
    if (await safeIsDirectory(fsopDir)) return { ok: true, fsopDir };
    try {
        await fs.mkdir(fsopDir, { recursive: true });
        if (!(await safeIsDirectory(fsopDir))) {
            return { ok: false, response: res.status(422).json({ error: 'FSOP_DIR_NOT_FOUND', fsopDir, message: `Répertoire FSOP inaccessible après création: ${fsopDir}` }) };
        }
    } catch (err) {
        if (await safeIsFile(fsopDir)) {
            return { ok: false, response: res.status(422).json({ error: 'FSOP_DIR_CONFLICT', fsopDir, rootLt, message: `Un fichier existe déjà avec le nom FSOP: ${fsopDir}` }) };
        }
        return { ok: false, response: res.status(422).json({ error: 'FSOP_DIR_CREATE_FAILED', fsopDir, rootLt, message: `Impossible de créer le répertoire FSOP dans ${rootLt}`, details: process.env.NODE_ENV === 'development' ? err.message : undefined }) };
    }
    return { ok: true, fsopDir };
}

function normalizeTemplateCode(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!/^F\d{3,4}$/i.test(raw)) {
        return null;
    }
    return raw;
}

function normalizeSerialNumber(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    // Keep SN fairly permissive but avoid path injection and crazy whitespace.
    const cleaned = raw.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(cleaned)) {
        return null;
    }
    return cleaned;
}

function normalizeLaunchNumber(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!/^LT\d{7,8}$/.test(raw)) {
        return null;
    }
    return raw;
}

/**
 * GET /api/fsop/lots/:launchNumber
 * Retourne les CodeLot trouvés dans SEDI_ERP.dbo.LCTC pour un lancement.
 * - Si 1 seul lot distinct => l'UI peut l'auto-sélectionner
 * - Si plusieurs lots => l'UI affiche un menu déroulant
 */
router.get('/lots/:launchNumber', async (req, res) => {
    try {
        const launchNumber = normalizeLaunchNumber(req.params.launchNumber);
        if (!launchNumber) {
            return res.status(400).json({ success: false, error: 'INVALID_LAUNCH_NUMBER' });
        }

        const rows = await executeQuery(`
            SELECT
                CodeOperation,
                CodeRubrique,
                Phase,
                CodeLot
            FROM [SEDI_ERP].[dbo].[LCTC]
            WHERE CodeLancement = @launchNumber
              AND CodeLot IS NOT NULL
              AND LTRIM(RTRIM(CodeLot)) <> ''
        `, { launchNumber });

        const byRubrique = new Map(); // CodeRubrique -> { lots:Set, phases:Set }
        const byOperationRubrique = new Map(); // "MO xxxx|CodeRubrique" -> { lots:Set, phases:Set }
        const uniqueLots = new Set();

        for (const r of rows || []) {
            const codeOperation = String(r.CodeOperation || '').trim();
            const codeRubrique = String(r.CodeRubrique || '').trim();
            const phase = String(r.Phase || '').trim();
            const codeLot = String(r.CodeLot || '').trim();
            if (!codeRubrique || !codeLot) continue;
            uniqueLots.add(codeLot);
            if (!byRubrique.has(codeRubrique)) byRubrique.set(codeRubrique, { lots: new Set(), phases: new Set() });
            const entry = byRubrique.get(codeRubrique);
            entry.lots.add(codeLot);
            if (phase) entry.phases.add(phase);

            if (codeOperation) {
                const key = `${codeOperation}|${codeRubrique}`;
                if (!byOperationRubrique.has(key)) byOperationRubrique.set(key, { lots: new Set(), phases: new Set(), codeOperation, codeRubrique });
                const e2 = byOperationRubrique.get(key);
                e2.lots.add(codeLot);
                if (phase) e2.phases.add(phase);
            }
        }

        const items = [...byRubrique.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([codeRubrique, entry]) => ({
                designation: codeRubrique, // faute de désignation détaillée par ligne dans ce contexte
                codeRubrique,
                phases: [...entry.phases].sort(),
                lots: [...entry.lots].sort()
            }));

        const lines = [...byOperationRubrique.values()]
            .sort((a, b) => {
                const ao = String(a.codeOperation || '');
                const bo = String(b.codeOperation || '');
                if (ao !== bo) return ao.localeCompare(bo);
                return String(a.codeRubrique || '').localeCompare(String(b.codeRubrique || ''));
            })
            .map((e) => ({
                codeOperation: e.codeOperation,
                codeRubrique: e.codeRubrique,
                phases: [...e.phases].sort(),
                lots: [...e.lots].sort(),
                // safe autofill hint: only autofill when unique
                uniqueLot: [...e.lots].size === 1 ? [...e.lots][0] : null
            }));

        return res.json({
            success: true,
            launchNumber,
            uniqueLots: [...uniqueLots].sort(),
            items,
            lines,
            count: uniqueLots.size
        });
    } catch (error) {
        console.error('❌ Erreur récupération lots FSOP:', error);
        return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: error.message });
    }
});

router.get('/debug/:launchNumber', requireDebugMode, async (req, res) => {
    try {
        const launchNumber = normalizeLaunchNumber(req.params.launchNumber);
        if (!launchNumber) {
            return res.status(400).json({ error: 'INVALID_LAUNCH_NUMBER' });
        }

        const traceRoot = process.env.TRACEABILITY_DIR;
        if (!traceRoot) {
            return res.status(503).json({ error: 'TRACEABILITY_DIR_NOT_CONFIGURED' });
        }

        const rootLt = await resolveLtRootCached(traceRoot, launchNumber);
        if (!rootLt) {
            return res.status(422).json({ 
                error: 'LT_DIR_NOT_FOUND',
                traceRoot: traceRoot,
                launchNumber: launchNumber
            });
        }

        const fsopDir = path.join(rootLt, 'FSOP');
        const fsopExists = await safeIsDirectory(fsopDir);

        if (!fsopExists) {
            return res.json({
                launchNumber: launchNumber,
                rootLt: rootLt,
                fsopDir: fsopDir,
                fsopExists: false,
                message: 'Répertoire FSOP introuvable'
            });
        }

        // Lister tous les fichiers .docx dans FSOP
        async function listAllDocxFiles(dir, baseDir, maxDepth = 3, currentDepth = 0) {
            const files = [];
            if (currentDepth > maxDepth) return files;
            
            try {
                const entries = await fsp.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory() && currentDepth < maxDepth) {
                        const subFiles = await listAllDocxFiles(fullPath, baseDir, maxDepth, currentDepth + 1);
                        files.push(...subFiles);
                    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.docx')) {
                        files.push({
                            path: path.relative(baseDir, fullPath),
                            name: entry.name,
                            fullPath: fullPath
                        });
                    }
                }
            } catch (err) {
                console.error(`Erreur lecture ${dir}:`, err.message);
            }
            return files;
        }

        const docxFiles = await listAllDocxFiles(fsopDir, fsopDir, 3);

        return res.json({
            launchNumber: launchNumber,
            rootLt: rootLt,
            fsopDir: fsopDir,
            fsopExists: true,
            docxFilesCount: docxFiles.length,
            docxFiles: docxFiles.map(f => ({
                path: f.path,
                name: f.name
            }))
        });
    } catch (error) {
        console.error('❌ Erreur debug FSOP:', error);
        return res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
    }
});

router.get('/templates', async (req, res) => {
    try {
        const excelPath = await resolveTemplatesXlsx();
        if (!excelPath) {
            return res.status(503).json({
                error: 'TEMPLATES_SOURCE_UNAVAILABLE',
                tried: _templatesXlsxCandidatesCache,
                hint: 'Définissez FSOP_TEMPLATES_XLSX_PATH dans .env (sans /Services si votre montage est déjà /mnt/templates).'
            });
        }

        console.log(`📋 Lecture des templates depuis: ${excelPath}`);
        const result = await readTemplatesFromExcel(excelPath);
        
        console.log(`✅ ${result.count} templates chargés avec succès (onglet: ${result.sheet || 'N/A'})`);
        return res.json(result);
    } catch (error) {
        console.error('❌ FSOP templates error:', error);
        
        if (error.message.includes('TEMPLATES_SOURCE_UNAVAILABLE')) {
            return res.status(503).json({ 
                error: 'TEMPLATES_SOURCE_UNAVAILABLE',
                message: 'Le fichier Excel des templates est introuvable ou inaccessible',
                path: process.env.FSOP_TEMPLATES_XLSX_PATH || DEFAULT_TEMPLATES_XLSX_WIN,
                tried: _templatesXlsxCandidatesCache,
                hint: 'Vérifiez que le fichier existe et que le chemin est correct. Vous pouvez définir FSOP_TEMPLATES_XLSX_PATH (Linux: /mnt/templates/... ou /mnt/services/... ).'
            });
        }
        
        if (error.message.includes('TEMPLATES_PARSE_FAILED')) {
            return res.status(500).json({ 
                error: 'TEMPLATES_PARSE_FAILED', 
                message: error.message 
            });
        }
        
        return res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
});

router.get('/template/:templateCode/structure', requireFsopSession, async (req, res) => {
    try {
        const templateCode = normalizeTemplateCode(req.params.templateCode);
        
        if (!templateCode) {
            return res.status(400).json({ 
                error: 'INPUT_INVALID',
                message: 'Code template invalide (format attendu: Fxxx)'
            });
        }

        const templatesBaseDir = await resolveTemplatesDir();

        if (!templatesBaseDir) {
            return res.status(503).json({ 
                error: 'TEMPLATES_DIR_NOT_FOUND',
                message: 'Répertoire des templates introuvable',
                tried: [
                    ...withServicesPathFallbacks(process.env.FSOP_TEMPLATES_DIR),
                    DEFAULT_TEMPLATES_DIR_LINUX,
                    DEFAULT_TEMPLATES_DIR_LINUX_SERVICES,
                    DEFAULT_TEMPLATES_DIR_LINUX_ALT,
                    DEFAULT_TEMPLATES_DIR_WIN
                ].filter(Boolean),
                hint: 'Définissez FSOP_TEMPLATES_DIR (Linux: /mnt/templates/... ou /mnt/services/... ).'
            });
        }

        // Chercher le template
        const depthLimit = Number.parseInt(process.env.FSOP_SEARCH_DEPTH || '3', 10);
        const searchDepth = Number.isFinite(depthLimit) && depthLimit >= 0 ? depthLimit : 3;
        
        const templatePath = await findTemplateFileCached(templatesBaseDir, templateCode, searchDepth);
        
        if (!templatePath) {
            return res.status(404).json({ 
                error: 'TEMPLATE_NOT_FOUND',
                message: `Template ${templateCode} introuvable`,
                templateCode: templateCode
            });
        }

        const templatesSheet = String(process.env.FSOP_TEMPLATES_SHEET || 'Liste des formulaires').trim();

        // Parser la structure du document
        console.log(`🔍 Starting structure parsing for template ${templateCode}...`);
        console.log(`📄 Templates source sheet: ${templatesSheet}`);
        console.log(`📁 Template path: ${templatePath}`);
        const structure = await parseWordStructure(templatePath);
        console.log(`✅ Structure parsed successfully for template ${templateCode}`);
        
        return res.json({
            templateCode: templateCode,
            templatesSource: {
                sheet: templatesSheet
            },
            structure: structure
        });
    } catch (error) {
        console.error('❌ FSOP structure error:', error.message);
        return res.status(500).json({ 
            error: 'INTERNAL_ERROR',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

router.post('/open', requireFsopSession, async (req, res) => {
    try {
        const launchNumber = normalizeLaunchNumber(req.body?.launchNumber);
        const templateCode = normalizeTemplateCode(req.body?.templateCode);
        const serialNumber = normalizeSerialNumber(req.body?.serialNumber);

        if (!launchNumber || !templateCode || !serialNumber) {
            return res.status(400).json({ error: 'INPUT_INVALID' });
        }

        const traceRoot = process.env.TRACEABILITY_DIR;
        if (!traceRoot) {
            console.error('❌ TRACEABILITY_DIR non configuré dans les variables d\'environnement');
            return res.status(503).json({ 
                error: 'TRACEABILITY_UNAVAILABLE',
                message: 'Répertoire de traçabilité non configuré',
                hint: 'Définissez TRACEABILITY_DIR dans votre fichier .env (ex: TRACEABILITY_DIR=X:\\Tracabilite)'
            });
        }
        
        if (!(await safeIsDirectory(traceRoot))) {
            console.error(`❌ Répertoire de traçabilité introuvable: ${traceRoot}`);
            return res.status(503).json({ 
                error: 'TRACEABILITY_UNAVAILABLE',
                message: 'Répertoire de traçabilité introuvable ou inaccessible',
                path: traceRoot,
                hint: 'Vérifiez que le répertoire existe et que le chemin est correct dans TRACEABILITY_DIR'
            });
        }

        // Resolve LT root directory (supports depth 1: <traceRoot>/<child>/<LT>)
        console.log(`🔍 Recherche du répertoire LT: ${launchNumber} dans ${traceRoot}`);
        const rootLt = await resolveLtRootCached(traceRoot, launchNumber);
        if (!rootLt) {
            console.error(`❌ Répertoire LT introuvable: ${launchNumber} dans ${traceRoot}`);
            return res.status(422).json({ 
                error: 'LT_DIR_NOT_FOUND',
                launchNumber: launchNumber,
                traceRoot: traceRoot
            });
        }
        console.log(`✅ Répertoire LT trouvé: ${rootLt}`);

        const { ok: fsopOk, fsopDir, response: fsopErr } = await ensureFsopDirectory(rootLt, res);
        if (!fsopOk) return fsopErr;
        console.log(`✅ Répertoire FSOP: ${fsopDir}`);

        const templatesBaseDir = await resolveTemplatesDir();
        console.log(`🔍 Recherche du template ${templateCode} dans: ${templatesBaseDir || '(introuvable)'}`);
        if (!templatesBaseDir) {
            return res.status(503).json({ error: 'TEMPLATES_DIR_NOT_FOUND', hint: 'Définissez FSOP_TEMPLATES_DIR dans .env' });
        }

        const depthLimit = Number.parseInt(process.env.FSOP_SEARCH_DEPTH || '3', 10);
        const searchDepth = Number.isFinite(depthLimit) && depthLimit >= 0 ? depthLimit : 3;
        
        const templatePath = await findTemplateFileCached(templatesBaseDir, templateCode, searchDepth);
        
        if (!templatePath) {
            console.error(`❌ Template ${templateCode} introuvable dans ${templatesBaseDir} (recherche jusqu'à ${searchDepth} niveaux de profondeur)`);
            
            return res.status(404).json({ 
                error: 'TEMPLATE_NOT_FOUND',
                message: `Template ${templateCode} introuvable`,
                templateCode: templateCode,
                searchedDir: templatesBaseDir,
                searchDepth: searchDepth,
                hint: `Le template doit être un fichier .docx commençant par "${templateCode}" (ex: ${templateCode}-Ind A FSOP...docx) dans ${templatesBaseDir} ou ses sous-dossiers jusqu'à ${searchDepth} niveaux de profondeur`
            });
        }
        
        console.log(`✅ Template trouvé: ${templatePath}`);

        // Search roots (order): 1) ROOT_LT/FSOP 2) ROOT_LT
        console.log(`🔍 Recherche d'un document existant pour ${templateCode}...`);
        let existingInFsop, existingInRoot, existing;
        try {
            existingInFsop = await findExistingDocx(fsopDir, templateCode, searchDepth, 'TEMPLATE_');
            existingInRoot = existingInFsop ? null : await findExistingDocx(rootLt, templateCode, searchDepth, 'TEMPLATE_');
            existing = existingInFsop || existingInRoot;
            if (existing) {
                console.log(`✅ Document existant trouvé: ${existing}`);
            } else {
                console.log(`ℹ️ Aucun document existant trouvé, utilisation du template`);
            }
        } catch (err) {
            console.warn(`⚠️ Erreur lors de la recherche de document existant:`, err.message);
            existing = null;
        }

        // Prepare destination file - Format: FSOP_<TemplateCode>_<SerialNumber>_<LaunchNumber>.docx
        // Exemple: FSOP_F479_23.199_LT2500133.docx
        if (!serialNumber || serialNumber.trim() === '') {
            return res.status(400).json({
                error: 'SERIAL_NUMBER_REQUIRED',
                message: 'Le numéro de série est requis pour générer le nom du fichier FSOP'
            });
        }
        const destName = `FSOP_${templateCode}_${serialNumber}_${launchNumber}.docx`;
        const destPath = path.join(fsopDir, destName);
        console.log(`📝 Nom du fichier généré: ${destName} (Template: ${templateCode}, SN: ${serialNumber}, LT: ${launchNumber})`);
        console.log(`📝 Copie vers: ${destPath}`);

        try {
            if (existing) {
                console.log(`📋 Copie depuis document existant: ${existing}`);
                await fs.copyFile(existing, destPath);
            } else {
                console.log(`📋 Copie depuis template: ${templatePath}`);
                await fs.copyFile(templatePath, destPath);
            }
            
            // Verify the copied file exists and has content
            const copiedStats = await fsp.stat(destPath);
            if (copiedStats.size === 0) {
                throw new Error('Le fichier copié est vide');
            }
            console.log(`✅ Fichier copié avec succès: ${copiedStats.size} bytes`);
        } catch (err) {
            console.error(`❌ Erreur lors de la copie:`, err.message);
            return res.status(500).json({
                error: 'TEMPLATE_COPY_FAILED',
                message: `Impossible de copier le fichier vers ${destPath}`,
                details: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        }

        console.log(`🔧 Injection des données dans le document...`);
        try {
            await injectIntoDocx(destPath, { '{{LT}}': launchNumber, '{{SN}}': serialNumber });
            console.log(`✅ Données injectées avec succès`);
            
            // Verify the final file is valid
            const finalStats = await fsp.stat(destPath);
            if (finalStats.size === 0) {
                throw new Error('Le fichier final est vide après injection');
            }
            console.log(`✅ Fichier final vérifié: ${finalStats.size} bytes`);
        } catch (err) {
            console.error(`❌ Erreur lors de l'injection:`, err.message);
            
            // Try to clean up corrupted file
            try {
                await fsp.unlink(destPath).catch(() => {});
                console.log(`🧹 Fichier corrompu supprimé: ${destPath}`);
            } catch (_) {
                // Ignore cleanup errors
            }
            
            return res.status(500).json({
                error: 'DOCX_INJECTION_FAILED',
                message: `Impossible d'injecter les données dans le document DOCX: ${err.message}`,
                details: process.env.NODE_ENV === 'development' ? err.message : undefined,
                hint: 'Le fichier peut être corrompu. Vérifiez les données injectées (caractères spéciaux, structure XML).'
            });
        }

        // Try to load saved form data from JSON if exists
        const jsonFileName = `FSOP_${templateCode}_${serialNumber}_${launchNumber}.json`;
        const jsonPath = path.join(fsopDir, jsonFileName);
        let savedFormData = null;
        try {
            if (await safeIsFile(jsonPath)) {
                const jsonContent = await fs.readFile(jsonPath, 'utf8');
                const jsonData = JSON.parse(jsonContent);
                savedFormData = jsonData.formData || null;
                console.log(`✅ Données sauvegardées chargées depuis: ${jsonPath}`);
            } else {
                console.log(`ℹ️ Aucun fichier JSON trouvé: ${jsonPath}`);
            }
        } catch (jsonError) {
            console.warn(`⚠️ Erreur lors du chargement du JSON (non bloquant):`, jsonError.message);
            // Don't fail if JSON doesn't exist or is corrupted
        }

        console.log(`📥 Envoi du fichier au client...`);
        return res.download(destPath, destName);
    } catch (error) {
        console.error('❌ FSOP open error:', error);
        console.error('❌ Stack trace:', error.stack);
        return res.status(500).json({ 
            error: 'INTERNAL_ERROR',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

router.post('/load-data', requireFsopSession, async (req, res) => {
    try {
        const launchNumber = normalizeLaunchNumber(req.body?.launchNumber);
        const templateCode = normalizeTemplateCode(req.body?.templateCode);
        const serialNumber = normalizeSerialNumber(req.body?.serialNumber);

        if (!launchNumber || !templateCode || !serialNumber) {
            return res.status(400).json({ error: 'INPUT_INVALID' });
        }

        const traceRoot = process.env.TRACEABILITY_DIR;
        if (!traceRoot || !(await safeIsDirectory(traceRoot))) {
            return res.status(503).json({ 
                error: 'TRACEABILITY_UNAVAILABLE',
                message: 'Répertoire de traçabilité non configuré ou inaccessible'
            });
        }

        const rootLt = await resolveLtRootCached(traceRoot, launchNumber);
        if (!rootLt) {
            return res.status(422).json({ 
                error: 'LT_DIR_NOT_FOUND',
                launchNumber: launchNumber
            });
        }

        const fsopDir = path.join(rootLt, 'FSOP');
        const jsonFileName = `FSOP_${templateCode}_${serialNumber}_${launchNumber}.json`;
        const jsonPath = path.join(fsopDir, jsonFileName);

        try {
            if (await safeIsFile(jsonPath)) {
                const jsonContent = await fs.readFile(jsonPath, 'utf8');
                const jsonData = JSON.parse(jsonContent);
                console.log(`✅ Données chargées depuis: ${jsonPath}`);
                return res.json({
                    success: true,
                    hasData: true,
                    formData: jsonData.formData || {},
                    savedAt: jsonData.savedAt
                });
            } else {
                console.log(`ℹ️ Aucun fichier JSON trouvé: ${jsonPath}`);
                return res.json({
                    success: true,
                    hasData: false,
                    formData: null
                });
            }
        } catch (jsonError) {
            console.warn(`⚠️ Erreur lors du chargement du JSON:`, jsonError.message);
            return res.json({
                success: true,
                hasData: false,
                formData: null,
                error: jsonError.message
            });
        }
    } catch (error) {
        console.error('❌ FSOP load-data error:', error);
        return res.status(500).json({ 
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

router.post('/validate-serial', requireFsopSession, async (req, res) => {
    try {
        const launchNumber = normalizeLaunchNumber(req.body?.launchNumber);
        const serialNumber = normalizeSerialNumber(req.body?.serialNumber);

        if (!launchNumber || !serialNumber) {
            return res.status(400).json({ 
                error: 'INPUT_INVALID',
                message: 'Numéro de lancement et numéro de série requis'
            });
        }

        const traceRoot = process.env.TRACEABILITY_DIR;
        if (!traceRoot) {
            return res.status(503).json({ 
                error: 'TRACEABILITY_UNAVAILABLE',
                message: 'Répertoire de traçabilité non configuré'
            });
        }
        
        if (!(await safeIsDirectory(traceRoot))) {
            return res.status(503).json({ 
                error: 'TRACEABILITY_UNAVAILABLE',
                message: 'Répertoire de traçabilité introuvable'
            });
        }

        // Validate serial number in mesure file
        const { validateSerialNumberInMesure } = require('../services/fsopExcelService');
        const result = await validateSerialNumberInMesure(launchNumber, serialNumber, traceRoot);

        if (result.exists) {
            return res.json({
                success: true,
                exists: true,
                excelPath: result.excelPath,
                message: result.message
            });
        } else {
            return res.status(422).json({
                success: false,
                exists: false,
                excelPath: result.excelPath,
                message: result.message
            });
        }

    } catch (error) {
        console.error('❌ FSOP validate-serial error:', error);
        return res.status(500).json({ 
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

router.post('/save', requireFsopSession, async (req, res) => {
    try {
        const launchNumber = normalizeLaunchNumber(req.body?.launchNumber);
        const templateCode = normalizeTemplateCode(req.body?.templateCode);
        const serialNumber = normalizeSerialNumber(req.body?.serialNumber);
        const formData = req.body?.formData || {}; // { placeholders: {}, tables: {}, wordlikeTables: {}, passFail: {} }
        
        // Merge wordlikeTables into tables (wordlikeTables use numeric table indices as keys)
        if (formData.wordlikeTables && typeof formData.wordlikeTables === 'object') {
            if (!formData.tables) formData.tables = {};
            // Merge wordlikeTables into tables (they use string keys like "0", "1", etc.)
            Object.assign(formData.tables, formData.wordlikeTables);
        }

        if (!launchNumber || !templateCode || !serialNumber) {
            return res.status(400).json({ error: 'INPUT_INVALID' });
        }

        const traceRoot = process.env.TRACEABILITY_DIR;
        if (!traceRoot) {
            return res.status(503).json({ 
                error: 'TRACEABILITY_UNAVAILABLE',
                message: 'Répertoire de traçabilité non configuré'
            });
        }
        
        if (!(await safeIsDirectory(traceRoot))) {
            return res.status(503).json({ 
                error: 'TRACEABILITY_UNAVAILABLE',
                message: 'Répertoire de traçabilité introuvable'
            });
        }

        // Resolve LT root directory
        console.log(`🔍 Recherche du répertoire LT: ${launchNumber} dans ${traceRoot}`);
        const rootLt = await resolveLtRootCached(traceRoot, launchNumber);
        if (!rootLt) {
            console.error(`❌ Répertoire LT introuvable: ${launchNumber} dans ${traceRoot}`);
            // Try to list what directories exist for debugging
            let availableDirs = [];
            try {
                const entries = await fsp.readdir(traceRoot, { withFileTypes: true });
                availableDirs = entries
                    .filter(e => e.isDirectory())
                    .map(e => e.name)
                    .slice(0, 20); // Limit to first 20 for response size
            } catch (err) {
                console.warn(`⚠️ Impossible de lister les répertoires dans ${traceRoot}:`, err.message);
            }
            
            return res.status(422).json({ 
                error: 'LT_DIR_NOT_FOUND',
                launchNumber: launchNumber,
                traceRoot: traceRoot,
                message: `Le répertoire pour le lancement ${launchNumber} est introuvable dans ${traceRoot}`,
                hint: 'Vérifiez que le répertoire existe. Le format attendu est: <traceRoot>/<LT> ou <traceRoot>/<child>/<LT>',
                availableDirectories: availableDirs.length > 0 ? availableDirs : undefined
            });
        }
        console.log(`✅ Répertoire LT trouvé: ${rootLt}`);

        const { ok: fsopOk2, fsopDir, response: fsopErr2 } = await ensureFsopDirectory(rootLt, res);
        if (!fsopOk2) return fsopErr2;
        console.log(`✅ Répertoire FSOP: ${fsopDir}`);

        const templatesBaseDir = await resolveTemplatesDir();
        if (!templatesBaseDir) {
            return res.status(503).json({ error: 'TEMPLATES_DIR_NOT_FOUND', hint: 'Définissez FSOP_TEMPLATES_DIR dans .env' });
        }
        
        const depthLimit = Number.parseInt(process.env.FSOP_SEARCH_DEPTH || '3', 10);
        const searchDepth = Number.isFinite(depthLimit) && depthLimit >= 0 ? depthLimit : 3;
        
        const templatePath = await findTemplateFileCached(templatesBaseDir, templateCode, searchDepth);
        
        if (!templatePath) {
            return res.status(404).json({ 
                error: 'TEMPLATE_NOT_FOUND',
                message: `Template ${templateCode} introuvable`
            });
        }

        // Prepare destination file - Format: FSOP_<TemplateCode>_<SerialNumber>_<LaunchNumber>.docx
        // Exemple: FSOP_F479_23.199_LT2500133.docx
        if (!serialNumber || serialNumber.trim() === '') {
            return res.status(400).json({
                error: 'SERIAL_NUMBER_REQUIRED',
                message: 'Le numéro de série est requis pour générer le nom du fichier FSOP'
            });
        }
        const destName = `FSOP_${templateCode}_${serialNumber}_${launchNumber}.docx`;
        const destPath = path.join(fsopDir, destName);
        const lockKey = destPath;
        console.log(`📝 Nom du fichier généré: ${destName} (Template: ${templateCode}, SN: ${serialNumber}, LT: ${launchNumber})`);

        // Copy template to destination — protégé par verrou pour éviter les corruptions simultanées
        try {
            await withSaveLock(lockKey, async () => {
            // Écriture atomique : copie vers un fichier temporaire, puis renommage
            const tmpPath = destPath + '.tmp.' + Date.now();
            await fs.copyFile(templatePath, tmpPath);
            try {
                await fsp.rename(tmpPath, destPath);
            } catch (_) {
                // Sur Windows cross-device, rename peut échouer : fallback copyFile + unlink
                await fs.copyFile(tmpPath, destPath);
                await fsp.unlink(tmpPath).catch(() => {});
            }
            
            await fs.copyFile(templatePath, destPath);
            console.log(`✅ Template copié: ${templatePath} -> ${destPath}`);
            
            // Verify the copied file exists and has content
            const copiedStats = await fsp.stat(destPath);
            if (copiedStats.size === 0) {
                throw new Error('Le fichier copié est vide');
            }
            console.log(`✅ Fichier copié vérifié: ${copiedStats.size} bytes`);
            
            // Verify it's a valid DOCX (ZIP file)
            try {
                const testZip = new AdmZip(destPath);
                const testEntry = testZip.getEntry('word/document.xml');
                if (!testEntry) {
                    throw new Error('Fichier copié n\'est pas un DOCX valide');
                }
                console.log(`✅ Fichier DOCX valide après copie`);
            } catch (zipError) {
                console.error(`❌ Fichier copié n'est pas un DOCX valide:`, zipError.message);
                throw new Error(`Le fichier copié est corrompu: ${zipError.message}`);
            }
            }); // fin withSaveLock
        } catch (copyError) {
            console.error(`❌ Erreur lors de la copie du template:`, copyError.message);
            return res.status(500).json({
                error: 'TEMPLATE_COPY_FAILED',
                message: `Impossible de copier le template vers ${destPath}`,
                details: process.env.NODE_ENV === 'development' ? copyError.message : undefined
            });
        }

        // Prepare replacements
        const replacements = {
            '{{LT}}': launchNumber,
            '{{SN}}': serialNumber,
            ...(formData.placeholders || {})
        };

        // Sanitize table data: remove ** markers from values before injecting into Word
        const sanitizedTables = {};
        if (formData.tables) {
            for (const [tableId, rows] of Object.entries(formData.tables)) {
                sanitizedTables[tableId] = {};
                for (const [rowId, cells] of Object.entries(rows)) {
                    sanitizedTables[tableId][rowId] = {};
                    for (const [colIdx, value] of Object.entries(cells)) {
                        // Remove ** markers if present (defense in depth)
                        let cleanedValue = String(value || '');
                        cleanedValue = cleanedValue.replace(/^\*\*|\*\*$/g, '');
                        // Normalize decimal separator (comma to point)
                        cleanedValue = cleanedValue.replace(',', '.');
                        sanitizedTables[tableId][rowId][colIdx] = cleanedValue;
                    }
                }
            }
        }

        // Inject data into document
        try {
            await injectIntoDocx(
                destPath,
                replacements,
                sanitizedTables,
                formData.passFail || {},
                formData.checkboxes || {},
                formData.textFields || {}
            );
            console.log(`✅ FSOP sauvegardé: ${destPath}`);
            
            // Verify the final file is valid
            const finalStats = await fsp.stat(destPath);
            if (finalStats.size === 0) {
                throw new Error('Le fichier final est vide après injection');
            }
            console.log(`✅ Fichier final vérifié: ${finalStats.size} bytes`);
        } catch (injectError) {
            console.error(`❌ Erreur lors de l'injection dans le DOCX:`, injectError.message);
            
            // Try to clean up corrupted file
            try {
                await fsp.unlink(destPath).catch(() => {});
                console.log(`🧹 Fichier corrompu supprimé: ${destPath}`);
            } catch (_) {
                // Ignore cleanup errors
            }
            
            return res.status(500).json({
                error: 'DOCX_INJECTION_FAILED',
                message: `Impossible d'injecter les données dans le document DOCX: ${injectError.message}`,
                details: process.env.NODE_ENV === 'development' ? injectError.message : undefined,
                hint: 'Le fichier peut être corrompu. Vérifiez les données injectées (caractères spéciaux, structure XML).'
            });
        }

        // Extract reference and tagged measures for Excel transfer
        let excelUpdateResult = null;
        const reference = formData.reference || formData.placeholders?.REF || formData.placeholders?.REFERENCE;
        const taggedMeasures = formData.taggedMeasures || {};

        if (Object.keys(taggedMeasures).length > 0) {
            try {
                const { findMesureFileInLaunch, findExcelFileByReference, updateExcelWithTaggedMeasures } = require('../services/fsopExcelService');
                
                // Priorité 1: Utiliser le fichier mesure du lancement (déjà validé lors de la saisie du numéro de série)
                let excelPath = await findMesureFileInLaunch(launchNumber, traceRoot);
                
                // Priorité 2: Si pas trouvé et référence fournie, chercher par référence
                if (!excelPath && reference) {
                    console.log(`🔍 Recherche du fichier Excel pour la référence: ${reference}`);
                    excelPath = await findExcelFileByReference(reference, traceRoot);
                }
                
                if (excelPath) {
                    console.log(`📊 Mise à jour du fichier Excel: ${excelPath}`);
                    const serialNumber = formData.placeholders?.['{{SN}}'] || formData.serialNumber || req.body?.serialNumber;
                    excelUpdateResult = await updateExcelWithTaggedMeasures(excelPath, taggedMeasures, {
                        serialNumber: serialNumber,
                        forceReplace: req.body?.forceReplace === true,
                        retryAttempts: 3,
                        retryDelayMs: 2000,
                        lockRetryMs: 1000,
                        lockMaxRetries: 10
                    });
                    console.log(`✅ ${excelUpdateResult.message}`);
                } else {
                    console.warn(`⚠️ Fichier Excel mesure non trouvé pour le lancement ${launchNumber}${reference ? ` ou la référence ${reference}` : ''}`);
                    excelUpdateResult = {
                        success: false,
                        message: `Fichier Excel mesure non trouvé pour le lancement ${launchNumber}${reference ? ` ou la référence ${reference}` : ''}`,
                        updated: 0,
                        missing: []
                    };
                }
            } catch (error) {
                console.error(`❌ Erreur lors de la mise à jour Excel:`, error.message);
                excelUpdateResult = {
                    success: false,
                    message: `Erreur lors de la mise à jour Excel: ${error.message}`,
                    updated: 0,
                    missing: []
                };
            }
        } else {
            console.log(`ℹ️ Aucune mesure taguée fournie, pas de mise à jour Excel`);
        }

        // Save form data as JSON for future loading
        const jsonFileName = `FSOP_${templateCode}_${serialNumber}_${launchNumber}.json`;
        const jsonPath = path.join(fsopDir, jsonFileName);
        try {
            const jsonData = {
                launchNumber: launchNumber,
                templateCode: templateCode,
                serialNumber: serialNumber,
                formData: formData,
                savedAt: new Date().toISOString()
            };
            await fs.writeFile(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');
            console.log(`✅ Données du formulaire sauvegardées: ${jsonPath}`);
        } catch (jsonError) {
            console.warn(`⚠️ Impossible de sauvegarder le JSON (non bloquant):`, jsonError.message);
            // Don't fail the save if JSON write fails
        }

        return res.json({
            success: true,
            message: 'FSOP sauvegardé avec succès',
            fileName: destName,
            excelUpdate: excelUpdateResult
        });
    } catch (error) {
        console.error('❌ FSOP save error:', error);
        console.error('❌ Stack trace:', error.stack);
        return res.status(500).json({ 
            error: 'INTERNAL_ERROR',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

module.exports = router;


