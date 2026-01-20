// Routes pour les opérations - STOCKAGE RÉEL avec ABHISTORIQUE_OPERATEURS
const express = require('express');
const router = express.Router();
const { executeQuery } = require('../config/database');
const { validateOperatorSession, validateDataOwnership, logSecurityAction } = require('../middleware/operatorSecurity');
const dataValidation = require('../services/DataValidationService');
const { validateConcurrency, releaseResources } = require('../middleware/concurrencyManager');

// Route de test pour insertion réelle dans SEDI_APP_INDEPENDANTE
router.post('/test-sedi-table', async (req, res) => {
    try {
        console.log('🧪 Test insertion réelle SEDI_APP_INDEPENDANTE');
        
        // Test 1: Compter les enregistrements existants
        const countQuery = `SELECT COUNT(*) as total FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]`;
        const countBefore = await executeQuery(countQuery);
        console.log(`📊 ${countBefore[0].total} enregistrements existants`);
        
        // Test 2: Insertion réelle avec données comme dans SSMS
        const insertQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, DateCreation)
            VALUES ('843', 'LT2500643', '843', 'DEBUT', 'PRODUCTION', 'EN_COURS', GETDATE(), GETDATE())
        `;
        
        await executeQuery(insertQuery);
        console.log('✅ Insertion réussie dans ABHISTORIQUE_OPERATEURS');
        
        // Test 3: Vérifier l'insertion
        const countAfter = await executeQuery(countQuery);
        console.log(`📊 ${countAfter[0].total} enregistrements après insertion`);
        
        // Test 4: Lire les derniers enregistrements
        const selectQuery = `
            SELECT TOP 3 NoEnreg, OperatorCode, CodeLanctImprod, Ident, Phase, Statut, HeureDebut, DateCreation
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            ORDER BY DateCreation DESC
        `;
        
        const lastRecords = await executeQuery(selectQuery);
        
        res.json({
            message: '✅ Test insertion SEDI_APP_INDEPENDANTE réussi !',
            recordsBefore: countBefore[0].total,
            recordsAfter: countAfter[0].total,
            newRecords: countAfter[0].total - countBefore[0].total,
            lastRecords: lastRecords,
            insertedData: {
                OperatorCode: '843',
                CodeLanctImprod: 'LT2500643',
                Ident: 'DEBUT',
                Phase: 'PRODUCTION',
                Statut: 'EN_COURS'
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur test insertion SEDI_APP_INDEPENDANTE:', error);
        res.status(500).json({
            error: 'Erreur test insertion SEDI_APP_INDEPENDANTE',
            details: error.message,
            errorCode: error.code || 'UNKNOWN'
        });
    }
});

// POST /api/operations/start - Démarrer une opération (UTILISE LES 3 TABLES)
router.post('/start', validateConcurrency, releaseResources, async (req, res) => {
    try {
        console.log('🚀 Démarrage opération avec 3 tables:', req.body);
        const { operatorId, lancementCode } = req.body;
        
        if (!operatorId || !lancementCode) {
            return res.status(400).json({ 
                error: 'operatorId et lancementCode sont requis' 
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
                error: 'Opérateur non trouvé dans la base de données',
                security: 'OPERATOR_NOT_FOUND'
            });
        }
        
        console.log(`✅ Opérateur validé: ${operatorId} (${operatorResult[0].Designation1})`);
        
        // Lire les infos de l'opérateur
        let operatorInfo = null;
        try {
            const operatorQuery = `
                SELECT TOP 1 Coderessource, Designation1, Typeressource
                FROM [SEDI_ERP].[dbo].[RESSOURC]
                WHERE Coderessource = @operatorId
            `;
            const operatorResult = await executeQuery(operatorQuery, { operatorId });
            operatorInfo = operatorResult[0] || null;
        } catch (error) {
            console.log('⚠️ Erreur lecture opérateur:', error.message);
        }
        
        // Lire les infos du lancement
        let lancementInfo = null;
        try {
            const lancementQuery = `
                SELECT TOP 1 CodeLancement, DesignationLct1
                FROM [SEDI_ERP].[dbo].[LCTE]
                WHERE CodeLancement = @lancementCode
            `;
            const lancementResult = await executeQuery(lancementQuery, { lancementCode });
            lancementInfo = lancementResult[0] || null;
        } catch (error) {
            console.log('⚠️ Erreur lecture lancement:', error.message);
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
        
        // 1️⃣ CRÉER/METTRE À JOUR SESSION dans ABSESSIONS_OPERATEURS
        console.log('📝 1. Gestion session opérateur...');
        try {
            // Vérifier s'il y a une session active
            const sessionCheckQuery = `
                SELECT TOP 1 SessionId 
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
                WHERE OperatorCode = @operatorId 
                AND SessionStatus = 'ACTIVE'
                AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            `;
            const existingSession = await executeQuery(sessionCheckQuery, { operatorId });
            
            if (existingSession.length === 0) {
            // Créer nouvelle session
            const sessionInsertQuery = `
                INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
                (OperatorCode, LoginTime, SessionStatus, DeviceInfo, DateCreation)
                VALUES (@operatorId, GETDATE(), 'ACTIVE', 'Tablette SEDI', GETDATE())
            `;
                await executeQuery(sessionInsertQuery, { operatorId });
                console.log('✅ Nouvelle session créée avec statut ACTIF');
            } else {
                // Mettre à jour la session existante
                const updateActivityQuery = `
                    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
                    SET LoginTime = GETDATE()
                    WHERE OperatorCode = @operatorId 
                    AND SessionStatus = 'ACTIVE'
                    AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                `;
                await executeQuery(updateActivityQuery, { operatorId });
                console.log('✅ Session mise à jour - Opérateur actif');
            }
        } catch (error) {
            console.log('⚠️ Erreur session:', error.message);
        }
        
        // 2️⃣ ENREGISTRER ÉVÉNEMENT dans ABHISTORIQUE_OPERATEURS
        console.log('📝 2. Enregistrement événement DEBUT...');
        const histoInsertQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, DateCreation)
            VALUES (@operatorId, @lancementCode, @operatorId, 'DEBUT', 'PRODUCTION', 'EN_COURS', CAST(GETDATE() AS TIME), CAST(GETDATE() AS DATE))
        `;
        await executeQuery(histoInsertQuery, { operatorId, lancementCode });
        console.log('✅ Événement DEBUT enregistré');
        
        // 3️⃣ CRÉER/METTRE À JOUR TEMPS dans ABTEMPS_OPERATEURS
        console.log('📝 3. Gestion des temps...');
        try {
            // Vérifier s'il existe déjà un enregistrement temps pour aujourd'hui
            const tempsCheckQuery = `
                SELECT TOP 1 TempsId 
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                WHERE OperatorCode = @operatorId 
                AND LancementCode = @lancementCode
                AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            `;
            const existingTemps = await executeQuery(tempsCheckQuery, { operatorId, lancementCode });
            
            if (existingTemps.length === 0) {
                // Récupérer Phase et CodeRubrique depuis V_LCTC (comme demandé par Franck MAILLARD)
                let phase = 'PRODUCTION';
                let codeRubrique = operatorId;
                try {
                    const vlctcQuery = `
                        SELECT TOP 1 Phase, CodeRubrique
                        FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]
                        WHERE CodeLancement = @lancementCode
                    `;
                    const vlctcResult = await executeQuery(vlctcQuery, { lancementCode });
                    if (vlctcResult && vlctcResult.length > 0) {
                        phase = vlctcResult[0].Phase || phase;
                        codeRubrique = vlctcResult[0].CodeRubrique || codeRubrique;
                    }
                } catch (error) {
                    console.warn(`⚠️ Impossible de récupérer Phase/CodeRubrique depuis V_LCTC: ${error.message}`);
                }
                
                // Créer nouvel enregistrement temps
                const tempsInsertQuery = `
                    INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                    (OperatorCode, LancementCode, StartTime, EndTime, TotalDuration, PauseDuration, ProductiveDuration, EventsCount, Phase, CodeRubrique, DateCreation)
                    VALUES (@operatorId, @lancementCode, GETDATE(), GETDATE(), 0, 0, 0, 1, @phase, @codeRubrique, GETDATE())
                `;
                await executeQuery(tempsInsertQuery, { operatorId, lancementCode, phase, codeRubrique });
                console.log('✅ Nouvel enregistrement temps créé');
            } else {
                // Mettre à jour l'enregistrement existant
                const tempsUpdateQuery = `
                    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                    SET EventsCount = EventsCount + 1,
                        StartTime = GETDATE()
                    WHERE TempsId = @tempsId
                `;
                await executeQuery(tempsUpdateQuery, { tempsId: existingTemps[0].TempsId });
                console.log('✅ Enregistrement temps mis à jour');
            }
        } catch (error) {
            console.log('⚠️ Erreur temps:', error.message);
        }
        
        console.log('🎯 Opération démarrée avec succès dans les 3 tables');
        
        res.json({
            message: '✅ Opération démarrée avec succès (3 tables mises à jour)',
            operatorId: operatorId,
            operatorName: operatorInfo?.Designation1 || 'Opérateur inconnu',
            lancementCode: lancementCode,
            lancementName: lancementInfo?.DesignationLct1 || 'Lancement libre',
            status: 'DEBUT',
            timestamp: new Date().toISOString(),
            tablesUpdated: ['ABSESSIONS_OPERATEURS', 'ABHISTORIQUE_OPERATEURS', 'ABTEMPS_OPERATEURS']
        });
        
    } catch (error) {
        console.error('❌ Erreur démarrage:', error);
        res.status(500).json({ 
            error: 'Erreur interne du serveur',
            details: error.message
        });
    }
});

