/**
 * Utilitaires communs aux scripts de migration SQL (batches GO + commentaires).
 */

function splitSqlBatches(sqlContent) {
    return String(sqlContent || '')
        .replace(/^\uFEFF/, '')
        .split(/^[ \t]*GO[ \t]*$/gim)
        .map((b) => b.trim());
}

function stripSqlBlockComments(sqlText) {
    const source = String(sqlText || '');
    let out = '';
    let i = 0;
    while (i < source.length) {
        const start = source.indexOf('/*', i);
        if (start === -1) {
            out += source.slice(i);
            break;
        }
        out += source.slice(i, start);
        const end = source.indexOf('*/', start + 2);
        if (end === -1) {
            break;
        }
        i = end + 2;
    }
    return out;
}

function isMeaningfulBatch(batch) {
    const withoutLineComments = String(batch || '').replace(/--[^\n]*$/gm, '');
    return stripSqlBlockComments(withoutLineComments).trim().length > 0;
}

module.exports = {
    splitSqlBatches,
    stripSqlBlockComments,
    isMeaningfulBatch
};
