/**
 * Gestionnaire d'erreurs centralisé pour standardiser la gestion des erreurs
 */
class ErrorHandler {
    constructor(notificationManager, logger) {
        this.notificationManager = notificationManager;
        this.logger = logger;
    }

    /**
     * Gère une erreur de manière standardisée
     * @param {Error} error - L'erreur à gérer
     * @param {string} context - Contexte de l'erreur (nom de la méthode)
     * @param {string} userMessage - Message à afficher à l'utilisateur
     * @param {Object} options - Options additionnelles
     */
    handle(error, context, userMessage = null, options = {}) {
        const {
            silent = false,
            showNotification = true,
            logError = true,
        } = options;

        // Logger l'erreur
        if (logError) {
            this.logger.error(`[${context}]`, error);
        }

        // Déterminer le message utilisateur
        let message = userMessage;
        if (!message) {
            message = this.getDefaultMessage(error);
        }

        // Afficher la notification
        if (showNotification && !silent && this.notificationManager) {
            this.notificationManager.error(message);
        }

        // Retourner un objet standardisé pour traitement ultérieur
        return {
            error: true,
            message,
            originalError: error,
            context,
        };
    }

    /**
     * Génère un message d'erreur par défaut basé sur le type d'erreur
     * @param {Error} error - L'erreur
     * @returns {string} Message d'erreur
     */
    getDefaultMessage(error) {
        if (!error) return 'Une erreur est survenue';

        const errorMessage = error.message || String(error);

        // Erreurs réseau
        if (errorMessage.includes('Timeout') || errorMessage.includes('timeout')) {
            return 'Le serveur met trop de temps à répondre. Vérifiez votre connexion.';
        }

        if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
            return 'Trop de requêtes. Veuillez patienter quelques secondes.';
        }

        if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
            return 'Impossible de contacter le serveur. Vérifiez votre connexion.';
        }

        // Erreurs HTTP
        if (errorMessage.includes('HTTP')) {
            return `Erreur serveur: ${errorMessage}`;
        }

        // Erreur générique
        return 'Une erreur est survenue. Veuillez réessayer.';
    }

    /**
     * Vérifie si une erreur est une erreur de rate limiting
     * @param {Error} error - L'erreur à vérifier
     * @returns {boolean}
     */
    isRateLimitError(error) {
        if (!error || !error.message) return false;
        const message = error.message.toLowerCase();
        return message.includes('429') || 
               message.includes('too many requests') || 
               message.includes('trop de requêtes');
    }

    /**
     * Wrapper pour les fonctions async qui gère automatiquement les erreurs
     * @param {Function} asyncFn - Fonction async à wrapper
     * @param {string} context - Contexte de l'erreur
     * @param {string} userMessage - Message utilisateur
     * @returns {Function} Fonction wrappée
     */
    wrapAsync(asyncFn, context, userMessage = null) {
        return async (...args) => {
            try {
                return await asyncFn(...args);
            } catch (error) {
                return this.handle(error, context, userMessage);
            }
        };
    }
}

export default ErrorHandler;
