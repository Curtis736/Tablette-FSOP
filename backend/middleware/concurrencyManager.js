/**
 * Gestionnaire de concurrence pour 20 connexions simultanées
 * Assure l'isolation des données entre opérateurs
 */

class ConcurrencyManager {
    constructor() {
        this.activeOperations = new Map(); // Map des opérations actives par opérateur
        this.lancementLocks = new Map();   // Verrous sur les lancements
        this.operatorSessions = new Map(); // Sessions actives par opérateur
        this.maxConcurrentPerOperator = 5; // Max 5 opérations simultanées par opérateur (augmenté pour flexibilité)
        this.maxTotalConcurrent = 100;     // Max 100 opérations totales (20 opérateurs × 5 max)
        this.cleanupInterval = 60000;      // Nettoyage toutes les minutes
        
        // Démarrer le nettoyage périodique
        this.startCleanup();
    }

    /**
     * Vérifier si un opérateur peut démarrer une nouvelle opération
     */
    canStartOperation(operatorCode, lancementCode) {
        const operatorOps = this.activeOperations.get(operatorCode) || [];
        
        // Vérifier la limite par opérateur
        if (operatorOps.length >= this.maxConcurrentPerOperator) {
            return {
                allowed: false,
                reason: `Opérateur ${operatorCode} a atteint la limite de ${this.maxConcurrentPerOperator} opérations simultanées`
            };
        }

        // Vérifier la limite globale (pour éviter la surcharge)
        let totalOps = 0;
        for (const ops of this.activeOperations.values()) {
            totalOps += ops.length;
        }
        if (totalOps >= this.maxTotalConcurrent) {
            return {
                allowed: false,
                reason: `Limite globale de ${this.maxTotalConcurrent} opérations simultanées atteinte`
            };
        }

        // ✅ AUTORISATION : Plusieurs opérateurs peuvent travailler sur le même lancement simultanément
        // La vérification de verrouillage exclusif a été désactivée pour permettre la collaboration multi-opérateurs
        // Ancienne vérification commentée :
        /*
        const lockInfo = this.lancementLocks.get(lancementCode);
        if (lockInfo && lockInfo.operatorCode !== operatorCode) {
            return {
                allowed: false,
                reason: `Lancement ${lancementCode} déjà en cours par l'opérateur ${lockInfo.operatorCode}`,
                conflict: lockInfo
            };
        }
        */

        return { allowed: true };
    }

    /**
     * Réserver un lancement pour un opérateur
     */
    reserveLancement(operatorCode, lancementCode, operationId) {
        const lockInfo = {
            operatorCode,
            lancementCode,
            operationId,
            timestamp: Date.now(),
            status: 'RESERVED'
        };

        this.lancementLocks.set(lancementCode, lockInfo);
        
        // Ajouter à la liste des opérations de l'opérateur
        if (!this.activeOperations.has(operatorCode)) {
            this.activeOperations.set(operatorCode, []);
        }
        this.activeOperations.get(operatorCode).push({
            operationId,
            lancementCode,
            startTime: Date.now(),
            status: 'ACTIVE'
        });

        console.log(`🔒 Lancement ${lancementCode} réservé pour l'opérateur ${operatorCode}`);
        return lockInfo;
    }

    /**
     * Libérer un lancement
     */
    releaseLancement(operatorCode, lancementCode, operationId) {
        // Retirer de la liste des opérations actives
        const operatorOps = this.activeOperations.get(operatorCode) || [];
        const updatedOps = operatorOps.filter(op => 
            !(op.operationId === operationId && op.lancementCode === lancementCode)
        );
        
        if (updatedOps.length === 0) {
            this.activeOperations.delete(operatorCode);
        } else {
            this.activeOperations.set(operatorCode, updatedOps);
        }

        // Libérer le verrou du lancement
        const lockInfo = this.lancementLocks.get(lancementCode);
        if (lockInfo && lockInfo.operatorCode === operatorCode) {
            this.lancementLocks.delete(lancementCode);
            console.log(`🔓 Lancement ${lancementCode} libéré par l'opérateur ${operatorCode}`);
        }
    }

