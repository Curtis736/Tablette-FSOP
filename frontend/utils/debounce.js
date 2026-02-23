/**
 * Fonction debounce pour limiter la fréquence d'appel d'une fonction
 * @param {Function} func - Fonction à débouncer
 * @param {number} wait - Délai d'attente en millisecondes
 * @param {boolean} immediate - Si true, appelle immédiatement puis attend
 * @returns {Function} Fonction débouncée
 */
export function debounce(func, wait, immediate = false) {
    let timeout;
    
    return function executedFunction(...args) {
        const later = () => {
            timeout = null;
            if (!immediate) func(...args);
        };
        
        const callNow = immediate && !timeout;
        
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        
        if (callNow) func(...args);
    };
}

/**
 * Fonction throttle pour limiter la fréquence d'appel d'une fonction
 * @param {Function} func - Fonction à throttler
 * @param {number} limit - Délai minimum entre les appels en millisecondes
 * @returns {Function} Fonction throttlée
 */
export function throttle(func, limit) {
    let inThrottle;
    
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}
