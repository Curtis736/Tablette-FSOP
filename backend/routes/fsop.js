const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const fsp = fs; // Alias for consistency with other parts of the codebase

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
const { executeQuery } = require('../config/database');

const router = express.Router();

const DEFAULT_TEMPLATES_DIR_WIN = 'X:\\Qualite\\4_Public\\A disposition\\DOSSIER SMI\\Formulaires';
const DEFAULT_TEMPLATES_XLSX_WIN = 'X:\\Qualite\\4_Public\\A disposition\\DOSSIER SMI\\Formulaires\\Liste des formulaires.xlsx';

// Common Linux/container locations we support out of the box (VM/Docker).
const DEFAULT_TEMPLATES_DIR_LINUX = '/mnt/templates/Qualite/4_Public/A disposition/DOSSIER SMI/Formulaires';
const DEFAULT_TEMPLATES_DIR_LINUX_ALT = '/mnt/services/Qualite/4_Public/A disposition/DOSSIER SMI/Formulaires';
const DEFAULT_TEMPLATES_XLSX_LINUX = '/mnt/templates/Qualite/4_Public/A disposition/DOSSIER SMI/Formulaires/Liste des formulaires.xlsx';
const DEFAULT_TEMPLATES_XLSX_LINUX_ALT = '/mnt/services/Qualite/4_Public/A disposition/DOSSIER SMI/Formulaires/Liste des formulaires.xlsx';

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

