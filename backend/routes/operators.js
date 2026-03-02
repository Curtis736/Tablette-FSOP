// Routes pour la gestion des opérateurs
const express = require('express');
const router = express.Router();
const { executeQuery, executeNonQuery, executeProcedure } = require('../config/database');
const TimeUtils = require('../utils/timeUtils');
const { authenticateOperator } = require('../middleware/auth');
const dataIsolation = require('../middleware/dataIsolation');
const secureQuery = require('../services/SecureQueryService');
const { validateOperatorSession, validateDataOwnership, logSecurityAction } = require('../middleware/operatorSecurity');
const dataValidation = require('../services/DataValidationService');
const SessionService = require('../services/SessionService');
const AuditService = require('../services/AuditService');
const { generateRequestId } = require('../middleware/audit');

// ⚡ OPTIMISATION : Cache pour les validations de lancement (évite les requêtes répétées)
const lancementCache = new Map();
const LANCEMENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Fonction de nettoyage des données incohérentes
async function cleanupInconsistentData(operatorId) {
    try {
        console.log(`🧹 Nettoyage des données incohérentes pour l'opérateur ${operatorId}...`);
        
        // 1. Trouver tous les lancements de cet opérateur
        const operatorLancementsQuery = `
            SELECT DISTINCT CodeLanctImprod 
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE OperatorCode = @operatorId
        `;
        
        const operatorLancements = await executeQuery(operatorLancementsQuery, { operatorId });
        
        for (const lancement of operatorLancements) {
            const lancementCode = lancement.CodeLanctImprod;
            
            // 2. Vérifier s'il y a des événements avec d'autres OperatorCode pour ce lancement
            const inconsistentEventsQuery = `
                SELECT NoEnreg, OperatorCode, Ident, DateCreation
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE CodeLanctImprod = @lancementCode 
                AND OperatorCode != @operatorId
            `;
            
            const inconsistentEvents = await executeQuery(inconsistentEventsQuery, { 
                lancementCode, 
                operatorId 
            });
            
            if (inconsistentEvents.length > 0) {
                console.log(`⚠️ Lancement ${lancementCode} a ${inconsistentEvents.length} événements incohérents:`);
                inconsistentEvents.forEach(e => {
                    console.log(`  - NoEnreg: ${e.NoEnreg}, OperatorCode: ${e.OperatorCode}, Ident: ${e.Ident}`);
                });
                
                // 3. Supprimer les événements incohérents
                const deleteQuery = `
                    DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                    WHERE CodeLanctImprod = @lancementCode 
                    AND OperatorCode != @operatorId
                `;
                
                await executeQuery(deleteQuery, { lancementCode, operatorId });
                console.log(`✅ ${inconsistentEvents.length} événements incohérents supprimés pour ${lancementCode}`);
            }
        }
        
        console.log(`✅ Nettoyage terminé pour l'opérateur ${operatorId}`);
        
    } catch (error) {
        console.error('❌ Erreur lors du nettoyage:', error);
    }
}

