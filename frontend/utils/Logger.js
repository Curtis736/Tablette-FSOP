export default class Logger {
    static _levelValue(level) {
        return ({ debug: 10, info: 20, warn: 30, error: 40 })[level] ?? 20;
    }

    static level() {
        const fromStorage = (typeof localStorage !== 'undefined' && localStorage.getItem('LOG_LEVEL')) || '';
        const fromWindow = (typeof window !== 'undefined' && window.LOG_LEVEL) || '';
        const raw = String(fromStorage || fromWindow || 'info').toLowerCase();
        return ['debug', 'info', 'warn', 'error'].includes(raw) ? raw : 'info';
    }

    static enabled(level) {
        return Logger._levelValue(level) >= Logger._levelValue(Logger.level());
    }

    static child(scope) {
        return {
            debug: (...args) => Logger.debug(scope, ...args),
            info: (...args) => Logger.info(scope, ...args),
            warn: (...args) => Logger.warn(scope, ...args),
            error: (...args) => Logger.error(scope, ...args),
        };
    }

    static debug(scope, ...args) {
        if (!Logger.enabled('debug')) return;
        console.log(`[DEBUG]${scope ? ' [' + scope + ']' : ''}`, ...args);
    }
    static info(scope, ...args) {
        if (!Logger.enabled('info')) return;
        console.log(`[INFO]${scope ? ' [' + scope + ']' : ''}`, ...args);
    }
    static warn(scope, ...args) {
        if (!Logger.enabled('warn')) return;
        console.warn(`[WARN]${scope ? ' [' + scope + ']' : ''}`, ...args);
    }
    static error(scope, ...args) {
        if (!Logger.enabled('error')) return;
        console.error(`[ERROR]${scope ? ' [' + scope + ']' : ''}`, ...args);
    }
}
