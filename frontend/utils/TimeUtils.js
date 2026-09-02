// Utilitaires pour la gestion du temps
class TimeUtils {
    // Formater une durée en secondes vers HH:MM:SS
    static formatDuration(seconds) {
        if (typeof seconds !== 'number' || seconds < 0) {
            return '00:00:00';
        }

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // Parser une durée HH:MM:SS vers secondes
    static parseDuration(durationString) {
        if (!durationString || typeof durationString !== 'string') {
            return 0;
        }

        const parts = durationString.split(':');
        if (parts.length === 3) {
            const hours = Number.parseInt(parts[0]) || 0;
            const minutes = Number.parseInt(parts[1]) || 0;
            const seconds = Number.parseInt(parts[2]) || 0;
            return hours * 3600 + minutes * 60 + seconds;
        } else if (parts.length === 2) {
            const minutes = Number.parseInt(parts[0]) || 0;
            const seconds = Number.parseInt(parts[1]) || 0;
            return minutes * 60 + seconds;
        }

        return 0;
    }

    // Formater une date selon les préférences (fuseau horaire Paris)
    static formatDate(date, format = 'DD/MM/YYYY HH:mm') {
        if (!date) return '-';
        
        const d = new Date(date);
        if (Number.isNaN(d.getTime())) return '-';

        // Utiliser fuseau horaire français (Europe/Paris)
        const options = {
            timeZone: 'Europe/Paris',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };

        const formatted = d.toLocaleString('fr-FR', options);
        const [datePart, timePart] = formatted.split(' ');
        const [day, month, year] = datePart.split('/');
        const [hours, minutes, seconds] = timePart.split(':');

        return format
            .replace('DD', day)
            .replace('MM', month)
            .replace('YYYY', year)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    }

    // Formater une date relative (il y a X minutes)
    static formatRelativeTime(date) {
        if (!date) return '-';
        
        const now = new Date();
        const target = new Date(date);
        const diffMs = now - target;
        const diffSeconds = Math.floor(diffMs / 1000);
        const diffMinutes = Math.floor(diffSeconds / 60);
        const diffHours = Math.floor(diffMinutes / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffSeconds < 60) {
            return 'À l\'instant';
        } else if (diffMinutes < 60) {
            return `Il y a ${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`;
        } else if (diffHours < 24) {
            return `Il y a ${diffHours} heure${diffHours > 1 ? 's' : ''}`;
        } else if (diffDays < 7) {
            return `Il y a ${diffDays} jour${diffDays > 1 ? 's' : ''}`;
        } else {
            return this.formatDate(date, 'DD/MM/YYYY');
        }
    }

    // Calculer la différence entre deux dates
    static getTimeDifference(startDate, endDate) {
        if (!startDate || !endDate) return 0;
        
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
        
        return Math.floor((end - start) / 1000); // en secondes
    }

    // Vérifier si une date est aujourd'hui
    static isToday(date) {
        if (!date) return false;
        
        const today = new Date();
        const target = new Date(date);
        
        return today.getDate() === target.getDate() &&
               today.getMonth() === target.getMonth() &&
               today.getFullYear() === target.getFullYear();
    }

    // Vérifier si une date est cette semaine
    static isThisWeek(date) {
        if (!date) return false;
        
        const today = new Date();
        const target = new Date(date);
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);
        
        return target >= startOfWeek && target <= endOfWeek;
    }

    // Obtenir le début de la journée
    static getStartOfDay(date = new Date()) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    // Obtenir la fin de la journée
    static getEndOfDay(date = new Date()) {
        const d = new Date(date);
        d.setHours(23, 59, 59, 999);
        return d;
    }

    // Obtenir le début de la semaine
    static getStartOfWeek(date = new Date()) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Ajuster pour lundi
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    // Obtenir la fin de la semaine
    static getEndOfWeek(date = new Date()) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? 0 : 7); // Ajuster pour dimanche
        d.setDate(diff);
        d.setHours(23, 59, 59, 999);
        return d;
    }

    // Convertir en format ISO pour la base de données
    static toISOString(date = new Date()) {
        return new Date(date).toISOString();
    }

    // Obtenir la date d'aujourd'hui au format YYYY-MM-DD
    static getTodayString() {
        return new Date().toISOString().split('T')[0];
    }

    // Obtenir la date d'hier au format YYYY-MM-DD
    static getYesterdayString() {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
    }

    // Obtenir la date de demain au format YYYY-MM-DD
    static getTomorrowString() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
    }

    // Valider une date
    static isValidDate(date) {
        if (!date) return false;
        const d = new Date(date);
        return d instanceof Date && !Number.isNaN(d.getTime());
    }

    // Obtenir l'âge d'une date en jours
    static getAgeInDays(date) {
        if (!date) return 0;
        const now = new Date();
        const target = new Date(date);
        const diffTime = Math.abs(now - target);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    // Formater une durée en texte lisible
    static formatDurationText(seconds) {
        if (seconds < 60) {
            return `${seconds} seconde${seconds > 1 ? 's' : ''}`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            return `${minutes} minute${minutes > 1 ? 's' : ''}`;
        } else if (seconds < 86400) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            let text = `${hours} heure${hours > 1 ? 's' : ''}`;
            if (minutes > 0) {
                text += ` et ${minutes} minute${minutes > 1 ? 's' : ''}`;
            }
            return text;
        } else {
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            let text = `${days} jour${days > 1 ? 's' : ''}`;
            if (hours > 0) {
                text += ` et ${hours} heure${hours > 1 ? 's' : ''}`;
            }
            return text;
        }
    }
}

export default TimeUtils;