function normalizeTemplateCode(value) {
    const raw = String(value || '').trim().toUpperCase();
    // Accept "F469" only (MVP) – keep it strict to match template naming rules.
    if (!/^F\d{3}$/i.test(raw)) {
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
                CodeRubrique,
                Phase,
                CodeLot
            FROM [SEDI_ERP].[dbo].[LCTC]
            WHERE CodeLancement = @launchNumber
              AND CodeLot IS NOT NULL
              AND LTRIM(RTRIM(CodeLot)) <> ''
        `, { launchNumber });

        const byRubrique = new Map(); // CodeRubrique -> Set(CodeLot)
        const uniqueLots = new Set();

        for (const r of rows || []) {
            const codeRubrique = String(r.CodeRubrique || '').trim();
            const codeLot = String(r.CodeLot || '').trim();
            if (!codeRubrique || !codeLot) continue;
            uniqueLots.add(codeLot);
            if (!byRubrique.has(codeRubrique)) byRubrique.set(codeRubrique, new Set());
            byRubrique.get(codeRubrique).add(codeLot);
        }

        const items = [...byRubrique.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([codeRubrique, lotSet]) => ({
                designation: codeRubrique, // à défaut de table de désignation article
                codeRubrique,
                lots: [...lotSet].sort()
            }));

        return res.json({
            success: true,
            launchNumber,
            uniqueLots: [...uniqueLots].sort(),
            items,
            count: uniqueLots.size
        });
    } catch (error) {
        console.error('❌ Erreur récupération lots FSOP:', error);
        return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: error.message });
    }
});

router.get('/debug/:launchNumber', async (req, res) => {
    try {
        const launchNumber = normalizeLaunchNumber(req.params.launchNumber);
        if (!launchNumber) {
            return res.status(400).json({ error: 'INVALID_LAUNCH_NUMBER' });
        }

        const traceRoot = process.env.TRACEABILITY_DIR;
        if (!traceRoot) {
            return res.status(503).json({ error: 'TRACEABILITY_DIR_NOT_CONFIGURED' });
        }

        const rootLt = await resolveLtRoot(traceRoot, launchNumber);
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
        // Excel templates list: try env, then common Linux paths, then Windows default.
        const excelPath = await resolveFirstExistingFile([
            process.env.FSOP_TEMPLATES_XLSX_PATH,
            DEFAULT_TEMPLATES_XLSX_LINUX,
            DEFAULT_TEMPLATES_XLSX_LINUX_ALT,
            DEFAULT_TEMPLATES_XLSX_WIN
        ]);

        if (!excelPath) {
            return res.status(503).json({
                error: 'TEMPLATES_SOURCE_UNAVAILABLE',
                message: 'Le fichier Excel des templates est introuvable ou inaccessible',
                tried: [
                    process.env.FSOP_TEMPLATES_XLSX_PATH,
                    DEFAULT_TEMPLATES_XLSX_LINUX,
                    DEFAULT_TEMPLATES_XLSX_LINUX_ALT,
                    DEFAULT_TEMPLATES_XLSX_WIN
                ].filter(Boolean),
                hint: 'Définissez FSOP_TEMPLATES_XLSX_PATH (Linux: /mnt/templates/... ou /mnt/services/... ).'
            });
        }

        console.log(`📋 Lecture des templates depuis: ${excelPath}`);
        const result = await readTemplatesFromExcel(excelPath);
        
        console.log(`✅ ${result.count} templates chargés avec succès`);
        return res.json(result);
    } catch (error) {
        console.error('❌ FSOP templates error:', error);
        
        if (error.message.includes('TEMPLATES_SOURCE_UNAVAILABLE')) {
            return res.status(503).json({ 
                error: 'TEMPLATES_SOURCE_UNAVAILABLE',
                message: 'Le fichier Excel des templates est introuvable ou inaccessible',
                path: process.env.FSOP_TEMPLATES_XLSX_PATH || DEFAULT_TEMPLATES_XLSX_WIN,
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

router.get('/template/:templateCode/structure', async (req, res) => {
    try {
        const templateCode = normalizeTemplateCode(req.params.templateCode);
        
        if (!templateCode) {
            return res.status(400).json({ 
                error: 'INPUT_INVALID',
                message: 'Code template invalide (format attendu: Fxxx)'
            });
        }

        // Templates: try env, then common Linux paths, then Windows default.
        const templatesBaseDir = await resolveFirstExistingDir([
            process.env.FSOP_TEMPLATES_DIR,
            DEFAULT_TEMPLATES_DIR_LINUX,
            DEFAULT_TEMPLATES_DIR_LINUX_ALT,
            DEFAULT_TEMPLATES_DIR_WIN
        ]);

        if (!templatesBaseDir) {
            return res.status(503).json({ 
                error: 'TEMPLATES_DIR_NOT_FOUND',
                message: 'Répertoire des templates introuvable',
                tried: [
                    process.env.FSOP_TEMPLATES_DIR,
                    DEFAULT_TEMPLATES_DIR_LINUX,
                    DEFAULT_TEMPLATES_DIR_LINUX_ALT,
                    DEFAULT_TEMPLATES_DIR_WIN
                ].filter(Boolean),
                hint: 'Définissez FSOP_TEMPLATES_DIR (Linux: /mnt/templates/... ou /mnt/services/... ).'
            });
        }

        // Chercher le template
        const depthLimit = Number.parseInt(process.env.FSOP_SEARCH_DEPTH || '3', 10);
        const searchDepth = Number.isFinite(depthLimit) && depthLimit >= 0 ? depthLimit : 3;
        
        const templatePath = await findTemplateFile(templatesBaseDir, templateCode, searchDepth);
        
        if (!templatePath) {
            return res.status(404).json({ 
                error: 'TEMPLATE_NOT_FOUND',
                message: `Template ${templateCode} introuvable`,
                templateCode: templateCode
            });
        }

        // Parser la structure du document
        console.log(`🔍 Starting structure parsing for template ${templateCode}...`);
        console.log(`📁 Template path: ${templatePath}`);
        const structure = await parseWordStructure(templatePath);
        console.log(`✅ Structure parsed successfully for template ${templateCode}`);
        
        return res.json({
            templateCode: templateCode,
            templatePath: templatePath,
            structure: structure
        });
    } catch (error) {
        console.error('❌ FSOP structure error:', error);
        console.error('❌ Error message:', error.message);
        console.error('❌ Stack trace:', error.stack);
        console.error('❌ Error name:', error.name);
        console.error('❌ Error code:', error.code);
        return res.status(500).json({ 
            error: 'INTERNAL_ERROR',
            message: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            stack: error.stack // Always include stack for debugging
        });
    }
});

router.post('/open', async (req, res) => {
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
        const rootLt = await resolveLtRoot(traceRoot, launchNumber);
        if (!rootLt) {
            console.error(`❌ Répertoire LT introuvable: ${launchNumber} dans ${traceRoot}`);
            return res.status(422).json({ 
                error: 'LT_DIR_NOT_FOUND',
                launchNumber: launchNumber,
                traceRoot: traceRoot
            });
        }
        console.log(`✅ Répertoire LT trouvé: ${rootLt}`);

        const fsopDir = path.join(rootLt, 'FSOP');
        console.log(`🔍 Vérification du répertoire FSOP: ${fsopDir}`);
        
        // Vérifier d'abord si le répertoire existe déjà
        const fsopDirExists = await safeIsDirectory(fsopDir);
        
        if (!fsopDirExists) {
            // Créer le répertoire FSOP s'il n'existe pas
            // recursive: true crée aussi les répertoires parents si nécessaire
            try {
                await fs.mkdir(fsopDir, { recursive: true });
                console.log(`✅ Répertoire FSOP créé: ${fsopDir}`);
                
                // Vérifier que la création a réussi
                if (!(await safeIsDirectory(fsopDir))) {
                    console.error(`❌ Répertoire FSOP introuvable après création: ${fsopDir}`);
                    return res.status(422).json({
                        error: 'FSOP_DIR_NOT_FOUND',
                        fsopDir,
                        rootLt,
                        message: `Le répertoire FSOP n'a pas pu être créé ou n'est pas accessible: ${fsopDir}`
                    });
                }
            } catch (err) {
                // Vérifier si c'est parce qu'un fichier existe avec le même nom
                const existsAsFile = await safeIsFile(fsopDir);
                if (existsAsFile) {
                    console.error(`❌ Un fichier existe déjà avec le nom du répertoire FSOP: ${fsopDir}`);
                    return res.status(422).json({
                        error: 'FSOP_DIR_CONFLICT',
                        fsopDir,
                        rootLt,
                        message: `Un fichier existe déjà avec le nom du répertoire FSOP. Impossible de créer le répertoire: ${fsopDir}`
                    });
                }
                
                console.error(`❌ Impossible de créer le répertoire FSOP: ${fsopDir}`, err.message);
                return res.status(422).json({
                    error: 'FSOP_DIR_CREATE_FAILED',
                    fsopDir,
                    rootLt,
                    message: `Impossible de créer le répertoire FSOP dans ${rootLt}`,
                    details: process.env.NODE_ENV === 'development' ? err.message : undefined
                });
            }
        } else {
            console.log(`✅ Répertoire FSOP existe déjà: ${fsopDir}`);
        }

        // Les templates sont dans le répertoire centralisé (où se trouve l'Excel)
        // X:\Qualite\4_Public\A disposition\DOSSIER SMI\Formulaires\
        const templatesBaseDir = await resolveFirstExistingDir([
            process.env.FSOP_TEMPLATES_DIR,
            DEFAULT_TEMPLATES_DIR_LINUX,
            DEFAULT_TEMPLATES_DIR_LINUX_ALT,
            DEFAULT_TEMPLATES_DIR_WIN
        ]);
        
        console.log(`🔍 Recherche du template ${templateCode} dans le répertoire centralisé: ${templatesBaseDir || '(introuvable)'}`);
        
        if (!templatesBaseDir) {
            console.error(`❌ Répertoire des templates introuvable (tous chemins testés)`);
            return res.status(503).json({ 
                error: 'TEMPLATES_DIR_NOT_FOUND',
                tried: [
                    process.env.FSOP_TEMPLATES_DIR,
                    DEFAULT_TEMPLATES_DIR_LINUX,
                    DEFAULT_TEMPLATES_DIR_LINUX_ALT,
                    DEFAULT_TEMPLATES_DIR_WIN
                ].filter(Boolean),
                hint: 'Définissez FSOP_TEMPLATES_DIR (Linux: /mnt/templates/... ou /mnt/services/... ).'
            });
        }

        // Chercher le template dans le répertoire centralisé et ses sous-dossiers (ex: B3-PRODUCTION\AGS\F571-...)
        // Le template peut être dans un sous-dossier et avoir un nom complexe (ex: F571-Ind A FSOP OHRNS -24.184-10.docx)
        const depthLimit = Number.parseInt(process.env.FSOP_SEARCH_DEPTH || '3', 10);
        const searchDepth = Number.isFinite(depthLimit) && depthLimit >= 0 ? depthLimit : 3;
        
        const templatePath = await findTemplateFile(templatesBaseDir, templateCode, searchDepth);
        
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

router.post('/validate-serial', async (req, res) => {
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

router.post('/save', async (req, res) => {
    try {
        const launchNumber = normalizeLaunchNumber(req.body?.launchNumber);
        const templateCode = normalizeTemplateCode(req.body?.templateCode);
        const serialNumber = normalizeSerialNumber(req.body?.serialNumber);
        const formData = req.body?.formData || {}; // { placeholders: {}, tables: {}, passFail: {} }

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
        const rootLt = await resolveLtRoot(traceRoot, launchNumber);
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

        const fsopDir = path.join(rootLt, 'FSOP');
        
        // Vérifier d'abord si le répertoire existe déjà
        const fsopDirExists = await safeIsDirectory(fsopDir);
        
        if (!fsopDirExists) {
            // Créer le répertoire FSOP s'il n'existe pas
            // recursive: true crée aussi les répertoires parents si nécessaire
            try {
                await fs.mkdir(fsopDir, { recursive: true });
                console.log(`✅ Répertoire FSOP créé: ${fsopDir}`);
                
                // Vérifier que la création a réussi
                if (!(await safeIsDirectory(fsopDir))) {
                    console.error(`❌ Répertoire FSOP introuvable après création: ${fsopDir}`);
                    return res.status(422).json({ 
                        error: 'FSOP_DIR_NOT_FOUND',
                        fsopDir: fsopDir,
                        message: `Le répertoire FSOP n'a pas pu être créé ou n'est pas accessible: ${fsopDir}`
                    });
                }
            } catch (err) {
                // Vérifier si c'est parce qu'un fichier existe avec le même nom
                const existsAsFile = await safeIsFile(fsopDir);
                if (existsAsFile) {
                    console.error(`❌ Un fichier existe déjà avec le nom du répertoire FSOP: ${fsopDir}`);
                    return res.status(422).json({
                        error: 'FSOP_DIR_CONFLICT',
                        fsopDir,
                        rootLt,
                        message: `Un fichier existe déjà avec le nom du répertoire FSOP. Impossible de créer le répertoire: ${fsopDir}`
                    });
                }
                
                console.error(`❌ Impossible de créer le répertoire FSOP: ${fsopDir}`, err.message);
                return res.status(422).json({
                    error: 'FSOP_DIR_CREATE_FAILED',
                    fsopDir,
                    rootLt,
                    message: `Impossible de créer le répertoire FSOP dans ${rootLt}`,
                    details: process.env.NODE_ENV === 'development' ? err.message : undefined
                });
            }
        } else {
            console.log(`✅ Répertoire FSOP existe déjà: ${fsopDir}`);
        }

        // Find template
        const templatesBaseDir = await resolveFirstExistingDir([
            process.env.FSOP_TEMPLATES_DIR,
            DEFAULT_TEMPLATES_DIR_LINUX,
            DEFAULT_TEMPLATES_DIR_LINUX_ALT,
            DEFAULT_TEMPLATES_DIR_WIN
        ]);
        if (!templatesBaseDir) {
            return res.status(503).json({ 
                error: 'TEMPLATES_DIR_NOT_FOUND',
                message: 'Répertoire des templates introuvable',
                tried: [
                    process.env.FSOP_TEMPLATES_DIR,
                    DEFAULT_TEMPLATES_DIR_LINUX,
                    DEFAULT_TEMPLATES_DIR_LINUX_ALT,
                    DEFAULT_TEMPLATES_DIR_WIN
                ].filter(Boolean),
                hint: 'Définissez FSOP_TEMPLATES_DIR (Linux: /mnt/templates/... ou /mnt/services/... ).'
            });
        }
        
        const depthLimit = Number.parseInt(process.env.FSOP_SEARCH_DEPTH || '3', 10);
        const searchDepth = Number.isFinite(depthLimit) && depthLimit >= 0 ? depthLimit : 3;
        
        const templatePath = await findTemplateFile(templatesBaseDir, templateCode, searchDepth);
        
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
        console.log(`📝 Nom du fichier généré: ${destName} (Template: ${templateCode}, SN: ${serialNumber}, LT: ${launchNumber})`);

        // Check if file already exists and is being used
        try {
            const existingStats = await fsp.stat(destPath);
            if (existingStats) {
                console.log(`⚠️ Fichier existe déjà: ${destPath}, il sera écrasé`);
                // Try to check if file is locked (on Windows) or in use
                // On Linux, we can't easily check this, so we'll try and catch the error
            }
        } catch (_) {
            // File doesn't exist, which is fine
        }

        // Copy template to destination
        try {
            // If file exists, try to remove it first to avoid issues
            try {
                await fsp.unlink(destPath);
            } catch (_) {
                // Ignore if file doesn't exist
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
                const AdmZip = require('adm-zip');
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

        return res.json({
            success: true,
            message: 'FSOP sauvegardé avec succès',
            filePath: destPath,
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


