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

module.exports = {
    PAUSE_TYPES,
    PAUSE_TYPE_BY_CODE,
    DEJ_MIN_MINUTES,
    /** @deprecated alias — préférer DEJ_MIN_MINUTES */
    DEJ_FIXED_MINUTES: DEJ_MIN_MINUTES,
    isPauseTypesEnabled,
    isValidPauseTypeCode,
    normalizePauseTypeCode,
    getPauseTypeLabel,
    countedPauseMinutes
};
