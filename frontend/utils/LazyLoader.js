/**
 * Utilitaire pour le lazy loading des grandes listes
 * Implémente l'intersection observer pour charger les éléments à la demande
 */

class LazyLoader {
    constructor(options = {}) {
        this.options = {
            root: options.root || null,
            rootMargin: options.rootMargin || '100px',
            threshold: options.threshold || 0.1,
            onLoad: options.onLoad || null,
            onError: options.onError || null,
            batchSize: options.batchSize || 20
        };
        
        this.observer = null;
        this.loadedItems = new Set();
        this.pendingLoads = new Map();
    }

    /**
     * Initialiser l'observer
     */
    init() {
        if (typeof IntersectionObserver === 'undefined') {
            console.warn('⚠️ IntersectionObserver non supporté, fallback sur chargement immédiat');
            return false;
        }

        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const element = entry.target;
                    const itemId = element.dataset.lazyId;
                    
                    if (itemId && !this.loadedItems.has(itemId)) {
                        this.loadItem(element, itemId);
                    }
                }
            });
        }, {
            root: this.options.root,
            rootMargin: this.options.rootMargin,
            threshold: this.options.threshold
        });

        return true;
    }

    /**
     * Observer un élément pour le lazy loading
     */
    observe(element, itemId) {
        if (!this.observer) {
            // Si l'observer n'est pas disponible, charger immédiatement
            this.loadItem(element, itemId);
            return;
        }

        element.dataset.lazyId = itemId;
        this.observer.observe(element);
    }

    /**
     * Charger un élément
     */
    async loadItem(element, itemId) {
        if (this.loadedItems.has(itemId)) {
            return;
        }

        // Marquer comme en cours de chargement
        this.loadedItems.add(itemId);
        element.classList.add('lazy-loading');

        try {
            if (this.options.onLoad) {
                await this.options.onLoad(element, itemId);
            }
            element.classList.remove('lazy-loading');
            element.classList.add('lazy-loaded');
        } catch (error) {
            console.error(`❌ Erreur lors du chargement lazy de ${itemId}:`, error);
            element.classList.remove('lazy-loading');
            element.classList.add('lazy-error');
            
            if (this.options.onError) {
                this.options.onError(element, itemId, error);
            }
        }
    }

    /**
     * Arrêter d'observer un élément
     */
    unobserve(element) {
        if (this.observer) {
            this.observer.unobserve(element);
        }
    }

    /**
     * Nettoyer l'observer
     */
    disconnect() {
        if (this.observer) {
            this.observer.disconnect();
        }
        this.loadedItems.clear();
        this.pendingLoads.clear();
    }

    /**
     * Charger une liste d'éléments par batch
     */
    async loadBatch(items, loadFn, batchSize = null) {
        const size = batchSize || this.options.batchSize;
        const batches = [];
        
        for (let i = 0; i < items.length; i += size) {
            batches.push(items.slice(i, i + size));
        }

        for (const batch of batches) {
            await Promise.all(batch.map(item => loadFn(item)));
            // Petit délai entre les batches pour ne pas surcharger
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
}

/**
 * Pagination virtuelle pour les grandes listes
 */
class VirtualList {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            itemHeight: options.itemHeight || 50,
            buffer: options.buffer || 5, // Nombre d'éléments à charger en avance
            renderItem: options.renderItem || null,
            getItemData: options.getItemData || null
        };
        
        this.allItems = [];
        this.visibleItems = [];
        this.scrollTop = 0;
        this.containerHeight = 0;
        
        this.init();
    }

    init() {
        this.container.addEventListener('scroll', () => this.handleScroll());
        window.addEventListener('resize', () => this.handleResize());
        this.handleResize();
    }

    setItems(items) {
        this.allItems = items;
        this.updateVisibleItems();
    }

    handleScroll() {
        this.scrollTop = this.container.scrollTop;
        this.updateVisibleItems();
    }

    handleResize() {
        this.containerHeight = this.container.clientHeight;
        this.updateVisibleItems();
    }

    updateVisibleItems() {
        const startIndex = Math.max(0, Math.floor(this.scrollTop / this.options.itemHeight) - this.options.buffer);
        const endIndex = Math.min(
            this.allItems.length,
            Math.ceil((this.scrollTop + this.containerHeight) / this.options.itemHeight) + this.options.buffer
        );

        this.visibleItems = this.allItems.slice(startIndex, endIndex);
        
        if (this.options.renderItem) {
            this.render();
        }
    }

    render() {
        // Cette méthode doit être implémentée par l'utilisateur
        // ou utiliser renderItem pour chaque élément visible
    }
}

export { LazyLoader, VirtualList };
