/**
 * Utilitaires pour la manipulation sécurisée du DOM
 * Remplace innerHTML par des méthodes sécurisées
 */

/**
 * Crée un élément avec des attributs
 * @param {string} tag - Nom de la balise
 * @param {Object} attributes - Attributs à définir
 * @param {string|Node|Node[]} content - Contenu textuel ou éléments enfants
 * @returns {HTMLElement}
 */
export function createElement(tag, attributes = {}, content = null) {
    const element = document.createElement(tag);
    
    // Définir les attributs
    Object.entries(attributes).forEach(([key, value]) => {
        if (key === 'className') {
            element.className = value;
        } else if (key === 'dataset') {
            Object.entries(value).forEach(([dataKey, dataValue]) => {
                element.dataset[dataKey] = dataValue;
            });
        } else if (key === 'style' && typeof value === 'object') {
            Object.assign(element.style, value);
        } else if (key.startsWith('on') && typeof value === 'function') {
            element.addEventListener(key.substring(2).toLowerCase(), value);
        } else {
            element.setAttribute(key, value);
        }
    });
    
    // Ajouter le contenu
    if (content !== null) {
        if (typeof content === 'string') {
            element.textContent = content;
        } else if (Array.isArray(content)) {
            content.forEach(child => {
                if (child instanceof Node) {
                    element.appendChild(child);
                } else if (typeof child === 'string') {
                    element.appendChild(document.createTextNode(child));
                }
            });
        } else if (content instanceof Node) {
            element.appendChild(content);
        }
    }
    
    return element;
}

/**
 * Crée un élément de tableau (td) de manière sécurisée
 * @param {string|Node} content - Contenu de la cellule
 * @param {Object} attributes - Attributs additionnels
 * @returns {HTMLTableCellElement}
 */
export function createTableCell(content, attributes = {}) {
    const td = createElement('td', attributes);
    
    if (typeof content === 'string') {
        td.textContent = content;
    } else if (content instanceof Node) {
        td.appendChild(content);
    } else if (Array.isArray(content)) {
        content.forEach(item => {
            if (item instanceof Node) {
                td.appendChild(item);
            } else if (typeof item === 'string') {
                td.appendChild(document.createTextNode(item));
            }
        });
    }
    
    return td;
}

/**
 * Crée un bouton de manière sécurisée
 * @param {Object} config - Configuration du bouton
 * @param {string} config.icon - Classe d'icône FontAwesome
 * @param {string} config.title - Titre/tooltip
 * @param {string} config.className - Classes CSS
 * @param {Function} config.onClick - Handler de clic
 * @param {Object} config.dataset - Attributs data-*
 * @returns {HTMLButtonElement}
 */
export function createButton({ icon, title, className = '', onClick, dataset = {} }) {
    const button = createElement('button', {
        type: 'button',
        className: className,
        title: title,
        dataset: dataset,
    });
    
    if (onClick) {
        button.addEventListener('click', onClick);
    }
    
    if (icon) {
        const iconElement = createElement('i', { className: icon });
        button.appendChild(iconElement);
    }
    
    return button;
}

/**
 * Crée un badge de manière sécurisée
 * @param {string} text - Texte du badge
 * @param {string} className - Classes CSS additionnelles
 * @returns {HTMLSpanElement}
 */
export function createBadge(text, className = '') {
    return createElement('span', {
        className: `badge ${className}`.trim(),
    }, text);
}

/**
 * Échappe les caractères HTML pour éviter XSS
 * @param {string} text - Texte à échapper
 * @returns {string}
 */
export function escapeHtml(text) {
    if (typeof text !== 'string') return String(text);
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Vide un élément de manière sécurisée
 * @param {HTMLElement} element - Élément à vider
 */
export function clearElement(element) {
    if (element) {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    }
}
