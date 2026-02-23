/**
 * Validateur pour les données d'entrée utilisateur
 */
class Validator {
    /**
     * Valide les données d'une opération
     * @param {Object} data - Données à valider
     * @returns {{valid: boolean, errors: string[]}}
     */
    validateOperation(data) {
        const errors = [];

        if (!data.operatorId && !data.OperatorCode) {
            errors.push('Code opérateur requis');
        }

        if (!data.lancementCode && !data.LancementCode) {
            errors.push('Code lancement requis');
        }

        // Validation des dates si présentes
        if (data.startTime) {
            const startDate = new Date(data.startTime);
            if (isNaN(startDate.getTime())) {
                errors.push('Date de début invalide');
            }
        }

        if (data.endTime) {
            const endDate = new Date(data.endTime);
            if (isNaN(endDate.getTime())) {
                errors.push('Date de fin invalide');
            }

            // Vérifier que la fin est après le début
            if (data.startTime) {
                const startDate = new Date(data.startTime);
                if (endDate < startDate) {
                    errors.push('La date de fin doit être après la date de début');
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    /**
     * Valide un code opérateur
     * @param {string} code - Code à valider
     * @returns {boolean}
     */
    validateOperatorCode(code) {
        if (!code || typeof code !== 'string') return false;
        return code.trim().length > 0;
    }

    /**
     * Valide un code lancement
     * @param {string} code - Code à valider
     * @returns {boolean}
     */
    validateLancementCode(code) {
        if (!code || typeof code !== 'string') return false;
        return code.trim().length > 0;
    }

    /**
     * Valide un ID numérique
     * @param {*} id - ID à valider
     * @returns {boolean}
     */
    validateId(id) {
        if (id === null || id === undefined) return false;
        const numId = Number(id);
        return Number.isFinite(numId) && numId > 0;
    }
}

export default Validator;
