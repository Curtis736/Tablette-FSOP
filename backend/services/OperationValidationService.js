/**
 * Service de validation et auto-correction des opérations
 * Valide la cohérence des événements, détecte les problèmes et les corrige automatiquement
 */

const { executeQuery, executeNonQuery } = require('../config/database');
const DurationCalculationService = require('./DurationCalculationService');

class OperationValidationService {
    /**
     * Valide l'ordre et la cohérence des événements d'une opération
     * @param {Array} events - Liste des événements
     * @returns {Object} { valid: boolean, errors: Array, warnings: Array }
     */
    static validateOperationEvents(events) {
        const errors = [];
        const warnings = [];
        
        if (!events || events.length === 0) {
            return {
                valid: false,
                errors: ['Aucun événement trouvé'],
                warnings: []
            };
        }
        
        // Trier les événements par date
        const sortedEvents = [...events].sort((a, b) => {
            const dateA = new Date(a.DateCreation || a.CreatedAt);
            const dateB = new Date(b.DateCreation || b.CreatedAt);
            return dateA - dateB;
        });
        
        // Vérifier la présence d'un événement DEBUT
        const debutEvent = sortedEvents.find(e => e.Ident === 'DEBUT');
        if (!debutEvent) {
            errors.push('Événement DEBUT manquant');
        }
        
        // Vérifier l'ordre des événements
        let lastEventType = null;
        for (let i = 0; i < sortedEvents.length; i++) {
            const event = sortedEvents[i];
            const eventType = event.Ident;
            
            // Vérifier les transitions valides
            if (lastEventType) {
                const validTransitions = {
                    'DEBUT': ['PAUSE', 'FIN'],
                    'PAUSE': ['REPRISE', 'FIN'],
                    'REPRISE': ['PAUSE', 'FIN'],
                    'FIN': [] // FIN ne peut être suivi de rien
                };
                
                if (!validTransitions[lastEventType]?.includes(eventType)) {
                    warnings.push(`Transition invalide: ${lastEventType} → ${eventType} à l'index ${i}`);
                }
            }
            
            lastEventType = eventType;
        }
        
        // Vérifier la cohérence PAUSE/REPRISE
        const pauseEvents = sortedEvents.filter(e => e.Ident === 'PAUSE');
        const repriseEvents = sortedEvents.filter(e => e.Ident === 'REPRISE');
        
        if (pauseEvents.length > repriseEvents.length) {
            warnings.push(`${pauseEvents.length - repriseEvents.length} pause(s) sans reprise correspondante`);
        }
        
        if (repriseEvents.length > pauseEvents.length) {
            errors.push(`${repriseEvents.length - pauseEvents.length} reprise(s) sans pause correspondante`);
        }
        
        // Vérifier les heures
        if (debutEvent && debutEvent.HeureDebut) {
            const heureDebut = this.parseTime(debutEvent.HeureDebut);
            if (!heureDebut) {
                warnings.push('Format d\'heure de début invalide');
            }
        }
        
        const finEvent = sortedEvents.find(e => e.Ident === 'FIN');
        if (finEvent && finEvent.HeureFin) {
            const heureFin = this.parseTime(finEvent.HeureFin);
            if (!heureFin) {
                warnings.push('Format d\'heure de fin invalide');
            }
            
            // Vérifier que l'heure de fin est après l'heure de début
            if (debutEvent && debutEvent.HeureDebut && finEvent.HeureFin) {
                const startTime = this.parseTime(debutEvent.HeureDebut);
                const endTime = this.parseTime(finEvent.HeureFin);
                if (startTime && endTime && endTime < startTime) {
                    // Peut être valide si l'opération traverse minuit
                    warnings.push('Heure de fin antérieure à l\'heure de début (vérifier si traverse minuit)');
                }
            }
        }
        
        return {
            valid: errors.length === 0,
            errors,
            warnings,
            events: sortedEvents
        };
    }
    
