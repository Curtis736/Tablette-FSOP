// Point d'entrée principal de l'application
import App from './components/App.js?v=20260203-fsop-autolot';

// Initialiser l'application
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
