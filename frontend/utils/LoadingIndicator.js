/**
 * Gestionnaire d'indicateurs de chargement
 */
class LoadingIndicator {
    constructor() {
        this.activeLoaders = new Map();
    }

    /**
     * Affiche un indicateur de chargement
     * @param {string} id - Identifiant unique du loader
     * @param {HTMLElement} targetElement - Élément où afficher le loader (optionnel)
     * @param {string} message - Message à afficher (optionnel)
     * @returns {HTMLElement} L'élément du loader créé
     */
    show(id, targetElement = null, message = 'Chargement...') {
        // Si un loader existe déjà avec cet ID, le supprimer
        if (this.activeLoaders.has(id)) {
            this.hide(id);
        }

        const loader = document.createElement('div');
        loader.className = 'loading-indicator';
        loader.id = `loader-${id}`;
        loader.innerHTML = `
            <div class="spinner-border spinner-border-sm" role="status">
                <span class="sr-only">${message}</span>
            </div>
            <span class="loading-message">${message}</span>
        `;
        loader.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.9);
            border-radius: 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            position: absolute;
            z-index: 1000;
        `;

        if (targetElement) {
            // Position relative pour le parent
            const position = window.getComputedStyle(targetElement).position;
            if (position === 'static') {
                targetElement.style.position = 'relative';
            }
            targetElement.appendChild(loader);
        } else {
            // Ajouter au body
            document.body.appendChild(loader);
            loader.style.position = 'fixed';
            loader.style.top = '50%';
            loader.style.left = '50%';
            loader.style.transform = 'translate(-50%, -50%)';
        }

        this.activeLoaders.set(id, { element: loader, target: targetElement });
        return loader;
    }

    /**
     * Masque un indicateur de chargement
     * @param {string} id - Identifiant du loader à masquer
     */
    hide(id) {
        const loaderInfo = this.activeLoaders.get(id);
        if (loaderInfo) {
            const { element, target } = loaderInfo;
            if (element && element.parentNode) {
                element.parentNode.removeChild(element);
            }
            this.activeLoaders.delete(id);
        }
    }

    /**
     * Masque tous les indicateurs de chargement
     */
    hideAll() {
        this.activeLoaders.forEach((_, id) => this.hide(id));
    }

    /**
     * Vérifie si un loader est actif
     * @param {string} id - Identifiant du loader
     * @returns {boolean}
     */
    isActive(id) {
        return this.activeLoaders.has(id);
    }
}

export default LoadingIndicator;
