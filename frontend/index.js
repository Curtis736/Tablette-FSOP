// Point d'entrée principal de l'application
import App from './components/App.js?v=20260505-session-context-fix';

// Initialiser l'application
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
