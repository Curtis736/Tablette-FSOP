// Point d'entrée principal de l'application
import App from './components/App.js?v=20260309-cache-bust';

// Initialiser l'application
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