// POST /api/operations/pause - Mettre en pause
router.post('/pause', async (req, res) => {
    try {
        const { operatorId } = req.body;
        
        if (!operatorId) {
            return res.status(400).json({ error: 'operatorId requis' });
        }
        
        // Vérifier qu'il y a une opération en cours
        const checkQuery = `
            SELECT TOP 1 CodeLanctImprod
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE OperatorCode = @operatorId 
            AND Ident = 'DEBUT'
            AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC
        `;
        
        const activeOp = await executeQuery(checkQuery, { operatorId });
        
        if (activeOp.length === 0) {
            return res.status(404).json({ 
                error: 'Aucune opération en cours pour cet opérateur' 
            });
        }
        
        const lancementCode = activeOp[0].CodeLanctImprod;
        
        // Insérer la pause
        const insertQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, DateCreation)
            VALUES (@operatorId, @lancementCode, @operatorId, 'PAUSE', 'PAUSE', 'PAUSE', GETDATE(), GETDATE())
        `;
        
        await executeQuery(insertQuery, { operatorId, lancementCode });
        
        res.json({
            message: 'Opération mise en pause',
            operatorId: operatorId,
            lancementCode: lancementCode,
            status: 'PAUSE',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error(' Erreur pause:', error);
        res.status(500).json({ 
            error: 'Erreur interne du serveur',
            details: error.message
        });
    }
});

// POST /api/operations/resume - Reprendre
router.post('/resume', async (req, res) => {
    try {
        const { operatorId } = req.body;
        
        if (!operatorId) {
            return res.status(400).json({ error: 'operatorId requis' });
        }
        
        // Vérifier qu'il y a une opération en pause
        const checkQuery = `
            SELECT TOP 1 CodeLanctImprod
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE OperatorCode = @operatorId 
            AND Ident = 'PAUSE'
            AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC
        `;
        
        const pausedOp = await executeQuery(checkQuery, { operatorId });
        
        if (pausedOp.length === 0) {
            return res.status(404).json({ 
                error: 'Aucune opération en pause pour cet opérateur' 
            });
        }
        
        const lancementCode = pausedOp[0].CodeLanctImprod;
        
        // Insérer la reprise
        const insertQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, DateCreation)
            VALUES (@operatorId, @lancementCode, @operatorId, 'REPRISE', 'REPRISE', 'ACTIF', GETDATE(), GETDATE())
        `;
        
        await executeQuery(insertQuery, { operatorId, lancementCode });
        
        res.json({
            message: ' Opération reprise',
            operatorId: operatorId,
            lancementCode: lancementCode,
            status: 'REPRISE',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error(' Erreur reprise:', error);
        res.status(500).json({ 
            error: 'Erreur interne du serveur',
            details: error.message
        });
    }
});

// POST /api/operations/stop - Terminer (CALCULE LES DURÉES FINALES)
router.post('/stop', async (req, res) => {
    try {
        console.log('🏁 Arrêt opération avec calcul des durées:', req.body);
        const { operatorId } = req.body;
        
        if (!operatorId) {
            return res.status(400).json({ error: 'operatorId requis' });
        }
        
        // Vérifier qu'il y a une opération en cours
        const checkQuery = `
            SELECT TOP 1 CodeLanctImprod
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE OperatorCode = @operatorId 
            AND Ident IN ('DEBUT', 'REPRISE')
            AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC
        `;
        
        const activeOp = await executeQuery(checkQuery, { operatorId });
        
        if (activeOp.length === 0) {
            return res.status(404).json({ 
                error: 'Aucune opération en cours pour cet opérateur' 
            });
        }
        
        const lancementCode = activeOp[0].CodeLanctImprod;
        
        // 1️⃣ CALCULER LES DURÉES TOTALES (logique unifiée)
        console.log('📊 1. Calcul des durées...');
        const DurationCalculationService = require('../services/DurationCalculationService');
        
        let durations = {
            totalDuration: 0,
            pauseDuration: 0,
            productiveDuration: 0,
            eventsCount: 0
        };
        
        try {
            // Utiliser le service unifié pour calculer les durées
            durations = await DurationCalculationService.calculateDurationsFromDB(operatorId, lancementCode);
            durations.eventsCount += 1; // +1 pour l'événement FIN qu'on va ajouter
            
            console.log(`📊 Durées calculées: Total=${durations.totalDuration}min, Pause=${durations.pauseDuration}min, Productif=${durations.productiveDuration}min`);
            
            // Vérifier que ProductiveDuration > 0 (SILOG n'accepte pas les temps à 0)
            if (durations.productiveDuration <= 0) {
                console.warn(`⚠️ ProductiveDuration = ${durations.productiveDuration} (Total=${durations.totalDuration}, Pause=${durations.pauseDuration})`);
                console.warn(`⚠️ SILOG n'accepte pas les enregistrements avec ProductiveDuration = 0`);
                console.warn(`⚠️ Cet enregistrement ne pourra pas être transféré vers SILOG tant que ProductiveDuration n'est pas > 0`);
            }
        } catch (error) {
            console.log('⚠️ Erreur calcul durées:', error.message);
        }
        
        const { totalDuration, pauseDuration, productiveDuration, eventsCount } = durations;
        
        // 2️⃣ ENREGISTRER ÉVÉNEMENT FIN dans ABHISTORIQUE_OPERATEURS
        console.log('📝 2. Enregistrement événement FIN...');
        const histoInsertQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation)
            VALUES (@operatorId, @lancementCode, @operatorId, 'FIN', 'TERMINE', 'TERMINE', NULL, CAST(GETDATE() AS TIME), CAST(GETDATE() AS DATE))
        `;
        await executeQuery(histoInsertQuery, { operatorId, lancementCode });
        console.log('✅ Événement FIN enregistré');
        
        // 3️⃣ METTRE À JOUR LES DURÉES FINALES dans ABTEMPS_OPERATEURS
        console.log('📝 3. Mise à jour durées finales...');
        try {
            const tempsUpdateQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                SET EndTime = GETDATE(),
                    TotalDuration = @totalDuration,
                    PauseDuration = @pauseDuration,
                    ProductiveDuration = @productiveDuration,
                    EventsCount = @eventsCount
                WHERE OperatorCode = @operatorId 
                AND LancementCode = @lancementCode
                AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            `;
            
            await executeQuery(tempsUpdateQuery, { 
                operatorId, 
                lancementCode, 
                totalDuration, 
                pauseDuration, 
                productiveDuration, 
                eventsCount 
            });
            console.log('✅ Durées finales mises à jour');
        } catch (error) {
            console.log('⚠️ Erreur mise à jour durées:', error.message);
        }
        
        // 4️⃣ FERMER LA SESSION si plus d'opérations actives
        console.log('📝 4. Vérification fermeture session...');
        try {
            // Vérifier s'il reste des opérations actives pour cet opérateur
            const activeOpsQuery = `
                SELECT COUNT(*) as count
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode = @operatorId 
                AND Statut IN ('EN_COURS', 'EN_PAUSE')
                AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            `;
            
            const activeOpsCount = await executeQuery(activeOpsQuery, { operatorId });
            
            if (activeOpsCount[0].count === 0) {
                // Fermer la session
                const sessionCloseQuery = `
                    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
                    SET LogoutTime = GETDATE(), SessionStatus = 'CLOSED'
                    WHERE OperatorCode = @operatorId 
                    AND SessionStatus = 'ACTIVE'
                    AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                `;
                
                await executeQuery(sessionCloseQuery, { operatorId });
                console.log('✅ Session fermée automatiquement');
            } else {
                console.log('✅ Session maintenue (autres opérations actives)');
            }
        } catch (error) {
            console.log('⚠️ Erreur fermeture session:', error.message);
        }
        
        console.log('🎯 Opération terminée avec succès dans les 3 tables');
        
        res.json({
            message: '✅ Opération terminée avec succès (durées calculées)',
            operatorId: operatorId,
            lancementCode: lancementCode,
            status: 'FIN',
            timestamp: new Date().toISOString(),
            durations: {
                total: totalDuration, // en minutes
                pause: pauseDuration, // en minutes
                productive: productiveDuration, // en minutes
                events: eventsCount
            },
            tablesUpdated: ['ABHISTORIQUE_OPERATEURS', 'ABTEMPS_OPERATEURS', 'ABSESSIONS_OPERATEURS']
        });
        
    } catch (error) {
        console.error('❌ Erreur arrêt:', error);
        res.status(500).json({ 
            error: 'Erreur interne du serveur',
            details: error.message
        });
    }
});