// Fonction utilitaire pour formater les dates/heures (format HH:mm seulement, fuseau horaire Paris)
function formatDateTime(dateTime) {
    if (!dateTime) return null;
    
    try {
        // Si c'est déjà au format HH:mm ou HH:mm:ss, le retourner directement
        if (typeof dateTime === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(dateTime)) {
            const parts = dateTime.split(':');
            return `${parts[0]}:${parts[1]}`; // Retourner juste HH:mm
        }
        
        // Si c'est un objet Date, extraire l'heure avec fuseau horaire français
        if (dateTime instanceof Date) {
            return dateTime.toLocaleTimeString('fr-FR', {
                timeZone: 'Europe/Paris',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        }
        
        // Sinon, traiter comme une date complète
        const date = new Date(dateTime);
        if (isNaN(date.getTime())) return null;
        
        return date.toLocaleTimeString('fr-FR', {
            timeZone: 'Europe/Paris',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    } catch (error) {
        console.error('Erreur formatage date:', error);
        return null;
    }
}

// Fonction pour traiter les événements et créer l'historique des lancements
function processLancementEvents(events) {
    const lancementGroups = {};
    
    // Grouper les événements par lancement + opérateur + étape (Phase + CodeRubrique)
    events.forEach(event => {
        const phase = (event.Phase || '').toString().trim();
        const rubrique = (event.CodeRubrique || '').toString().trim();
        const key = `${event.CodeLanctImprod}_${event.OperatorCode}_${phase}_${rubrique}`;
        if (!lancementGroups[key]) {
            lancementGroups[key] = [];
        }
        lancementGroups[key].push(event);
    });
    
    const processedOperations = [];
    
    // Traiter chaque groupe de lancement
    Object.keys(lancementGroups).forEach(key => {
        const events = lancementGroups[key].sort((a, b) => new Date(a.DateCreation) - new Date(b.DateCreation));
        
        if (events.length === 0) return;
        
        const firstEvent = events[0];
        const lastEvent = events[events.length - 1];
        
        // Trouver les événements DEBUT et FIN
        const debutEvent = events.find(e => e.Ident === 'DEBUT');
        const finEvent = events.find(e => e.Ident === 'FIN');
        const pauseEvents = events.filter(e => e.Ident === 'PAUSE');
        const repriseEvents = events.filter(e => e.Ident === 'REPRISE');
        
        // Déterminer le statut actuel
        let status = 'En cours';
        if (finEvent) {
            status = 'Terminé';
        } else if (pauseEvents.length > repriseEvents.length) {
            // Il y a plus de pauses que de reprises, donc en pause
            status = 'En pause';
        }
        
        const operation = {
            id: firstEvent.NoEnreg,
            operatorCode: firstEvent.OperatorCode,  // ✅ CORRECTION : Utiliser OperatorCode au lieu de CodeRubrique
            lancementCode: firstEvent.CodeLanctImprod,
            article: firstEvent.Article || 'N/A',
            startTime: debutEvent && debutEvent.HeureDebut ? formatDateTime(debutEvent.HeureDebut) : null,
            endTime: finEvent && finEvent.HeureFin ? formatDateTime(finEvent.HeureFin) : null,
            status: status,
            phase: firstEvent.Phase || 'PRODUCTION',
            codeRubrique: firstEvent.CodeRubrique || null,
            lastUpdate: lastEvent.DateCreation
        };
        
        processedOperations.push(operation);
    });
    
    // Trier par date du dernier événement (plus récent en premier)
    return processedOperations.sort((a, b) => new Date(b.lastUpdate) - new Date(a.lastUpdate));
}

// Fonction pour valider et récupérer les informations d'un lancement depuis LCTE
// ⚡ OPTIMISATION : Cache pour éviter les requêtes répétées
async function validateLancement(codeLancement) {
    try {
        // Vérifier le cache
        const cached = lancementCache.get(codeLancement);
        if (cached && (Date.now() - cached.timestamp) < LANCEMENT_CACHE_TTL) {
            console.log(`📦 Cache hit pour lancement ${codeLancement}`);
            return cached.data;
        }
        
        console.log(`🔍 Validation du lancement ${codeLancement} dans LCTE...`);
        
        const query = `
            SELECT TOP 1 
                [CodeLancement],
                [CodeArticle],
                [DesignationLct1],
                [CodeModele],
                [DesignationArt1],
                [DesignationArt2]
            FROM [SEDI_ERP].[dbo].[LCTE]
            WHERE [CodeLancement] = @codeLancement
        `;
        
        const result = await executeQuery(query, { codeLancement });
        
        let validationResult;
        if (result && result.length > 0) {
            const lancement = result[0];
            console.log(`✅ Lancement ${codeLancement} trouvé:`, {
                CodeArticle: lancement.CodeArticle,
                DesignationLct1: lancement.DesignationLct1,
                CodeModele: lancement.CodeModele
            });

            // Enregistrer la consultation du lancement (mapping côté SEDI_APP_INDEPENDANTE)
            try {
                await executeProcedure('sp_RecordLancementConsultation', { CodeLancement: codeLancement });
            } catch (error) {
                // Ne pas faire échouer la validation si la procédure n'est pas encore installée
                console.warn(`⚠️ Erreur enregistrement consultation lancement ${codeLancement}:`, error.message);
            }

            validationResult = {
                valid: true,
                data: lancement
            };
        } else {
            console.log(`❌ Lancement ${codeLancement} non trouvé dans LCTE`);
            validationResult = {
                valid: false,
                error: `Le numéro de lancement ${codeLancement} n'existe pas dans la base de données`
            };
        }
        
        // Mettre en cache (même les résultats négatifs pour éviter les requêtes répétées)
        lancementCache.set(codeLancement, {
            data: validationResult,
            timestamp: Date.now()
        });
        
        // Nettoyer le cache périodiquement (garder max 1000 entrées)
        if (lancementCache.size > 1000) {
            const oldestKey = Array.from(lancementCache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
            lancementCache.delete(oldestKey);
        }
        
        return validationResult;
    } catch (error) {
        console.error('❌ Erreur lors de la validation du lancement:', error);
        return {
            valid: false,
            error: 'Erreur lors de la validation du lancement'
        };
    }
}

// GET /api/operators/:code - Récupérer un opérateur par son code
router.get('/:code', async (req, res) => {
    try {
        const { code } = req.params;
        
        // Utiliser la vue V_RESSOURC au lieu d'accéder directement à RESSOURC
        const query = `
            SELECT TOP 1
                v.CodeOperateur,
                v.NomOperateur,
                v.StatutOperateur,
                v.DateConsultation,
                r.Typeressource
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_RESSOURC] v
            LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r ON v.CodeOperateur = r.Coderessource
            WHERE v.CodeOperateur = @code
        `;
        let operators = [];
        try {
            operators = await executeQuery(query, { code });
        } catch (e) {
            // Fallback: certaines installations n'ont pas la vue V_RESSOURC ou l'accès cross-db peut être restreint.
            console.warn('⚠️ V_RESSOURC indisponible, fallback sur RESSOURC:', e?.message || e);
            const fallbackQuery = `
                SELECT TOP 1
                    r.Coderessource AS CodeOperateur,
                    r.Designation1 AS NomOperateur,
                    CAST(NULL AS VARCHAR(50)) AS StatutOperateur,
                    CAST(NULL AS DATETIME2) AS DateConsultation,
                    r.Typeressource
                FROM [SEDI_ERP].[dbo].[RESSOURC] r
                WHERE r.Coderessource = @code
            `;
            operators = await executeQuery(fallbackQuery, { code });
        }
        
        if (operators.length === 0) {
            return res.status(404).json({ 
                error: 'Opérateur non trouvé' 
            });
        }
        
        const operator = operators[0];
        
        // Enregistrer la consultation dans la table de mapping
        try {
            await executeProcedure('sp_RecordOperatorConsultation', { CodeOperateur: code });
        } catch (error) {
            // Ne pas faire échouer la requête si l'enregistrement de consultation échoue
            console.warn('⚠️ Erreur lors de l\'enregistrement de la consultation:', error.message);
        }
        
        res.json({
            id: operator.CodeOperateur,
            code: operator.CodeOperateur,
            nom: operator.NomOperateur,
            type: operator.Typeressource,
            statutOperateur: operator.StatutOperateur,
            dateConsultation: operator.DateConsultation,
            actif: true
        });
        
    } catch (error) {
        console.error('Erreur lors de la récupération de l\'opérateur:', error);
        res.status(500).json({ 
            error: 'Erreur interne du serveur',
            details: error.message 
        });
    }
});

// GET /api/operators - Récupérer tous les opérateurs
router.get('/', async (req, res) => {
    try {
        const { search, limit = 100 } = req.query;
        const limitNum = Math.max(1, Math.min(parseInt(limit, 10) || 100, 500));
        
        // Utiliser la vue V_RESSOURC au lieu d'accéder directement à RESSOURC
        let query = `
            SELECT TOP ${limitNum}
                v.CodeOperateur,
                v.NomOperateur,
                v.StatutOperateur,
                v.DateConsultation,
                r.Typeressource
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_RESSOURC] v
            LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r ON v.CodeOperateur = r.Coderessource
            WHERE 1=1
        `;
        
        const params = {};
        
        // Filtre de recherche
        if (search) {
            query += ` AND (v.CodeOperateur LIKE @search OR v.NomOperateur LIKE @search)`;
            params.search = `%${search}%`;
        }
        
        query += ` ORDER BY v.CodeOperateur`;
        
        let operators = [];
        try {
            operators = await executeQuery(query, params);
        } catch (e) {
            console.warn('⚠️ V_RESSOURC indisponible, fallback liste sur RESSOURC:', e?.message || e);
            let fallbackQuery = `
                SELECT TOP ${limitNum}
                    r.Coderessource AS CodeOperateur,
                    r.Designation1 AS NomOperateur,
                    CAST(NULL AS VARCHAR(50)) AS StatutOperateur,
                    CAST(NULL AS DATETIME2) AS DateConsultation,
                    r.Typeressource
                FROM [SEDI_ERP].[dbo].[RESSOURC] r
                WHERE 1=1
            `;
            const fbParams = {};
            if (search) {
                fallbackQuery += ` AND (r.Coderessource LIKE @search OR r.Designation1 LIKE @search)`;
                fbParams.search = `%${search}%`;
            }
            fallbackQuery += ` ORDER BY r.Coderessource`;
            operators = await executeQuery(fallbackQuery, fbParams);
        }
        
        const formattedOperators = operators.map(operator => ({
            id: operator.CodeOperateur,
            code: operator.CodeOperateur,
            nom: operator.NomOperateur,
            type: operator.Typeressource,
            statutOperateur: operator.StatutOperateur,
            dateConsultation: operator.DateConsultation,
            actif: true
        }));
        
        // Enregistrer les consultations pour les opérateurs consultés (en arrière-plan, ne pas bloquer)
        if (formattedOperators.length > 0) {
            // Enregistrer seulement pour les premiers résultats (limite à 10 pour éviter la surcharge)
            const operatorsToRecord = formattedOperators.slice(0, 10);
            operatorsToRecord.forEach(async (op) => {
                try {
                    await executeProcedure('sp_RecordOperatorConsultation', { CodeOperateur: op.code });
                } catch (error) {
                    // Ignorer silencieusement les erreurs pour ne pas bloquer la réponse
                    console.warn(`⚠️ Erreur enregistrement consultation pour ${op.code}:`, error.message);
                }
            });
        }
        
        res.json(formattedOperators);
        
    } catch (error) {
        console.error('Erreur lors de la récupération des opérateurs:', error);
        res.status(500).json({ 
            error: 'Erreur interne du serveur',
            details: error.message 
        });
    }
});

// POST /api/operators/login - Connexion d'un opérateur avec session
router.post('/login', async (req, res) => {
    try {
        const { code } = req.body;
        
        if (!code) {
            return res.status(400).json({ 
                error: 'Code opérateur requis' 
            });
        }
        
        // Vérifier l'existence de l'opérateur dans SEDI_ERP
        const operatorQuery = `
            SELECT TOP 1
                Typeressource,
                Coderessource,
                Designation1
            FROM [SEDI_ERP].[dbo].[RESSOURC]
            WHERE Coderessource = @code
        `;
        
        const operators = await executeQuery(operatorQuery, { code });
        
        if (operators.length === 0) {
            return res.status(401).json({ 
                error: 'Code opérateur invalide' 
            });
        }
        
        const operator = operators[0];
        
        // Créer une nouvelle session (ferme automatiquement les anciennes)
        const deviceInfo = req.headers['user-agent'] || 'Unknown Device';
        const ipAddress = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || null;
        const deviceId = req.headers['x-device-id'] || null; // À implémenter côté client
        
        const session = await SessionService.createSession(code, deviceId, ipAddress, deviceInfo);
        
        // Logger l'événement d'audit
        await AuditService.logOperatorLogin(code, session.SessionId, deviceId, ipAddress);
        
        console.log(`✅ Session créée pour l'opérateur ${code} (SessionId: ${session.SessionId})`);
        
        res.json({
            success: true,
            operator: {
                id: operator.Coderessource,
                code: operator.Coderessource,
                nom: operator.Designation1,
                type: operator.Typeressource,
                actif: true,
                sessionActive: true,
                sessionId: session.SessionId,
                loginTime: session.LoginTime
            }
        });
        
    } catch (error) {
        console.error('Erreur lors de la connexion:', error);
        res.status(500).json({ 
            error: 'Erreur interne du serveur',
            details: error.message 
        });
    }
});

// POST /api/operators/logout - Déconnexion d'un opérateur
router.post('/logout', async (req, res) => {
    try {
        const { code } = req.body;
        
        if (!code) {
            return res.status(400).json({ 
                error: 'Code opérateur requis' 
            });
        }
        
        // Nettoyer les données incohérentes avant la déconnexion
        await cleanupInconsistentData(code);
        
        // Récupérer la session active avant fermeture
        const activeSession = await SessionService.getActiveSession(code);
        const sessionId = activeSession ? activeSession.SessionId : null;
        
        // Fermer la session active
        await SessionService.closeSession(code, sessionId);
        
        // Logger l'événement d'audit
        await AuditService.logOperatorLogout(code, sessionId);
        
        console.log(`✅ Session fermée pour l'opérateur ${code} (SessionId: ${sessionId})`);
        
        res.json({
            success: true,
            message: 'Déconnexion réussie'
        });
        
    } catch (error) {
        console.error('Erreur lors de la déconnexion:', error);
        res.status(500).json({ 
            error: 'Erreur interne du serveur',
            details: error.message 
        });
    }
});

// GET /api/operators/lancement/:code - Valider un lancement pour un opérateur
router.get('/lancement/:code', async (req, res) => {
    try {
        const { code } = req.params;
        
        console.log(`🔍 Validation du lancement ${code} pour opérateur...`);
        
        const validation = await validateLancement(code);
        
        if (validation.valid) {
            res.json({
                success: true,
                data: validation.data
            });
        } else {
            res.status(404).json({
                success: false,
                error: validation.error
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de la validation du lancement:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la validation du lancement'
        });
    }
});

// GET /api/operators/lancements/search - Rechercher des lancements pour un opérateur
router.get('/lancements/search', async (req, res) => {
    try {
        const { term, limit = 10 } = req.query;
        
        if (!term || term.length < 2) {
            return res.json({
                success: true,
                data: []
            });
        }
        
        console.log(`🔍 Recherche de lancements avec le terme: ${term}`);
        
        const searchTerm = `%${term}%`;
        const query = `
            SELECT TOP ${parseInt(limit)} 
                [CodeLancement],
                [CodeArticle],
                [DesignationLct1],
                [CodeModele],
                [DesignationArt1],
                [DesignationArt2]
            FROM [SEDI_ERP].[dbo].[LCTE]
            WHERE [CodeLancement] LIKE '${searchTerm}'
               OR [DesignationLct1] LIKE '${searchTerm}'
               OR [CodeArticle] LIKE '${searchTerm}'
            ORDER BY [CodeLancement]
        `;
        
        const result = await executeQuery(query);
        
        console.log(`✅ ${result.length} lancements trouvés`);
        
        res.json({
            success: true,
            data: result || []
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la recherche de lancements:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la recherche'
        });
    }
});

// Fonction de nettoyage rapide avant les opérations
async function quickCleanup() {
    try {
        // Nettoyer les sessions expirées rapidement
        const cleanupQuery = `
            DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
            WHERE DateCreation < DATEADD(hour, -24, GETDATE())
        `;
        await executeQuery(cleanupQuery);
    } catch (error) {
        console.error('⚠️ Erreur lors du nettoyage rapide:', error);
    }
}

// ===== Étapes de fabrication (CodeOperation) =====
async function getLctcStepsForLaunch(lancementCode) {
    const rows = await executeQuery(`
        SELECT DISTINCT
            LTRIM(RTRIM(CodeOperation)) AS CodeOperation,
            LTRIM(RTRIM(Phase)) AS Phase,
            LTRIM(RTRIM(CodeRubrique)) AS CodeRubrique
        FROM [SEDI_ERP].[dbo].[LCTC] C
        INNER JOIN [SEDI_ERP].[dbo].[LCTE] E
            ON E.CodeLancement = C.CodeLancement
            AND E.LancementSolde = 'N'
        WHERE C.CodeLancement = @lancementCode
          AND C.TypeRubrique = 'O'
          AND C.CodeOperation IS NOT NULL
          AND LTRIM(RTRIM(C.CodeOperation)) <> ''
          -- Ne jamais proposer "Séchage" / "ÉtuVage" (accents/casse ignorés)
          AND UPPER(LTRIM(RTRIM(C.CodeOperation))) COLLATE Latin1_General_CI_AI NOT IN ('SECHAGE', 'ETUVAGE')
        ORDER BY LTRIM(RTRIM(Phase)), LTRIM(RTRIM(CodeOperation)), LTRIM(RTRIM(CodeRubrique))
    `, { lancementCode });
    return rows || [];
}

async function resolveStepContext(lancementCode, codeOperation = null) {
    const steps = await getLctcStepsForLaunch(lancementCode);
    // On considère "une étape" = (Phase + CodeRubrique). CodeOperation est le libellé/nom de fabrication.
    const uniqueOps = [...new Set((steps || []).map(s => String(s?.CodeOperation || '').trim()).filter(Boolean))];
    const uniqueSteps = [...new Set((steps || []).map(s => {
        const ph = String(s?.Phase || '').trim();
        const rub = String(s?.CodeRubrique || '').trim();
        return `${ph}|${rub}`;
    }).filter(k => k !== '|' && k !== ''))];
    if (!codeOperation) {
        return { steps, uniqueOps, uniqueSteps, context: steps[0] || null };
    }
    const raw = String(codeOperation || '').trim();
    // Support "StepId" = "PHASE|CODERUBRIQUE" (permet de choisir 010/040/060 même si CodeOperation est identique)
    if (raw.includes('|')) {
        const [ph, rub] = raw.split('|').map(x => String(x || '').trim());
        const matchByKey = steps.find(s =>
            String(s?.Phase || '').trim() === ph &&
            String(s?.CodeRubrique || '').trim() === rub
        );
        return { steps, uniqueOps, uniqueSteps, context: matchByKey || null };
    }
    const match = steps.find(s => String(s.CodeOperation || '').trim() === raw);
    return { steps, uniqueOps, uniqueSteps, context: match || null };
}

async function resolvePhaseRubriqueForAction(lancementCode, operatorId, codeOperation) {
    // 1) Si le client fournit une étape (StepId "Phase|CodeRubrique" ou CodeOperation), la résoudre
    if (codeOperation) {
        const { steps, context } = await resolveStepContext(lancementCode, codeOperation);
        if (steps.length > 0 && !context) {
            const err = new Error('INVALID_CODE_OPERATION');
            err.details = { lancementCode, received: { codeOperation }, steps };
            throw err;
        }
        return {
            phase: String(context?.Phase || 'PRODUCTION').trim() || 'PRODUCTION',
            codeRubrique: String(context?.CodeRubrique || operatorId).trim() || operatorId
        };
    }

    // 2) Sinon, inférer depuis le dernier événement de l'opérateur sur ce lancement aujourd'hui
    const q = `
        SELECT TOP 1
            COALESCE(Phase, 'PRODUCTION') AS Phase,
            CodeRubrique
        FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
        WHERE CodeLanctImprod = @lancementCode
          AND OperatorCode = @operatorId
          AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
        ORDER BY DateCreation DESC, NoEnreg DESC
    `;
    const rows = await executeQuery(q, { lancementCode, operatorId });
    const r = rows && rows[0] ? rows[0] : null;
    return {
        phase: String(r?.Phase || 'PRODUCTION').trim() || 'PRODUCTION',
        codeRubrique: String(r?.CodeRubrique || operatorId).trim() || operatorId
    };
}

function buildInParams(values, prefix) {
    const params = {};
    const placeholders = [];
    values.forEach((v, i) => {
        const key = `${prefix}${i}`;
        params[key] = v;
        placeholders.push(`@${key}`);
    });
    return { params, placeholders: placeholders.join(', ') };
}

async function getFabricationMapForOperations(ops) {
    // Map: `${CodeLancement}_${Phase}_${CodeRubrique}` -> "CodeOperation" (or joined list)
    const launches = [...new Set((ops || []).map(o => String(o?.lancementCode || o?.CodeLancement || '').trim()).filter(Boolean))];
    if (launches.length === 0) return new Map();

    const { params, placeholders } = buildInParams(launches, 'lc');
    const rows = await executeQuery(`
        SELECT DISTINCT
            C.CodeLancement,
            LTRIM(RTRIM(C.Phase)) AS Phase,
            LTRIM(RTRIM(C.CodeRubrique)) AS CodeRubrique,
            LTRIM(RTRIM(C.CodeOperation)) AS CodeOperation
        FROM [SEDI_ERP].[dbo].[LCTC] C
        WHERE C.TypeRubrique = 'O'
          AND C.CodeOperation IS NOT NULL
          AND LTRIM(RTRIM(C.CodeOperation)) <> ''
          -- Ne jamais proposer "Séchage" / "ÉtuVage" (accents/casse ignorés)
          AND UPPER(LTRIM(RTRIM(C.CodeOperation))) COLLATE Latin1_General_CI_AI NOT IN ('SECHAGE', 'ETUVAGE')
          AND C.CodeLancement IN (${placeholders})
    `, params);

    const acc = new Map(); // key -> Set
    (rows || []).forEach(r => {
        const lc = String(r?.CodeLancement || '').trim();
        const ph = String(r?.Phase || '').trim();
        const rub = String(r?.CodeRubrique || '').trim();
        const op = String(r?.CodeOperation || '').trim();
        if (!lc || !op) return;
        const key = `${lc}_${ph}_${rub}`;
        if (!acc.has(key)) acc.set(key, new Set());
        acc.get(key).add(op);
    });

    const out = new Map();
    acc.forEach((set, key) => {
        out.set(key, Array.from(set).join(' / '));
    });
    return out;
}

// GET /api/operators/steps/:lancementCode - Liste des étapes de fabrication (CodeOperation)
router.get('/steps/:lancementCode', async (req, res) => {
    try {
        const lancementCode = String(req.params.lancementCode || '').trim().toUpperCase();
        if (!/^LT\d{7,8}$/.test(lancementCode)) {
            return res.status(400).json({ success: false, error: 'INVALID_LAUNCH_NUMBER' });
        }
        const steps = await getLctcStepsForLaunch(lancementCode);
        // Ajouter un "StepId" stable et un label lisible.
        // NOTE: l'utilisateur veut choisir 010/040/060 => on se base sur Phase + CodeRubrique.
        const stepsWithLabel = (steps || []).map(s => {
            const phase = String(s?.Phase || '').trim();
            const rubrique = String(s?.CodeRubrique || '').trim();
            const fabrication = String(s?.CodeOperation || '').trim();
            return {
                ...s,
                StepId: `${phase}|${rubrique}`,
                Label: `${phase}${rubrique ? ` (${rubrique})` : ''} — ${fabrication || 'Fabrication'}`
            };
        });
        const uniqueOps = [...new Set((steps || []).map(s => String(s?.CodeOperation || '').trim()).filter(Boolean))];
        const uniqueSteps = [...new Set((stepsWithLabel || []).map(s => String(s?.StepId || '').trim()).filter(Boolean))];
        return res.json({
            success: true,
            lancementCode,
            steps: stepsWithLabel,
            uniqueOperations: uniqueOps,
            uniqueSteps,
            stepCount: uniqueSteps.length,
            operationCount: uniqueOps.length,
            count: stepsWithLabel.length
        });
    } catch (error) {
        console.error('❌ Erreur récupération étapes LCTC:', error);
        return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: error.message });
    }
});

// POST /api/operators/start - Démarrer un lancement
router.post('/start', async (req, res) => {
    try {
        // Nettoyage rapide avant l'opération
        await quickCleanup();
        
        const { operatorId, lancementCode, codeOperation } = req.body;
        
        if (!operatorId || !lancementCode) {
            return res.status(400).json({
                success: false,
                error: 'operatorId et lancementCode requis'
            });
        }
        
        // 🔒 Sécurité validée par le middleware validateOperatorSession
        
        // 🔍 VALIDATION SIMPLIFIÉE : Vérifier seulement que l'opérateur existe
        const operatorCheckQuery = `
            SELECT TOP 1 Coderessource, Designation1, Typeressource
            FROM [SEDI_ERP].[dbo].[RESSOURC]
            WHERE Coderessource = @operatorId
        `;
        
        const operatorResult = await executeQuery(operatorCheckQuery, { operatorId });
        
        if (operatorResult.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Opérateur non trouvé dans la base de données',
                security: 'OPERATOR_NOT_FOUND'
            });
        }
        
        console.log(`✅ Opérateur validé: ${operatorId} (${operatorResult[0].Designation1})`);
        
        // Récupérer la session active et mettre à jour LastActivityTime
        const activeSession = await SessionService.getActiveSession(operatorId);
        if (activeSession) {
            await SessionService.updateLastActivity(operatorId, activeSession.SessionId);
        }
        
        // Obtenir l'heure française actuelle
        const { time: currentTime, date: currentDate } = TimeUtils.getCurrentDateTime();
        
        TimeUtils.log(`🚀 Démarrage lancement ${lancementCode} par opérateur ${operatorId} à ${currentTime}`);
        
        // Valider le lancement dans LCTE
        const validation = await validateLancement(lancementCode);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                error: validation.error
            });
        }
        
        const requestId = req.audit?.requestId || generateRequestId();

        // Résoudre Phase/CodeRubrique via CodeOperation (si plusieurs étapes)
        if (codeOperation) {
            const normalized = String(codeOperation).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (normalized === 'SECHAGE' || normalized === 'ETUVAGE') {
                return res.status(400).json({
                    success: false,
                    error: 'FORBIDDEN_CODE_OPERATION',
                    message: 'Étape "Séchage/ÉtuVage" est interdite.'
                });
            }
        }
        const { steps, uniqueOps, uniqueSteps, context } = await resolveStepContext(lancementCode, codeOperation);
        // Ne demander un choix que s'il y a plusieurs étapes (Phase+CodeRubrique)
        if (uniqueSteps.length > 1 && !codeOperation) {
            return res.status(400).json({
                success: false,
                error: 'CODE_OPERATION_REQUIRED',
                message: 'Plusieurs étapes sont disponibles. Choisissez une étape (Phase).',
                lancementCode,
                steps,
                uniqueOperations: uniqueOps,
                uniqueSteps,
                stepCount: uniqueSteps.length,
                operationCount: uniqueOps.length
            });
        }
        // Compat: si l'ancien client envoie encore CodeOperation "Séchage"
        if (false && codeOperation && String(codeOperation).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === 'SECHAGE') {
            return res.status(400).json({
                success: false,
                error: 'FORBIDDEN_CODE_OPERATION',
                message: 'CodeOperation "Séchage" est interdit.'
            });
        }
        if (steps.length > 0 && !context) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_CODE_OPERATION',
                message: `CodeOperation invalide pour ${lancementCode}`,
                lancementCode,
                received: { codeOperation },
                steps
            });
        }

        const phase = context?.Phase || 'PRODUCTION';
        const codeRubrique = context?.CodeRubrique || operatorId;

        // ✅ Autoriser plusieurs "cycles" dans la journée (DEBUT...FIN, puis redémarrage),
        // mais empêcher de démarrer si la DERNIÈRE action pour cette étape est déjà active.
        // (Sinon on crée des DEBUT doublons et ensuite /stop peut se retrouver incohérent.)
        const lastEventCheck = `
            SELECT TOP 1 Ident, Statut
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE CodeLanctImprod = @lancementCode
              AND OperatorCode = @operatorId
              AND Phase = @phase
              AND CodeRubrique = @codeRubrique
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC, NoEnreg DESC
        `;
        const lastEventRows = await executeQuery(lastEventCheck, { operatorId, lancementCode, phase, codeRubrique });
        const last = lastEventRows && lastEventRows[0] ? lastEventRows[0] : null;
        const lastIdent = String(last?.Ident || '').toUpperCase();
        const lastStatut = String(last?.Statut || '').toUpperCase();
        if (lastIdent && lastIdent !== 'FIN' && (lastStatut === 'EN_COURS' || lastStatut === 'EN_PAUSE' || lastIdent === 'DEBUT' || lastIdent === 'PAUSE' || lastIdent === 'REPRISE')) {
            return res.status(409).json({
                success: false,
                error: 'OPERATION_ALREADY_ACTIVE',
                message: `Cette étape est déjà active (${lastIdent || lastStatut}). Terminez-la avant de redémarrer.`,
                lastEvent: lastIdent,
                status: lastStatut,
                phase,
                codeRubrique
            });
        }

        // ✅ AUTORISATION : Plusieurs opérateurs peuvent travailler sur le même lancement simultanément
        // La vérification de conflit a été désactivée pour permettre la collaboration multi-opérateurs
        // Ancienne vérification commentée :
        /*
        try {
            const conflictQuery = `
                SELECT TOP 1 OperatorCode, Statut, DateCreation
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE CodeLanctImprod = @lancementCode
                AND Statut IN ('EN_COURS', 'EN_PAUSE')
                AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                AND OperatorCode != @operatorId
            `;
            const conflictResult = await executeQuery(conflictQuery, { lancementCode, operatorId });
            
            if (conflictResult.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: `Le lancement ${lancementCode} est déjà en cours par l'opérateur ${conflictResult[0].OperatorCode}`,
                    conflict: {
                        operatorCode: conflictResult[0].OperatorCode,
                        status: conflictResult[0].Statut,
                        startTime: conflictResult[0].DateCreation
                    }
                });
            }
        } catch (error) {
            console.log('⚠️ Erreur vérification conflit:', error.message);
        }
        */
        
        // Enregistrer l'événement DEBUT dans ABHISTORIQUE_OPERATEURS avec corrélation session
        const insertQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation, SessionId, RequestId, CreatedAt)
            VALUES (
                @operatorId,
                @lancementCode,
                @codeRubrique,
                'DEBUT',
                @phase,
                'EN_COURS',
                CAST(@currentTime AS TIME),
                NULL,
                CAST(@currentDate AS DATE),
                @sessionId,
                @requestId,
                GETDATE()
            )
        `;
        
        await executeNonQuery(insertQuery, { 
            operatorId, 
            lancementCode, 
            codeRubrique,
            phase,
            currentTime, 
            currentDate,
            sessionId: activeSession ? activeSession.SessionId : null,
            requestId
        });
        
        // Logger l'événement d'audit
        await AuditService.logStartLancement(operatorId, activeSession?.SessionId, lancementCode, requestId);
        
        console.log(`✅ Lancement ${lancementCode} démarré par opérateur ${operatorId} (SessionId: ${activeSession?.SessionId})`);
        
        res.json({
            success: true,
            message: 'Lancement démarré avec succès',
            data: {
                operatorId,
                lancementCode,
                action: 'DEBUT',
                sessionId: activeSession?.SessionId,
                requestId,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error(' Erreur lors du démarrage:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors du démarrage'
        });
    }
});

// POST /api/operators/pause - Mettre en pause un lancement
router.post('/pause', async (req, res) => {
    try {
        const { operatorId, lancementCode, codeOperation } = req.body;

        // Résoudre l'étape (Phase/CodeRubrique) pour éviter d'écrire sur PRODUCTION par défaut
        let phase = 'PRODUCTION';
        let codeRubrique = operatorId;
        try {
            const ctx = await resolvePhaseRubriqueForAction(lancementCode, operatorId, codeOperation);
            phase = ctx.phase;
            codeRubrique = ctx.codeRubrique;
        } catch (e) {
            if (e.message === 'INVALID_CODE_OPERATION') {
                return res.status(400).json({ success: false, error: 'INVALID_CODE_OPERATION', ...(e.details || {}) });
            }
            throw e;
        }
        
        // 🔒 VÉRIFICATION DE SÉCURITÉ : S'assurer que l'opérateur possède ce lancement
        // Vérifier qu'il existe un événement DEBUT pour ce lancement et cet opérateur aujourd'hui
        const ownershipCheck = `
            SELECT TOP 1 OperatorCode, Ident, Statut
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE CodeLanctImprod = @lancementCode
              AND OperatorCode = @operatorId
              AND Phase = @phase
              AND CodeRubrique = @codeRubrique
              AND Ident = 'DEBUT'
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC
        `;
        const ownership = await executeQuery(ownershipCheck, { operatorId, lancementCode, phase, codeRubrique });
        if (ownership.length === 0) {
            return res.status(403).json({
                success: false,
                error: `Vous ne pouvez pas mettre en pause ce lancement. Il ne vous appartient pas ou n'est pas en cours.`,
                security: 'DATA_OWNERSHIP_VIOLATION'
            });
        }
        
        // Vérifier que le dernier événement n'est pas déjà PAUSE (pour éviter les doublons)
        const lastEventCheck = `
            SELECT TOP 1 Ident, Statut
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE CodeLanctImprod = @lancementCode
              AND OperatorCode = @operatorId
              AND Phase = @phase
              AND CodeRubrique = @codeRubrique
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC, NoEnreg DESC
        `;
        const lastEvent = await executeQuery(lastEventCheck, { operatorId, lancementCode, phase, codeRubrique });
        if (lastEvent.length > 0 && (lastEvent[0].Ident === 'PAUSE' || lastEvent[0].Statut === 'PAUSE' || lastEvent[0].Statut === 'EN_PAUSE')) {
            return res.status(403).json({
                success: false,
                error: `Ce lancement est déjà en pause.`,
                security: 'ALREADY_PAUSED'
            });
        }
        
        if (!operatorId || !lancementCode) {
            return res.status(400).json({
                success: false,
                error: 'operatorId et lancementCode requis'
            });
        }
        
        // Obtenir l'heure française actuelle
        const { time: currentTime, date: currentDate } = TimeUtils.getCurrentDateTime();
        
        TimeUtils.log(`⏸️ Pause lancement ${lancementCode} par opérateur ${operatorId} à ${currentTime}`);

        // phase/codeRubrique déjà résolus plus haut
        
        // Enregistrer l'événement PAUSE dans ABHISTORIQUE_OPERATEURS avec l'heure française
        const insertQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation)
            VALUES (
                '${operatorId}',
                '${lancementCode}',
                '${codeRubrique}',
                'PAUSE',
                '${phase}',
                'EN_PAUSE',
                CAST('${currentTime}' AS TIME),
                NULL,
                CAST('${currentDate}' AS DATE)
            )
        `;
        
        await executeQuery(insertQuery);
        
        console.log(` Lancement ${lancementCode} mis en pause par opérateur ${operatorId}`);
        
        res.json({
            success: true,
            message: 'Lancement mis en pause',
            data: {
                operatorId,
                lancementCode,
                action: 'PAUSE',
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Erreur lors de la pause:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la pause'
        });
    }
});

// POST /api/operators/resume - Reprendre un lancement
router.post('/resume', async (req, res) => {
    try {
        const { operatorId, lancementCode, codeOperation } = req.body;

        // Résoudre l'étape (Phase/CodeRubrique) pour reprendre la bonne étape
        let phase = 'PRODUCTION';
        let codeRubrique = operatorId;
        try {
            const ctx = await resolvePhaseRubriqueForAction(lancementCode, operatorId, codeOperation);
            phase = ctx.phase;
            codeRubrique = ctx.codeRubrique;
        } catch (e) {
            if (e.message === 'INVALID_CODE_OPERATION') {
                return res.status(400).json({ success: false, error: 'INVALID_CODE_OPERATION', ...(e.details || {}) });
            }
            throw e;
        }
        
        // 🔒 VÉRIFICATION DE SÉCURITÉ : S'assurer que l'opérateur possède ce lancement
        // Vérifier qu'il existe un événement DEBUT pour ce lancement et cet opérateur aujourd'hui
        const ownershipCheck = `
            SELECT TOP 1 OperatorCode, Ident, Statut
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE CodeLanctImprod = @lancementCode
              AND OperatorCode = @operatorId
              AND Phase = @phase
              AND CodeRubrique = @codeRubrique
              AND Ident = 'DEBUT'
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC
        `;
        const ownership = await executeQuery(ownershipCheck, { operatorId, lancementCode, phase, codeRubrique });
        if (ownership.length === 0) {
            return res.status(403).json({
                success: false,
                error: `Vous ne pouvez pas reprendre ce lancement. Il ne vous appartient pas ou n'est pas en pause.`,
                security: 'DATA_OWNERSHIP_VIOLATION'
            });
        }
        
        // Vérifier que le dernier événement est bien PAUSE (pour permettre la reprise)
        const lastEventCheck = `
            SELECT TOP 1 Ident, Statut
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE CodeLanctImprod = @lancementCode
              AND OperatorCode = @operatorId
              AND Phase = @phase
              AND CodeRubrique = @codeRubrique
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC, NoEnreg DESC
        `;
        const lastEvent = await executeQuery(lastEventCheck, { operatorId, lancementCode, phase, codeRubrique });
        if (lastEvent.length === 0 || (lastEvent[0].Ident !== 'PAUSE' && lastEvent[0].Statut !== 'PAUSE' && lastEvent[0].Statut !== 'EN_PAUSE')) {
            return res.status(403).json({
                success: false,
                error: `Vous ne pouvez pas reprendre ce lancement. Il n'est pas en pause.`,
                security: 'INVALID_STATE'
            });
        }
        
        if (!operatorId || !lancementCode) {
            return res.status(400).json({
                success: false,
                error: 'operatorId et lancementCode requis'
            });
        }
        
        // Obtenir l'heure française actuelle
        const { time: currentTime, date: currentDate } = TimeUtils.getCurrentDateTime();
        
        TimeUtils.log(`▶️ Reprise lancement ${lancementCode} par opérateur ${operatorId} à ${currentTime}`);

        // phase/codeRubrique déjà résolus plus haut
        
        // Enregistrer l'événement REPRISE dans ABHISTORIQUE_OPERATEURS avec l'heure française
        const insertQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation)
            VALUES (
                '${operatorId}',
                '${lancementCode}',
                '${codeRubrique}',
                'REPRISE',
                '${phase}',
                'EN_COURS',
                CAST('${currentTime}' AS TIME),
                NULL,
                CAST('${currentDate}' AS DATE)
            )
        `;
        
        await executeQuery(insertQuery);
        
        console.log(` Lancement ${lancementCode} repris par opérateur ${operatorId}`);
        
        res.json({
            success: true,
            message: 'Lancement repris',
            data: {
                operatorId,
                lancementCode,
                action: 'REPRISE',
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error(' Erreur lors de la reprise:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la reprise'
        });
    }
});

// POST /api/operators/stop - Terminer un lancement
router.post('/stop', async (req, res) => {
    try {
        const { operatorId, lancementCode, codeOperation } = req.body;

        // Résoudre l'étape (Phase/CodeRubrique) pour terminer la bonne étape
        let phase = 'PRODUCTION';
        let codeRubrique = operatorId;
        try {
            const ctx = await resolvePhaseRubriqueForAction(lancementCode, operatorId, codeOperation);
            phase = ctx.phase;
            codeRubrique = ctx.codeRubrique;
        } catch (e) {
            if (e.message === 'INVALID_CODE_OPERATION') {
                return res.status(400).json({ success: false, error: 'INVALID_CODE_OPERATION', ...(e.details || {}) });
            }
            throw e;
        }
        
        // 🔒 VÉRIFICATION DE SÉCURITÉ : S'assurer que l'opérateur possède ce lancement
        // Vérifier qu'il existe un événement DEBUT pour ce lancement et cet opérateur aujourd'hui
        const ownershipCheck = `
            SELECT TOP 1 OperatorCode, Ident, Statut
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE CodeLanctImprod = @lancementCode
              AND OperatorCode = @operatorId
              AND Phase = @phase
              AND CodeRubrique = @codeRubrique
              AND Ident = 'DEBUT'
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC
        `;
        const ownership = await executeQuery(ownershipCheck, { operatorId, lancementCode, phase, codeRubrique });
        if (ownership.length === 0) {
            return res.status(403).json({
                success: false,
                error: `Vous ne pouvez pas terminer ce lancement. Il ne vous appartient pas ou n'est pas en cours.`,
                security: 'DATA_OWNERSHIP_VIOLATION'
            });
        }
        
        if (!operatorId || !lancementCode) {
            return res.status(400).json({
                success: false,
                error: 'operatorId et lancementCode requis'
            });
        }
        
        // Obtenir l'heure française actuelle
        const { time: currentTime, date: currentDate } = TimeUtils.getCurrentDateTime();
        
        TimeUtils.log(`🏁 Arrêt lancement ${lancementCode} par opérateur ${operatorId} à ${currentTime}`);

        // phase/codeRubrique déjà résolus plus haut

        // ✅ Autoriser plusieurs cycles dans la journée:
        // On ne bloque que si la DERNIÈRE action de l'étape est déjà FIN.
        // (L'ancien check bloquait dès qu'il existait un FIN quelconque dans la journée.)
        const lastEventCheck = `
            SELECT TOP 1 Ident, Statut
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE CodeLanctImprod = @lancementCode
              AND OperatorCode = @operatorId
              AND Phase = @phase
              AND CodeRubrique = @codeRubrique
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC, NoEnreg DESC
        `;
        const lastEventRows = await executeQuery(lastEventCheck, { operatorId, lancementCode, phase, codeRubrique });
        const last = lastEventRows && lastEventRows[0] ? lastEventRows[0] : null;
        const lastIdent = String(last?.Ident || '').toUpperCase();
        const lastStatut = String(last?.Statut || '').toUpperCase();
        if (lastIdent === 'FIN' || lastStatut === 'TERMINE' || lastStatut === 'TERMINÉ') {
            return res.status(403).json({
                success: false,
                error: `Cette étape est déjà terminée.`,
                security: 'ALREADY_FINISHED'
            });
        }
        
        // Enregistrer l'événement FIN dans ABHISTORIQUE_OPERATEURS avec l'heure française
        const insertQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation)
            VALUES (
                '${operatorId}',
                '${lancementCode}',
                '${codeRubrique}',
                'FIN',
                '${phase}',
                'TERMINE',
                NULL,
                CAST('${currentTime}' AS TIME),
                CAST('${currentDate}' AS DATE)
            )
        `;
        
        await executeQuery(insertQuery);
        
        console.log(`✅ Lancement ${lancementCode} terminé par opérateur ${operatorId}`);
        
        // Consolidation obligatoire pour ne pas laisser de lancement non consolidé (retry si échec)
        const ConsolidationService = require('../services/ConsolidationService');
        const maxAttempts = 3;
        const delayMs = 400;
        let consolidated = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const consolidationResult = await ConsolidationService.consolidateOperation(operatorId, lancementCode, {
                    autoFix: true,
                    phase,
                    codeRubrique,
                    dateCreation: currentDate
                });
                if (consolidationResult.success) {
                    console.log(`✅ Consolidation réussie: TempsId=${consolidationResult.tempsId} (tentative ${attempt})`);
                    consolidated = true;
                    break;
                }
                if (attempt < maxAttempts) await new Promise(r => setTimeout(r, delayMs));
                else console.error(`⚠️ Consolidation échouée après ${maxAttempts} tentatives: ${consolidationResult.error}`);
            } catch (err) {
                if (attempt < maxAttempts) await new Promise(r => setTimeout(r, delayMs));
                else console.error(`⚠️ Erreur consolidation après ${maxAttempts} tentatives:`, err?.message || err);
            }
        }
        if (!consolidated) {
            console.warn(`⚠️ Lancement ${lancementCode} non consolidé après arrêt; sera consolidé au prochain chargement admin ou transfert.`);
        }
        
        res.json({
            success: true,
            message: 'Lancement terminé avec succès',
            data: {
                operatorId,
                lancementCode,
                action: 'FIN',
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error(' Erreur lors de l\'arrêt:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de l\'arrêt'
        });
    }
});

// GET /api/operators/:operatorCode/operations - Récupérer l'historique d'un opérateur
router.get('/:operatorCode/operations', 
    dataIsolation.logAccessAttempt,
    dataIsolation.validateDataAccess,
    dataIsolation.filterDataByOperator,
    authenticateOperator, 
    async (req, res) => {
    try {
        const { operatorCode } = req.params;
        const { page = 1, limit = 50 } = req.query; // ⚡ OPTIMISATION : Pagination
        const pageNum = parseInt(page, 10);
        const limitNum = Math.min(parseInt(limit, 10), 100); // Max 100 par page
        
        console.log(`🔍 Récupération de l'historique pour l'opérateur ${operatorCode} (page ${pageNum}, limit ${limitNum})...`);
        
        // Récupérer tous les événements de cet opérateur depuis ABHISTORIQUE_OPERATEURS
        // 🔒 FILTRE IMPORTANT : Exclure les lancements transférés (StatutTraitement = 'T')
        // L'opérateur doit voir ses lancements tant qu'ils n'ont pas été transférés par l'admin
        // ⚡ OPTIMISATION : Utiliser LEFT JOIN avec sous-requête dérivée au lieu de sous-requête corrélée
        // IMPORTANT: Convertir HeureDebut et HeureFin en VARCHAR(5) (HH:mm) directement dans SQL
        // pour éviter les problèmes de timezone lors de la conversion par Node.js
        const eventsQuery = `
            SELECT 
                h.NoEnreg,
                h.Ident,
                h.CodeLanctImprod,
                COALESCE(h.Phase, 'PRODUCTION') as Phase,
                h.OperatorCode,
                h.CodeRubrique,
                h.Statut,
                CONVERT(VARCHAR(5), h.HeureDebut, 108) AS HeureDebut,
                CONVERT(VARCHAR(5), h.HeureFin, 108) AS HeureFin,
                h.DateCreation,
                h.CreatedAt,
                l.DesignationLct1 as Article,
                l.DesignationLct2 as ArticleDetail,
                t.StatutTraitement
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
            LEFT JOIN [SEDI_ERP].[dbo].[LCTE] l ON l.CodeLancement = h.CodeLanctImprod
            LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t 
                ON t.OperatorCode = h.OperatorCode 
                AND t.LancementCode = h.CodeLanctImprod
                AND CAST(t.DateCreation AS DATE) = CAST(h.DateCreation AS DATE)
                -- IMPORTANT: ne pas cacher une autre étape du même lancement (Phase+CodeRubrique)
                AND ISNULL(LTRIM(RTRIM(t.Phase)), '') = ISNULL(LTRIM(RTRIM(COALESCE(h.Phase, 'PRODUCTION'))), '')
                AND ISNULL(LTRIM(RTRIM(t.CodeRubrique)), '') = ISNULL(LTRIM(RTRIM(h.CodeRubrique)), '')
            -- ⚡ OPTIMISATION : Utiliser h.Phase directement (plus simple et fiable)
            -- Si Phase n'est pas dans h, on utilise 'PRODUCTION' par défaut
            WHERE h.OperatorCode = @operatorCode
              AND (t.StatutTraitement IS NULL OR t.StatutTraitement != 'T')
            ORDER BY h.DateCreation DESC, h.NoEnreg DESC
        `;
        
        const events = await executeQuery(eventsQuery, { operatorCode });
        console.log(`📊 ${events.length} événements trouvés pour l'opérateur ${operatorCode}`);
        
        // Utiliser la fonction qui garde les pauses séparées
        const { processLancementEventsWithPauses } = require('./admin');
        const processed = processLancementEventsWithPauses(events);
        const fabricationMap = await getFabricationMapForOperations(processed);
        const allFormattedOperations = processed.map(operation => {
            // Normaliser les heures pour s'assurer qu'elles sont au format HH:mm uniquement
            let startTime = operation.startTime;
            let endTime = operation.endTime;
            
            // Si startTime contient une date, extraire uniquement l'heure
            if (startTime && typeof startTime === 'string') {
                // Si format "YYYY-MM-DD HH:mm:ss" ou similaire, extraire l'heure
                const timeMatch = startTime.match(/(\d{2}:\d{2})(?::\d{2})?/);
                if (timeMatch) {
                    startTime = timeMatch[1]; // Garder uniquement HH:mm
                }
            }
            
            // Si endTime contient une date, extraire uniquement l'heure
            if (endTime && typeof endTime === 'string') {
                const timeMatch = endTime.match(/(\d{2}:\d{2})(?::\d{2})?/);
                if (timeMatch) {
                    endTime = timeMatch[1]; // Garder uniquement HH:mm
                }
            }
            
            // Normaliser le statusCode
            let statusCode = operation.statusCode || operation.generalStatus;
            if (!statusCode && operation.status) {
                // Mapper le statut texte vers le code
                const statusLower = operation.status.toLowerCase();
                if (statusLower.includes('terminé') || statusLower.includes('termine')) {
                    statusCode = 'TERMINE';
                } else if (statusLower.includes('pause')) {
                    statusCode = 'EN_PAUSE';
                } else {
                    statusCode = 'EN_COURS';
                }
            }
            
            // Normaliser le statut texte
            let status = operation.status || operation.statusLabel;
            if (!status && statusCode) {
                const statusMap = {
                    'TERMINE': 'Terminé',
                    'TERMINÉ': 'Terminé',
                    'EN_PAUSE': 'En pause',
                    'PAUSE': 'En pause',
                    'EN_COURS': 'En cours',
                    'PAUSE_TERMINEE': 'Pause terminée',
                    'PAUSE_TERMINÉE': 'Pause terminée'
                };
                status = statusMap[statusCode] || statusCode;
            }
            
            const phase = operation.phase || 'PRODUCTION';
            const codeRubrique = operation.codeRubrique || null;
            const fabKey = `${operation.lancementCode}_${String(phase || '').trim()}_${String(codeRubrique || '').trim()}`;
            const fabrication = fabricationMap.get(fabKey) || operation.codeOperation || operation.fabrication || '-';
            
            return {
                id: operation.id,
                operatorCode: operation.operatorId || operation.operatorCode,
                lancementCode: operation.lancementCode,
                article: operation.article || 'N/A',
                fabrication,
                startTime: startTime || '-',
                endTime: endTime || '-',
                status: status || 'En cours',
                statusCode: statusCode || 'EN_COURS',
                phase,
                codeRubrique,
                type: operation.type || 'lancement'
            };
        });
        
        // ⚡ OPTIMISATION : Pagination côté serveur
        const totalCount = allFormattedOperations.length;
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = startIndex + limitNum;
        const paginatedOperations = allFormattedOperations.slice(startIndex, endIndex);
        
        res.json({
            success: true,
            operations: paginatedOperations,
            count: paginatedOperations.length,
            total: totalCount,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(totalCount / limitNum),
            hasNextPage: endIndex < totalCount,
            hasPrevPage: pageNum > 1
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la récupération de l\'historique opérateur:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la récupération de l\'historique'
        });
    }
});

