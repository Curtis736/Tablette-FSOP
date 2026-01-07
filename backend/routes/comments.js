// Routes pour la gestion des commentaires opérateurs
const express = require('express');
const router = express.Router();
const Comment = require('../models/Comment');
const emailService = require('../services/emailService');
const { executeQuery } = require('../config/database');

// Validation des données d'entrée
const validateComment = (req, res, next) => {
    const { operatorCode, operatorName, lancementCode, comment, qteNonConforme, statut } = req.body;
    
    if (!operatorCode || !operatorName || !lancementCode || !comment) {
        return res.status(400).json({
            success: false,
            error: 'Tous les champs sont requis (operatorCode, operatorName, lancementCode, comment)'
        });
    }
    
    if (comment.trim().length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Le commentaire ne peut pas être vide'
        });
    }
    
    if (comment.length > 2000) {
        return res.status(400).json({
            success: false,
            error: 'Le commentaire ne peut pas dépasser 2000 caractères'
        });
    }
    
    // Validation de QteNonConforme (optionnel, doit être numérique si fourni)
    if (qteNonConforme !== undefined && qteNonConforme !== null) {
        const qte = parseFloat(qteNonConforme);
        if (isNaN(qte) || qte < 0) {
            return res.status(400).json({
                success: false,
                error: 'QteNonConforme doit être un nombre positif ou nul'
            });
        }
    }
    
    // Validation de Statut (optionnel, doit être NULL, 'V', ou 'I' si fourni)
    if (statut !== undefined && statut !== null && statut !== '') {
        if (!['V', 'I'].includes(statut.toUpperCase())) {
            return res.status(400).json({
                success: false,
                error: 'Statut doit être NULL, "V" (Validée par l\'AQ), ou "I" (Intégré dans SILOG)'
            });
        }
    }
    
    next();
};

// POST /api/comments - Créer un nouveau commentaire
router.post('/', validateComment, async (req, res) => {
    try {
        const { operatorCode, operatorName, lancementCode, comment, qteNonConforme, statut } = req.body;
        
        console.log(`📝 Création d'un commentaire pour l'opérateur ${operatorCode} sur le lancement ${lancementCode}`);
        
        // Préparer les données avec les nouveaux champs
        const commentData = {
            operatorCode,
            operatorName,
            lancementCode,
            comment: comment.trim()
        };
        
        // Ajouter QteNonConforme si fourni
        if (qteNonConforme !== undefined && qteNonConforme !== null) {
            commentData.qteNonConforme = parseFloat(qteNonConforme);
        }
        
        // Ajouter Statut si fourni (normaliser en majuscules)
        if (statut !== undefined && statut !== null && statut !== '') {
            commentData.statut = statut.toUpperCase();
        }
        
        // Créer le commentaire en base de données
        const commentResult = await Comment.create(commentData);
        
        if (!commentResult.success) {
            return res.status(500).json({
                success: false,
                error: commentResult.error
            });
        }
        
        // Envoyer l'email de notification
        const emailResult = await emailService.sendCommentNotification({
            operatorCode,
            operatorName,
            lancementCode,
            comment: comment.trim(),
            timestamp: new Date().toLocaleString('fr-FR', {
                timeZone: 'Europe/Paris',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })
        });
        
        if (!emailResult.success) {
            console.warn('⚠️ Commentaire enregistré mais email non envoyé:', emailResult.error);
        }
        
        res.json({
            success: true,
            message: 'Commentaire enregistré et notification envoyée',
            data: commentResult.data,
            emailSent: emailResult.success
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la création du commentaire:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la création du commentaire'
        });
    }
});

// GET /api/comments/operator/:operatorCode - Récupérer les commentaires d'un opérateur
router.get('/operator/:operatorCode', async (req, res) => {
    try {
        const { operatorCode } = req.params;
        const { limit = 50 } = req.query;
        
        console.log(`🔍 Récupération des commentaires pour l'opérateur ${operatorCode}`);
        
        const result = await Comment.getByOperator(operatorCode, parseInt(limit));
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error
            });
        }
        
        res.json({
            success: true,
            data: result.data,
            count: result.data.length
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la récupération des commentaires:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la récupération des commentaires'
        });
    }
});

// GET /api/comments/lancement/:lancementCode - Récupérer les commentaires d'un lancement
router.get('/lancement/:lancementCode', async (req, res) => {
    try {
        const { lancementCode } = req.params;
        const { limit = 50 } = req.query;
        
        console.log(`🔍 Récupération des commentaires pour le lancement ${lancementCode}`);
        
        const result = await Comment.getByLancement(lancementCode, parseInt(limit));
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error
            });
        }
        
        res.json({
            success: true,
            data: result.data,
            count: result.data.length
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la récupération des commentaires du lancement:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la récupération des commentaires'
        });
    }
});

// GET /api/comments - Récupérer tous les commentaires récents
router.get('/', async (req, res) => {
    try {
        const { limit = 100 } = req.query;
        
        console.log(`🔍 Récupération de tous les commentaires récents (limite: ${limit})`);
        
        const result = await Comment.getAll(parseInt(limit));
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error
            });
        }
        
        res.json({
            success: true,
            data: result.data,
            count: result.data.length
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la récupération de tous les commentaires:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la récupération des commentaires'
        });
    }
});

// DELETE /api/comments/:commentId - Supprimer un commentaire
router.delete('/:commentId', async (req, res) => {
    try {
        const { commentId } = req.params;
        const { operatorCode } = req.body;
        
        if (!operatorCode) {
            return res.status(400).json({
                success: false,
                error: 'operatorCode requis pour supprimer un commentaire'
            });
        }
        
        console.log(`🗑️ Suppression du commentaire ${commentId} par l'opérateur ${operatorCode}`);
        
        const result = await Comment.delete(parseInt(commentId), operatorCode);
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }
        
        res.json({
            success: true,
            message: result.message
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la suppression du commentaire:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la suppression du commentaire'
        });
    }
});

// POST /api/comments/test-email - Tester l'envoi d'email
router.post('/test-email', async (req, res) => {
    try {
        console.log('📧 Test d\'envoi d\'email...');
        
        const result = await emailService.sendTestEmail();
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Email de test envoyé avec succès',
                messageId: result.messageId
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur lors du test d\'envoi d\'email:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors du test d\'envoi d\'email'
        });
    }
});

// GET /api/comments/stats - Statistiques des commentaires
router.get('/stats', async (req, res) => {
    try {
        const { period = 'today' } = req.query;
        
        let dateFilter = '';
        switch (period) {
            case 'today':
                dateFilter = 'AND CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)';
                break;
            case 'week':
                dateFilter = 'AND CreatedAt >= DATEADD(day, -7, GETDATE())';
                break;
            case 'month':
                dateFilter = 'AND CreatedAt >= DATEADD(month, -1, GETDATE())';
                break;
        }
        
        const query = `
            SELECT 
                COUNT(*) as totalComments,
                COUNT(DISTINCT OperatorCode) as uniqueOperators,
                COUNT(DISTINCT LancementCode) as uniqueLancements
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS]
            WHERE 1=1 ${dateFilter}
        `;
        
        const result = await executeQuery(query);
        const stats = result[0];
        
        res.json({
            success: true,
            data: {
                totalComments: parseInt(stats.totalComments),
                uniqueOperators: parseInt(stats.uniqueOperators),
                uniqueLancements: parseInt(stats.uniqueLancements),
                period: period
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la récupération des statistiques:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la récupération des statistiques'
        });
    }
});

module.exports = router;