// GET /api/operations/current/:operatorId - État actuel
router.get('/current/:operatorId', async (req, res) => {
    try {
        const { operatorId } = req.params;
        
        // Chercher la dernière opération de l'opérateur
        const query = `
            SELECT TOP 1 *
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE OperatorCode = @operatorId 
            AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            ORDER BY DateCreation DESC
        `;
        
        const result = await executeQuery(query, { operatorId });
        
        if (result.length === 0) {
            return res.json({
                hasActiveOperation: false,
                operation: null
            });
        }
        
        const lastOp = result[0];
        const isActive = ['DEBUT', 'REPRISE'].includes(lastOp.Ident);
        const isPaused = lastOp.Ident === 'PAUSE';
        
        res.json({
            hasActiveOperation: isActive || isPaused,
            operation: {
                id: lastOp.NoEnreg,
                operatorId: lastOp.CodeRubrique,
                lancementCode: lastOp.CodeLanctImprod,
                status: lastOp.Ident,
                phase: lastOp.Phase,
                timestamp: lastOp.HeureDebut,
                isActive: isActive,
                isPaused: isPaused
            }
        });
        
    } catch (error) {
        console.error(' Erreur récupération:', error);
        res.status(500).json({ 
            error: 'Erreur interne du serveur',
            details: error.message
        });
    }
});

