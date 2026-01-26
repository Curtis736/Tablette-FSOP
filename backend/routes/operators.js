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
        
        const operators = await executeQuery(query, { code });
        
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
        
        // Utiliser la vue V_RESSOURC au lieu d'accéder directement à RESSOURC
        let query = `
            SELECT TOP ${limit}
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
        
        const operators = await executeQuery(query, params);
        
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
        FROM [SEDI_ERP].[dbo].[LCTC]
        WHERE CodeLancement = @lancementCode
          AND TypeRubrique = 'O'
          AND LancementSolde = 'N'
          AND CodeOperation IS NOT NULL
          AND LTRIM(RTRIM(CodeOperation)) <> ''
        ORDER BY LTRIM(RTRIM(Phase)), LTRIM(RTRIM(CodeOperation)), LTRIM(RTRIM(CodeRubrique))
    `, { lancementCode });
    return rows || [];
}

async function resolveStepContext(lancementCode, codeOperation = null) {
    const steps = await getLctcStepsForLaunch(lancementCode);
    if (!codeOperation) {
        return { steps, context: steps[0] || null };
    }
    const match = steps.find(s => String(s.CodeOperation || '').trim() === String(codeOperation || '').trim());
    return { steps, context: match || null };
}

// GET /api/operators/steps/:lancementCode - Liste des étapes de fabrication (CodeOperation)
router.get('/steps/:lancementCode', async (req, res) => {
    try {
        const lancementCode = String(req.params.lancementCode || '').trim().toUpperCase();
        if (!/^LT\\d{7,8}$/.test(lancementCode)) {
            return res.status(400).json({ success: false, error: 'INVALID_LAUNCH_NUMBER' });
        }
        const steps = await getLctcStepsForLaunch(lancementCode);
        return res.json({ success: true, lancementCode, steps, count: steps.length });
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
        const { steps, context } = await resolveStepContext(lancementCode, codeOperation);
        if (steps.length > 1 && !codeOperation) {
            return res.status(400).json({
                success: false,
                error: 'CODE_OPERATION_REQUIRED',
                message: 'Plusieurs étapes de fabrication sont disponibles. Choisissez une étape (CodeOperation).',
                lancementCode,
                steps
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
        
        // 🔒 VÉRIFICATION DE SÉCURITÉ : S'assurer que l'opérateur possède ce lancement
        // Vérifier qu'il existe un événement DEBUT pour ce lancement et cet opérateur aujourd'hui
        const ownershipCheck = `
            SELECT TOP 1 OperatorCode, Ident, Statut
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE CodeLanctImprod = @lancementCode
              AND OperatorCode = @operatorId
              AND Ident = 'DEBUT'
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC
        `;
        const ownership = await executeQuery(ownershipCheck, { operatorId, lancementCode });
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
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC, NoEnreg DESC
        `;
        const lastEvent = await executeQuery(lastEventCheck, { operatorId, lancementCode });
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

        // Garder Phase/CodeRubrique cohérents avec l'étape choisie (si fournie)
        let phase = 'PRODUCTION';
        let codeRubrique = operatorId;
        if (codeOperation) {
            const { steps, context } = await resolveStepContext(lancementCode, codeOperation);
            if (steps.length > 0 && !context) {
                return res.status(400).json({ success: false, error: 'INVALID_CODE_OPERATION', lancementCode, steps });
            }
            phase = context?.Phase || phase;
            codeRubrique = context?.CodeRubrique || codeRubrique;
        }
        
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
        
        // 🔒 VÉRIFICATION DE SÉCURITÉ : S'assurer que l'opérateur possède ce lancement
        // Vérifier qu'il existe un événement DEBUT pour ce lancement et cet opérateur aujourd'hui
        const ownershipCheck = `
            SELECT TOP 1 OperatorCode, Ident, Statut
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE CodeLanctImprod = @lancementCode
              AND OperatorCode = @operatorId
              AND Ident = 'DEBUT'
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC
        `;
        const ownership = await executeQuery(ownershipCheck, { operatorId, lancementCode });
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
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC, NoEnreg DESC
        `;
        const lastEvent = await executeQuery(lastEventCheck, { operatorId, lancementCode });
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

        let phase = 'PRODUCTION';
        let codeRubrique = operatorId;
        if (codeOperation) {
            const { steps, context } = await resolveStepContext(lancementCode, codeOperation);
            if (steps.length > 0 && !context) {
                return res.status(400).json({ success: false, error: 'INVALID_CODE_OPERATION', lancementCode, steps });
            }
            phase = context?.Phase || phase;
            codeRubrique = context?.CodeRubrique || codeRubrique;
        }
        
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
        
        // 🔒 VÉRIFICATION DE SÉCURITÉ : S'assurer que l'opérateur possède ce lancement
        // Vérifier qu'il existe un événement DEBUT pour ce lancement et cet opérateur aujourd'hui
        const ownershipCheck = `
            SELECT TOP 1 OperatorCode, Ident, Statut
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE CodeLanctImprod = @lancementCode
              AND OperatorCode = @operatorId
              AND Ident = 'DEBUT'
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC
        `;
        const ownership = await executeQuery(ownershipCheck, { operatorId, lancementCode });
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

        let phase = 'PRODUCTION';
        let codeRubrique = operatorId;
        if (codeOperation) {
            const { steps, context } = await resolveStepContext(lancementCode, codeOperation);
            if (steps.length > 0 && !context) {
                return res.status(400).json({ success: false, error: 'INVALID_CODE_OPERATION', lancementCode, steps });
            }
            phase = context?.Phase || phase;
            codeRubrique = context?.CodeRubrique || codeRubrique;
        }

        // Vérifier qu'il n'y a pas déjà un événement FIN pour CETTE étape (Phase + CodeRubrique) aujourd'hui
        const finCheck = `
            SELECT TOP 1 Ident
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE CodeLanctImprod = @lancementCode
              AND OperatorCode = @operatorId
              AND Ident = 'FIN'
              AND Phase = @phase
              AND CodeRubrique = @codeRubrique
              AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
        `;
        const finExists = await executeQuery(finCheck, { operatorId, lancementCode, phase, codeRubrique });
        if (finExists.length > 0) {
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
        
        // Consolidation automatique en arrière-plan (sans bloquer le FIN)
        // Nécessaire pour que le transfert fonctionne côté admin
        try {
            const ConsolidationService = require('../services/ConsolidationService');
            const consolidationResult = await ConsolidationService.consolidateOperation(operatorId, lancementCode, { autoFix: true });
            
            if (consolidationResult.success) {
                console.log(`✅ Consolidation automatique réussie: TempsId=${consolidationResult.tempsId}`);
            } else {
                // Ne pas bloquer le FIN si la consolidation échoue, mais logger l'erreur
                console.error(`⚠️ Consolidation automatique échouée (sera réessayée plus tard): ${consolidationResult.error}`);
                // L'opération peut être consolidée manuellement plus tard par l'admin
            }
        } catch (consolidationError) {
            // Ne pas bloquer le FIN si la consolidation échoue, mais logger l'erreur
            console.error(`⚠️ Erreur lors de la consolidation automatique (sera réessayée plus tard):`, consolidationError);
            // L'opération peut être consolidée manuellement plus tard par l'admin
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
        const allFormattedOperations = processLancementEventsWithPauses(events).map(operation => {
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
            
            return {
                id: operation.id,
                operatorCode: operation.operatorId || operation.operatorCode,
                lancementCode: operation.lancementCode,
                article: operation.article || 'N/A',
                startTime: startTime || '-',
                endTime: endTime || '-',
                status: status || 'En cours',
                statusCode: statusCode || 'EN_COURS',
                phase: operation.phase || 'PRODUCTION',
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
        
        // Chercher la dernière opération non terminée
        // 🔒 FILTRE : Exclure les lancements transférés (StatutTraitement = 'T')
        const query = `
            SELECT TOP 1
                h.CodeLanctImprod,
                h.Ident,
                h.Statut,
                h.HeureDebut,
                h.DateCreation,
                l.DesignationLct1 as Article
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
            LEFT JOIN [SEDI_ERP].[dbo].[LCTE] l ON l.CodeLancement = h.CodeLanctImprod
            LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t 
                ON t.OperatorCode = h.OperatorCode 
                AND t.LancementCode = h.CodeLanctImprod
                AND CAST(t.DateCreation AS DATE) = CAST(h.DateCreation AS DATE)
            WHERE h.OperatorCode = @operatorCode
              AND h.Statut IN ('EN_COURS', 'EN_PAUSE')
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
        
        res.json({
            success: true,
            data: {
                lancementCode: operation.CodeLanctImprod,
                article: operation.Article || 'N/A',
                status: operation.Statut,
                startTime: operation.HeureDebut ? formatDateTime(operation.HeureDebut) : null,
                lastEvent: operation.Ident
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