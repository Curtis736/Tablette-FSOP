/**
 * Service unifié pour le calcul des durées (aligné avec la logique admin.js)
 * Évite les incohérences entre operators.js, operations.js et admin.js
 */

class DurationCalculationService {
    /**
     * Calculer les durées d'un lancement basé sur les événements
     * Logique alignée avec admin.js (pauses appariées)
     */
    static calculateDurations(events) {
        if (!events || events.length === 0) {
            return {
                totalDuration: 0,
                pauseDuration: 0,
                productiveDuration: 0,
                eventsCount: 0
            };
        }
        
        // Trier les événements par date
        const sortedEvents = events.sort((a, b) => {
            const dateA = new Date(a.CreatedAt || a.DateCreation);
            const dateB = new Date(b.CreatedAt || b.DateCreation);
            return dateA - dateB;
        });
        
        // Trouver les événements clés
        const debutEvent = sortedEvents.find(e => e.Ident === 'DEBUT');
        const finEvent = sortedEvents.find(e => e.Ident === 'FIN');
        const pauseEvents = sortedEvents.filter(e => e.Ident === 'PAUSE');
        const repriseEvents = sortedEvents.filter(e => e.Ident === 'REPRISE');
        
        if (!debutEvent) {
            return {
                totalDuration: 0,
                pauseDuration: 0,
                productiveDuration: 0,
                eventsCount: sortedEvents.length
            };
        }
        
        // Calculer la durée totale
        let totalDuration = 0;
        
        if (finEvent) {
            // Utiliser CreatedAt si disponible, sinon DateCreation
            const startDateTime = new Date(debutEvent.CreatedAt || debutEvent.DateCreation);
            const endDateTime = new Date(finEvent.CreatedAt || finEvent.DateCreation);
            
            // Si les heures sont disponibles, les utiliser pour un calcul plus précis
            if (debutEvent.HeureDebut && finEvent.HeureFin) {
                try {
                    const startDate = new Date(startDateTime);
                    const endDate = new Date(endDateTime);
                    
                    // Fonction helper pour extraire l'heure d'une valeur (string, Date, etc.)
                    const extractTime = (timeValue) => {
                        if (!timeValue) return null;
                        
                        // Si c'est déjà une string au format HH:mm ou HH:mm:ss
                        if (typeof timeValue === 'string') {
                            const match = timeValue.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
                            if (match) {
                                return { hour: parseInt(match[1], 10), minute: parseInt(match[2], 10) };
                            }
                        }
                        
                        // Si c'est un objet Date
                        if (timeValue instanceof Date) {
                            return {
                                hour: timeValue.getHours(),
                                minute: timeValue.getMinutes()
                            };
                        }
                        
                        // Si c'est un objet avec des propriétés hour/minute
                        if (typeof timeValue === 'object' && timeValue.hour !== undefined && timeValue.minute !== undefined) {
                            return {
                                hour: parseInt(timeValue.hour, 10),
                                minute: parseInt(timeValue.minute, 10)
                            };
                        }
                        
                        return null;
                    };
                    
                    const startTime = extractTime(debutEvent.HeureDebut);
                    const endTime = extractTime(finEvent.HeureFin);
                    
                    if (startTime && endTime) {
                        // Créer des dates complètes avec les heures extraites
                        startDate.setHours(startTime.hour, startTime.minute, 0, 0);
                        endDate.setHours(endTime.hour, endTime.minute, 0, 0);
                        
                        // Si l'heure de fin est antérieure à l'heure de début, ajouter un jour
                        if (endDate < startDate) {
                            endDate.setDate(endDate.getDate() + 1);
                        }
                        
                        totalDuration = Math.floor((endDate - startDate) / (1000 * 60)); // en minutes
                    } else {
                        // Si l'extraction a échoué, fallback sur CreatedAt/DateCreation
                        console.warn(`⚠️ Impossible d'extraire les heures de HeureDebut/HeureFin, utilisation de DateCreation`);
                        totalDuration = Math.floor((endDateTime - startDateTime) / (1000 * 60));
                    }
                } catch (error) {
                    console.error('❌ Erreur lors de l\'extraction des heures:', error);
                    // Fallback sur CreatedAt/DateCreation en cas d'erreur
                    totalDuration = Math.floor((endDateTime - startDateTime) / (1000 * 60));
                }
            } else {
                // Fallback sur CreatedAt/DateCreation
                totalDuration = Math.floor((endDateTime - startDateTime) / (1000 * 60));
            }
        } else {
            // Pas de FIN, calculer jusqu'à maintenant
            const startDateTime = new Date(debutEvent.CreatedAt || debutEvent.DateCreation);
            const now = new Date();
            totalDuration = Math.floor((now - startDateTime) / (1000 * 60));
        }
        
        // Calculer le temps de pause (pauses appariées)
        let pauseDuration = 0;
        const minLength = Math.min(pauseEvents.length, repriseEvents.length);
        
        for (let i = 0; i < minLength; i++) {
            const pauseEvent = pauseEvents[i];
            const repriseEvent = repriseEvents[i];
            
            const pauseStart = new Date(pauseEvent.CreatedAt || pauseEvent.DateCreation);
            const pauseEnd = new Date(repriseEvent.CreatedAt || repriseEvent.DateCreation);
            
            pauseDuration += Math.floor((pauseEnd - pauseStart) / (1000 * 60));
        }
        
        // Si plus de pauses que de reprises, ajouter le temps depuis la dernière pause
        if (pauseEvents.length > repriseEvents.length) {
            const lastPause = pauseEvents[pauseEvents.length - 1];
            const pauseStart = new Date(lastPause.CreatedAt || lastPause.DateCreation);
            const now = new Date();
            pauseDuration += Math.floor((now - pauseStart) / (1000 * 60));
        }
        
        const productiveDuration = Math.max(0, totalDuration - pauseDuration);
        
        return {
            totalDuration,
            pauseDuration,
            productiveDuration,
            eventsCount: sortedEvents.length
        };
    }
    
    /**
     * Calculer les durées depuis la base de données (requête SQL)
     */
    static async calculateDurationsFromDB(operatorCode, lancementCode, date = null) {
        const { executeQuery } = require('../config/database');
        
        let query = `
            SELECT 
                Ident,
                HeureDebut,
                HeureFin,
                DateCreation,
                CreatedAt
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE OperatorCode = @operatorCode
              AND CodeLanctImprod = @lancementCode
        `;
        
        const params = { operatorCode, lancementCode };
        
        if (date) {
            query += ` AND CAST(DateCreation AS DATE) = @date`;
            params.date = date;
        } else {
            query += ` AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)`;
        }
        
        query += ` ORDER BY CreatedAt ASC, DateCreation ASC`;
        
        const events = await executeQuery(query, params);
        
        return this.calculateDurations(events);
    }
}

module.exports = DurationCalculationService;