    /**
     * Auto-corrige les problèmes détectables dans les événements
     * @param {Array} events - Liste des événements
     * @returns {Object} { fixed: boolean, fixedEvents: Array, fixes: Array }
     */
    static autoFixOperationEvents(events) {
        const fixes = [];
        const fixedEvents = [...events];
        
        if (!events || events.length === 0) {
            return { fixed: false, fixedEvents: [], fixes: ['Aucun événement à corriger'] };
        }
        
        // Trier les événements par date
        fixedEvents.sort((a, b) => {
            const dateA = new Date(a.DateCreation || a.CreatedAt);
            const dateB = new Date(b.DateCreation || b.CreatedAt);
            return dateA - dateB;
        });
        
        // Corriger les formats d'heures invalides
        fixedEvents.forEach((event, index) => {
            if (event.Ident === 'DEBUT' && event.HeureDebut) {
                const fixedTime = this.fixTimeFormat(event.HeureDebut);
                if (fixedTime !== event.HeureDebut) {
                    fixes.push(`Correction format heure début: ${event.HeureDebut} → ${fixedTime}`);
                    event.HeureDebut = fixedTime;
                }
            }
            
            if (event.Ident === 'FIN' && event.HeureFin) {
                const fixedTime = this.fixTimeFormat(event.HeureFin);
                if (fixedTime !== event.HeureFin) {
                    fixes.push(`Correction format heure fin: ${event.HeureFin} → ${fixedTime}`);
                    event.HeureFin = fixedTime;
                }
            }
        });
        
        // Corriger les pauses sans reprise (ajouter une reprise automatique si l'opération est terminée)
        const pauseEvents = fixedEvents.filter(e => e.Ident === 'PAUSE');
        const repriseEvents = fixedEvents.filter(e => e.Ident === 'REPRISE');
        const finEvent = fixedEvents.find(e => e.Ident === 'FIN');
        
        if (pauseEvents.length > repriseEvents.length && finEvent) {
            // Si l'opération est terminée et qu'il y a des pauses sans reprise,
            // on considère que la reprise a été faite juste avant le FIN
            // (pas de correction automatique car cela changerait les durées)
            fixes.push(`Note: ${pauseEvents.length - repriseEvents.length} pause(s) sans reprise (durée de pause incluse dans le calcul)`);
        }
        
        return {
            fixed: fixes.length > 0,
            fixedEvents,
            fixes
        };
    }
    
    /**
     * Valide les données avant consolidation
     * @param {string} operatorCode - Code opérateur
     * @param {string} lancementCode - Code lancement
     * @returns {Promise<Object>} { valid: boolean, errors: Array, events: Array }
     */
    static async validateConsolidationData(operatorCode, lancementCode) {
        try {
            // Récupérer tous les événements
            const eventsQuery = `
                SELECT * 
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode = @operatorCode 
                  AND CodeLanctImprod = @lancementCode
                ORDER BY DateCreation ASC, NoEnreg ASC
            `;
            
            const events = await executeQuery(eventsQuery, { operatorCode, lancementCode });
            
            if (events.length === 0) {
                return {
                    valid: false,
                    errors: ['Aucun événement trouvé pour cette opération'],
                    events: []
                };
            }
            
            // Vérifier la présence de DEBUT et FIN
            const debutEvent = events.find(e => e.Ident === 'DEBUT');
            const finEvent = events.find(e => e.Ident === 'FIN');
            
            if (!debutEvent) {
                return {
                    valid: false,
                    errors: ['Événement DEBUT manquant - l\'opération n\'a pas été démarrée'],
                    events
                };
            }
            
            // Si pas d'événement FIN mais que l'opération est marquée comme terminée (Statut = 'TERMINE'),
            // on peut quand même consolider (l'événement FIN sera créé automatiquement si nécessaire)
            if (!finEvent) {
                const hasTerminatedStatus = events.some(e => e.Statut && e.Statut.toUpperCase().includes('TERMIN'));
                if (!hasTerminatedStatus) {
                    return {
                        valid: false,
                        errors: ['Événement FIN manquant et aucun statut TERMINE trouvé'],
                        events
                    };
                }
                // Si on a un statut TERMINE, on peut continuer (l'auto-correction créera le FIN si nécessaire)
                console.log(`⚠️ Pas d'événement FIN mais statut TERMINE trouvé, consolidation possible avec auto-correction`);
            }
            
            // Valider la cohérence des événements
            const validation = this.validateOperationEvents(events);
            
            return {
                valid: validation.valid,
                errors: validation.errors,
                warnings: validation.warnings,
                events: validation.events
            };
            
        } catch (error) {
            console.error('❌ Erreur lors de la validation de consolidation:', error);
            return {
                valid: false,
                errors: [`Erreur lors de la validation: ${error.message}`],
                events: []
            };
        }
    }
    
