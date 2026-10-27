/**
 * Catalogue des types de pause (tablette).
 * Source de vérité applicative — simple et stable pour les compteurs.
 * Pas de notion payé / non payé côté métier affiché.
 *
 * Pause déjeuner (DEJ) :
 * - minimum 45 min toujours déduites
 * - si l'opérateur repointe plus tard → on compte la durée réelle jusqu'au repointage
 */
const DEJ_MIN_MINUTES = 45;

const PAUSE_TYPES = [
    { code: 'P20_PAYEE', label: 'Pause 20 min', expectedMinutes: 20 },
    { code: 'P10', label: 'Pause 10 min', expectedMinutes: 10 },
    { code: 'DEJ', label: 'Pause déjeuner (min. 45 min)', expectedMinutes: DEJ_MIN_MINUTES },
    { code: 'AUTRE', label: 'Autre', expectedMinutes: null },
    { code: 'FORMATION', label: 'Formation', expectedMinutes: null }
];

const PAUSE_TYPE_BY_CODE = Object.fromEntries(PAUSE_TYPES.map((t) => [t.code, t]));

/** Choix du type de pause sur tablette : coupé tant que ENABLE_PAUSE_TYPES n'est pas à true. */
function isPauseTypesEnabled() {
    return String(process.env.ENABLE_PAUSE_TYPES || '').trim().toLowerCase() === 'true';
}

function isValidPauseTypeCode(code) {
    return Boolean(normalizePauseTypeCode(code));
}

function normalizePauseTypeCode(code) {
    const key = String(code || '').trim().toUpperCase();
    // Ancien bouton DEJ45 → même règle que DEJ
    if (key === 'DEJ45') return 'DEJ';
    return PAUSE_TYPE_BY_CODE[key] ? key : null;
}

function getPauseTypeLabel(code) {
    const normalized = normalizePauseTypeCode(code);
    return normalized ? PAUSE_TYPE_BY_CODE[normalized].label : null;
}

/**
 * Minutes comptabilisées pour une pause.
 * DEJ = max(45, durée réelle jusqu'au repointage).
 */
function countedPauseMinutes(code, actualMinutes) {
    const normalized = normalizePauseTypeCode(code);
    const actual = Math.max(0, Math.round(Number(actualMinutes) || 0));
    if (normalized === 'DEJ') return Math.max(DEJ_MIN_MINUTES, actual);
    return actual;
}

/** Opérateurs en pause courte 10 min même en semaine (codes + noms). */
const SHORT_PAUSE_10_OPERATOR_CODES = new Set(['319', '528', '929']);
const SHORT_PAUSE_10_NAME_TOKENS = ['HASSAN', 'HASSANE', 'JOSEPHINE', 'MARIA'];

function normalizePersonKey(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();
}

/**
 * Pause courte 10 min (au lieu de 20) : vendredi pour tous,
 * ou Hassan / Joséphine / Maria en semaine.
 */
function usesShortPause10({ operatorCode, operatorName, at = new Date() } = {}) {
    const day = at instanceof Date ? at.getDay() : new Date(at).getDay();
    if (day === 5) return true; // vendredi

    const code = String(operatorCode || '').trim();
    if (code && SHORT_PAUSE_10_OPERATOR_CODES.has(code)) return true;

    const name = normalizePersonKey(operatorName);
    if (!name) return false;
    // MARIA = mot entier (évite Mariama)
    if (/\bMARIA\b/.test(name)) return true;
    return SHORT_PAUSE_10_NAME_TOKENS.some((token) => {
        if (token === 'MARIA') return false;
        return name.includes(token);
    });
}

function shortPauseType({ operatorCode, operatorName, at = new Date() } = {}) {
    return usesShortPause10({ operatorCode, operatorName, at })
        ? PAUSE_TYPE_BY_CODE.P10
        : PAUSE_TYPE_BY_CODE.P20_PAYEE;
}

/**
 * Catalogue des boutons pause pour un opérateur / jour.
 * Une seule pause courte (P10 ou P20) + DEJ / AUTRE / FORMATION.
 */
function getPauseTypesForOperator({ operatorCode, operatorName, at = new Date() } = {}) {
    const short = shortPauseType({ operatorCode, operatorName, at });
    return PAUSE_TYPES.filter((t) => {
        if (t.code === 'P10' || t.code === 'P20_PAYEE') return t.code === short.code;
        return true;
    });
}

function isPauseTypeAllowedForOperator(pauseTypeCode, ctx = {}) {
    const code = normalizePauseTypeCode(pauseTypeCode);
    if (!code) return false;
    return getPauseTypesForOperator(ctx).some((t) => t.code === code);
}

module.exports = {
    PAUSE_TYPES,
    PAUSE_TYPE_BY_CODE,
    DEJ_MIN_MINUTES,
    /** @deprecated alias — préférer DEJ_MIN_MINUTES */
    DEJ_FIXED_MINUTES: DEJ_MIN_MINUTES,
    SHORT_PAUSE_10_OPERATOR_CODES,
    isPauseTypesEnabled,
    isValidPauseTypeCode,
    normalizePauseTypeCode,
    getPauseTypeLabel,
    countedPauseMinutes,
    usesShortPause10,
    shortPauseType,
    getPauseTypesForOperator,
    isPauseTypeAllowedForOperator
};
