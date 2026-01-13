/**
 * Service pour exécuter des requêtes batch et réduire les allers-retours DB
 * Regroupe plusieurs requêtes similaires en une seule transaction
 */

const { executeQuery, executeNonQuery } = require('../config/database');

class BatchQueryService {
    constructor() {
        this.batchQueue = new Map();
        this.batchTimeout = 100; // ms - Délai avant exécution du batch
        this.maxBatchSize = 50; // Nombre max de requêtes par batch
        this.pendingBatches = new Map();
    }

    /**
     * Ajouter une requête au batch
     * @param {string} batchKey - Clé unique pour regrouper les requêtes similaires
     * @param {Function} queryFn - Fonction qui retourne la requête SQL et les paramètres
     * @returns {Promise} Résultat de la requête
     */
    async addToBatch(batchKey, queryFn) {
        return new Promise((resolve, reject) => {
            if (!this.batchQueue.has(batchKey)) {
                this.batchQueue.set(batchKey, []);
            }

            const batch = this.batchQueue.get(batchKey);
            batch.push({ queryFn, resolve, reject });

            // Si le batch est plein, l'exécuter immédiatement
            if (batch.length >= this.maxBatchSize) {
                this.executeBatch(batchKey);
            } else {
                // Sinon, programmer l'exécution après le délai
                if (!this.pendingBatches.has(batchKey)) {
                    const timeoutId = setTimeout(() => {
                        this.executeBatch(batchKey);
                    }, this.batchTimeout);
                    this.pendingBatches.set(batchKey, timeoutId);
                }
            }
        });
    }

    /**
     * Exécuter un batch de requêtes
     */
    async executeBatch(batchKey) {
        const batch = this.batchQueue.get(batchKey);
        if (!batch || batch.length === 0) {
            return;
        }

        // Nettoyer le timeout
        if (this.pendingBatches.has(batchKey)) {
            clearTimeout(this.pendingBatches.get(batchKey));
            this.pendingBatches.delete(batchKey);
        }

        // Retirer le batch de la queue
        this.batchQueue.delete(batchKey);

        // Exécuter toutes les requêtes en parallèle
        const promises = batch.map(async ({ queryFn, resolve, reject }) => {
            try {
                const { query, params } = queryFn();
                const result = await executeQuery(query, params);
                resolve(result);
            } catch (error) {
                reject(error);
            }
        });

        // Attendre que toutes les requêtes soient terminées
        await Promise.allSettled(promises);
    }

    /**
     * Exécuter plusieurs requêtes de validation de lancement en batch
     */
    async batchValidateLancements(lancementCodes) {
        if (!lancementCodes || lancementCodes.length === 0) {
            return [];
        }

        // Si un seul lancement, exécuter directement
        if (lancementCodes.length === 1) {
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
            const result = await executeQuery(query, { codeLancement: lancementCodes[0] });
            return result;
        }

        // Batch query pour plusieurs lancements
        const placeholders = lancementCodes.map((_, i) => `@code${i}`).join(', ');
        const params = {};
        lancementCodes.forEach((code, i) => {
            params[`code${i}`] = code;
        });

        const query = `
            SELECT 
                [CodeLancement],
                [CodeArticle],
                [DesignationLct1],
                [CodeModele],
                [DesignationArt1],
                [DesignationArt2]
            FROM [SEDI_ERP].[dbo].[LCTE]
            WHERE [CodeLancement] IN (${placeholders})
        `;

        return await executeQuery(query, params);
    }

    /**
     * Exécuter plusieurs requêtes d'opérateurs en batch
     */
    async batchGetOperators(operatorCodes) {
        if (!operatorCodes || operatorCodes.length === 0) {
            return [];
        }

        if (operatorCodes.length === 1) {
            const query = `
                SELECT 
                    r.Coderessource,
                    r.Designation1,
                    r.Typeressource
                FROM [SEDI_ERP].[dbo].[RESSOURC] r
                WHERE r.Coderessource = @operatorCode
            `;
            const result = await executeQuery(query, { operatorCode: operatorCodes[0] });
            return result;
        }

        const placeholders = operatorCodes.map((_, i) => `@code${i}`).join(', ');
        const params = {};
        operatorCodes.forEach((code, i) => {
            params[`code${i}`] = code;
        });

        const query = `
            SELECT 
                r.Coderessource,
                r.Designation1,
                r.Typeressource
            FROM [SEDI_ERP].[dbo].[RESSOURC] r
            WHERE r.Coderessource IN (${placeholders})
        `;

        return await executeQuery(query, params);
    }

    /**
     * Exécuter plusieurs requêtes d'historique en batch
     */
    async batchGetHistories(operatorCodes, date = null) {
        if (!operatorCodes || operatorCodes.length === 0) {
            return [];
        }

        const placeholders = operatorCodes.map((_, i) => `@code${i}`).join(', ');
        const params = {};
        operatorCodes.forEach((code, i) => {
            params[`code${i}`] = code;
        });

        let dateFilter = '';
        if (date) {
            dateFilter = 'AND CAST(h.DateCreation AS DATE) = @date';
            params.date = date;
        }

        const query = `
            SELECT 
                h.NoEnreg,
                h.Ident,
                h.CodeLanctImprod,
                h.OperatorCode,
                h.Phase,
                h.Statut,
                h.HeureDebut,
                h.HeureFin,
                h.DateCreation
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
            WHERE h.OperatorCode IN (${placeholders})
            ${dateFilter}
            ORDER BY h.DateCreation DESC
        `;

        return await executeQuery(query, params);
    }

    /**
     * Forcer l'exécution de tous les batches en attente
     */
    async flushAll() {
        const batchKeys = Array.from(this.batchQueue.keys());
        await Promise.all(batchKeys.map(key => this.executeBatch(key)));
    }
}

// Singleton
const batchQueryService = new BatchQueryService();

module.exports = batchQueryService;