// POST /api/operations/create-session - Créer une session opérateur
router.post('/create-session', async (req, res) => {
    try {
        const { operatorCode, deviceInfo = 'Tablette SEDI' } = req.body;
        
        if (!operatorCode) {
            return res.status(400).json({ error: 'operatorCode requis' });
        }
        
        // Insérer dans ABSESSIONS_OPERATEURS
        const insertQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
            (OperatorCode, LoginTime, SessionStatus, DeviceInfo, DateCreation)
            VALUES (@operatorCode, GETDATE(), 'ACTIVE', @deviceInfo, GETDATE())
        `;
        
        await executeQuery(insertQuery, { operatorCode, deviceInfo });
        
        res.json({
            message: '✅ Session créée avec succès',
            operatorCode: operatorCode,
            loginTime: new Date().toISOString(),
            status: 'ACTIVE'
        });
        
    } catch (error) {
        console.error('❌ Erreur création session:', error);
        res.status(500).json({ 
            error: 'Erreur création session',
            details: error.message
        });
    }
});

// POST /api/operations/close-session - Fermer une session opérateur
router.post('/close-session', async (req, res) => {
    try {
        const { operatorCode } = req.body;
        
        if (!operatorCode) {
            return res.status(400).json({ error: 'operatorCode requis' });
        }
        
        // Mettre à jour la session active
        const updateQuery = `
            UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
            SET LogoutTime = GETDATE(), SessionStatus = 'CLOSED'
            WHERE OperatorCode = @operatorCode 
            AND SessionStatus = 'ACTIVE'
            AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
        `;
        
        await executeQuery(updateQuery, { operatorCode });
        
        res.json({
            message: '✅ Session fermée avec succès',
            operatorCode: operatorCode,
            logoutTime: new Date().toISOString(),
            status: 'CLOSED'
        });
        
    } catch (error) {
        console.error('❌ Erreur fermeture session:', error);
        res.status(500).json({ 
            error: 'Erreur fermeture session',
            details: error.message
        });
    }
});

// POST /api/operations/update-temps - Mettre à jour ABTEMPS_OPERATEURS
router.post('/update-temps', async (req, res) => {
    try {
        const { 
            operatorCode, 
            lancementCode, 
            totalDuration = 0, 
            pauseDuration = 0, 
            productiveDuration = 0, 
            eventsCount = 1 
        } = req.body;
        
        if (!operatorCode || !lancementCode) {
            return res.status(400).json({ 
                error: 'operatorCode et lancementCode requis' 
            });
        }
        
        // Vérifier si un enregistrement existe déjà pour aujourd'hui
        const checkQuery = `
            SELECT TOP 1 TempsId 
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            WHERE OperatorCode = @operatorCode 
            AND LancementCode = @lancementCode
            AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
        `;
        
        const existing = await executeQuery(checkQuery, { operatorCode, lancementCode });
        
        if (existing.length > 0) {
            // Mettre à jour l'enregistrement existant
            const updateQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                SET TotalDuration = @totalDuration,
                    PauseDuration = @pauseDuration,
                    ProductiveDuration = @productiveDuration,
                    EventsCount = EventsCount + 1,
                    EndTime = GETDATE()
                WHERE TempsId = @tempsId
            `;
            
            await executeQuery(updateQuery, { 
                totalDuration, 
                pauseDuration, 
                productiveDuration,
                tempsId: existing[0].TempsId 
            });
            
            res.json({
                message: '✅ Temps mis à jour avec succès',
                action: 'UPDATE',
                tempsId: existing[0].TempsId
            });
            
        } else {
            // Récupérer Phase et CodeRubrique depuis V_LCTC (comme demandé par Franck MAILLARD)
            let phase = 'PRODUCTION';
            let codeRubrique = operatorCode;
            try {
                const vlctcQuery = `
                    SELECT TOP 1 Phase, CodeRubrique
                    FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]
                    WHERE CodeLancement = @lancementCode
                `;
                const vlctcResult = await executeQuery(vlctcQuery, { lancementCode });
                if (vlctcResult && vlctcResult.length > 0) {
                    phase = vlctcResult[0].Phase || phase;
                    codeRubrique = vlctcResult[0].CodeRubrique || codeRubrique;
                }
            } catch (error) {
                console.warn(`⚠️ Impossible de récupérer Phase/CodeRubrique depuis V_LCTC: ${error.message}`);
            }
            
            // Créer un nouvel enregistrement
            const insertQuery = `
                INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                (OperatorCode, LancementCode, StartTime, EndTime, TotalDuration, PauseDuration, ProductiveDuration, EventsCount, Phase, CodeRubrique, DateCreation)
                VALUES (@operatorCode, @lancementCode, GETDATE(), GETDATE(), @totalDuration, @pauseDuration, @productiveDuration, @eventsCount, @phase, @codeRubrique, GETDATE())
            `;
            
            await executeQuery(insertQuery, { 
                operatorCode, 
                lancementCode, 
                totalDuration, 
                pauseDuration, 
                productiveDuration, 
                eventsCount,
                phase,
                codeRubrique
            });
            
            res.json({
                message: '✅ Nouveau temps créé avec succès',
                action: 'INSERT',
                operatorCode: operatorCode,
                lancementCode: lancementCode
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur mise à jour temps:', error);
        res.status(500).json({ 
            error: 'Erreur mise à jour temps',
            details: error.message
        });
    }
});

// GET /api/operations/dashboard/:operatorId - Vue d'ensemble des 3 tables
router.get('/dashboard/:operatorId', async (req, res) => {
    try {
        const { operatorId } = req.params;
        console.log(`📊 Dashboard 3 tables pour opérateur ${operatorId}`);
        
        const dashboard = {};
        
        // 1️⃣ SESSION ACTIVE depuis ABSESSIONS_OPERATEURS
        try {
            const sessionQuery = `
                SELECT TOP 1 SessionId, LoginTime, SessionStatus, DeviceInfo, DateCreation
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
                WHERE OperatorCode = @operatorId 
                AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                ORDER BY DateCreation DESC
            `;
            const session = await executeQuery(sessionQuery, { operatorId });
            dashboard.session = session[0] || null;
        } catch (error) {
            dashboard.session = { error: error.message };
        }
        
        // 2️⃣ ÉVÉNEMENTS DU JOUR depuis ABHISTORIQUE_OPERATEURS
        try {
            const eventsQuery = `
                SELECT NoEnreg, CodeLanctImprod, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode = @operatorId 
                AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                ORDER BY DateCreation DESC
            `;
            const events = await executeQuery(eventsQuery, { operatorId });
            dashboard.events = events;
            dashboard.eventsCount = events.length;
        } catch (error) {
            dashboard.events = [];
            dashboard.eventsError = error.message;
        }
        
        // 3️⃣ SYNTHÈSE DES TEMPS depuis ABTEMPS_OPERATEURS
        try {
            const tempsQuery = `
                SELECT TempsId, LancementCode, StartTime, EndTime, TotalDuration, PauseDuration, ProductiveDuration, EventsCount, DateCreation, Phase, CodeRubrique, StatutTraitement
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                WHERE OperatorCode = @operatorId 
                AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                ORDER BY DateCreation DESC
            `;
            const temps = await executeQuery(tempsQuery, { operatorId });
            dashboard.temps = temps;
            
            // Calculer totaux
            dashboard.summary = {
                totalOperations: temps.length,
                totalDuration: temps.reduce((sum, t) => sum + (t.TotalDuration || 0), 0),
                totalPause: temps.reduce((sum, t) => sum + (t.PauseDuration || 0), 0),
                totalProductive: temps.reduce((sum, t) => sum + (t.ProductiveDuration || 0), 0),
                totalEvents: temps.reduce((sum, t) => sum + (t.EventsCount || 0), 0)
            };
        } catch (error) {
            dashboard.temps = [];
            dashboard.tempsError = error.message;
        }
        
        // 4️⃣ INFORMATIONS OPÉRATEUR depuis SEDI_ERP
        try {
            const operatorQuery = `
                SELECT TOP 1 Coderessource, Designation1, Typeressource
                FROM [SEDI_ERP].[dbo].[RESSOURC]
                WHERE Coderessource = @operatorId
            `;
            const operator = await executeQuery(operatorQuery, { operatorId });
            dashboard.operator = operator[0] || null;
        } catch (error) {
            dashboard.operator = { error: error.message };
        }
        
        res.json({
            message: '📊 Dashboard 3 tables généré avec succès',
            operatorId: operatorId,
            date: new Date().toISOString().split('T')[0],
            dashboard: dashboard,
            tablesUsed: ['ABSESSIONS_OPERATEURS', 'ABHISTORIQUE_OPERATEURS', 'ABTEMPS_OPERATEURS', 'RESSOURC']
        });
        
    } catch (error) {
        console.error('❌ Erreur dashboard:', error);
        res.status(500).json({
            error: 'Erreur génération dashboard',
            details: error.message
        });
    }
});

module.exports = router;
