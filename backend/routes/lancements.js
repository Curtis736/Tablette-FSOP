const express = require('express');
const { executeQuery, executeNonQuery } = require('../config/database');
const router = express.Router();

// GET /api/lancements - Récupérer tous les lancements
router.get('/', async (req, res) => {
    try {
        const { search, limit = 100 } = req.query;
        
        const limitNum = Math.max(1, Math.min(parseInt(limit, 10) || 100, 500));
        let query = `
            SELECT TOP (@limitNum)
                t.NoEnreg,
                t.Ident,
                t.DateTravail,
                t.CodeLanctImprod as CodeLancement,
                t.Phase,
                t.CodePoste,
                t.CodeOperateur,
                l.DesignationLct1,
                l.CodeArticle
            FROM [SEDI_ERP].[GPSQL].[abetemps_temp] t
            LEFT JOIN [SEDI_ERP].[dbo].[LCTE] l ON l.CodeLancement = t.CodeLanctImprod
            WHERE 1=1
        `;
        
        const params = { limitNum };
        
        // Filtre de recherche
        if (search) {
            query += ` AND (
                t.CodeLanctImprod LIKE @search OR 
                l.DesignationLct1 LIKE @search OR 
                l.CodeArticle LIKE @search OR
                t.CodeOperateur LIKE @search
            )`;
            params.search = `%${search}%`;
        }
        
        query += ` ORDER BY t.DateTravail DESC, t.CodeLanctImprod`;
        
        const lancements = await executeQuery(query, params);
        
        res.json(lancements);
        
    } catch (error) {
        console.error('Erreur lors de la récupération des lancements:', error);
        res.status(500).json({ 
            error: 'Erreur lors de la récupération des lancements' 
        });
    }
});

// GET /api/lancements/:code - Récupérer un lancement par son code
router.get('/:code', async (req, res) => {
    try {
        const { code } = req.params;
        
        const query = `
            SELECT TOP 1
                t.NoEnreg,
                t.Ident,
                t.DateTravail,
                t.CodeLanctImprod as CodeLancement,
                t.Phase,
                t.CodePoste,
                t.CodeOperateur,
                l.DesignationLct1,
                l.CodeArticle
            FROM [SEDI_ERP].[GPSQL].[abetemps_temp] t
            LEFT JOIN [SEDI_ERP].[dbo].[LCTE] l ON l.CodeLancement = t.CodeLanctImprod
            WHERE t.CodeLanctImprod = @code
        `;
        
        const lancements = await executeQuery(query, { code });
        
        if (lancements.length === 0) {
            return res.status(404).json({ 
                error: 'Lancement non trouvé' 
            });
        }
        
        res.json(lancements[0]);
        
    } catch (error) {
        console.error('Erreur lors de la récupération du lancement:', error);
        res.status(500).json({ 
            error: 'Erreur lors de la récupération du lancement' 
        });
    }
});

// GET /api/lancements/active - Récupérer les lancements actifs
router.get('/active', async (req, res) => {
    try {
        const query = `
            SELECT 
                CodeLancement,
                DateMiseJour,
                CodeArticle,
                DesignationLct1,
                Statut,
                Quantite,
                DateDebut,
                DateFin
            FROM [SEDI_ERP].[dbo].[LCTE]
            WHERE Statut IN ('EN_COURS', 'EN_ATTENTE', 'PLANIFIE')
            ORDER BY Priorite DESC, DateDebut ASC
        `;
        
        const lancements = await executeQuery(query);
        res.json(lancements);
        
    } catch (error) {
        console.error('Erreur lors de la récupération des lancements actifs:', error);
        res.status(500).json({ 
            error: 'Erreur lors de la récupération des lancements actifs' 
        });
    }
});

