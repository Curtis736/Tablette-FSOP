export default class Logger {
    constructor(forceEnabled = false, scope = '') {
        this.forceEnabled = !!forceEnabled;
        this.scope = scope || '';
    }

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

    _scopeOr(firstArg) {
        if (typeof firstArg === 'string') return firstArg;
        return this.scope;
    }

    debug(...args) {
        if (!this.forceEnabled && !Logger.enabled('debug')) return;
        const [first, ...rest] = args;
        if (typeof first === 'string' && first.startsWith('[')) {
            console.log(`[DEBUG]${this.scope ? ' [' + this.scope + ']' : ''}`, first, ...rest);
            return;
        }
        Logger.debug(this._scopeOr(first), ...(typeof first === 'string' ? rest : args));
    }

    info(...args) {
        if (!this.forceEnabled && !Logger.enabled('info')) return;
        const [first, ...rest] = args;
        if (typeof first === 'string' && first.startsWith('[')) {
            console.log(`[INFO]${this.scope ? ' [' + this.scope + ']' : ''}`, first, ...rest);
            return;
        }
        Logger.info(this._scopeOr(first), ...(typeof first === 'string' ? rest : args));
    }

    warn(...args) {
        if (!this.forceEnabled && !Logger.enabled('warn')) return;
        const [first, ...rest] = args;
        if (typeof first === 'string' && first.startsWith('[')) {
            console.warn(`[WARN]${this.scope ? ' [' + this.scope + ']' : ''}`, first, ...rest);
            return;
        }
        Logger.warn(this._scopeOr(first), ...(typeof first === 'string' ? rest : args));
    }

    error(...args) {
        if (!this.forceEnabled && !Logger.enabled('error')) return;
        const [first, ...rest] = args;
        if (typeof first === 'string' && first.startsWith('[')) {
            console.error(`[ERROR]${this.scope ? ' [' + this.scope + ']' : ''}`, first, ...rest);
            return;
        }
        Logger.error(this._scopeOr(first), ...(typeof first === 'string' ? rest : args));
    }

    log(...args) {
        // Compatibilite legacy: logger.log() -> niveau info
        this.info(...args);
    }
}
