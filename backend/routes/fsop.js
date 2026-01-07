const express = require('express');
const path = require('path');
const fs = require('fs/promises');

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

const router = express.Router();

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
        // Get Excel file path from environment variable or use default
        const excelPath = process.env.FSOP_TEMPLATES_XLSX_PATH || 
            'X:\\Qualite\\4_Public\\A disposition\\DOSSIER SMI\\Formulaires\\Liste des formulaires.xlsx';

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
                path: process.env.FSOP_TEMPLATES_XLSX_PATH || 'X:\\Qualite\\4_Public\\A disposition\\DOSSIER SMI\\Formulaires\\Liste des formulaires.xlsx',
                hint: 'Vérifiez que le fichier existe et que le chemin est correct. Vous pouvez définir FSOP_TEMPLATES_XLSX_PATH dans votre fichier .env'
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

        // Les templates sont dans le répertoire centralisé
        const templatesBaseDir = process.env.FSOP_TEMPLATES_DIR || 
            'X:\\Qualite\\4_Public\\A disposition\\DOSSIER SMI\\Formulaires';
        
        if (!(await safeIsDirectory(templatesBaseDir))) {
            return res.status(503).json({ 
                error: 'TEMPLATES_DIR_NOT_FOUND',
                message: 'Répertoire des templates introuvable',
                templatesDir: templatesBaseDir
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
        if (!(await safeIsDirectory(fsopDir))) {
            console.error(`❌ Répertoire FSOP introuvable: ${fsopDir}`);
            return res.status(422).json({ 
                error: 'FSOP_DIR_NOT_FOUND',
                fsopDir: fsopDir,
                rootLt: rootLt
            });
        }
        console.log(`✅ Répertoire FSOP trouvé: ${fsopDir}`);

        // Les templates sont dans le répertoire centralisé (où se trouve l'Excel)
        // X:\Qualite\4_Public\A disposition\DOSSIER SMI\Formulaires\
        const templatesBaseDir = process.env.FSOP_TEMPLATES_DIR || 
            'X:\\Qualite\\4_Public\\A disposition\\DOSSIER SMI\\Formulaires';
        
        console.log(`🔍 Recherche du template ${templateCode} dans le répertoire centralisé: ${templatesBaseDir}`);
        
        if (!(await safeIsDirectory(templatesBaseDir))) {
            console.error(`❌ Répertoire des templates introuvable: ${templatesBaseDir}`);
            return res.status(503).json({ 
                error: 'TEMPLATES_DIR_NOT_FOUND',
                templatesDir: templatesBaseDir,
                hint: 'Définissez FSOP_TEMPLATES_DIR dans votre fichier .env pour pointer vers le répertoire contenant les templates'
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

        const destName = `FSOP_${templateCode}_${serialNumber}_${launchNumber}.docx`;
        const destPath = path.join(fsopDir, destName);
        console.log(`📝 Copie vers: ${destPath}`);

        try {
            if (existing) {
                console.log(`📋 Copie depuis document existant: ${existing}`);
                await fs.copyFile(existing, destPath);
            } else {
                console.log(`📋 Copie depuis template: ${templatePath}`);
                await fs.copyFile(templatePath, destPath);
            }
            console.log(`✅ Fichier copié avec succès`);
        } catch (err) {
            console.error(`❌ Erreur lors de la copie:`, err.message);
            throw new Error(`Impossible de copier le fichier: ${err.message}`);
        }

        console.log(`🔧 Injection des données dans le document...`);
        try {
            await injectIntoDocx(destPath, { '{{LT}}': launchNumber, '{{SN}}': serialNumber });
            console.log(`✅ Données injectées avec succès`);
        } catch (err) {
            console.error(`❌ Erreur lors de l'injection:`, err.message);
            throw new Error(`Impossible d'injecter les données: ${err.message}`);
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
        const rootLt = await resolveLtRoot(traceRoot, launchNumber);
        if (!rootLt) {
            return res.status(422).json({ 
                error: 'LT_DIR_NOT_FOUND',
                launchNumber: launchNumber
            });
        }

        const fsopDir = path.join(rootLt, 'FSOP');
        if (!(await safeIsDirectory(fsopDir))) {
            return res.status(422).json({ 
                error: 'FSOP_DIR_NOT_FOUND',
                fsopDir: fsopDir
            });
        }

        // Find template
        const templatesBaseDir = process.env.FSOP_TEMPLATES_DIR || 
            'X:\\Qualite\\4_Public\\A disposition\\DOSSIER SMI\\Formulaires';
        
        const depthLimit = Number.parseInt(process.env.FSOP_SEARCH_DEPTH || '3', 10);
        const searchDepth = Number.isFinite(depthLimit) && depthLimit >= 0 ? depthLimit : 3;
        
        const templatePath = await findTemplateFile(templatesBaseDir, templateCode, searchDepth);
        
        if (!templatePath) {
            return res.status(404).json({ 
                error: 'TEMPLATE_NOT_FOUND',
                message: `Template ${templateCode} introuvable`
            });
        }

        // Prepare destination file
        const destName = `FSOP_${templateCode}_${serialNumber}_${launchNumber}.docx`;
        const destPath = path.join(fsopDir, destName);

        // Copy template to destination
        await fs.copyFile(templatePath, destPath);

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
        await injectIntoDocx(
            destPath,
            replacements,
            sanitizedTables,
            formData.passFail || {},
            formData.checkboxes || {},
            formData.textFields || {}
        );

        console.log(`✅ FSOP sauvegardé: ${destPath}`);

        // Extract reference and tagged measures for Excel transfer
        let excelUpdateResult = null;
        const reference = formData.reference || formData.placeholders?.REF || formData.placeholders?.REFERENCE;
        const taggedMeasures = formData.taggedMeasures || {};

        if (reference && Object.keys(taggedMeasures).length > 0) {
            try {
                const { findExcelFileByReference, updateExcelWithTaggedMeasures } = require('../services/fsopExcelService');
                
                console.log(`🔍 Recherche du fichier Excel pour la référence: ${reference}`);
                const excelPath = await findExcelFileByReference(reference, traceRoot);
                
                if (excelPath) {
                    console.log(`📊 Mise à jour du fichier Excel: ${excelPath}`);
                    excelUpdateResult = await updateExcelWithTaggedMeasures(excelPath, taggedMeasures, {
                        retryAttempts: 3,
                        retryDelayMs: 2000,
                        lockRetryMs: 1000,
                        lockMaxRetries: 10
                    });
                    console.log(`✅ ${excelUpdateResult.message}`);
                } else {
                    console.warn(`⚠️ Fichier Excel non trouvé pour la référence: ${reference}`);
                    excelUpdateResult = {
                        success: false,
                        message: `Fichier Excel non trouvé pour la référence: ${reference}`,
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
            if (!reference) {
                console.log(`ℹ️ Aucune référence fournie, pas de mise à jour Excel`);
            }
            if (Object.keys(taggedMeasures).length === 0) {
                console.log(`ℹ️ Aucune mesure taguée fournie, pas de mise à jour Excel`);
            }
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