// GET /api/lancements/by-operator/:operatorId - Récupérer les lancements d'un opérateur
router.get('/by-operator/:operatorId', async (req, res) => {
    try {
        const { operatorId } = req.params;
        const { date } = req.query;
        
        let query = `
            SELECT DISTINCT
                l.CodeLancement,
                l.DateMiseJour,
                l.CodeArticle,
                l.DesignationLct1,
                l.Statut,
                l.Quantite,
                l.DateDebut,
                l.DateFin,
                o.Statut as OperationStatut,
                o.DateDebut as OperationDebut,
                o.DateFin as OperationFin
            FROM [SEDI_ERP].[dbo].[LCTE] l
            LEFT JOIN GPSQL.abetemps o ON l.CodeLancement = o.CodeLancement
            WHERE o.OperateurId = @operatorId
        `;
        
        const params = { operatorId };
        
        if (date) {
            query += ` AND CAST(o.DateDebut AS DATE) = @date`;
            params.date = date;
        }
        
        query += ` ORDER BY o.DateDebut DESC`;
        
        const lancements = await executeQuery(query, params);
        res.json(lancements);
        
    } catch (error) {
        console.error('Erreur lors de la récupération des lancements de l\'opérateur:', error);
        res.status(500).json({ 
            error: 'Erreur lors de la récupération des lancements de l\'opérateur' 
        });
    }
});

// POST /api/lancements - Créer un nouveau lancement
router.post('/', async (req, res) => {
    try {
        const { 
            codeLancement, 
            codeArticle, 
            designation, 
            quantite, 
            priorite = 'NORMALE',
            operatorId  // OBLIGATOIRE : opérateur qui crée le lancement
        } = req.body;
        
        // Vérifier que tous les champs requis sont présents
        if (!codeLancement || !codeArticle || !designation || !operatorId) {
            return res.status(400).json({ 
                error: 'Code lancement, code article, désignation et opérateur sont requis' 
            });
        }

        // Vérifier que l'opérateur existe
        const operatorQuery = `
            SELECT TOP 1 Coderessource, Designation1
            FROM [SEDI_ERP].[dbo].[RESSOURC]
            WHERE Coderessource = @operatorId
        `;
        const operatorResult = await executeQuery(operatorQuery, { operatorId });
        
        if (operatorResult.length === 0) {
            return res.status(400).json({ 
                error: 'Opérateur non trouvé' 
            });
        }
        
        // Vérifier si le lancement existe déjà
        const checkQuery = `
            SELECT COUNT(*) as count 
            FROM [SEDI_ERP].[dbo].[LCTE] 
            WHERE CodeLancement = @codeLancement
        `;
        
        const existing = await executeQuery(checkQuery, { codeLancement });
        
        if (existing[0].count > 0) {
            return res.status(409).json({ 
                error: 'Un lancement avec ce code existe déjà' 
            });
        }
        
        // Insérer le nouveau lancement
        const insertQuery = `
            INSERT INTO [SEDI_ERP].[dbo].[LCTE] (
                CodeLancement, 
                CodeArticle, 
                DesignationLct1, 
                Quantite, 
                Priorite,
                Statut,
                DateMiseJour,
                DateCreation
            )
            VALUES (
                @codeLancement, 
                @codeArticle, 
                @designation, 
                @quantite, 
                @priorite,
                'PLANIFIE',
                GETDATE(),
                GETDATE()
            )
        `;
        
        await executeQuery(insertQuery, { 
            codeLancement, 
            codeArticle, 
            designation, 
            quantite: quantite || 0, 
            priorite 
        });
        
        res.status(201).json({ 
            message: 'Lancement créé avec succès',
            codeLancement 
        });
        
    } catch (error) {
        console.error('Erreur lors de la création du lancement:', error);
        res.status(500).json({ 
            error: 'Erreur lors de la création du lancement' 
        });
    }
});

// PUT /api/lancements/:code - Mettre à jour un lancement
router.put('/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const { 
            codeArticle, 
            designation, 
            quantite, 
            statut, 
            priorite 
        } = req.body;
        
        const updateQuery = `
            UPDATE [SEDI_ERP].[dbo].[LCTE] 
            SET CodeArticle = @codeArticle,
                DesignationLct1 = @designation,
                Quantite = @quantite,
                Statut = @statut,
                Priorite = @priorite,
                DateMiseJour = GETDATE()
            WHERE CodeLancement = @code
        `;
        
        const result = await executeNonQuery(updateQuery, { 
            code, 
            codeArticle, 
            designation, 
            quantite, 
            statut, 
            priorite 
        });
        
        if (!result || !result.rowsAffected || result.rowsAffected === 0) {
            return res.status(404).json({ 
                error: 'Lancement non trouvé' 
            });
        }
        
        res.json({ 
            message: 'Lancement mis à jour avec succès' 
        });
        
    } catch (error) {
        console.error('Erreur lors de la mise à jour du lancement:', error);
        res.status(500).json({ 
            error: 'Erreur lors de la mise à jour du lancement' 
        });
    }
});

module.exports = router;
