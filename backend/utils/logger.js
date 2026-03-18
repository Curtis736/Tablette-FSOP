const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function normalizeLevel(raw) {
    const v = String(raw || '').trim().toLowerCase();
    return LEVELS[v] ? v : 'info';
}

function shouldLog(currentLevel, msgLevel) {
    return LEVELS[msgLevel] >= LEVELS[currentLevel];
}

function formatContext(ctx) {
    if (!ctx) return '';
    const parts = [];
    for (const [k, v] of Object.entries(ctx)) {
        if (v === undefined || v === null || v === '') continue;
        parts.push(`${k}=${String(v)}`);
    }
    return parts.length ? ` [${parts.join(' ')}]` : '';
}

function createLogger(baseContext = {}) {
    const level = normalizeLevel(process.env.LOG_LEVEL);
    const ctxStr = formatContext(baseContext);

    const log = (msgLevel, ...args) => {
        if (!shouldLog(level, msgLevel)) return;
        const prefix = `${msgLevel.toUpperCase()}${ctxStr}`;
        const fn = msgLevel === 'debug' || msgLevel === 'info'
            ? console.log
            : (msgLevel === 'warn' ? console.warn : console.error);
        fn(prefix, ...args);
    };

    return {
        level,
        child: (extraCtx = {}) => createLogger({ ...baseContext, ...extraCtx }),
        debug: (...args) => log('debug', ...args),
        info: (...args) => log('info', ...args),
        warn: (...args) => log('warn', ...args),
        error: (...args) => log('error', ...args),
    };
}

module.exports = { createLogger };