    /**
     * Vérifier l'isolation des données d'un opérateur
     */
    validateDataIsolation(operatorCode, requestedOperatorCode) {
        if (requestedOperatorCode && requestedOperatorCode !== operatorCode) {
            console.log(`🚨 TENTATIVE D'ACCÈS NON AUTORISÉ: ${operatorCode} essaie d'accéder aux données de ${requestedOperatorCode}`);
            return {
                allowed: false,
                reason: 'Accès non autorisé aux données d\'un autre opérateur',
                security: 'DATA_ISOLATION_VIOLATION'
            };
        }

        return { allowed: true };
    }

    /**
     * Obtenir les statistiques de concurrence
     */
    getConcurrencyStats() {
        const stats = {
            totalActiveOperations: 0,
            operatorsWithActiveOps: this.activeOperations.size,
            lockedLancements: this.lancementLocks.size,
            operatorBreakdown: {}
        };

        for (const [operatorCode, operations] of this.activeOperations) {
            stats.totalActiveOperations += operations.length;
            stats.operatorBreakdown[operatorCode] = {
                activeOperations: operations.length,
                lancements: operations.map(op => op.lancementCode)
            };
        }

        return stats;
    }

    /**
     * Nettoyage périodique des opérations expirées
     */
    startCleanup() {
        setInterval(() => {
            this.cleanupExpiredOperations();
        }, this.cleanupInterval);
    }

    /**
     * Nettoyer les opérations expirées (plus de 2 heures)
     */
    cleanupExpiredOperations() {
        const now = Date.now();
        const maxAge = 2 * 60 * 60 * 1000; // 2 heures

        for (const [operatorCode, operations] of this.activeOperations) {
            const validOps = operations.filter(op => (now - op.startTime) < maxAge);
            
            if (validOps.length === 0) {
                this.activeOperations.delete(operatorCode);
            } else {
                this.activeOperations.set(operatorCode, validOps);
            }
        }

        // Nettoyer les verrous expirés
        for (const [lancementCode, lockInfo] of this.lancementLocks) {
            if ((now - lockInfo.timestamp) > maxAge) {
                this.lancementLocks.delete(lancementCode);
                console.log(`🧹 Verrou expiré libéré pour le lancement ${lancementCode}`);
            }
        }
    }

    /**
     * Middleware pour valider la concurrence
     */
    validateConcurrency(req, res, next) {
        const { operatorId, lancementCode } = req.body;
        const operationId = req.params.id || `op_${Date.now()}_${Math.random()}`;

        // Validation de l'isolation des données
        const isolationCheck = this.validateDataIsolation(operatorId, req.query.operatorCode);
        if (!isolationCheck.allowed) {
            return res.status(403).json({
                success: false,
                error: isolationCheck.reason,
                security: isolationCheck.security
            });
        }

        // Vérification de concurrence pour les opérations de lancement
        if (lancementCode) {
            const concurrencyCheck = this.canStartOperation(operatorId, lancementCode);
            if (!concurrencyCheck.allowed) {
                return res.status(409).json({
                    success: false,
                    error: concurrencyCheck.reason,
                    conflict: concurrencyCheck.conflict
                });
            }

            // Réserver le lancement
            req.lancementLock = this.reserveLancement(operatorId, lancementCode, operationId);
        }

        req.operationId = operationId;
        next();
    }

    /**
     * Middleware pour libérer les ressources
     */
    releaseResources(req, res, next) {
        const originalSend = res.send;
        
        res.send = function(data) {
            // Libérer les ressources après envoi de la réponse
            if (req.lancementLock && req.body.operatorId) {
                concurrencyManager.releaseLancement(
                    req.body.operatorId, 
                    req.lancementLock.lancementCode, 
                    req.operationId
                );
            }
            
            return originalSend.call(this, data);
        };
        
        next();
    }
}

const concurrencyManager = new ConcurrencyManager();

module.exports = {
    concurrencyManager,
    validateConcurrency: concurrencyManager.validateConcurrency.bind(concurrencyManager),
    releaseResources: concurrencyManager.releaseResources.bind(concurrencyManager),
    getConcurrencyStats: concurrencyManager.getConcurrencyStats.bind(concurrencyManager)
};