    /**
     * Valide les données avant transfert
     * @param {number} tempsId - ID de l'enregistrement consolidé
     * @returns {Promise<Object>} { valid: boolean, errors: Array, record: Object }
     */
    static async validateTransferData(tempsId) {
        try {
            // Récupérer l'enregistrement consolidé
            const recordQuery = `
                SELECT *
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                WHERE TempsId = @tempsId
            `;
            
            const records = await executeQuery(recordQuery, { tempsId });
            
            if (records.length === 0) {
                return {
                    valid: false,
                    errors: [`Enregistrement consolidé ${tempsId} non trouvé`],
                    record: null
                };
            }
            
            const record = records[0];
            const errors = [];
            
            // Vérifier que l'enregistrement est validé
            if (record.StatutTraitement !== 'O') {
                errors.push(`L'enregistrement doit être validé (StatutTraitement = 'O') avant transfert. Statut actuel: ${record.StatutTraitement || 'NULL'}`);
            }
            
            // Vérifier la cohérence des durées
            const totalDuration = record.TotalDuration || 0;
            const pauseDuration = record.PauseDuration || 0;
            const productiveDuration = record.ProductiveDuration || 0;
            const calculatedProductive = totalDuration - pauseDuration;
            
            // Tolérance de 1 minute pour les arrondis
            if (Math.abs(productiveDuration - calculatedProductive) > 1) {
                errors.push(`Incohérence des durées: TotalDuration (${totalDuration}) - PauseDuration (${pauseDuration}) = ${calculatedProductive}, mais ProductiveDuration = ${productiveDuration}`);
            }
            
            // Vérifier que les durées sont positives
            if (totalDuration < 0) {
                errors.push(`TotalDuration négatif: ${totalDuration}`);
            }
            
            if (pauseDuration < 0) {
                errors.push(`PauseDuration négatif: ${pauseDuration}`);
            }
            
            if (productiveDuration < 0) {
                errors.push(`ProductiveDuration négatif: ${productiveDuration}`);
            }
            
            // Vérifier que les champs requis sont présents
            if (!record.OperatorCode) {
                errors.push('OperatorCode manquant');
            }
            
            if (!record.LancementCode) {
                errors.push('LancementCode manquant');
            }
            
            if (!record.StartTime) {
                errors.push('StartTime manquant');
            }
            
            if (!record.EndTime) {
                errors.push('EndTime manquant');
            }
            
            return {
                valid: errors.length === 0,
                errors,
                record
            };
            
        } catch (error) {
            console.error('❌ Erreur lors de la validation de transfert:', error);
            return {
                valid: false,
                errors: [`Erreur lors de la validation: ${error.message}`],
                record: null
            };
        }
    }
    
    /**
     * Auto-corrige les données de transfert
     * @param {number} tempsId - ID de l'enregistrement consolidé
     * @returns {Promise<Object>} { fixed: boolean, fixes: Array }
     */
    static async autoFixTransferData(tempsId) {
        try {
            const fixes = [];
            
            // Récupérer l'enregistrement
            const recordQuery = `
                SELECT *
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                WHERE TempsId = @tempsId
            `;
            
            const records = await executeQuery(recordQuery, { tempsId });
            
            if (records.length === 0) {
                return { fixed: false, fixes: ['Enregistrement non trouvé'] };
            }
            
            const record = records[0];
            
            // Corriger les durées incohérentes
            const totalDuration = record.TotalDuration || 0;
            const pauseDuration = record.PauseDuration || 0;
            const productiveDuration = record.ProductiveDuration || 0;
            const calculatedProductive = totalDuration - pauseDuration;
            
            if (Math.abs(productiveDuration - calculatedProductive) > 1) {
                // Recalculer ProductiveDuration
                const updateQuery = `
                    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                    SET ProductiveDuration = @productiveDuration
                    WHERE TempsId = @tempsId
                `;
                
                await executeNonQuery(updateQuery, {
                    tempsId,
                    productiveDuration: Math.max(0, calculatedProductive)
                });
                
                fixes.push(`ProductiveDuration corrigé: ${productiveDuration} → ${calculatedProductive}`);
            }
            
            // Corriger les durées négatives
            if (totalDuration < 0 || pauseDuration < 0 || productiveDuration < 0) {
                const correctedTotal = Math.max(0, totalDuration);
                const correctedPause = Math.max(0, pauseDuration);
                const correctedProductive = Math.max(0, calculatedProductive);
                
                const updateQuery = `
                    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                    SET TotalDuration = @totalDuration,
                        PauseDuration = @pauseDuration,
                        ProductiveDuration = @productiveDuration
                    WHERE TempsId = @tempsId
                `;
                
                await executeNonQuery(updateQuery, {
                    tempsId,
                    totalDuration: correctedTotal,
                    pauseDuration: correctedPause,
                    productiveDuration: correctedProductive
                });
                
                fixes.push(`Durées négatives corrigées`);
            }
            
            return {
                fixed: fixes.length > 0,
                fixes
            };
            
        } catch (error) {
            console.error('❌ Erreur lors de l\'auto-correction de transfert:', error);
            return {
                fixed: false,
                fixes: [`Erreur: ${error.message}`]
            };
        }
    }
    
