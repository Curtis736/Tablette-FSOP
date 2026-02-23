/**
 * Cache pour les éléments DOM afin d'éviter les requêtes répétées
 */
class DOMCache {
    constructor() {
        this.cache = new Map();
        this.initialized = false;
    }

    /**
     * Initialise le cache avec les éléments DOM principaux
     * @param {Array<string>} elementIds - Liste des IDs d'éléments à mettre en cache
     */
    initialize(elementIds = []) {
        const defaultIds = [
            'refreshDataBtn',
            'totalOperators',
            'activeLancements',
            'pausedLancements',
            'completedLancements',
            'operationsTableBody',
            'operatorFilter',
            'statusFilter',
            'periodFilter',
            'searchFilter',
            'clearFiltersBtn',
            'transferBtn',
            'addOperationBtn',
            'transferSelectionModal',
            'transferModalTableBody',
            'closeTransferModalBtn',
            'transferSelectedConfirmBtn',
            'transferSelectAll',
            'selectAllRows',
            'paginationInfo',
            'activeOperatorsIndicator',
            'pauseCount',
            'tempCount',
            'pauseTableBody',
            'tempTableBody',
        ];

        const idsToCache = [...new Set([...defaultIds, ...elementIds])];

        idsToCache.forEach(id => {
            this.get(id);
        });

        this.initialized = true;
    }

    /**
     * Récupère un élément du cache ou le récupère du DOM
     * @param {string} id - ID de l'élément
     * @param {boolean} forceRefresh - Forcer le rafraîchissement du cache
     * @returns {HTMLElement|null}
     */
    get(id, forceRefresh = false) {
        if (!id) return null;

        if (forceRefresh || !this.cache.has(id)) {
            const element = document.getElementById(id);
            this.cache.set(id, element);
            return element;
        }

        return this.cache.get(id);
    }

    /**
     * Vérifie si un élément existe dans le cache
     * @param {string} id - ID de l'élément
     * @returns {boolean}
     */
    has(id) {
        return this.cache.has(id);
    }

    /**
     * Définit un élément dans le cache
     * @param {string} id - ID de l'élément
     * @param {HTMLElement} element - Élément à mettre en cache
     */
    set(id, element) {
        this.cache.set(id, element);
    }

    /**
     * Supprime un élément du cache
     * @param {string} id - ID de l'élément
     */
    delete(id) {
        this.cache.delete(id);
    }

    /**
     * Vide tout le cache
     */
    clear() {
        this.cache.clear();
        this.initialized = false;
    }

    /**
     * Rafraîchit tous les éléments du cache
     */
    refresh() {
        const ids = Array.from(this.cache.keys());
        this.cache.clear();
        ids.forEach(id => this.get(id));
    }

    /**
     * Récupère plusieurs éléments à la fois
     * @param {Array<string>} ids - Liste des IDs
     * @returns {Object} Objet avec les IDs comme clés et les éléments comme valeurs
     */
    getMultiple(ids) {
        const result = {};
        ids.forEach(id => {
            result[id] = this.get(id);
        });
        return result;
    }
}

export default DOMCache;
