/**
 * Constantes de configuration pour AdminPage
 * Remplace les nombres magiques par des valeurs nommées et maintenables
 */
export const ADMIN_CONFIG = {
    // Intervalles de temps (en millisecondes)
    AUTO_SAVE_INTERVAL: 30000,        // 30 secondes
    REFRESH_INTERVAL: 30000,          // 30 secondes
    OPERATORS_UPDATE_INTERVAL: 60000, // 60 secondes
    EDIT_COOLDOWN: 5000,              // 5 secondes
    TIMEOUT_DURATION: 30000,           // 30 secondes
    
    // Cache et retry
    MAX_CONSECUTIVE_ERRORS: 3,
    ALL_OPERATORS_CACHE_AGE: 10 * 60 * 1000, // 10 minutes
    
    // Debounce
    SEARCH_DEBOUNCE_DELAY: 500,       // 500ms pour les filtres de recherche
    
    // Pagination
    DEFAULT_PAGE_SIZE: 25,
    
    // Timeouts pour les requêtes
    REQUEST_TIMEOUT: 30000,
    
    // Délais de mise à jour
    MIN_UPDATE_INTERVAL: 10000,        // 10 secondes minimum entre mises à jour
};

export const STATUS_CODES = {
    EN_COURS: 'EN_COURS',
    EN_PAUSE: 'EN_PAUSE',
    PAUSE: 'PAUSE',
    TERMINE: 'TERMINE',
    NULL: 'NULL',
    VALIDE: 'O',
    EN_ATTENTE: 'A',
    TRANSMIS: 'T',
};

export const STATUS_LABELS = {
    [STATUS_CODES.NULL]: 'NON TRAITÉ',
    [STATUS_CODES.VALIDE]: 'VALIDÉ',
    [STATUS_CODES.EN_ATTENTE]: 'EN ATTENTE',
    [STATUS_CODES.TRANSMIS]: 'TRANSMIS',
    [STATUS_CODES.EN_COURS]: 'En cours',
    [STATUS_CODES.EN_PAUSE]: 'En pause',
    [STATUS_CODES.TERMINE]: 'Terminé',
};

export const IDENT_BADGE_CLASSES = {
    'DEBUT': 'success',
    'PAUSE': 'warning',
    'REPRISE': 'info',
    'FIN': 'secondary',
    'ARRET': 'danger',
};
