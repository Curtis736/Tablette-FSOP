/**
 * Route heartbeat pour maintenir la session active et mettre à jour LastActivityTime
 */

const express = require('express');
const router = express.Router();
const SessionService = require('../services/SessionService');
const AuditService = require('../services/AuditService');

// POST /api/heartbeat - Heartbeat pour maintenir la session active
router.post('/', async (req, res) => {
    try {
        const { operatorCode } = req.body;
        
        if (!operatorCode) {
            return res.status(400).json({
                success: false,
                error: 'Code opérateur requis'
            });
        }
        
        // Récupérer la session active
        const activeSession = await SessionService.getActiveSession(operatorCode);
        
        if (!activeSession) {
            return res.status(404).json({
                success: false,
                error: 'Aucune session active trouvée'
            });
        }
        
        // Mettre à jour LastActivityTime
        await SessionService.updateLastActivity(operatorCode, activeSession.SessionId);
        
        // Logger l'événement d'audit (léger)
        await AuditService.logHeartbeat(operatorCode, activeSession.SessionId);
        
        res.json({
            success: true,
            message: 'Heartbeat enregistré',
            data: {
                operatorCode,
                sessionId: activeSession.SessionId,
                lastActivityTime: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur heartbeat:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur interne du serveur',
            details: error.message
        });
    }
});

module.exports = router;


