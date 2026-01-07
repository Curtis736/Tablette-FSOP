const { executeQuery, executeNonQuery } = require('../config/database');

class Comment {
    constructor(data) {
        this.id = data.id;
        this.operatorCode = data.operatorCode;
        this.operatorName = data.operatorName;
        this.lancementCode = data.lancementCode;
        this.comment = data.comment;
        this.timestamp = data.timestamp;
        this.createdAt = data.createdAt;
        this.qteNonConforme = data.qteNonConforme !== undefined ? parseFloat(data.qteNonConforme) : null;
        this.statut = data.statut || null;
    }

    // Créer un nouveau commentaire
    static async create(commentData) {
        try {
            const { operatorCode, operatorName, lancementCode, comment, qteNonConforme, statut } = commentData;
            const timestamp = new Date().toISOString();
            
            // Construire la requête avec les colonnes optionnelles
            const columns = ['OperatorCode', 'OperatorName', 'LancementCode', 'Comment', 'Timestamp', 'CreatedAt'];
            const values = ['@operatorCode', '@operatorName', '@lancementCode', '@comment', '@timestamp', 'GETDATE()'];
            const params = {
                operatorCode,
                operatorName,
                lancementCode,
                comment,
                timestamp
            };
            
            // Ajouter QteNonConforme si fourni
            if (qteNonConforme !== undefined && qteNonConforme !== null) {
                columns.push('QteNonConforme');
                values.push('@qteNonConforme');
                params.qteNonConforme = parseFloat(qteNonConforme);
            }
            
            // Ajouter Statut si fourni
            if (statut !== undefined && statut !== null && statut !== '') {
                columns.push('Statut');
                values.push('@statut');
                params.statut = statut.toUpperCase();
            }
            
            const query = `
                INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS]
                (${columns.join(', ')})
                VALUES (${values.join(', ')})
            `;
            
            const result = await executeNonQuery(query, params);
            
            if (result.rowsAffected > 0) {
                console.log(`✅ Commentaire créé pour l'opérateur ${operatorCode}`);
                return {
                    success: true,
                    message: 'Commentaire enregistré avec succès',
                    data: {
                        operatorCode,
                        operatorName,
                        lancementCode,
                        comment,
                        timestamp,
                        qteNonConforme: params.qteNonConforme || null,
                        statut: params.statut || null
                    }
                };
            } else {
                throw new Error('Aucune ligne affectée lors de la création du commentaire');
            }
            
        } catch (error) {
            console.error('❌ Erreur lors de la création du commentaire:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Récupérer les commentaires d'un opérateur
    static async getByOperator(operatorCode, limit = 50) {
        try {
            const query = `
                SELECT TOP ${limit}
                    Id,
                    OperatorCode,
                    OperatorName,
                    LancementCode,
                    Comment,
                    Timestamp,
                    CreatedAt,
                    QteNonConforme,
                    Statut
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS]
                WHERE OperatorCode = @operatorCode
                ORDER BY CreatedAt DESC
            `;
            
            const params = { operatorCode };
            const comments = await executeQuery(query, params);
            
            return {
                success: true,
                data: comments.map(comment => new Comment(comment))
            };
            
        } catch (error) {
            console.error('❌ Erreur lors de la récupération des commentaires:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Récupérer tous les commentaires récents
    static async getAll(limit = 100) {
        try {
            const query = `
                SELECT TOP ${limit}
                    Id,
                    OperatorCode,
                    OperatorName,
                    LancementCode,
                    Comment,
                    Timestamp,
                    CreatedAt,
                    QteNonConforme,
                    Statut
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS]
                ORDER BY CreatedAt DESC
            `;
            
            const comments = await executeQuery(query);
            
            return {
                success: true,
                data: comments.map(comment => new Comment(comment))
            };
            
        } catch (error) {
            console.error('❌ Erreur lors de la récupération de tous les commentaires:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Récupérer les commentaires pour un lancement spécifique
    static async getByLancement(lancementCode, limit = 50) {
        try {
            const query = `
                SELECT TOP ${limit}
                    Id,
                    OperatorCode,
                    OperatorName,
                    LancementCode,
                    Comment,
                    Timestamp,
                    CreatedAt,
                    QteNonConforme,
                    Statut
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS]
                WHERE LancementCode = @lancementCode
                ORDER BY CreatedAt DESC
            `;
            
            const params = { lancementCode };
            const comments = await executeQuery(query, params);
            
            return {
                success: true,
                data: comments.map(comment => new Comment(comment))
            };
            
        } catch (error) {
            console.error('❌ Erreur lors de la récupération des commentaires du lancement:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Supprimer un commentaire
    static async delete(commentId, operatorCode) {
        try {
            const query = `
                DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS]
                WHERE Id = @commentId AND OperatorCode = @operatorCode
            `;
            
            const params = { commentId, operatorCode };
            const result = await executeNonQuery(query, params);
            
            if (result.rowsAffected > 0) {
                return {
                    success: true,
                    message: 'Commentaire supprimé avec succès'
                };
            } else {
                return {
                    success: false,
                    error: 'Commentaire non trouvé ou non autorisé à supprimer'
                };
            }
            
        } catch (error) {
            console.error('❌ Erreur lors de la suppression du commentaire:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Méthode pour formater le timestamp pour l'affichage
    getFormattedTimestamp() {
        if (!this.timestamp) return 'N/A';
        
        try {
            const date = new Date(this.timestamp);
            return date.toLocaleString('fr-FR', {
                timeZone: 'Europe/Paris',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch (error) {
            return this.timestamp;
        }
    }
}

module.exports = Comment;




