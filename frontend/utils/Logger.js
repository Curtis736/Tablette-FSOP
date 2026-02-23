/**
 * Système de logging configurable pour éviter de polluer la console en production
 */
class Logger {
    constructor(debug = false) {
        // Activer le debug via URL: ?debug=1 ou via localStorage: sedi_debug=1
        try {
            const sp = new URLSearchParams(window.location.search);
            this.debug = debug || 
                sp.get('debug') === '1' || 
                window.localStorage?.getItem('sedi_debug') === '1';
        } catch (e) {
            this.debug = debug;
        }
    }

    log(...args) {
        if (this.debug) {
            console.log(...args);
        }
    }

    warn(...args) {
        if (this.debug) {
            console.warn(...args);
        }
    }

    error(...args) {
        // Toujours logger les erreurs, même en production
        console.error(...args);
    }

    info(...args) {
        if (this.debug) {
            console.info(...args);
        }
    }

    debug(...args) {
        if (this.debug) {
            console.debug(...args);
        }
    }
}

export default Logger;