    /**
     * Parse un format d'heure (HH:mm ou HH:mm:ss)
     * @param {string} timeString - Chaîne d'heure
     * @returns {number|null} Minutes depuis minuit ou null si invalide
     */
    static parseTime(timeString) {
        if (!timeString) return null;
        
        const timeStr = String(timeString).trim();
        const parts = timeStr.split(':');
        
        if (parts.length < 2) return null;
        
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        
        if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return null;
        }
        
        return hours * 60 + minutes;
    }
    
    /**
     * Corrige le format d'heure si nécessaire
     * @param {string} timeString - Chaîne d'heure
     * @returns {string} Heure au format HH:mm
     */
    static fixTimeFormat(timeString) {
        if (!timeString) return '';
        
        const timeStr = String(timeString).trim();
        const parts = timeStr.split(':');
        
        if (parts.length < 2) return timeStr; // Ne peut pas corriger
        
        let hours = parseInt(parts[0], 10);
        let minutes = parseInt(parts[1], 10);
        
        if (isNaN(hours)) hours = 0;
        if (isNaN(minutes)) minutes = 0;
        
        // Normaliser les heures et minutes
        hours = Math.max(0, Math.min(23, hours));
        minutes = Math.max(0, Math.min(59, minutes));
        
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    
    /**
     * Vérifie l'intégrité d'une consolidation
     * @param {number} tempsId - ID de l'enregistrement consolidé
     * @returns {Promise<Object>} { valid: boolean, errors: Array, record: Object }
     */
    static async verifyConsolidation(tempsId) {
        try {
            // Récupérer l'enregistrement consolidé
            const recordQuery = `
                SELECT *
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                WHERE TempsId = @tempsId
            `;
            
            const records = await executeQuery(recordQuery, { tempsId });
            
            if (records.length === 0) {
                return {
                    valid: false,
                    errors: ['Enregistrement consolidé non trouvé'],
                    record: null
                };
            }
            
            const record = records[0];
            const errors = [];
            
            // Vérifier que les événements existent toujours
            const eventsQuery = `
                SELECT COUNT(*) as count
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode = @operatorCode
                  AND CodeLanctImprod = @lancementCode
            `;
            
            const eventsCount = await executeQuery(eventsQuery, {
                operatorCode: record.OperatorCode,
                lancementCode: record.LancementCode
            });
            
            if (eventsCount[0].count !== record.EventsCount) {
                errors.push(`Nombre d'événements incohérent: ${eventsCount[0].count} dans ABHISTORIQUE vs ${record.EventsCount} dans ABTEMPS`);
            }
            
            // Vérifier la cohérence des durées
            const validation = await this.validateTransferData(tempsId);
            if (!validation.valid) {
                errors.push(...validation.errors);
            }
            
            return {
                valid: errors.length === 0,
                errors,
                record
            };
            
        } catch (error) {
            console.error('❌ Erreur lors de la vérification de consolidation:', error);
            return {
                valid: false,
                errors: [`Erreur: ${error.message}`],
                record: null
            };
        }
    }
}

module.exports = OperationValidationService;
