const { createLogger } = require('../utils/logger');

function requestLogger(req, res, next) {
    const requestId = req.audit?.requestId;
    if (requestId) {
        res.setHeader('X-Request-Id', requestId);
    }

    req.log = createLogger({
        requestId,
        method: req.method,
        path: req.originalUrl || req.path,
    });

    next();
}

module.exports = { requestLogger };