// GET /api/operations/current/:operatorCode - Récupérer l'opération en cours d'un opérateur
router.get('/current/:operatorCode', authenticateOperator, async (req, res) => {
    try {
        const { operatorCode } = req.params;
        
        console.log(`🔍 Recherche d'opération en cours pour l'opérateur ${operatorCode}...`);
        
        // Chercher le DERNIER événement de l'opérateur aujourd'hui, puis déduire l'état.
        // ⚠️ Important: on ne doit pas filtrer sur Statut IN ('EN_COURS','EN_PAUSE'),
        // sinon on peut "ressortir" un vieux DEBUT (EN_COURS) alors qu'un FIN existe après,
        // ce qui crée le bug UI: écran "En cours" alors que l'historique est "Terminé".
        // 🔒 FILTRE : Exclure les lancements transférés (StatutTraitement = 'T')
        const query = `
            SELECT TOP 1
                h.CodeLanctImprod,
                h.Ident,
                h.Statut,
                CONVERT(VARCHAR(8), h.HeureDebut, 108) AS HeureDebut, -- HH:mm:ss (stable)
                CONVERT(VARCHAR(10), h.DateCreation, 23) AS DateCreation, -- YYYY-MM-DD (stable, évite décalage timezone)
                h.CreatedAt,
                COALESCE(h.Phase, 'PRODUCTION') AS Phase,
                h.CodeRubrique,
                l.DesignationLct1 as Article
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
            LEFT JOIN [SEDI_ERP].[dbo].[LCTE] l ON l.CodeLancement = h.CodeLanctImprod
            LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t 
                ON t.OperatorCode = h.OperatorCode 
                AND t.LancementCode = h.CodeLanctImprod
                AND CAST(t.DateCreation AS DATE) = CAST(h.DateCreation AS DATE)
                -- IMPORTANT: ne pas cacher une autre étape du même lancement (Phase+CodeRubrique)
                AND ISNULL(LTRIM(RTRIM(t.Phase)), '') = ISNULL(LTRIM(RTRIM(COALESCE(h.Phase, 'PRODUCTION'))), '')
                AND ISNULL(LTRIM(RTRIM(t.CodeRubrique)), '') = ISNULL(LTRIM(RTRIM(h.CodeRubrique)), '')
            WHERE h.OperatorCode = @operatorCode
              AND (t.StatutTraitement IS NULL OR t.StatutTraitement != 'T')
            ORDER BY h.DateCreation DESC, h.NoEnreg DESC
        `;
        
        const result = await executeQuery(query, { operatorCode });
        
        if (result.length === 0) {
            return res.json({
                success: true,
                data: null
            });
        }
        
        const operation = result[0];
        const lastEvent = String(operation.Ident || '').toUpperCase();
        const lastStatus = String(operation.Statut || '').toUpperCase();

        // Si le dernier event est FIN/terminé => pas d'opération en cours
        if (lastEvent === 'FIN' || lastStatus === 'TERMINE' || lastStatus === 'TERMINÉ') {
            return res.json({ success: true, data: null });
        }

        // Pour le timer: utiliser l’heure de début du CYCLE (événement DEBUT), pas du dernier event (REPRISE/PAUSE)
        let startedAt = null;
        if (lastEvent === 'DEBUT') {
            startedAt = operation.CreatedAt || null;
            if (!startedAt && operation.DateCreation && operation.HeureDebut) {
                const datePart = String(operation.DateCreation || '').slice(0, 10);
                const timeStr = String(operation.HeureDebut || '').length >= 5 ? String(operation.HeureDebut) : null;
                if (datePart && timeStr) startedAt = `${datePart}T${timeStr}`;
            }
        } else {
            // Dernier event = PAUSE ou REPRISE: récupérer le DEBUT du même jour/phase/rubrique pour le timer
            const debutQuery = `
                SELECT TOP 1 CreatedAt, DateCreation, HeureDebut
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode = @operatorCode AND CodeLanctImprod = @lancementCode
                  AND Ident = 'DEBUT' AND Phase = @phase AND CodeRubrique = @codeRubrique
                  AND CAST(DateCreation AS DATE) = CAST(@dateCreation AS DATE)
                ORDER BY DateCreation ASC, NoEnreg ASC
            `;
            const debutParams = {
                operatorCode,
                lancementCode: operation.CodeLanctImprod,
                phase: operation.Phase || 'PRODUCTION',
                codeRubrique: operation.CodeRubrique || operation.OperatorCode,
                dateCreation: operation.DateCreation
            };
            const debutRows = await executeQuery(debutQuery, debutParams);
            const debut = debutRows && debutRows[0] ? debutRows[0] : null;
            if (debut) {
                startedAt = debut.CreatedAt || null;
                if (!startedAt && debut.DateCreation && debut.HeureDebut) {
                    const datePart = String(debut.DateCreation || '').slice(0, 10);
                    const timeStr = String(debut.HeureDebut || '').length >= 5 ? String(debut.HeureDebut) : null;
                    if (datePart && timeStr) startedAt = `${datePart}T${timeStr}`;
                }
            }
            if (!startedAt) {
                startedAt = operation.CreatedAt || null;
                if (!startedAt && operation.DateCreation && operation.HeureDebut) {
                    const datePart = String(operation.DateCreation || '').slice(0, 10);
                    const timeStr = String(operation.HeureDebut || '').length >= 5 ? String(operation.HeureDebut) : null;
                    if (datePart && timeStr) startedAt = `${datePart}T${timeStr}`;
                }
            }
        }
        
        res.json({
            success: true,
            data: {
                // Nouveau format (camelCase)
                lancementCode: operation.CodeLanctImprod,
                article: operation.Article || 'N/A',
                status: operation.Statut,
                startTime: operation.HeureDebut ? formatDateTime(operation.HeureDebut) : null,
                startedAt,
                dateCreation: operation.DateCreation || null,
                lastEvent: operation.Ident,
                phase: operation.Phase || 'PRODUCTION',
                codeRubrique: operation.CodeRubrique || null,
                stepId: `${String(operation.Phase || 'PRODUCTION').trim()}|${String(operation.CodeRubrique || '').trim()}`
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la récupération de l\'opération en cours:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la récupération de l\'opération en cours'
        });
    }
});

// Route pour récupérer les informations d'un opérateur spécifique
router.get('/:operatorCode', authenticateOperator, async (req, res) => {
    const { operatorCode } = req.params;
    
    try {
        // Récupérer les informations de l'opérateur
        const operatorQuery = `
            SELECT 
                r.Coderessource,
                r.Designation1,
                r.Typeressource,
                s.SessionId,
                s.LoginTime,
                s.SessionStatus,
                s.DeviceInfo
            FROM [SEDI_ERP].[dbo].[RESSOURC] r
            LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] s 
                ON r.Coderessource = s.OperatorCode 
                AND s.SessionStatus = 'ACTIVE'
                AND CAST(s.DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            WHERE r.Coderessource = @operatorCode
        `;
        
        const result = await executeQuery(operatorQuery, { operatorCode });
        
        if (result.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Opérateur non trouvé'
            });
        }
        
        const operator = result[0];
        
        // Enregistrer la consultation dans la table de mapping
        try {
            await executeProcedure('sp_RecordOperatorConsultation', { CodeOperateur: operatorCode });
        } catch (error) {
            // Ne pas faire échouer la requête si l'enregistrement de consultation échoue
            console.warn('⚠️ Erreur lors de l\'enregistrement de la consultation:', error.message);
        }
        
        res.json({
            success: true,
            data: {
                id: operator.Coderessource,
                code: operator.Coderessource,
                name: operator.Designation1,
                type: operator.Typeressource,
                sessionId: operator.SessionId,
                loginTime: operator.LoginTime,
                sessionStatus: operator.SessionStatus,
                deviceInfo: operator.DeviceInfo,
                hasActiveSession: !!operator.SessionId
            }
        });
        
    } catch (error) {
        console.error('Erreur lors de la récupération de l\'opérateur:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la récupération de l\'opérateur'
        });
    }
});

module.exports = router;