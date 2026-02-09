// Gestionnaire de notifications
export class NotificationManager {
    constructor() {
        this.notifications = [];
        this.container = null;
        this.createContainer();
        this.setupStyles();
    }

    createContainer() {
        this.container = document.createElement('div');
        this.container.id = 'notification-container';
        this.container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            max-width: 400px;
            pointer-events: none;
        `;
        document.body.appendChild(this.container);
    }

    setupStyles() {
        if (!document.getElementById('notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                .notification {
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    margin-bottom: 10px;
                    padding: 16px 20px;
                    pointer-events: auto;
                    position: relative;
                    transform: translateX(100%);
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    max-width: 100%;
                    word-wrap: break-word;
                }
                
                .notification.show {
                    transform: translateX(0);
                }
                
                .notification.hide {
                    transform: translateX(100%);
                    opacity: 0;
                }
                
                .notification-success {
                    border-left: 4px solid #28a745;
                }
                
                .notification-error {
                    border-left: 4px solid #dc3545;
                }
                
                .notification-warning {
                    border-left: 4px solid #ffc107;
                }
                
                .notification-info {
                    border-left: 4px solid #17a2b8;
                }
                
                .notification-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }
                
                .notification-title {
                    font-weight: 600;
                    font-size: 14px;
                    margin: 0;
                }
                
                .notification-close {
                    background: none;
                    border: none;
                    font-size: 18px;
                    cursor: pointer;
                    color: #666;
                    padding: 0;
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .notification-close:hover {
                    color: #333;
                }
                
                .notification-message {
                    font-size: 13px;
                    color: #666;
                    margin: 0;
                    line-height: 1.4;
                }
                
                .notification-progress {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    height: 3px;
                    background: rgba(0,0,0,0.1);
                    border-radius: 0 0 8px 8px;
                    transition: width linear;
                }
                
                .notification-icon {
                    margin-right: 8px;
                    font-size: 16px;
                }
            `;
            document.head.appendChild(style);
        }
    }

    show(message, type = 'info', options = {}) {
        const notification = {
            id: Date.now() + Math.random(),
            message,
            type,
            title: options.title || this.getDefaultTitle(type),
            duration: options.duration || this.getDefaultDuration(type),
            persistent: options.persistent || false,
            actions: options.actions || []
        };

        this.notifications.push(notification);
        this.renderNotification(notification);
        
        if (!notification.persistent && notification.duration > 0) {
            setTimeout(() => {
                this.hide(notification.id);
            }, notification.duration);
        }

        return notification.id;
    }

    renderNotification(notification) {
        const element = document.createElement('div');
        element.className = `notification notification-${notification.type}`;
        element.dataset.id = notification.id;

        const icon = this.getIcon(notification.type);
        const closeButton = notification.persistent ? '' : 
            `<button class="notification-close" onclick="window.notificationManager.hide(${notification.id})">&times;</button>`;

        element.innerHTML = `
            <div class="notification-header">
                <div style="display: flex; align-items: center;">
                    <span class="notification-icon">${icon}</span>
                    <h4 class="notification-title">${notification.title}</h4>
                </div>
                ${closeButton}
            </div>
            <p class="notification-message">${notification.message}</p>
            ${notification.duration > 0 ? '<div class="notification-progress"></div>' : ''}
        `;

        this.container.appendChild(element);

        // Animation d'entrée
        requestAnimationFrame(() => {
            element.classList.add('show');
        });

        // Barre de progression
        if (notification.duration > 0) {
            const progressBar = element.querySelector('.notification-progress');
            if (progressBar) {
                progressBar.style.width = '100%';
                progressBar.style.transition = `width ${notification.duration}ms linear`;
                setTimeout(() => {
                    progressBar.style.width = '0%';
                }, 10);
            }
        }
    }

    hide(id) {
        const element = this.container.querySelector(`[data-id="${id}"]`);
        if (element) {
            element.classList.add('hide');
            setTimeout(() => {
                if (element.parentNode) {
                    element.parentNode.removeChild(element);
                }
            }, 300);
        }

        this.notifications = this.notifications.filter(n => n.id !== id);
    }

    hideAll() {
        this.notifications.forEach(notification => {
            this.hide(notification.id);
        });
    }

    getDefaultTitle(type) {
        const titles = {
            success: 'Succès',
            error: 'Erreur',
            warning: 'Attention',
            info: 'Information'
        };
        return titles[type] || 'Notification';
    }

    getDefaultDuration(type) {
        const durations = {
            success: 3000,
            error: 5000,
            warning: 4000,
            info: 3000
        };
        return durations[type] || 3000;
    }

    getIcon(type) {
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        return icons[type] || 'ℹ';
    }

    // Méthodes de convenance
    success(message, options = {}) {
        return this.show(message, 'success', options);
    }

    error(message, options = {}) {
        return this.show(message, 'error', options);
    }

    warning(message, options = {}) {
        return this.show(message, 'warning', options);
    }

    info(message, options = {}) {
        return this.show(message, 'info', options);
    }

    // Notifications persistantes
    persistent(message, type = 'info', actions = []) {
        return this.show(message, type, {
            persistent: true,
            actions
        });
    }

    // Confirmation
    confirm(message, onConfirm, onCancel) {
        const id = this.show(message, 'info', {
            persistent: true,
            actions: [
                {
                    text: 'Confirmer',
                    action: () => {
                        this.hide(id);
                        if (onConfirm) onConfirm();
                    },
                    primary: true
                },
                {
                    text: 'Annuler',
                    action: () => {
                        this.hide(id);
                        if (onCancel) onCancel();
                    }
                }
            ]
        });
        return id;
    }
}

// Instance globale
const notificationManager = new NotificationManager();

export default notificationManager;
