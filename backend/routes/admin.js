const express = require('express');
const { executeQuery, executeProcedure } = require('../config/database');
const moment = require('moment');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/auth');
const dataValidation = require('../services/DataValidationService');
const { getConcurrencyStats } = require('../middleware/concurrencyManager');
const SessionService = require('../services/SessionService');
const { generateRequestId } = require('../middleware/audit');

// IMPORTANT: toutes les routes /api/admin doivent être protégées
router.use(authenticateAdmin);

// Fonction pour valider et récupérer les informations d'un lancement depuis LCTE
async function validateLancement(codeLancement) {
    try {
        console.log(`🔍 Validation du lancement ${codeLancement} dans LCTE...`);
        
        const query = `
            SELECT TOP 1 
                [CodeLancement],
                [CodeArticle],
                [DesignationLct1],
                [CodeModele],
                [DesignationArt1],
                [DesignationArt2]
            FROM [SEDI_ERP].[dbo].[LCTE]
            WHERE [CodeLancement] = @codeLancement
        `;
        
        const result = await executeQuery(query, { codeLancement });
        
        if (result && result.length > 0) {
            const lancement = result[0];
            console.log(` Lancement ${codeLancement} trouvé:`, {
                CodeArticle: lancement.CodeArticle,
                DesignationLct1: lancement.DesignationLct1,
                CodeModele: lancement.CodeModele
            });

            // Enregistrer la consultation du lancement (mapping côté SEDI_APP_INDEPENDANTE)
            try {
                await executeProcedure('sp_RecordLancementConsultation', { CodeLancement: codeLancement });
            } catch (error) {
                // Ne pas faire échouer la requête admin si la procédure n'est pas encore installée
                console.warn(`⚠️ Erreur enregistrement consultation lancement ${codeLancement}:`, error.message);
            }

            return {
                valid: true,
                data: lancement
            };
        } else {
            console.log(` Lancement ${codeLancement} non trouvé dans LCTE`);
            return {
                valid: false,
                error: `Le numéro de lancement ${codeLancement} n'existe pas dans la base de données`
            };
        }
    } catch (error) {
        console.error(' Erreur lors de la validation du lancement:', error);
        return {
            valid: false,
            error: 'Erreur lors de la validation du lancement'
        };
    }
}

// Fonction pour valider et formater une heure au format TIME SQL
function formatTimeForSQL(timeInput) {
    if (!timeInput) return null;
    
    try {
        console.log(`🔧 formatTimeForSQL input: "${timeInput}" (type: ${typeof timeInput})`);
        
        // Si c'est déjà une chaîne au format HH:mm ou HH:mm:ss
        if (typeof timeInput === 'string') {
            // Nettoyer la chaîne (enlever espaces, etc.)
            const cleanTime = timeInput.trim();
            
            // Format HH:mm
            const timeMatch = cleanTime.match(/^(\d{1,2}):(\d{2})$/);
            if (timeMatch) {
                const hours = timeMatch[1].padStart(2, '0');
                const minutes = timeMatch[2];
                const result = `${hours}:${minutes}:00`;
                console.log(`🔧 formatTimeForSQL: ${timeInput} → ${result}`);
                return result;
            }
            
            // Format HH:mm:ss
            const timeWithSecondsMatch = cleanTime.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
            if (timeWithSecondsMatch) {
                const hours = timeWithSecondsMatch[1].padStart(2, '0');
                const minutes = timeWithSecondsMatch[2];
                const seconds = timeWithSecondsMatch[3];
                const result = `${hours}:${minutes}:${seconds}`;
                console.log(`🔧 formatTimeForSQL: ${timeInput} → ${result}`);
                return result;
            }
        }
        
        // Si c'est un objet Date, extraire seulement l'heure avec fuseau horaire français
        if (timeInput instanceof Date) {
            const timeString = timeInput.toLocaleTimeString('fr-FR', {
                timeZone: 'Europe/Paris',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            console.log(`🔧 formatTimeForSQL: Date → ${timeString}`);
            return timeString;
        }
        
        console.warn(`⚠️ Format d'heure non reconnu: ${timeInput}`);
        return null;
    } catch (error) {
        console.error('Erreur formatage heure SQL:', error);
        return null;
    }
}

// Fonction pour convertir une heure en minutes depuis minuit
function timeToMinutes(timeString) {
    if (!timeString) return 0;
    
    const parts = timeString.split(':');
    if (parts.length < 2) return 0;
    
    const hours = parseInt(parts[0]) || 0;
    const minutes = parseInt(parts[1]) || 0;
    
    return hours * 60 + minutes;
}

// Fonction pour valider les heures suspectes (comme 02:00 qui pourrait indiquer un problème)
function validateSuspiciousTime(timeString, context = '') {
    if (!timeString) return { isValid: true, warning: null };
    
    const time = timeString.split(':');
    const hour = parseInt(time[0]);
    const minute = parseInt(time[1]);
    
    // Détecter les heures suspectes
    if (hour === 2 && minute === 0) {
        return {
            isValid: true,
            warning: `⚠️ Heure suspecte détectée: ${timeString} ${context}. Cela pourrait indiquer une opération terminée à 2h du matin ou un problème de calcul de durée.`
        };
    }
    
    // Détecter les heures très tardives ou très matinales
    if (hour >= 22 || hour <= 4) {
        return {
            isValid: true,
            warning: `ℹ Heure inhabituelle: ${timeString} ${context}. Vérifiez si cette opération traverse minuit.`
        };
    }
    
    return { isValid: true, warning: null };
}

// Fonction pour formater une date en HH:mm (fuseau horaire Paris)
function formatDateTime(dateTime) {
    if (!dateTime) {
        console.log('🔍 formatDateTime: dateTime est null/undefined');
        return null;
    }
    
    // Si c'est un tableau, prendre le premier élément
    if (Array.isArray(dateTime)) {
        console.log('🔍 formatDateTime: Tableau détecté, utilisation du premier élément');
        if (dateTime.length > 0) {
            dateTime = dateTime[0];
        } else {
            return null;
        }
    }
    
    try {
        // Si c'est déjà une chaîne au format HH:mm ou HH:mm:ss, la retourner directement
        if (typeof dateTime === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(dateTime)) {
            const parts = dateTime.split(':');
            const formattedTime = `${parts[0]}:${parts[1]}`;
            
            // Valider les heures suspectes
            const validation = validateSuspiciousTime(formattedTime, '(format direct)');
            if (validation.warning) {
                console.warn(validation.warning);
            }
            
            return formattedTime;
        }
        
        // Si c'est un objet Date, extraire l'heure avec fuseau horaire français
        if (dateTime instanceof Date) {
            const timeString = dateTime.toLocaleTimeString('fr-FR', {
                timeZone: 'Europe/Paris',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            
            // Valider les heures suspectes
            const validation = validateSuspiciousTime(timeString, '(formatage Date object)');
            if (validation.warning) {
                console.warn(validation.warning);
            }
            
            console.log(`🔍 formatDateTime: Date object -> ${timeString}`);
            return timeString;
        }
        
        // Sinon, essayer de créer un objet Date
        const date = new Date(dateTime);
        if (isNaN(date.getTime())) {
            console.warn('🔍 formatDateTime: Date invalide:', dateTime);
            return null;
        }
        
        // Utiliser fuseau horaire français (Europe/Paris)
        const timeString = date.toLocaleTimeString('fr-FR', {
            timeZone: 'Europe/Paris',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        
        // Valider les heures suspectes
        const validation = validateSuspiciousTime(timeString, '(formatage date)');
        if (validation.warning) {
            console.warn(validation.warning);
        }
        
        console.log(`🔍 formatDateTime: ${dateTime} -> ${timeString}`);
        return timeString;
    } catch (error) {
        console.error('🔍 formatDateTime: Erreur formatage date:', dateTime, error);
        return null;
    }
}

// Fonction pour calculer la durée entre deux dates en minutes
function calculateDuration(startDate, endDate) {
    if (!startDate || !endDate) return null;
    
    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
        
        const diffMs = end.getTime() - start.getTime();
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        
        // Gérer les durées négatives (traversée de minuit)
        if (diffMinutes < 0) {
            console.log(`⚠️ Durée négative détectée: ${startDate} -> ${endDate} (${diffMinutes}min)`);
            // Si la durée est négative, cela peut indiquer une traversée de minuit
            // Dans ce cas, on peut soit retourner null soit ajuster
            return null;
        }
        
        const hours = Math.floor(diffMinutes / 60);
        const minutes = diffMinutes % 60;
        
        // Format amélioré pour les durées longues
        if (hours >= 24) {
            const days = Math.floor(hours / 24);
            const remainingHours = hours % 24;
            if (remainingHours > 0) {
                return `${days}j${remainingHours}h${minutes.toString().padStart(2, '0')}`;
            } else {
                return `${days}j${minutes.toString().padStart(2, '0')}min`;
            }
        } else if (hours > 0) {
            return `${hours}h${minutes.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}min`;
        }
    } catch (error) {
        console.error('Erreur calcul durée:', error);
        return null;
    }
}

// Fonction pour consolider les temps d'un lancement terminé dans ABTEMPS_OPERATEURS
// DÉPRÉCIÉE : Utiliser ConsolidationService.consolidateOperation() à la place
// Conservée pour compatibilité ascendante
async function consolidateLancementTimes(operatorCode, lancementCode) {
    try {
        console.log(`⚠️ consolidateLancementTimes() est dépréciée, utiliser ConsolidationService.consolidateOperation() à la place`);
        
        // Utiliser le nouveau service de consolidation
        const ConsolidationService = require('../services/ConsolidationService');
        const result = await ConsolidationService.consolidateOperation(operatorCode, lancementCode, { autoFix: true });
        
        if (result.success) {
            return result.tempsId;
        } else {
            console.error(`❌ Erreur consolidation: ${result.error}`);
            return null;
        }
    } catch (error) {
        console.error('❌ Erreur consolidation temps:', error);
        return null;
    }
}

// Fonction pour regrouper les événements par lancement sur une seule ligne (sans pauses séparées)
function processLancementEventsSingleLine(events) {
    const lancementGroups = {};
    
    // Regrouper par CodeLanctImprod et CodeRubrique
    events.forEach(event => {
        const key = `${event.CodeLanctImprod}_${event.CodeRubrique}`;
        if (!lancementGroups[key]) {
            lancementGroups[key] = [];
        }
        lancementGroups[key].push(event);
    });
    
    const processedItems = [];
    
    Object.keys(lancementGroups).forEach(key => {
        const groupEvents = lancementGroups[key].sort((a, b) => {
            const da = new Date(a.CreatedAt || a.DateCreation).getTime();
            const db = new Date(b.CreatedAt || b.DateCreation).getTime();
            if (da !== db) return da - db;
            return (a.NoEnreg || 0) - (b.NoEnreg || 0);
        });
        
        console.log(`🔍 Traitement du groupe ${key}:`, groupEvents.map(e => ({
            ident: e.Ident,
            dateCreation: e.DateCreation,
            heureDebut: e.HeureDebut,
            heureFin: e.HeureFin
        })));
        
        // Trouver les événements clés
        // ⚠️ Important: un même opérateur peut faire plusieurs cycles DEBUT..FIN pour le même lancement.
        // Pour l'affichage "actuel" (admin + historique opérateur), on prend toujours le DERNIER cycle,
        // sinon un ancien FIN masque un nouveau DEBUT (et l'admin n'affiche jamais "En cours").
        let lastDebutIdx = -1;
        for (let i = groupEvents.length - 1; i >= 0; i--) {
            if (groupEvents[i]?.Ident === 'DEBUT') {
                lastDebutIdx = i;
                break;
            }
        }
        const cycleEvents = lastDebutIdx >= 0 ? groupEvents.slice(lastDebutIdx) : [];
        const debutEvent = cycleEvents.find(e => e.Ident === 'DEBUT');
        const finEvent = cycleEvents.find(e => e.Ident === 'FIN');
        const pauseEvents = cycleEvents.filter(e => e.Ident === 'PAUSE');
        const repriseEvents = cycleEvents.filter(e => e.Ident === 'REPRISE');
        
        if (debutEvent) {
            let status, statusLabel;
            let endTime = null;
            
            if (finEvent) {
                // DÉMARRÉ → FIN = TERMINÉ
                status = 'TERMINE';
                statusLabel = 'Terminé';
                // Utiliser HeureFin si disponible (déjà converti en VARCHAR(5) par SQL)
                // Sinon utiliser CreatedAt (DATETIME2) plutôt que DateCreation (DATE) pour éviter les problèmes de timezone
                endTime = finEvent.HeureFin ? formatDateTime(finEvent.HeureFin) : formatDateTime(finEvent.CreatedAt || finEvent.DateCreation);
            } else if (pauseEvents.length > 0 && pauseEvents.length > repriseEvents.length) {
                // DÉMARRÉ → PAUSE = EN PAUSE
                status = 'PAUSE';
                statusLabel = 'En pause';
                // Pas d'heure de fin pour une pause en cours
                endTime = null;
            } else {
                // DÉMARRÉ seul = EN COURS
                status = 'EN_COURS';
                statusLabel = 'En cours';
                endTime = null;
            }
            
            console.log(`🔍 Ligne unique pour ${key}:`, status);
            processedItems.push(createLancementItem(debutEvent, groupEvents, status, statusLabel, endTime));
        }
        
        console.log(`🔍 Créé 1 item pour ${key}`);
    });
    
    console.log(`🔍 Total d'items créés: ${processedItems.length}`);
    return processedItems.sort((a, b) => 
        new Date(b.lastUpdate) - new Date(a.lastUpdate)
    );
}

// Fonction pour regrouper les événements par lancement et calculer les temps (évite les doublons)
function processLancementEventsWithPauses(events) {
    const lancementGroups = {};
    
    // 🔒 ISOLATION STRICTE : Regrouper par CodeLanctImprod + OperatorCode + Phase + CodeRubrique
    // Chaque opérateur a son propre historique pour chaque lancement
    // Un même lancement peut avoir plusieurs historiques (un par opérateur)
    events.forEach(event => {
        const phase = (event.Phase || '').toString().trim();
        const rubrique = (event.CodeRubrique || '').toString().trim();
        // Clé unique = Lancement + Opérateur + Étape (garantit l'isolation par fabrication)
        const key = `${event.CodeLanctImprod}_${event.OperatorCode}_${phase}_${rubrique}`;
        if (!lancementGroups[key]) {
            lancementGroups[key] = [];
        }
        lancementGroups[key].push(event);
    });
    
    // Log pour debug si plusieurs opérateurs sur le même lancement
    const lancementByCode = {};
    events.forEach(event => {
        if (!lancementByCode[event.CodeLanctImprod]) {
            lancementByCode[event.CodeLanctImprod] = new Set();
        }
        lancementByCode[event.CodeLanctImprod].add(event.OperatorCode);
    });
    
    Object.keys(lancementByCode).forEach(lancementCode => {
        if (lancementByCode[lancementCode].size > 1) {
            const operators = Array.from(lancementByCode[lancementCode]);
            console.log(`ℹ️ Lancement ${lancementCode} partagé entre ${operators.length} opérateurs: ${operators.join(', ')}`);
            console.log(`   → Chaque opérateur aura son propre historique isolé`);
        }
    });
    
    const processedItems = [];
    
    Object.keys(lancementGroups).forEach(key => {
        const groupEvents = lancementGroups[key].sort((a, b) => {
            const da = new Date(a.CreatedAt || a.DateCreation).getTime();
            const db = new Date(b.CreatedAt || b.DateCreation).getTime();
            if (da !== db) return da - db;
            return (a.NoEnreg || 0) - (b.NoEnreg || 0);
        });
        
        console.log(`🔍 Traitement du groupe ${key}:`, groupEvents.map(e => ({
            ident: e.Ident,
            dateCreation: e.DateCreation,
            heureDebut: e.HeureDebut,
            heureFin: e.HeureFin
        })));
        
        // Logique : une ligne par CYCLE (DEBUT..FIN ou DEBUT..PAUSE/REPRISE), pas seulement la dernière.
        console.log(`🔍 Traitement de ${groupEvents.length} événements pour ${key}`);

        // Identifier tous les indices de DEBUT pour découper en cycles successifs
        const debutIndices = [];
        for (let i = 0; i < groupEvents.length; i++) {
            if (groupEvents[i]?.Ident === 'DEBUT') {
                debutIndices.push(i);
            }
        }

        if (debutIndices.length === 0) {
            console.warn(`⚠️ Aucun DEBUT trouvé pour ${key}, groupe ignoré.`);
            return;
        }

        debutIndices.forEach((startIdx, idx) => {
            const endIdx = (idx + 1 < debutIndices.length) 
                ? debutIndices[idx + 1] - 1 
                : groupEvents.length - 1;
            const cycleEvents = groupEvents.slice(startIdx, endIdx + 1);

            const debutEvent = cycleEvents.find(e => e.Ident === 'DEBUT');
            const finEvent = cycleEvents.find(e => e.Ident === 'FIN');
            const pauseEvents = cycleEvents.filter(e => e.Ident === 'PAUSE');
            const repriseEvents = cycleEvents.filter(e => e.Ident === 'REPRISE');

            // Déterminer le statut final pour CE cycle
            let currentStatus = 'EN_COURS';
            let statusLabel = 'En cours';

            const debutEvents = cycleEvents
                .filter(e => e.Ident === 'DEBUT')
                .sort((a, b) => new Date(b.DateCreation) - new Date(a.DateCreation));
            const lastDebutEvent = debutEvents[0];

            const lastEvent = cycleEvents[cycleEvents.length - 1];

            if (lastEvent && lastEvent.Ident === 'FIN') {
                currentStatus = 'TERMINE';
                statusLabel = 'Terminé';
            } else if (lastEvent && lastEvent.Ident === 'PAUSE') {
                currentStatus = 'EN_PAUSE';
                statusLabel = 'En pause';
                console.log(`✅ Statut déterminé depuis dernier événement PAUSE: ${currentStatus}`);
            } else if (lastEvent && lastEvent.Ident === 'REPRISE') {
                currentStatus = 'EN_COURS';
                statusLabel = 'En cours';
                console.log(`✅ Statut déterminé depuis dernier événement REPRISE: ${currentStatus}`);
            } else if (lastDebutEvent && lastDebutEvent.Statut && lastDebutEvent.Statut.trim() !== '') {
                const dbStatus = lastDebutEvent.Statut.toUpperCase().trim();
                const statusMap = {
                    'EN_COURS': 'En cours',
                    'EN_PAUSE': 'En pause',
                    'PAUSE': 'En pause',
                    'TERMINE': 'Terminé',
                    'TERMINÉ': 'Terminé',
                    'PAUSE_TERMINEE': 'Pause terminée',
                    'PAUSE_TERMINÉE': 'Pause terminée',
                    'FORCE_STOP': 'Arrêt forcé'
                };

                if (statusMap[dbStatus] || dbStatus === 'TERMINE' || dbStatus === 'TERMINÉ') {
                    currentStatus = dbStatus;
                    statusLabel = statusMap[dbStatus] || (dbStatus === 'TERMINE' || dbStatus === 'TERMINÉ' ? 'Terminé' : dbStatus);
                    console.log(`✅ Utilisation du statut de la base de données depuis événement DEBUT: ${currentStatus} (${statusLabel})`);
                } else {
                    currentStatus = 'EN_COURS';
                    statusLabel = 'En cours';
                }
            } else {
                currentStatus = 'EN_COURS';
                statusLabel = 'En cours';
            }

            // Règle: jamais "Terminé" sans FIN explicite
            const statusUpper = String(currentStatus || '').toUpperCase();
            if ((statusUpper === 'TERMINE' || statusUpper === 'TERMINÉ') && !finEvent) {
                console.warn(`⚠️ Statut terminé détecté sans FIN pour ${key} (cycle ${idx}) → forcé à EN_COURS.`);
                currentStatus = 'EN_COURS';
                statusLabel = 'En cours';
            }

            if (debutEvent) {
                let endTime = null;

                if (finEvent) {
                    endTime = finEvent.HeureFin
                        ? formatDateTime(finEvent.HeureFin)
                        : formatDateTime(finEvent.CreatedAt || finEvent.DateCreation);
                }

                console.log(`🔍 Ligne pour ${key}, cycle ${idx}:`, currentStatus);
                console.log(`🔍 Pauses trouvées: ${pauseEvents.length}, Reprises trouvées: ${repriseEvents.length}`);

                processedItems.push(
                    createLancementItem(
                        debutEvent,
                        cycleEvents,
                        currentStatus,
                        statusLabel,
                        endTime,
                        pauseEvents,
                        repriseEvents
                    )
                );
            }
        });
    });
    
    console.log(`🔍 Total d'items créés: ${processedItems.length}`);
    return processedItems.sort((a, b) => 
        new Date(b.lastUpdate) - new Date(a.lastUpdate)
    );
}

// Fonction helper pour créer un item de lancement
function createLancementItem(startEvent, sequence, status, statusLabel, endTime = null, pauseEvents = [], repriseEvents = []) {
    const finEvent = sequence.find(e => e.Ident === 'FIN');
    const pauseEvent = sequence.find(e => e.Ident === 'PAUSE');
    
    // Debug uniquement si problème détecté
    if (startEvent.HeureDebut && typeof startEvent.HeureDebut !== 'string' && !(startEvent.HeureDebut instanceof Date)) {
        console.log(`⚠️ createLancementItem - HeureDebut problématique:`, {
            HeureDebut: startEvent.HeureDebut,
            HeureDebutType: typeof startEvent.HeureDebut,
            Ident: startEvent.Ident
        });
    }
    
    // Traitement sécurisé de l'heure de début
    let startTime;
    // Gérer le cas où HeureDebut est un tableau
    let heureDebut = Array.isArray(startEvent.HeureDebut) ? startEvent.HeureDebut[0] : startEvent.HeureDebut;
    
    if (heureDebut) {
        if (typeof heureDebut === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(heureDebut)) {
            // Format HH:mm ou HH:mm:ss - retourner directement
            startTime = heureDebut.substring(0, 5);
        } else if (heureDebut instanceof Date) {
            // Objet Date - extraire l'heure avec fuseau horaire français
            startTime = heureDebut.toLocaleTimeString('fr-FR', {
                timeZone: 'Europe/Paris',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        } else {
            // Autre format - utiliser formatDateTime
            startTime = formatDateTime(heureDebut);
        }
    } else {
        // Pas d'heure de début - utiliser CreatedAt (DATETIME2) plutôt que DateCreation (DATE) pour éviter les problèmes de timezone
        startTime = formatDateTime(startEvent.CreatedAt || startEvent.DateCreation);
    }
    
    // Debug uniquement si problème détecté
    if (startTime && startTime.includes(':')) {
        const [hours, minutes] = startTime.split(':').map(Number);
        if (hours > 23 || minutes > 59) {
            console.log(`⚠️ startTime problématique:`, startTime);
        }
    }
    
    // Utiliser l'endTime fourni ou calculer selon le contexte
    let finalEndTime;
    if (endTime !== null) {
        // Si endTime est fourni explicitement (cas des pauses terminées), l'utiliser
        finalEndTime = endTime;
    } else if (finEvent) {
        // Pour les opérations terminées, utiliser HeureFin ou DateCreation
        // Gérer le cas où HeureFin est un tableau
        let heureFin = Array.isArray(finEvent.HeureFin) ? finEvent.HeureFin[0] : finEvent.HeureFin;
        
        if (heureFin) {
            if (typeof heureFin === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(heureFin)) {
                // Format HH:mm ou HH:mm:ss - retourner directement
                finalEndTime = heureFin.substring(0, 5);
            } else if (heureFin instanceof Date) {
                // Objet Date - extraire l'heure avec fuseau horaire français
                finalEndTime = heureFin.toLocaleTimeString('fr-FR', {
                    timeZone: 'Europe/Paris',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
            } else {
                // Autre format - utiliser formatDateTime
                finalEndTime = formatDateTime(heureFin);
            }
        } else {
            // Pas d'heure de fin - utiliser CreatedAt (DATETIME2) plutôt que DateCreation (DATE) pour éviter les problèmes de timezone
            finalEndTime = formatDateTime(finEvent.CreatedAt || finEvent.DateCreation);
        }
    } else if (pauseEvent && status === 'PAUSE') {
        // Pour les pauses en cours, pas d'heure de fin
        finalEndTime = null;
    } else {
        // Fallback par défaut
        finalEndTime = null;
    }
    
    // Validation et correction des heures incohérentes
    if (startTime && finalEndTime && startTime.includes(':') && finalEndTime.includes(':')) {
        const [startHours, startMinutes] = startTime.split(':').map(Number);
        const [endHours, endMinutes] = finalEndTime.split(':').map(Number);
        
        const startTotalMinutes = startHours * 60 + startMinutes;
        const endTotalMinutes = endHours * 60 + endMinutes;
        
        // Si l'heure de fin est avant l'heure de début (et pas de traversée de minuit)
        if (endTotalMinutes < startTotalMinutes && endTotalMinutes > 0) {
            console.log(`⚠️ Heures incohérentes détectées: ${startTime} -> ${finalEndTime}`);
            console.log(`🔧 Correction: heure de fin mise à null pour éviter l'incohérence`);
            finalEndTime = null; // Mettre à null plutôt qu'une heure incorrecte
        }
    }
    
    // Debug uniquement si problème détecté
    if (finalEndTime && finalEndTime.includes(':')) {
        const [hours, minutes] = finalEndTime.split(':').map(Number);
        if (hours > 23 || minutes > 59) {
            console.log(`⚠️ finalEndTime problématique:`, finalEndTime);
        }
    }
    
    // Utiliser CreatedAt pour les calculs de durée (plus précis que DateCreation)
    const duration = finalEndTime ? 
        calculateDuration(startEvent.CreatedAt || startEvent.DateCreation, new Date(finalEndTime)) : null;
    
    return {
        id: startEvent.NoEnreg,
        operatorId: startEvent.OperatorCode,
        operatorName: startEvent.operatorName || 'Non assigné',
        lancementCode: startEvent.CodeLanctImprod,
        article: startEvent.Article || 'N/A',
        phase: startEvent.Phase,
        codeRubrique: startEvent.CodeRubrique || null,
        startTime: startTime,
        endTime: finalEndTime,
        // pauseEvent.DateCreation peut être un DATE => utiliser CreatedAt pour l'heure réelle
        pauseTime: pauseEvent ? formatDateTime(pauseEvent.CreatedAt || pauseEvent.DateCreation) : null,
        duration: duration,
        pauseDuration: null,
        status: statusLabel,
        statusCode: status,
        generalStatus: status,
        events: sequence.length,
        // lastUpdate doit être une datetime fiable pour le tri
        lastUpdate: finEvent ? (finEvent.CreatedAt || finEvent.DateCreation) : (pauseEvent ? (pauseEvent.CreatedAt || pauseEvent.DateCreation) : (startEvent.CreatedAt || startEvent.DateCreation)),
        type: (status === 'PAUSE' || status === 'PAUSE_TERMINEE') ? 'pause' : 'lancement'
    };
}

// Fonction originale pour regrouper les événements par lancement et calculer les temps
function processLancementEvents(events) {
    const lancementGroups = {};
    
    // Regrouper par CodeLanctImprod et CodeRubrique
    events.forEach(event => {
        const key = `${event.CodeLanctImprod}_${event.CodeRubrique}`;
        if (!lancementGroups[key]) {
            lancementGroups[key] = [];
        }
        lancementGroups[key].push(event);
    });
    
    const processedLancements = [];
    
    Object.keys(lancementGroups).forEach(key => {
        // Trier par CreatedAt si disponible (datetime réelle), sinon DateCreation
        const groupEvents = lancementGroups[key].sort((a, b) => {
            const da = a.CreatedAt || a.DateCreation;
            const db = b.CreatedAt || b.DateCreation;
            return new Date(da) - new Date(db);
        });
        
        // Trouver les événements clés
        const debutEvent = groupEvents.find(e => e.Ident === 'DEBUT');
        const finEvent = groupEvents.find(e => e.Ident === 'FIN');
        const pauseEvents = groupEvents.filter(e => e.Ident === 'PAUSE');
        const repriseEvents = groupEvents.filter(e => e.Ident === 'REPRISE');
        
        // Déterminer le statut de la ligne principale (jamais "EN PAUSE")
        let currentStatus = 'EN_COURS';
        let statusLabel = 'En cours';
        
        if (finEvent) {
            currentStatus = 'TERMINE';
            statusLabel = 'Terminé';
        } else {
            // La ligne principale ne doit jamais être "EN PAUSE"
            // Elle reste "EN COURS" même si il y a des pauses
            currentStatus = 'EN_COURS';
            statusLabel = 'En cours';
        }
        
        // Calculer les temps
        // Utiliser CreatedAt (DATETIME2) plutôt que DateCreation (DATE) pour éviter les problèmes de timezone
        // DateCreation est souvent DATE (00:00Z => 01:00 Paris). Utiliser CreatedAt si possible.
        const startTime = debutEvent ? formatDateTime(debutEvent.CreatedAt || debutEvent.DateCreation) : null;
        const endTime = finEvent ? formatDateTime(finEvent.CreatedAt || finEvent.DateCreation) : null;
        // Utiliser CreatedAt pour les calculs de durée (plus précis que DateCreation)
        const duration = (debutEvent && finEvent) ? 
            calculateDuration(debutEvent.CreatedAt || debutEvent.DateCreation, finEvent.CreatedAt || finEvent.DateCreation) : null;
        
        // Calculer le temps de pause total
        let totalPauseTime = 0;
        for (let i = 0; i < Math.min(pauseEvents.length, repriseEvents.length); i++) {
            const pauseStart = new Date(pauseEvents[i].CreatedAt || pauseEvents[i].DateCreation);
            const pauseEnd = new Date(repriseEvents[i].CreatedAt || repriseEvents[i].DateCreation);
            if (!isNaN(pauseStart.getTime()) && !isNaN(pauseEnd.getTime())) {
                totalPauseTime += pauseEnd.getTime() - pauseStart.getTime();
            }
        }
        
        const pauseDuration = totalPauseTime > 0 ? 
            Math.floor(totalPauseTime / (1000 * 60)) + 'min' : null;
        
        // Utiliser le dernier événement pour les infos générales
        const lastEvent = groupEvents[groupEvents.length - 1];
        
        processedLancements.push({
            id: lastEvent.NoEnreg,
            operatorId: lastEvent.CodeRubrique,
            lancementCode: lastEvent.CodeLanctImprod,
            phase: lastEvent.Phase,
            startTime: startTime,
            endTime: endTime,
            pauseTime: pauseEvents.length > 0 ? formatDateTime(pauseEvents[0].CreatedAt || pauseEvents[0].DateCreation) : null,
            duration: duration,
            pauseDuration: pauseDuration,
            status: statusLabel,
            statusCode: currentStatus,
            generalStatus: currentStatus,
            events: groupEvents.length,
            lastUpdate: lastEvent.CreatedAt || lastEvent.DateCreation,
            type: 'lancement' // Ligne principale toujours de type 'lancement'
        });
    });
    
    return processedLancements.sort((a, b) => 
        new Date(b.lastUpdate) - new Date(a.lastUpdate)
    );
}

// GET /api/admin - Route racine admin
router.get('/', async (req, res) => {
    try {
        console.log('🚀 DEBUT route /api/admin');

        // Éviter le cache (sinon le navigateur peut recevoir 304 sans body JSON)
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        const { date } = req.query;
        const targetDate = date || moment().format('YYYY-MM-DD');
        
        // Récupérer les statistiques
        const stats = await getAdminStats(targetDate);
        
        // Récupérer les opérations (première page seulement pour la vue d'ensemble)
        const operationsResult = await getAdminOperations(targetDate, 1, 25);
        
        res.json({
            stats,
            operations: operationsResult.operations || [],
            pagination: operationsResult.pagination || null,
            date: targetDate
        });
        
    } catch (error) {
        console.error('Erreur lors de la récupération des données admin:', error);
        res.status(500).json({ 
            error: 'Erreur lors de la récupération des données admin' 
        });
    }
});

// GET /api/admin/operations - Récupérer les opérations pour l'interface admin
router.get('/operations', async (req, res) => {
    try {
        const { date, page = 1, limit = 25 } = req.query;
        const targetDate = date || moment().format('YYYY-MM-DD');
        
        // Éviter le cache
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        const result = await getAdminOperations(targetDate, parseInt(page), parseInt(limit));
        console.log('🎯 Envoi des opérations admin:', result.operations?.length || 0, 'éléments');
        res.json(result);
        
    } catch (error) {
        console.error('Erreur lors de la récupération des opérations:', error);
        res.status(500).json({ 
            error: 'Erreur lors de la récupération des opérations' 
        });
    }
});

// GET /api/admin/stats - Récupérer uniquement les statistiques
router.get('/stats', async (req, res) => {
    try {
        const { date } = req.query;
        const targetDate = date || moment().format('YYYY-MM-DD');
        
        const stats = await getAdminStats(targetDate);
        res.json(stats);
        
    } catch (error) {
        console.error('Erreur lors de la récupération des statistiques:', error);
        res.status(500).json({ 
            error: 'Erreur lors de la récupération des statistiques' 
        });
    }
});

// GET /api/admin/concurrency-stats - Statistiques de concurrence
router.get('/concurrency-stats', (req, res) => {
    try {
        const stats = getConcurrencyStats();
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            concurrency: stats,
            recommendations: {
                maxConcurrentConnections: 20,
                currentLoad: `${stats.totalActiveOperations}/20`,
                status: stats.totalActiveOperations > 15 ? 'HIGH_LOAD' : 'NORMAL'
            }
        });
    } catch (error) {
        console.error('❌ Erreur récupération stats concurrence:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération des statistiques de concurrence'
        });
    }
});

// GET /api/admin/export/:format - Exporter les données
router.get('/export/:format', async (req, res) => {
    try {
        const { format } = req.params;
        const { date } = req.query;
        const targetDate = date || moment().format('MM-DD');
        
        if (format !== 'csv') {
            return res.status(400).json({ 
                error: 'Format non supporté. Utilisez csv.' 
            });
        }
        
        const operations = await getAdminOperations(targetDate);
        
        // Générer CSV
        const csvHeader = 'ID,Opérateur,Code Lancement,Article,Date,Statut\n';
        const csvData = operations.map(op => 
            `${op.id},"${op.operatorName}","${op.lancementCode}","${op.article}","${op.startTime}","${op.status}"`
        ).join('\n');
        
            res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="operations-${targetDate}.csv"`);
        res.send(csvHeader + csvData);
        
    } catch (error) {
        console.error('Erreur lors de l\'export des données:', error);
        res.status(500).json({ 
            error: 'Erreur lors de l\'export des données' 
        });
    }
});

// Fonction pour récupérer les statistiques avec les vraies tables
async function getAdminStats(date) {
    try {
        // Compter les opérateurs actifs (connectés OU avec lancement en cours)
        // IMPORTANT:
        // Ne pas compter "actif" si un ancien DEBUT (Statut=EN_COURS) existe mais qu'un FIN est arrivé après.
        // On se base uniquement sur le DERNIER événement de la journée par opérateur.
        const operatorsQuery = `
            WITH last_per_operator AS (
                SELECT
                    h.OperatorCode,
                    h.Ident,
                    h.Statut,
                    ROW_NUMBER() OVER (
                        PARTITION BY h.OperatorCode
                        ORDER BY h.DateCreation DESC, h.NoEnreg DESC
                    ) AS rn
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h WITH (NOLOCK)
                -- ⚡ SARGABLE date filter (avoid CAST(DateCreation AS DATE) which can force scans)
                WHERE h.DateCreation >= CONVERT(date, GETDATE())
                  AND h.DateCreation <  DATEADD(day, 1, CONVERT(date, GETDATE()))
                  AND h.OperatorCode IS NOT NULL
                  AND LTRIM(RTRIM(h.OperatorCode)) <> ''
                  AND h.OperatorCode <> '0'
            )
            SELECT COUNT(DISTINCT active_operators.OperatorCode) AS totalOperators
            FROM (
                -- Opérateurs connectés (session ACTIVE)
                SELECT s.OperatorCode
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] s WITH (NOLOCK)
                WHERE s.SessionStatus = 'ACTIVE'
                  AND s.DateCreation >= CONVERT(date, GETDATE())
                  AND s.DateCreation <  DATEADD(day, 1, CONVERT(date, GETDATE()))

                UNION

                -- Opérateurs avec une opération réellement en cours (dernier event != FIN/TERMINE)
                SELECT l.OperatorCode
                FROM last_per_operator l
                WHERE l.rn = 1
                  AND UPPER(LTRIM(RTRIM(COALESCE(l.Ident, '')))) <> 'FIN'
                  AND UPPER(LTRIM(RTRIM(COALESCE(l.Statut, '')))) IN ('EN_COURS', 'EN_PAUSE')
            ) active_operators
        `;
        
        // Récupérer les événements depuis ABHISTORIQUE_OPERATEURS pour la date spécifiée
        // Utiliser la même logique que getAdminOperations pour la cohérence
        const targetDate = date ? moment(date).format('YYYY-MM-DD') : moment().format('YYYY-MM-DD');
        
        // Utiliser le service de validation pour récupérer les événements (même source que le tableau)
        // ⚡ Perf: filtrer directement côté SQL sur la journée demandée (sinon scan de tout l'historique)
        const validationResult = await dataValidation.getAdminDataSecurely(targetDate);
        
        // Exécuter la requête des opérateurs en parallèle
        const [operatorStats] = await Promise.all([
            executeQuery(operatorsQuery)
        ]);
        
        if (!validationResult.valid) {
            console.error('❌ Erreur de validation des données pour les statistiques:', validationResult.error);
            return {
                totalOperators: operatorStats[0]?.totalOperators || 0,
                activeLancements: 0,
                pausedLancements: 0,
                completedLancements: 0
            };
        }
        
        const allEvents = validationResult.events;
        
        // Filtrer les événements par date (par défaut, utiliser aujourd'hui)
        // IMPORTANT: DateCreation est renvoyé en 'YYYY-MM-DD' (string) pour éviter les décalages timezone.
        let filteredEvents = allEvents.filter(event => String(event.DateCreation || '') === targetDate);

        // Exclure les opérations déjà transmises (StatutTraitement = 'T') pour ne pas les afficher dans le dashboard
        try {
            const transmittedQuery = `
                SELECT OperatorCode, LancementCode, Phase, CodeRubrique
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] WITH (NOLOCK)
                WHERE StatutTraitement = 'T'
                  -- ABTEMPS.DateCreation is stored as DATE (see insertion), keep predicate sargable
                  AND DateCreation = @date
            `;
            const transmitted = await executeQuery(transmittedQuery, { date: targetDate });
            const transmittedSet = new Set(
                transmitted.map(t => `${t.OperatorCode}_${t.LancementCode}_${String(t.Phase || '').trim()}_${String(t.CodeRubrique || '').trim()}`)
            );
            filteredEvents = filteredEvents.filter(e => {
                const k = `${e.OperatorCode}_${e.CodeLanctImprod}_${String(e.Phase || '').trim()}_${String(e.CodeRubrique || '').trim()}`;
                return !transmittedSet.has(k);
            });
        } catch (e) {
            console.warn('⚠️ Impossible de filtrer les opérations transmises pour les stats:', e.message);
        }
        
        console.log(` Calcul des statistiques pour ${filteredEvents.length} événements (date: ${targetDate})`);
        
        // Utiliser la même fonction que getAdminOperations pour la cohérence
        const processedLancements = processLancementEventsWithPauses(filteredEvents);
        
        console.log(`📊 ${processedLancements.length} lancements traités pour les statistiques`);
        
        // Compter par statut (utiliser statusCode pour plus de fiabilité)
        // Debug: afficher les statuts trouvés
        const statusCounts = {};
        processedLancements.forEach(l => {
            const key = `${l.statusCode || 'NO_CODE'}_${l.status || 'NO_STATUS'}_${l.statusLabel || 'NO_LABEL'}`;
            statusCounts[key] = (statusCounts[key] || 0) + 1;
        });
        console.log('📊 Répartition des statuts:', statusCounts);
        
        const activeLancements = processedLancements.filter(l => 
            l.statusCode === 'EN_COURS' || 
            (l.status && (l.status.toLowerCase() === 'en cours' || l.status === 'En cours')) ||
            (l.statusLabel && l.statusLabel.toLowerCase() === 'en cours')
        ).length;
        
        const pausedLancements = processedLancements.filter(l => 
            l.statusCode === 'EN_PAUSE' || l.statusCode === 'PAUSE' ||
            (l.status && (l.status.toLowerCase().includes('pause') || l.status === 'En pause')) ||
            (l.statusLabel && l.statusLabel.toLowerCase().includes('pause'))
        ).length;
        
        const completedLancements = processedLancements.filter(l => 
            l.statusCode === 'TERMINE' ||
            (l.status && (l.status.toLowerCase().includes('terminé') || l.status.toLowerCase().includes('termine'))) ||
            (l.statusLabel && (l.statusLabel.toLowerCase().includes('terminé') || l.statusLabel.toLowerCase().includes('termine')))
        ).length;
        
        console.log(`📊 Statistiques calculées:`, {
            active: activeLancements,
            paused: pausedLancements,
            completed: completedLancements,
            total: processedLancements.length
        });
    
        return {
            totalOperators: operatorStats[0]?.totalOperators || 0,
            activeLancements: activeLancements,
            pausedLancements: pausedLancements,
            completedLancements: completedLancements
        };
    } catch (error) {
        console.error('Erreur lors de la récupération des statistiques:', error);
    return {
            totalOperators: 0,
            activeLancements: 0,
            pausedLancements: 0,
            completedLancements: 0
        };
    }
}

// Fonction pour récupérer les opérations basées sur les événements ABHISTORIQUE_OPERATEURS
function buildInParams(values, prefix) {
    const params = {};
    const placeholders = [];
    (values || []).forEach((v, i) => {
        const key = `${prefix}${i}`;
        params[key] = v;
        placeholders.push(`@${key}`);
    });
    return { params, placeholders: placeholders.join(', ') };
}

async function getFabricationMapForLaunches(lancements) {
    // Map: `${CodeLancement}_${Phase}_${CodeRubrique}` -> "CodeOperation" (or joined list)
    const unique = [...new Set((lancements || []).map(x => String(x || '').trim()).filter(Boolean))];
    if (unique.length === 0) return new Map();

    const { params, placeholders } = buildInParams(unique, 'lc');
    const rows = await executeQuery(`
        SELECT DISTINCT
            C.CodeLancement,
            LTRIM(RTRIM(C.Phase)) AS Phase,
            LTRIM(RTRIM(C.CodeRubrique)) AS CodeRubrique,
            LTRIM(RTRIM(C.CodeOperation)) AS CodeOperation
        FROM [SEDI_ERP].[dbo].[LCTC] C
        WHERE C.TypeRubrique = 'O'
          AND C.CodeOperation IS NOT NULL
          AND LTRIM(RTRIM(C.CodeOperation)) <> ''
          AND UPPER(LTRIM(RTRIM(C.CodeOperation))) COLLATE Latin1_General_CI_AI <> 'SECHAGE'
          AND C.CodeLancement IN (${placeholders})
    `, params);

    const acc = new Map(); // key -> Set(CodeOperation)
    (rows || []).forEach(r => {
        const lc = String(r?.CodeLancement || '').trim();
        const ph = String(r?.Phase || '').trim();
        const rub = String(r?.CodeRubrique || '').trim();
        const op = String(r?.CodeOperation || '').trim();
        if (!lc || !op) return;
        const key = `${lc}_${ph}_${rub}`;
        if (!acc.has(key)) acc.set(key, new Set());
        acc.get(key).add(op);
    });

    const out = new Map();
    acc.forEach((set, key) => out.set(key, Array.from(set).join(' / ')));
    return out;
}

async function getAdminOperations(date, page = 1, limit = 25) {
    try {
        console.log('🚀 DEBUT getAdminOperations SÉCURISÉ - date:', date, 'page:', page, 'limit:', limit);
        
        // Utiliser le service de validation pour éviter les mélanges de données
        const targetDate = date ? moment(date).format('YYYY-MM-DD') : moment().format('YYYY-MM-DD');
        // ⚡ Perf: filtrer côté SQL sur la journée demandée
        const validationResult = await dataValidation.getAdminDataSecurely(targetDate);
        
        if (!validationResult.valid) {
            console.error('❌ Erreur de validation des données:', validationResult.error);
            return { operations: [], pagination: null, error: validationResult.error };
        }
        
        const allEvents = validationResult.events;
        console.log('Résultats sécurisés:', allEvents.length, 'événements valides trouvés');
        
        if (validationResult.invalidEvents.length > 0) {
            console.log(`🚨 ${validationResult.invalidEvents.length} événements avec associations invalides ignorés`);
        }
        
        // DIAGNOSTIC : Vérifier les événements pour LT2501136
        const diagnosticEvents = allEvents.filter(e => e.CodeLanctImprod === 'LT2501136');
        if (diagnosticEvents.length > 0) {
            console.log('🔍 DIAGNOSTIC - Événements pour LT2501136:');
            diagnosticEvents.forEach(e => {
                console.log(`  - NoEnreg: ${e.NoEnreg}, OperatorCode: ${e.OperatorCode}, Ident: ${e.Ident}, DateCreation: ${e.DateCreation}`);
            });
        }
        
        // Filtrer par date (défense en profondeur)
        // IMPORTANT: DateCreation est renvoyé en 'YYYY-MM-DD' (string) pour éviter les décalages timezone.
        let filteredEvents = allEvents.filter(event => String(event.DateCreation || '') === targetDate);

        // Ne plus exclure les opérations déjà transmises vers ABTEMPS_OPERATEURS :
        // l'ADMIN doit pouvoir voir et vérifier toutes les opérations de la journée,
        // même après transfert technique (StatutTraitement = 'O' ou 'T').
        // On garde toutefois le try/catch précédent comme référence historique.

        // Regrouper les événements par lancement mais garder les pauses séparées
        console.log('🔍 Événements avant regroupement:', filteredEvents.length);
        // Debug des types d'heures (uniquement si problème détecté)
        const problematicEvents = filteredEvents.filter(e => 
            e.HeureDebut && typeof e.HeureDebut !== 'string' && !(e.HeureDebut instanceof Date)
        );
        if (problematicEvents.length > 0) {
            console.log('⚠️ Événements avec types d\'heures problématiques:', problematicEvents.map(e => ({
                ident: e.Ident,
                lancement: e.CodeLanctImprod,
                heureDebut: e.HeureDebut,
                heureDebutType: typeof e.HeureDebut
            })));
        }
        
        // Utiliser la fonction de regroupement avec pauses séparées
        const processedLancements = processLancementEventsWithPauses(filteredEvents);
        console.log('🔍 Événements après regroupement:', processedLancements.length);
        console.log('🔍 Détail des événements regroupés:', processedLancements.map(p => ({
            lancement: p.lancementCode,
            type: p.type,
            status: p.status,
            startTime: p.startTime,
            endTime: p.endTime
        })));
        
        // Appliquer la pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const limitedLancements = processedLancements.slice(startIndex, endIndex);
        
        const formattedOperations = limitedLancements.map(lancement => {
            // Trouver les informations détaillées depuis les événements
            const relatedEvents = filteredEvents.filter(e => 
                e.CodeLanctImprod === lancement.lancementCode && 
                e.OperatorCode === lancement.operatorId
            );
            
            const firstEvent = relatedEvents[0];
            // Utiliser le nom depuis lancement si disponible, sinon depuis les événements
            const operatorName = lancement.operatorName || firstEvent?.operatorName || `Opérateur ${lancement.operatorId}` || 'Non assigné';
            
            return {
                id: lancement.id,
                operatorId: lancement.operatorId,
                operatorName: operatorName,
                lancementCode: lancement.lancementCode,
                article: firstEvent?.Article || lancement.article || 'N/A',
                articleDetail: firstEvent?.ArticleDetail || lancement.articleDetail || '',
                phase: lancement.phase || null,
                codeRubrique: lancement.codeRubrique || null,
                // Duplicates of same fields with ERP-like casing (used by frontend normalizers)
                Phase: lancement.phase || null,
                CodeRubrique: lancement.codeRubrique || null,
                startTime: lancement.startTime,
                endTime: lancement.endTime,
                pauseTime: lancement.pauseTime,
                duration: lancement.duration,
                pauseDuration: lancement.pauseDuration,
                status: lancement.status,
                statusCode: lancement.statusCode,
                generalStatus: lancement.generalStatus,
                events: lancement.events,
                editable: true
            };
        });

        // Ajouter le libellé de fabrication (CodeOperation) depuis l'ERP via (LT + Phase + CodeRubrique)
        try {
            const lts = [...new Set(formattedOperations.map(o => String(o?.lancementCode || '').trim()).filter(Boolean))];
            const fabMap = await getFabricationMapForLaunches(lts);
            formattedOperations.forEach(o => {
                const key = `${String(o.lancementCode || '').trim()}_${String(o.Phase || o.phase || '').trim()}_${String(o.CodeRubrique || o.codeRubrique || '').trim()}`;
                const fabrication = fabMap.get(key) || '-';
                o.fabrication = fabrication;
                o.Fabrication = fabrication;
            });
        } catch (e) {
            console.warn('⚠️ Impossible d\'enrichir les opérations admin avec la fabrication (CodeOperation):', e.message);
        }

        console.log(`🎯 Envoi de ${formattedOperations.length} lancements regroupés (page ${page}/${Math.ceil(processedLancements.length / limit)})`);
        return {
            operations: formattedOperations,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(processedLancements.length / limit),
                totalItems: processedLancements.length,
                itemsPerPage: limit,
                hasNextPage: page < Math.ceil(processedLancements.length / limit),
                hasPrevPage: page > 1
            }
        };

    } catch (error) {
        console.error('❌ Erreur lors de la récupération des opérations:', error);
        return [];
    }
}

// PUT /api/admin/operations/:id - Modifier une opération
router.put('/operations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { operatorName, lancementCode, article, startTime, endTime } = req.body;
        
        console.log(`🔧 Modification opération ${id}:`, req.body);
        
        // Construire la requête de mise à jour dynamiquement
        const updateFields = [];
        const params = { id: parseInt(id) };
        let formattedEndTimeForFinEvent = null;
        let requestedLancementCode = lancementCode;
        
        // Heures et statut sont modifiables
        if (startTime !== undefined) {
            const formattedStartTime = formatTimeForSQL(startTime);
            if (!formattedStartTime) {
                return res.status(400).json({
                    success: false,
                    error: 'Format d\'heure de début invalide'
                });
            }
            updateFields.push('HeureDebut = @startTime');
            params.startTime = formattedStartTime;
            console.log(`🔧 startTime: ${startTime} -> ${params.startTime}`);
        }
        
        if (endTime !== undefined) {
            const formattedEndTime = formatTimeForSQL(endTime);
            if (!formattedEndTime) {
                return res.status(400).json({
                    success: false,
                    error: 'Format d\'heure de fin invalide'
                });
            }
            params.endTime = formattedEndTime;
            formattedEndTimeForFinEvent = formattedEndTime;
            // Update the current record too (harmless if not FIN),
            // and we'll also propagate to the FIN event after we load the base record.
            updateFields.push('HeureFin = @endTime');
            console.log(`🔧 endTime: ${endTime} -> ${params.endTime}`);
        }
        
        // Modification du statut
        if (req.body.status !== undefined) {
            const validStatuses = ['EN_COURS', 'EN_PAUSE', 'TERMINE', 'PAUSE_TERMINEE', 'FORCE_STOP'];
            if (!validStatuses.includes(req.body.status)) {
                return res.status(400).json({
                    success: false,
                    error: `Statut invalide. Statuts autorisés: ${validStatuses.join(', ')}`
                });
            }
            updateFields.push('Statut = @status');
            params.status = req.body.status;
            console.log(`🔧 status: ${req.body.status}`);
        }
        
        // Validation de cohérence des heures
        if (params.startTime && params.endTime) {
            const startMinutes = timeToMinutes(params.startTime);
            const endMinutes = timeToMinutes(params.endTime);
            
            if (endMinutes < startMinutes) {
                console.warn(`⚠️ Heure de fin (${params.endTime}) antérieure à l'heure de début (${params.startTime})`);
                // Ne pas bloquer, juste avertir
            }
        }
        
        // Normaliser lancementCode si fourni (admin: correction LT)
        if (requestedLancementCode !== undefined) {
            const normalized = String(requestedLancementCode || '').trim().toUpperCase();
            if (!normalized) {
                return res.status(400).json({
                    success: false,
                    error: 'LancementCode invalide (vide)'
                });
            }
            // Format attendu: LT + 7 ou 8 chiffres
            if (!/^LT\d{7,8}$/.test(normalized)) {
            return res.status(400).json({ 
                success: false, 
                    error: 'Format de lancement invalide (attendu: LT1234567 ou LT12345678)'
            });
            }
            requestedLancementCode = normalized;
        }
        
        // 🔒 VÉRIFICATION DE SÉCURITÉ : Vérifier que l'enregistrement existe et récupérer l'OperatorCode
        const checkQuery = `
            SELECT TOP 1
                OperatorCode,
                CodeLanctImprod,
                Ident,
                Phase,
                CodeRubrique,
                DateCreation,
                SessionId,
                RequestId
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE NoEnreg = @id
        `;
        const existing = await executeQuery(checkQuery, { id: parseInt(id) });
        
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Opération non trouvée'
            });
        }
        
        // Si un operatorId est fourni dans le body, vérifier qu'il correspond
        if (req.body.operatorId && req.body.operatorId !== existing[0].OperatorCode) {
            return res.status(403).json({
                success: false,
                error: 'Vous ne pouvez modifier que vos propres opérations',
                security: 'DATA_OWNERSHIP_VIOLATION'
            });
        }

        const base = existing[0];
        const baseOperatorCode = base.OperatorCode;
        let baseLancementCode = base.CodeLanctImprod;
        const baseDate = base.DateCreation; // DATE
        const basePhase = base.Phase;
        const baseCodeRubrique = base.CodeRubrique;
        const baseSessionId = base.SessionId || null;

        // Admin: allow correcting LT for non-consolidated operations by updating the whole step group
        // We update all events for the same (Operator + Phase + CodeRubrique + day), and prefer SessionId when available.
        let didLancementUpdate = false;
        if (requestedLancementCode !== undefined && requestedLancementCode !== String(baseLancementCode || '').trim().toUpperCase()) {
            try {
                if (baseSessionId) {
                    await executeQuery(
                        `UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                         SET CodeLanctImprod = @newLancementCode
                         WHERE OperatorCode = @operatorCode
                           AND SessionId = @sessionId
                           AND Phase = @phase
                           AND CodeRubrique = @codeRubrique
                           AND CAST(DateCreation AS DATE) = CAST(@date AS DATE)`,
                        {
                            newLancementCode: requestedLancementCode,
                            operatorCode: baseOperatorCode,
                            sessionId: baseSessionId,
                            phase: basePhase,
                            codeRubrique: baseCodeRubrique,
                            date: baseDate
                        }
                    );
                } else {
                    await executeQuery(
                        `UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                         SET CodeLanctImprod = @newLancementCode
                         WHERE OperatorCode = @operatorCode
                           AND CodeLanctImprod = @oldLancementCode
                           AND Phase = @phase
                           AND CodeRubrique = @codeRubrique
                           AND CAST(DateCreation AS DATE) = CAST(@date AS DATE)`,
                        {
                            newLancementCode: requestedLancementCode,
                            oldLancementCode: baseLancementCode,
                            operatorCode: baseOperatorCode,
                            phase: basePhase,
                            codeRubrique: baseCodeRubrique,
                            date: baseDate
                        }
                    );
                }
                didLancementUpdate = true;
                baseLancementCode = requestedLancementCode; // Important for FIN propagation below
                console.log(`✅ LancementCode corrigé: ${String(base.CodeLanctImprod || '').trim()} -> ${requestedLancementCode}`);
            } catch (e) {
                console.warn(`⚠️ Impossible de corriger le lancement: ${e.message}`);
                return res.status(500).json({
                    success: false,
                    error: 'Erreur serveur lors de la correction du lancement'
                });
            }
        }

        // If nothing to change (including LT), treat as no-op success
        if (updateFields.length === 0 && !didLancementUpdate) {
            return res.json({
                success: true,
                message: 'Aucune modification',
                noChange: true
            });
        }

        // If user edits endTime, ensure the FIN event is updated (or created) for the same (LT + operator + phase + rubrique + date)
        if (params.endTime && base.Ident !== 'FIN') {
            try {
                const finLookup = `
                    SELECT TOP 1 NoEnreg
                    FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                    WHERE OperatorCode = @operatorCode
                      AND CodeLanctImprod = @lancementCode
                      AND Ident = 'FIN'
                      AND Phase = @phase
                      AND CodeRubrique = @codeRubrique
                      AND CAST(DateCreation AS DATE) = CAST(@date AS DATE)
                    ORDER BY CreatedAt DESC, NoEnreg DESC
                `;
                const finRows = await executeQuery(finLookup, {
                    operatorCode: baseOperatorCode,
                    lancementCode: baseLancementCode,
                    phase: basePhase,
                    codeRubrique: baseCodeRubrique,
                    date: baseDate
                });

                if (finRows.length > 0) {
                    const finId = finRows[0].NoEnreg;
                    await executeQuery(
                        `UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                         SET HeureFin = @endTime
                         WHERE NoEnreg = @id`,
                        { id: finId, endTime: params.endTime }
                    );
                    console.log(`✅ HeureFin propagée sur l'événement FIN NoEnreg=${finId}`);
                } else {
                    // Create FIN event if missing (keeps UI and data consistent)
                    const insertFin = `
                        INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                        (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation, SessionId, RequestId, CreatedAt)
                        VALUES (
                            @operatorCode,
                            @lancementCode,
                            @codeRubrique,
                            'FIN',
                            @phase,
                            'TERMINE',
                            NULL,
                            @endTime,
                            CAST(@date AS DATE),
                            @sessionId,
                            @requestId,
                            GETDATE()
                        )
                    `;
                    await executeQuery(insertFin, {
                        operatorCode: baseOperatorCode,
                        lancementCode: baseLancementCode,
                        codeRubrique: baseCodeRubrique,
                        phase: basePhase,
                        endTime: params.endTime,
                        date: baseDate,
                        sessionId: base.SessionId || null,
                        requestId: base.RequestId || null
                    });
                    console.log(`✅ Événement FIN créé car absent (propagation endTime)`);
                }
            } catch (e) {
                console.warn(`⚠️ Impossible de propager endTime sur FIN: ${e.message}`);
            }
        }

        // 🔒 RÈGLE: interdiction de passer une opération en TERMINE sans endTime (sinon EndTime restera vide)
        const desiredStatus = req.body.status ? String(req.body.status).toUpperCase().trim() : null;
        if (desiredStatus === 'TERMINE' && !formattedEndTimeForFinEvent) {
            return res.status(400).json({
                success: false,
                error: 'Impossible de marquer TERMINE sans heure de fin (endTime).'
            });
        }

        // Si l'enregistrement modifié est un FIN, on peut mettre à jour HeureFin directement sur cette ligne.
        // Sinon (cas le plus courant côté UI: ligne "DEBUT"), on crée/maj l'événement FIN correspondant pour que l'heure de fin s'affiche
        // et que la consolidation dispose d'un FIN réel.
        if (formattedEndTimeForFinEvent && String(base.Ident || '').toUpperCase() === 'FIN') {
            updateFields.push('HeureFin = @endTime');
        }
        
        const updateQuery = `
            UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            SET ${updateFields.join(', ')}
            WHERE NoEnreg = @id
        `;
        
        if (updateFields.length > 0) {
        console.log(`🔧 Requête de mise à jour:`, updateQuery);
        console.log(`🔧 Paramètres:`, params);
            console.log(`🔒 Opération appartenant à l'opérateur: ${baseOperatorCode}`);
        await executeQuery(updateQuery, params);
        }

        // Mettre à jour / créer l'événement FIN si on a reçu endTime et que la ligne modifiée n'est pas FIN
        if (formattedEndTimeForFinEvent && String(base.Ident || '').toUpperCase() !== 'FIN') {
            const findFinQuery = `
                SELECT TOP 1 NoEnreg
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode = @operatorCode
                  AND CodeLanctImprod = @lancementCode
                  AND Ident = 'FIN'
                  AND CAST(DateCreation AS DATE) = CAST(@date AS DATE)
                ORDER BY CreatedAt DESC, NoEnreg DESC
            `;
            const finRows = await executeQuery(findFinQuery, {
                operatorCode: baseOperatorCode,
                lancementCode: baseLancementCode,
                date: baseDate
            });

            if (finRows.length > 0) {
                const finId = finRows[0].NoEnreg;
                console.log(`🔧 Mise à jour FIN existant NoEnreg=${finId} pour ${baseOperatorCode}/${baseLancementCode}`);
                await executeQuery(`
                    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                    SET HeureFin = @endTime,
                        Statut = 'TERMINE'
                    WHERE NoEnreg = @finId
                `, { endTime: formattedEndTimeForFinEvent, finId });
            } else {
                console.log(`➕ Création d'un événement FIN pour ${baseOperatorCode}/${baseLancementCode} (heure fin: ${formattedEndTimeForFinEvent})`);
                await executeQuery(`
                    INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                    (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation, SessionId, RequestId, CreatedAt)
                    VALUES (
                        @operatorCode,
                        @lancementCode,
                        @codeRubrique,
                        'FIN',
                        @phase,
                        'TERMINE',
                        NULL,
                        @endTime,
                        CAST(@date AS DATE),
                        @sessionId,
                        @requestId,
                        DATEADD(SECOND, DATEDIFF(SECOND, '00:00:00', @endTime), CAST(@date AS DATETIME2))
                    )
                `, {
                    operatorCode: baseOperatorCode,
                    lancementCode: baseLancementCode,
                    codeRubrique: base.CodeRubrique || baseOperatorCode,
                    phase: base.Phase || 'ADMIN',
                    endTime: formattedEndTimeForFinEvent,
                    date: baseDate,
                    sessionId: base.SessionId || null,
                    requestId: base.RequestId || null
                });
            }

            // Optionnel: aligner le statut sur la ligne de base pour cohérence d'affichage
            try {
                await executeQuery(`
                    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                    SET Statut = 'TERMINE'
                    WHERE NoEnreg = @id
                `, { id: parseInt(id) });
            } catch (e) {
                // non bloquant
            }

        }
        // Consolider dès qu'une heure de fin a été renseignée (FIN créé ou mis à jour) pour ne pas laisser de lancement non consolidé
        if (formattedEndTimeForFinEvent) {
            try {
                const ConsolidationService = require('../services/ConsolidationService');
                const baseDateStr = base.DateCreation ? (typeof base.DateCreation === 'string' ? base.DateCreation.split('T')[0] : null) : null;
                await ConsolidationService.consolidateOperation(baseOperatorCode, baseLancementCode, {
                    autoFix: true,
                    phase: base.Phase || 'ADMIN',
                    codeRubrique: base.CodeRubrique || baseOperatorCode,
                    dateCreation: baseDateStr || baseDate
                });
            } catch (consErr) {
                console.warn('Consolidation après édition (non bloquant):', consErr?.message || consErr);
            }
        }
        
        console.log(`✅ Opération ${id} modifiée avec succès`);
        
        res.json({
            success: true,
            message: 'Opération modifiée avec succès',
            id: id
        });
        
    } catch (error) {
        console.error('Erreur lors de la modification:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la modification de l\'opération',
            details: error.message
        });
    }
});

// POST /api/admin/operations - Ajouter une nouvelle opération
router.post('/operations', async (req, res) => {
    try {
        const { operatorId, lancementCode, startTime, status = 'DEBUT', phase = '', codeOperation } = req.body;
        
        console.log('=== AJOUT NOUVELLE OPERATION ===');
        console.log('Données reçues:', req.body);

        // Helper: récupérer les étapes ERP pour décider si on doit demander un choix
        // IMPORTANT: une "étape" = (Phase + CodeRubrique). CodeOperation est le libellé / nom de fabrication.
        const getStepsForLaunch = async (lt) => {
            const rows = await executeQuery(`
                SELECT DISTINCT
                    LTRIM(RTRIM(C.CodeOperation)) AS CodeOperation,
                    LTRIM(RTRIM(C.Phase)) AS Phase,
                    LTRIM(RTRIM(C.CodeRubrique)) AS CodeRubrique
                FROM [SEDI_ERP].[dbo].[LCTC] C
                INNER JOIN [SEDI_ERP].[dbo].[LCTE] E
                    ON E.CodeLancement = C.CodeLancement
                    AND E.LancementSolde = 'N'
                WHERE C.CodeLancement = @lancementCode
                  AND C.TypeRubrique = 'O'
                  AND C.CodeOperation IS NOT NULL
                  AND LTRIM(RTRIM(C.CodeOperation)) <> ''
                  -- Ne jamais proposer "Séchage" / "ÉtuVage" (accents/casse ignorés)
                  AND UPPER(LTRIM(RTRIM(C.CodeOperation))) COLLATE Latin1_General_CI_AI NOT IN ('SECHAGE', 'ETUVAGE')
                ORDER BY LTRIM(RTRIM(C.Phase)), LTRIM(RTRIM(C.CodeOperation)), LTRIM(RTRIM(C.CodeRubrique))
            `, { lancementCode: lt });
            const steps = (rows || []).map(s => {
                const phase = String(s?.Phase || '').trim();
                const rubrique = String(s?.CodeRubrique || '').trim();
                const fabrication = String(s?.CodeOperation || '').trim();
                return {
                    ...s,
                    StepId: `${phase}|${rubrique}`,
                    Label: `${phase}${rubrique ? ` (${rubrique})` : ''} — ${fabrication || 'Fabrication'}`
                };
            });
            const uniqueOps = [...new Set(steps.map(s => String(s?.CodeOperation || '').trim()).filter(Boolean))];
            const uniqueSteps = [...new Set(steps.map(s => String(s?.StepId || '').trim()).filter(Boolean))];
            return { steps, uniqueOps, uniqueSteps };
        };

        const resolveStep = async (lt, op) => {
            const { steps, uniqueOps, uniqueSteps } = await getStepsForLaunch(lt);
            const raw = String(op || '').trim();
            if (!raw) return { steps, uniqueOps, uniqueSteps, ctx: steps[0] || null };

            // Support "StepId" = "PHASE|CODERUBRIQUE" (permet de choisir une étape même si CodeOperation est identique)
            if (raw.includes('|')) {
                const [ph, rub] = raw.split('|').map(x => String(x || '').trim());
                const matchByKey = steps.find(s =>
                    String(s?.Phase || '').trim() === ph &&
                    String(s?.CodeRubrique || '').trim() === rub
                );
                return { steps, uniqueOps, uniqueSteps, ctx: matchByKey || null };
            }

            const ctx = steps.find(s => String(s?.CodeOperation || '').trim() === raw) || null;
            return { steps, uniqueOps, uniqueSteps, ctx };
        };
        
        // Valider le numéro de lancement dans LCTE (optionnel pour l'admin)
        const validation = await validateLancement(lancementCode);
        let lancementInfo = null;
        let warning = null;
        
        if (!validation.valid) {
            // Pour l'admin, on permet de créer une opération même si le lancement n'existe pas
            // mais on enregistre un avertissement
            warning = `Attention: Le lancement ${lancementCode} n'existe pas dans la table LCTE. L'opération sera créée mais le lancement devra être créé dans LCTE pour être valide.`;
            console.warn('⚠️', warning);
            lancementInfo = {
                CodeLancement: lancementCode,
                CodeArticle: null,
                DesignationLct1: `Lancement ${lancementCode} (non trouvé dans LCTE)`,
                CodeModele: null,
                DesignationArt1: null,
                DesignationArt2: null
            };
        } else {
            lancementInfo = validation.data;
            console.log('✅ Lancement validé:', lancementInfo);
        }

        // Si lancement valide, appliquer la logique "choisir uniquement si plusieurs étapes (Phase+CodeRubrique)"
        // et résoudre Phase/CodeRubrique depuis l'ERP quand codeOperation est fourni.
        let erpPhase = null;
        let erpRubrique = null;

        if (validation.valid) {
            const { steps, uniqueOps, uniqueSteps, ctx } = await resolveStep(lancementCode, codeOperation);
            if (uniqueSteps.length > 1 && !codeOperation) {
                return res.status(400).json({
                    success: false,
                    error: 'CODE_OPERATION_REQUIRED',
                    message: 'Plusieurs étapes sont disponibles. Choisissez une étape (Phase).',
                    lancementCode,
                    steps,
                    uniqueOperations: uniqueOps,
                    uniqueSteps,
                    stepCount: uniqueSteps.length,
                    operationCount: uniqueOps.length
                });
            }
            if (codeOperation) {
                if (!ctx) {
                    return res.status(400).json({
                        success: false,
                        error: 'INVALID_CODE_OPERATION',
                        message: `CodeOperation invalide pour ${lancementCode}`,
                        lancementCode,
                        received: { codeOperation },
                        steps,
                        uniqueOperations: uniqueOps,
                        uniqueSteps,
                        stepCount: uniqueSteps.length,
                        operationCount: uniqueOps.length
                    });
                }
                erpPhase = ctx.Phase || null;
                erpRubrique = ctx.CodeRubrique || null;
            } else if (uniqueSteps.length === 1) {
                // Auto-sélection implicite pour cohérence des clés ERP (clé = Phase + CodeRubrique)
                const only = steps[0] || null;
                erpPhase = only?.Phase || null;
                erpRubrique = only?.CodeRubrique || null;
            }
        }
        
        // Insérer dans ABHISTORIQUE_OPERATEURS
        // Clés ERP: Phase + CodeRubrique (si disponibles via CodeOperation), sinon fallback admin.
        const codeRubrique = erpRubrique || phase || operatorId;
        const finalStatus = status === 'DEBUT' ? 'EN_COURS' : status === 'FIN' ? 'TERMINE' : status;
        const finalPhase = erpPhase || phase || 'ADMIN';

        // Corrélation requête/session (peut être NULL côté admin si pas de session active)
        const requestId = req.audit?.requestId || generateRequestId();
        const activeSession = operatorId ? await SessionService.getActiveSession(operatorId) : null;
        
        const insertQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation, SessionId, RequestId, CreatedAt)
            OUTPUT INSERTED.NoEnreg
            VALUES (
                @operatorId,
                @lancementCode,
                @codeRubrique,
                @status,
                @phase,
                @finalStatus,
                ${status === 'DEBUT' ? 'CAST(GETDATE() AS TIME)' : 'NULL'},
                ${status === 'FIN' ? 'CAST(GETDATE() AS TIME)' : 'NULL'},
                CAST(GETDATE() AS DATE),
                @sessionId,
                @requestId,
                GETDATE()
            )
        `;
        
        const params = {
            operatorId,
            lancementCode,
            codeRubrique,
            status,
            phase: finalPhase,
            finalStatus,
            sessionId: activeSession ? activeSession.SessionId : null,
            requestId
        };
        
        console.log('Requête SQL à exécuter:', insertQuery);
        console.log('Paramètres:', params);
        
        const insertResult = await executeQuery(insertQuery, params);
        const insertedId = insertResult && insertResult[0] ? insertResult[0].NoEnreg : null;
        
        console.log('✅ Opération ajoutée avec succès dans ABHISTORIQUE_OPERATEURS, ID:', insertedId);
        
        // Si c'est une fin de lancement, consolider les temps
        if (status === 'FIN' || status === 'TERMINE') {
            await consolidateLancementTimes(operatorId, lancementCode);
        }
        
        res.json({
            success: true,
            message: warning ? 'Opération ajoutée avec succès (avec avertissement)' : 'Opération ajoutée avec succès',
            warning: warning || null,
            data: {
                id: insertedId,
                operatorId,
                lancementCode,
                phase,
                lancementInfo: lancementInfo
            }
        });
        
    } catch (error) {
        console.error('❌ ERREUR lors de l\'ajout:', error);
        console.error('Message d\'erreur:', error.message);
        console.error('Stack:', error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Erreur lors de l\'ajout de l\'opération',
            details: error.message
        });
    }
});

// DELETE /api/admin/operations/:id - Supprimer une opération complète (tous les événements du lancement)
router.delete('/operations/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`🗑️ Suppression opération ${id} (type: ${typeof id})`);
        
        // D'abord, récupérer les informations du lancement à partir de l'ID
        const getLancementQuery = `
            SELECT CodeLanctImprod, OperatorCode, Phase, CodeRubrique
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE NoEnreg = @id
        `;
        
        const lancementInfo = await executeQuery(getLancementQuery, { id: parseInt(id) });
        
        console.log(`🔍 Résultat de la requête pour ID ${id}:`, lancementInfo);
        
        if (lancementInfo.length === 0) {
            console.log(`❌ Aucune opération trouvée avec l'ID ${id}`);
            return res.status(404).json({
                success: false,
                error: 'Opération non trouvée'
            });
        }
        
        const { CodeLanctImprod, OperatorCode, Phase, CodeRubrique } = lancementInfo[0];
        
        // Compatibilité:
        // - Nouveau modèle: OperatorCode est renseigné, CodeRubrique = vrai code rubrique ERP
        // - Ancien modèle: OperatorCode parfois NULL et CodeRubrique contenait le code opérateur
        const operatorCodeToUse = (OperatorCode || '').toString().trim() || (CodeRubrique || '').toString().trim();

        // Détection heuristique "legacy": OperatorCode absent + CodeRubrique ressemble à un code opérateur numérique
        const isLegacy = !OperatorCode && typeof CodeRubrique === 'string' && /^\d+$/.test(CodeRubrique.trim());

        if (!operatorCodeToUse) {
            console.warn(`⚠️ Suppression impossible: OperatorCode/CodeRubrique manquants pour NoEnreg=${id}`);
            return res.status(400).json({
                success: false,
                error: 'Impossible de déterminer le code opérateur pour supprimer cette opération'
            });
        }

        if (isLegacy) {
            console.log(`🗑️ Suppression (legacy) des événements pour ${CodeLanctImprod} (opérateur via CodeRubrique=${operatorCodeToUse})`);
        
            // Ancien modèle: supprimer tous les événements du lancement pour cet opérateur (stocké dans CodeRubrique)
            const deleteLegacyQuery = `
            DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE CodeLanctImprod = @lancementCode
                  AND OperatorCode IS NULL
                  AND CodeRubrique = @operatorCode
        `;
        
            await executeQuery(deleteLegacyQuery, {
            lancementCode: CodeLanctImprod, 
            operatorCode: operatorCodeToUse 
        });
        } else {
            console.log(`🗑️ Suppression (par étape) pour ${CodeLanctImprod} (opérateur=${operatorCodeToUse}, phase=${Phase || 'NULL'}, rubrique=${CodeRubrique || 'NULL'})`);

            // Nouveau modèle: supprimer tous les événements pour CETTE étape (Phase+CodeRubrique) du lancement et opérateur
            const deleteStepQuery = `
                DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE CodeLanctImprod = @lancementCode
                  AND (
                        OperatorCode = @operatorCode
                        OR (OperatorCode IS NULL AND CodeRubrique = @operatorCode) -- compatibilité si des lignes ont encore OperatorCode NULL
                      )
                  AND ( (Phase = @phase) OR (@phase IS NULL AND Phase IS NULL) )
                  AND ( (CodeRubrique = @codeRubrique) OR (@codeRubrique IS NULL AND CodeRubrique IS NULL) )
            `;

            await executeQuery(deleteStepQuery, {
                lancementCode: CodeLanctImprod,
                operatorCode: operatorCodeToUse,
                phase: Phase ?? null,
                codeRubrique: CodeRubrique ?? null
            });
        }

        // Vérifier s'il reste des événements pour ce "scope" (utile pour debug)
        const remainingQuery = isLegacy
            ? `
                SELECT COUNT(*) AS remaining
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE CodeLanctImprod = @lancementCode
                  AND OperatorCode IS NULL
                  AND CodeRubrique = @operatorCode
              `
            : `
                SELECT COUNT(*) AS remaining
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE CodeLanctImprod = @lancementCode
                  AND (
                        OperatorCode = @operatorCode
                        OR (OperatorCode IS NULL AND CodeRubrique = @operatorCode)
                      )
                  AND ( (Phase = @phase) OR (@phase IS NULL AND Phase IS NULL) )
                  AND ( (CodeRubrique = @codeRubrique) OR (@codeRubrique IS NULL AND CodeRubrique IS NULL) )
              `;

        const remaining = await executeQuery(remainingQuery, {
            lancementCode: CodeLanctImprod,
            operatorCode: operatorCodeToUse,
            phase: Phase ?? null,
            codeRubrique: CodeRubrique ?? null
        });

        const remainingCount = remaining?.[0]?.remaining ?? null;
        console.log(`✅ Suppression terminée. remaining=${remainingCount}`);
        
        res.json({
            success: true,
            message: 'Opération supprimée avec succès',
            remaining: remainingCount
        });
        
    } catch (error) {
        console.error('Erreur lors de la suppression:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la suppression de l\'opération'
        });
    }
});

// Route pour récupérer les opérateurs connectés depuis ABSESSIONS_OPERATEURS
router.get('/operators', async (req, res) => {
    try {
        // Éviter le cache (sinon le navigateur peut recevoir 304 sans body JSON)
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        console.log('🔍 Récupération des opérateurs connectés depuis ABSESSIONS_OPERATEURS...');

        // IMPORTANT:
        // On considère "connecté" un opérateur qui a une session ACTIVE,
        // et "en opération" uniquement si le DERNIER événement du jour n'est pas FIN/TERMINE.
        // (Sinon, un ancien DEBUT (Statut=EN_COURS) ferait apparaître l'opérateur actif alors qu'il a terminé.)
        const operatorsQuery = `
            WITH active_sessions AS (
                SELECT DISTINCT s.OperatorCode, s.LoginTime, s.SessionStatus, s.DeviceInfo
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] s WITH (NOLOCK)
                WHERE s.SessionStatus = 'ACTIVE'
                  -- ⚡ SARGABLE date filter
                  AND s.DateCreation >= CONVERT(date, GETDATE())
                  AND s.DateCreation <  DATEADD(day, 1, CONVERT(date, GETDATE()))
            ),
            last_per_operator AS (
                SELECT
                    h.OperatorCode,
                    h.Ident,
                    h.Statut,
                    h.DateCreation,
                    h.NoEnreg,
                    ROW_NUMBER() OVER (
                        PARTITION BY h.OperatorCode
                        ORDER BY h.DateCreation DESC, h.NoEnreg DESC
                    ) AS rn
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h WITH (NOLOCK)
                WHERE h.DateCreation >= CONVERT(date, GETDATE())
                  AND h.DateCreation <  DATEADD(day, 1, CONVERT(date, GETDATE()))
                  AND h.OperatorCode IS NOT NULL
                  AND LTRIM(RTRIM(h.OperatorCode)) <> ''
                  AND h.OperatorCode <> '0'
            ),
            last_event AS (
                SELECT OperatorCode, Ident, Statut, DateCreation, NoEnreg
                FROM last_per_operator
                WHERE rn = 1
            ),
            all_operators AS (
                -- Liste: opérateurs avec session active OU avec une opération réellement en cours
                SELECT OperatorCode FROM active_sessions
                UNION
                SELECT le.OperatorCode
                FROM last_event le
                WHERE UPPER(LTRIM(RTRIM(COALESCE(le.Ident, '')))) <> 'FIN'
                  AND UPPER(LTRIM(RTRIM(COALESCE(le.Statut, '')))) IN ('EN_COURS', 'EN_PAUSE')
            )
            SELECT
                ao.OperatorCode AS OperatorCode,
                COALESCE(r.Designation1, 'Opérateur ' + CAST(ao.OperatorCode AS VARCHAR)) AS NomOperateur,
                s.LoginTime,
                COALESCE(s.SessionStatus, 'ACTIVE') AS SessionStatus,
                CASE
                    WHEN le.OperatorCode IS NOT NULL
                         AND UPPER(LTRIM(RTRIM(COALESCE(le.Ident, '')))) <> 'FIN'
                         AND UPPER(LTRIM(RTRIM(COALESCE(le.Statut, '')))) IN ('EN_COURS', 'EN_PAUSE')
                    THEN 'EN_OPERATION'
                    WHEN s.OperatorCode IS NOT NULL THEN 'CONNECTE'
                    ELSE 'INACTIVE'
                END AS ActivityStatus,
                COALESCE(s.LoginTime, le.DateCreation) AS LastActivityTime,
                r.Coderessource AS RessourceCode,
                s.DeviceInfo,
                CASE
                    WHEN le.OperatorCode IS NOT NULL
                         AND UPPER(LTRIM(RTRIM(COALESCE(le.Ident, '')))) <> 'FIN'
                         AND UPPER(LTRIM(RTRIM(COALESCE(le.Statut, '')))) IN ('EN_COURS', 'EN_PAUSE')
                    THEN 'EN_OPERATION'
                    WHEN s.OperatorCode IS NOT NULL THEN 'CONNECTE'
                    ELSE 'INACTIVE'
                END AS CurrentStatus
            FROM all_operators ao
            LEFT JOIN active_sessions s
              ON ao.OperatorCode = s.OperatorCode
            LEFT JOIN last_event le
              ON ao.OperatorCode = le.OperatorCode
            LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r WITH (NOLOCK)
              ON ao.OperatorCode = r.Coderessource
            ORDER BY ao.OperatorCode
        `;

        const operators = await executeQuery(operatorsQuery);
        
        console.log(`✅ ${operators.length} opérateurs connectés récupérés`);

        res.json({
            success: true,
            operators: operators.map(op => ({
                code: op.OperatorCode,
                name: op.NomOperateur || `Opérateur ${op.OperatorCode}`,
                loginTime: op.LoginTime,
                status: op.SessionStatus,
                activityStatus: op.ActivityStatus || 'INACTIVE',
                lastActivityTime: op.LastActivityTime,
                currentStatus: op.CurrentStatus,
                resourceCode: op.RessourceCode,
                deviceInfo: op.DeviceInfo,
                // Validation de l'association
                isProperlyLinked: op.RessourceCode === op.OperatorCode,
                isActive: op.CurrentStatus === 'EN_OPERATION'
            }))
        });

    } catch (error) {
        console.error('❌ Erreur lors de la récupération des opérateurs:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération des opérateurs connectés',
            details: error.message
        });
    }
});

// Route pour récupérer tous les opérateurs (liste globale depuis RESSOURC)
router.get('/operators/all', async (req, res) => {
    try {
        // Éviter le cache
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        console.log('🔍 Récupération de tous les opérateurs depuis RESSOURC...');

        const allOperatorsQuery = `
            SELECT TOP 500
                r.Coderessource as OperatorCode,
                r.Designation1 as NomOperateur,
                r.Typeressource,
                CASE 
                    WHEN s.OperatorCode IS NOT NULL THEN 'CONNECTE'
                    ELSE 'INACTIVE'
                END as ConnectionStatus,
                s.LoginTime,
                s.SessionStatus
            FROM [SEDI_ERP].[dbo].[RESSOURC] r
            LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] s 
                ON r.Coderessource = s.OperatorCode 
                AND s.SessionStatus = 'ACTIVE'
            WHERE r.Typeressource IN ('OP', 'OPERATEUR', 'O')
            ORDER BY r.Coderessource
        `;

        const allOperators = await executeQuery(allOperatorsQuery);
        
        console.log(`✅ ${allOperators.length} opérateurs globaux récupérés`);

        res.json({
            success: true,
            operators: allOperators.map(op => ({
                code: op.OperatorCode,
                name: op.NomOperateur || `Opérateur ${op.OperatorCode}`,
                type: op.Typeressource,
                isConnected: op.ConnectionStatus === 'CONNECTE',
                loginTime: op.LoginTime,
                sessionStatus: op.SessionStatus
            }))
        });

    } catch (error) {
        console.error('❌ Erreur lors de la récupération de tous les opérateurs:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération de tous les opérateurs',
            details: error.message
        });
    }
});

// Route pour résoudre les conflits de lancements
router.post('/resolve-conflict', async (req, res) => {
    try {
        const { lancementCode, action, operatorId } = req.body;
        
        if (!lancementCode || !action) {
            return res.status(400).json({
                success: false,
                error: 'lancementCode et action sont requis'
            });
        }

        if (action === 'force-stop') {
            // Forcer l'arrêt de tous les lancements en cours pour ce code
            const stopQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                SET Statut = 'FORCE_STOP', HeureFin = CAST(GETDATE() AS TIME)
                WHERE CodeLanctImprod = @lancementCode
                AND Statut IN ('EN_COURS', 'EN_PAUSE')
                AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            `;
            
            await executeQuery(stopQuery, { lancementCode });
            
            res.json({
                success: true,
                message: `Tous les lancements ${lancementCode} ont été forcés à l'arrêt`
            });
            
        } else if (action === 'assign-to-operator' && operatorId) {
            // Réassigner le lancement à un opérateur spécifique
            // D'abord arrêter tous les autres
            const stopOthersQuery = `
                UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                SET Statut = 'REASSIGNED', HeureFin = CAST(GETDATE() AS TIME)
                WHERE CodeLanctImprod = @lancementCode
                AND Statut IN ('EN_COURS', 'EN_PAUSE')
                AND OperatorCode != @operatorId
                AND CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            `;
            
            await executeQuery(stopOthersQuery, { lancementCode, operatorId });
            
            res.json({
                success: true,
                message: `Lancement ${lancementCode} réassigné à l'opérateur ${operatorId}`
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Action non reconnue'
            });
        }

    } catch (error) {
        console.error('❌ Erreur lors de la résolution du conflit:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la résolution du conflit',
            details: error.message
        });
    }
});

// Route pour nettoyage complet manuel
router.post('/cleanup-all', async (req, res) => {
    try {
        console.log('🧹 Nettoyage complet manuel...');
        
        // Importer et exécuter le script de nettoyage
        const { performFullCleanup } = require('../scripts/auto-cleanup');
        await performFullCleanup();
        
        res.json({
            success: true,
            message: 'Nettoyage complet terminé avec succès',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Erreur lors du nettoyage complet:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du nettoyage complet',
            details: error.message
        });
    }
});

// Route pour nettoyer les sessions expirées
router.post('/cleanup-sessions', async (req, res) => {
    try {
        console.log('🧹 Nettoyage des sessions expirées...');
        
        // Supprimer les sessions de plus de 24h
        const cleanupQuery = `
            DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
            WHERE DateCreation < DATEADD(hour, -24, GETDATE())
        `;
        
        const result = await executeQuery(cleanupQuery);
        console.log('✅ Sessions expirées supprimées');
        
        // Compter les sessions restantes
        const countQuery = `
            SELECT COUNT(*) as activeSessions
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
            WHERE SessionStatus = 'ACTIVE'
        `;
        
        const countResult = await executeQuery(countQuery);
        const activeSessions = countResult[0].activeSessions;
        
        res.json({
            success: true,
            message: `Nettoyage des sessions terminé: ${activeSessions} sessions actives restantes`,
            activeSessions: activeSessions
        });
        
    } catch (error) {
        console.error('❌ Erreur lors du nettoyage des sessions:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du nettoyage des sessions',
            details: error.message
        });
    }
});

// Route pour terminer les opérations orphelines (actives sans opérateur connecté)
router.post('/cleanup-orphan-operations', async (req, res) => {
    try {
        console.log('🧹 Nettoyage des opérations orphelines...');
        
        // Trouver les opérations actives sans session active
        const findOrphanQuery = `
            SELECT 
                h.NoEnreg,
                h.OperatorCode,
                h.CodeLanctImprod,
                h.Statut,
                h.DateCreation,
                h.HeureDebut
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
            LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] s 
                ON h.OperatorCode = s.OperatorCode 
                AND s.SessionStatus = 'ACTIVE'
                AND CAST(s.DateCreation AS DATE) = CAST(GETDATE() AS DATE)
            WHERE h.Statut IN ('EN_COURS', 'EN_PAUSE')
                AND CAST(h.DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                AND s.OperatorCode IS NULL
                AND h.OperatorCode IS NOT NULL
                AND h.OperatorCode != ''
                AND h.OperatorCode != '0'
        `;
        
        const orphanOperations = await executeQuery(findOrphanQuery);
        console.log(`🔍 ${orphanOperations.length} opérations orphelines trouvées`);
        
        if (orphanOperations.length === 0) {
            return res.json({
                success: true,
                message: 'Aucune opération orpheline trouvée',
                terminatedCount: 0
            });
        }
        
        // Terminer ces opérations
        const terminateQuery = `
            UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            SET Statut = 'TERMINE',
                HeureFin = CAST(GETDATE() AS TIME)
            WHERE NoEnreg IN (
                SELECT h.NoEnreg
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
                LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] s 
                    ON h.OperatorCode = s.OperatorCode 
                    AND s.SessionStatus = 'ACTIVE'
                    AND CAST(s.DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                WHERE h.Statut IN ('EN_COURS', 'EN_PAUSE')
                    AND CAST(h.DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                    AND s.OperatorCode IS NULL
                    AND h.OperatorCode IS NOT NULL
                    AND h.OperatorCode != ''
                    AND h.OperatorCode != '0'
            )
        `;
        
        await executeQuery(terminateQuery);
        
        console.log(`✅ ${orphanOperations.length} opérations orphelines terminées`);
        
        res.json({
            success: true,
            message: `${orphanOperations.length} opération(s) orpheline(s) terminée(s)`,
            terminatedCount: orphanOperations.length,
            operations: orphanOperations.map(op => ({
                id: op.NoEnreg,
                operatorCode: op.OperatorCode,
                lancementCode: op.CodeLanctImprod,
                status: op.Statut
            }))
        });
        
    } catch (error) {
        console.error('❌ Erreur lors du nettoyage des opérations orphelines:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du nettoyage des opérations orphelines',
            details: error.message
        });
    }
});

// Route pour nettoyer les doublons d'opérations
router.post('/cleanup-duplicates', async (req, res) => {
    try {
        console.log('🧹 Nettoyage des doublons d\'opérations...');
        
        // Identifier les doublons (même opérateur, même lancement, même jour)
        const duplicatesQuery = `
            SELECT 
                OperatorCode,
                CodeLanctImprod,
                CAST(DateCreation AS DATE) as DateOp,
                COUNT(*) as count
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            WHERE OperatorCode IS NOT NULL 
                AND OperatorCode != ''
                AND OperatorCode != '0'
            GROUP BY OperatorCode, CodeLanctImprod, CAST(DateCreation AS DATE)
            HAVING COUNT(*) > 1
            ORDER BY count DESC
        `;
        
        const duplicates = await executeQuery(duplicatesQuery);
        console.log(`🔍 ${duplicates.length} groupes de doublons trouvés`);
        
        let cleanedCount = 0;
        
        for (const duplicate of duplicates) {
            // Récupérer tous les événements du groupe
            const groupQuery = `
                SELECT *
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode = @operatorCode
                    AND CodeLanctImprod = @lancementCode
                    AND CAST(DateCreation AS DATE) = @dateOp
                ORDER BY DateCreation ASC, NoEnreg ASC
            `;
            
            const groupEvents = await executeQuery(groupQuery, {
                operatorCode: duplicate.OperatorCode,
                lancementCode: duplicate.CodeLanctImprod,
                dateOp: duplicate.DateOp
            });
            
            console.log(`🔍 Groupe ${duplicate.OperatorCode}_${duplicate.CodeLanctImprod}: ${groupEvents.length} événements`);
            
            // Garder seulement le premier événement de chaque type
            const keptEvents = [];
            const seenTypes = new Set();
            
            for (const event of groupEvents) {
                const eventKey = `${event.Ident}_${event.Phase}`;
                if (!seenTypes.has(eventKey)) {
                    keptEvents.push(event);
                    seenTypes.add(eventKey);
                }
            }
            
            // Supprimer les événements en doublon
            const eventsToDelete = groupEvents.filter(event => 
                !keptEvents.some(kept => kept.NoEnreg === event.NoEnreg)
            );
            
            if (eventsToDelete.length > 0) {
                const deleteIds = eventsToDelete.map(e => e.NoEnreg).join(',');
                const deleteQuery = `
                    DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                    WHERE NoEnreg IN (${deleteIds})
                `;
                
                await executeQuery(deleteQuery);
                cleanedCount += eventsToDelete.length;
                console.log(`✅ Supprimé ${eventsToDelete.length} doublons pour ${duplicate.OperatorCode}_${duplicate.CodeLanctImprod}`);
            }
        }
        
        res.json({
            success: true,
            message: `Nettoyage terminé: ${cleanedCount} doublons supprimés`,
            cleanedCount: cleanedCount,
            duplicateGroups: duplicates.length
        });
        
    } catch (error) {
        console.error('❌ Erreur lors du nettoyage des doublons:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du nettoyage des doublons',
            details: error.message
        });
    }
});

// ============================================
// TESTING HELPERS (safe purge, no DROP)
// ============================================
// ⚠️ Disabled by default. To enable: set ALLOW_TEST_PURGE=true on the backend container.
// Purpose: allow re-running tests by deleting ONLY rows in ABHISTORIQUE_OPERATEURS / ABTEMPS_OPERATEURS (and optionally sessions)
// without dropping tables.
router.post('/testing/purge', async (req, res) => {
    try {
        if (String(process.env.ALLOW_TEST_PURGE || '').toLowerCase() !== 'true') {
            return res.status(403).json({
                success: false,
                error: 'TEST_PURGE_DISABLED',
                message: 'Purge test désactivée. Définissez ALLOW_TEST_PURGE=true côté backend pour l\'autoriser.'
            });
        }

        const {
            scope = 'today', // 'today' | 'range' | 'all'
            dateStart,
            dateEnd,
            lancementCode,
            lancementPrefix,
            operatorCode,
            includeSessions = false,
            confirm
        } = req.body || {};

        if (confirm !== 'PURGE') {
            return res.status(400).json({
                success: false,
                error: 'CONFIRM_REQUIRED',
                message: 'Pour éviter une suppression accidentelle, envoyez { confirm: \"PURGE\" }.'
            });
        }

        if (!['today', 'range', 'all'].includes(scope)) {
            return res.status(400).json({ success: false, error: 'INVALID_SCOPE' });
        }

        const prefix = (lancementPrefix || '').trim() || null;
        const lt = (lancementCode || '').trim().toUpperCase() || null;
        const op = (operatorCode || '').trim() || null;

        // Date boundaries
        let dStart = null;
        let dEnd = null;
        if (scope === 'today') {
            dStart = moment().format('YYYY-MM-DD');
            dEnd = moment().format('YYYY-MM-DD');
        } else if (scope === 'range') {
            if (!dateStart || !dateEnd) {
                return res.status(400).json({ success: false, error: 'DATE_RANGE_REQUIRED' });
            }
            dStart = moment(dateStart).format('YYYY-MM-DD');
            dEnd = moment(dateEnd).format('YYYY-MM-DD');
        } else if (scope === 'all') {
            // keep nulls -> delete without date filter (still can be constrained by LT/operator)
        }

        // Final safety: if scope=all and no filters, refuse
        if (scope === 'all' && !lt && !prefix && !op) {
            return res.status(400).json({
                success: false,
                error: 'REFUSED',
                message: 'Refusé: scope=all sans filtre. Fournissez lancementCode, lancementPrefix ou operatorCode.'
            });
        }

        const whereHistorique = [];
        const whereTemps = [];
        const params = {};

        if (op) {
            whereHistorique.push('OperatorCode = @operatorCode');
            whereTemps.push('OperatorCode = @operatorCode');
            params.operatorCode = op;
        }

        if (lt) {
            whereHistorique.push('CodeLanctImprod = @lancementCode');
            whereTemps.push('LancementCode = @lancementCode');
            params.lancementCode = lt;
        } else if (prefix) {
            whereHistorique.push('CodeLanctImprod LIKE @prefix');
            whereTemps.push('LancementCode LIKE @prefix');
            params.prefix = `${prefix.trim().toUpperCase()}%`;
        }

        if (dStart && dEnd) {
            whereHistorique.push('CAST(DateCreation AS DATE) BETWEEN @dateStart AND @dateEnd');
            whereTemps.push('CAST(DateCreation AS DATE) BETWEEN @dateStart AND @dateEnd');
            params.dateStart = dStart;
            params.dateEnd = dEnd;
        }

        const whereHistSql = whereHistorique.length ? `WHERE ${whereHistorique.join(' AND ')}` : '';
        const whereTempsSql = whereTemps.length ? `WHERE ${whereTemps.join(' AND ')}` : '';

        // Counts first
        const countHist = await executeQuery(
            `SELECT COUNT(*) AS c FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] ${whereHistSql}`,
            params
        );
        const countTemps = await executeQuery(
            `SELECT COUNT(*) AS c FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] ${whereTempsSql}`,
            params
        );

        const histC = countHist?.[0]?.c ?? 0;
        const tempsC = countTemps?.[0]?.c ?? 0;

        // Delete (no DROP)
        await executeQuery(
            `DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] ${whereHistSql}`,
            params
        );
        await executeQuery(
            `DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] ${whereTempsSql}`,
            params
        );

        let sessionsC = 0;
        if (includeSessions) {
            const whereSess = [];
            const sessParams = {};
            if (op) {
                whereSess.push('OperatorCode = @operatorCode');
                sessParams.operatorCode = op;
            }
            if (dStart && dEnd) {
                whereSess.push('CAST(DateCreation AS DATE) BETWEEN @dateStart AND @dateEnd');
                sessParams.dateStart = dStart;
                sessParams.dateEnd = dEnd;
            }
            const whereSessSql = whereSess.length ? `WHERE ${whereSess.join(' AND ')}` : '';
            const countSess = await executeQuery(
                `SELECT COUNT(*) AS c FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] ${whereSessSql}`,
                sessParams
            );
            sessionsC = countSess?.[0]?.c ?? 0;
            await executeQuery(
                `DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] ${whereSessSql}`,
                sessParams
            );
        }

        return res.json({
            success: true,
            message: 'Purge test effectuée',
            deleted: {
                ABHISTORIQUE_OPERATEURS: histC,
                ABTEMPS_OPERATEURS: tempsC,
                ABSESSIONS_OPERATEURS: sessionsC
            },
            scope,
            filters: {
                operatorCode: op || null,
                lancementCode: lt || null,
                lancementPrefix: prefix || null,
                dateStart: dStart,
                dateEnd: dEnd
            }
        });
    } catch (error) {
        console.error('❌ Erreur purge test:', error);
        return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: error.message });
    }
});

// ============================================
// PRODUCTION: Reset historique (DANGEROUS)
// ============================================
// But: démarrer une nouvelle phase (prod) sans historique opérateur.
// Sécurités:
// - nécessite auth admin (router.use(authenticateAdmin) déjà en place)
// - nécessite env ALLOW_PRODUCTION_HISTORY_RESET=true
// - nécessite confirm explicite: "RESET_HISTORY"
router.post('/maintenance/reset-history', async (req, res) => {
    try {
        if (String(process.env.ALLOW_PRODUCTION_HISTORY_RESET || '').toLowerCase() !== 'true') {
            return res.status(403).json({
                success: false,
                error: 'HISTORY_RESET_DISABLED',
                message: 'Reset historique désactivé. Définissez ALLOW_PRODUCTION_HISTORY_RESET=true côté backend pour l\'autoriser.'
            });
        }

        const { confirm, includeSessions = true } = req.body || {};
        if (confirm !== 'RESET_HISTORY') {
            return res.status(400).json({
                success: false,
                error: 'CONFIRM_REQUIRED',
                message: 'Pour éviter une suppression accidentelle, envoyez { confirm: "RESET_HISTORY" }.'
            });
        }

        // Counts first (audit-friendly)
        const countHist = await executeQuery(
            `SELECT COUNT(*) AS c FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]`
        );
        const countTemps = await executeQuery(
            `SELECT COUNT(*) AS c FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]`
        );
        const histC = countHist?.[0]?.c ?? 0;
        const tempsC = countTemps?.[0]?.c ?? 0;

        let sessionsC = 0;
        if (includeSessions) {
            const countSess = await executeQuery(
                `SELECT COUNT(*) AS c FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]`
            );
            sessionsC = countSess?.[0]?.c ?? 0;
        }

        // Delete (no DROP)
        await executeQuery(`DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]`);
        await executeQuery(`DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]`);
        if (includeSessions) {
            await executeQuery(`DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]`);
        }

        return res.json({
            success: true,
            message: 'Historique opérateurs réinitialisé',
            deleted: {
                ABHISTORIQUE_OPERATEURS: histC,
                ABTEMPS_OPERATEURS: tempsC,
                ABSESSIONS_OPERATEURS: sessionsC
            }
        });
    } catch (error) {
        console.error('❌ Erreur reset historique:', error);
        return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: error.message });
    }
});

// Route pour récupérer les lancements d'un opérateur spécifique
router.get('/operators/:operatorCode/operations', async (req, res) => {
    try {
        const { operatorCode } = req.params;
        console.log(`🔍 Récupération des événements pour l'opérateur ${operatorCode}...`);

        // Récupérer tous les événements de cet opérateur depuis ABHISTORIQUE_OPERATEURS
        // 🔒 FILTRE IMPORTANT : Exclure les lancements transférés (StatutTraitement = 'T')
        // L'opérateur doit voir ses lancements tant qu'ils n'ont pas été transférés par l'admin
        // ⚡ OPTIMISATION : Utiliser LEFT JOIN avec sous-requête dérivée au lieu de sous-requête corrélée
        // IMPORTANT: Convertir HeureDebut et HeureFin en VARCHAR(5) (HH:mm) directement dans SQL
        // pour éviter les problèmes de timezone lors de la conversion par Node.js
        const operatorEventsQuery = `
        SELECT 
                h.NoEnreg,
                h.Ident,
                h.DateCreation,
                h.CreatedAt,
                h.CodeLanctImprod,
                COALESCE(h.Phase, 'PRODUCTION') as Phase,
                h.OperatorCode,
                h.CodeRubrique,
                h.Statut,
                CONVERT(VARCHAR(5), h.HeureDebut, 108) AS HeureDebut,
                CONVERT(VARCHAR(5), h.HeureFin, 108) AS HeureFin,
                r.Designation1 as operatorName,
                l.DesignationLct1 as Article,
                l.DesignationLct2 as ArticleDetail,
                t.StatutTraitement
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
            LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r ON h.OperatorCode = r.Coderessource
            LEFT JOIN [SEDI_ERP].[dbo].[LCTE] l ON l.CodeLancement = h.CodeLanctImprod
            LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t 
                ON t.OperatorCode = h.OperatorCode 
                AND t.LancementCode = h.CodeLanctImprod
                AND ISNULL(t.Phase, '') = ISNULL(h.Phase, '')
                AND ISNULL(t.CodeRubrique, '') = ISNULL(h.CodeRubrique, '')
                AND CAST(t.DateCreation AS DATE) = CAST(h.DateCreation AS DATE)
            -- ⚡ OPTIMISATION : Utiliser h.Phase directement (plus simple et fiable)
            WHERE h.OperatorCode = @operatorCode
              AND (t.StatutTraitement IS NULL OR t.StatutTraitement != 'T')
            ORDER BY h.DateCreation DESC
        `;
        
        const operatorEvents = await executeQuery(operatorEventsQuery, { operatorCode });
        
        // Utiliser la même fonction que getAdminOperations pour la cohérence
        const processedLancements = processLancementEventsWithPauses(operatorEvents);
        
        // Formater les données pour l'interface opérateur (sans pauseTime)
        const formattedOperations = processedLancements.map(lancement => ({
            id: lancement.id,
            operatorId: lancement.operatorId,
            operatorName: operatorEvents.find(e => e.OperatorCode === lancement.operatorId)?.operatorName || 'Non assigné',
            lancementCode: lancement.lancementCode,
            article: operatorEvents.find(e => e.CodeLanctImprod === lancement.lancementCode)?.Article || 'N/A',
            articleDetail: operatorEvents.find(e => e.CodeLanctImprod === lancement.lancementCode)?.ArticleDetail || '',
            startTime: lancement.startTime,
            endTime: lancement.endTime,
            duration: lancement.duration,
            status: lancement.status,
            statusCode: lancement.statusCode,
            generalStatus: lancement.generalStatus,
            events: lancement.events,
            editable: true
        }));

        console.log(`✅ ${formattedOperations.length} lancements traités pour l'opérateur ${operatorCode}`);

        res.json({
            success: true,
            operations: formattedOperations,
            operatorCode: operatorCode,
            count: formattedOperations.length
        });

    } catch (error) {
        console.error(`❌ Erreur lors de la récupération des lancements:`, error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération des lancements de l\'opérateur',
            details: error.message
        });
    }
});

router.get('/tables-info', async (req, res) => {
    try {
        console.log('🔍 Récupération des informations des tables abetemps');

        // Requête pour abetemps_Pause avec informations opérateur
        const pauseQuery = `
            SELECT TOP 50
                p.NoEnreg,
            p.Ident,
                p.DateTravail,
                p.CodeLanctImprod,
            p.Phase,
            p.CodePoste,
                p.CodeOperateur,
                r.Designation1 as NomOperateur
        FROM [SEDI_ERP].[GPSQL].[abetemps_Pause] p
        LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r ON p.CodeOperateur = r.Coderessource
            ORDER BY p.DateTravail DESC
        `;

        // Requête pour abetemps_temp avec informations opérateur
        const tempQuery = `
            SELECT TOP 50
                t.NoEnreg,
                t.Ident,
                t.DateTravail,
                t.CodeLanctImprod,
                t.Phase,
                t.CodePoste,
                t.CodeOperateur,
                r.Designation1 as NomOperateur
            FROM [SEDI_ERP].[GPSQL].[abetemps_temp] t
            LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r ON t.CodeOperateur = r.Coderessource
            ORDER BY t.DateTravail DESC
        `;

        console.log('📊 Exécution des requêtes pour abetemps_Pause et abetemps_temp');

        const [pauseData, tempData] = await Promise.all([
            executeQuery(pauseQuery),
            executeQuery(tempQuery)
        ]);

        console.log(`✅ Données récupérées: ${pauseData.length} entrées Pause, ${tempData.length} entrées Temp`);

        res.json({
            success: true,
            data: {
                abetemps_Pause: pauseData,
                abetemps_temp: tempData
            },
            counts: {
                pause: pauseData.length,
                temp: tempData.length
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la récupération des tables:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la récupération des informations des tables',
            details: error.message
        });
    }
});

// Route pour transférer les opérations terminées vers SEDI_APP_INDEPENDANTE
router.post('/transfer', async (req, res) => {
    try {
        console.log('🔄 Fonction de transfert temporairement désactivée pour debug...');
        
        // Retourner un message informatif
        res.json({
            success: true,
            message: 'Fonction de transfert temporairement désactivée - Fonctionnalités principales opérationnelles',
            note: 'Cette fonction sera réactivée après résolution du problème de colonnes'
        });
        return;

        // Récupérer toutes les opérations terminées (statut FIN) de la table abetemps
        const getCompletedOperationsQuery = `
            SELECT 
                a.NoEnreg,
                a.CodeOperateur,
                a.CodeLanctImprod,
                a.Phase,
                a.CodePoste,
                a.Ident,
                'TERMINE' as Statut,
                a.DateTravail
            FROM [SEDI_ERP].[GPSQL].[abetemps] a
            WHERE a.Ident = 'FIN'
            AND CAST(a.DateTravail AS DATE) = CAST(GETDATE() AS DATE)
        `;

        const completedOperations = await executeQuery(getCompletedOperationsQuery);
        console.log(` ${completedOperations.length} opérations terminées trouvées`);

        let transferredCount = 0;

        // Transférer chaque opération vers SEDI_APP_INDEPENDANTE
        for (const operation of completedOperations) {
            try {
                const requestId = req.audit?.requestId || generateRequestId();
                const insertQuery = `
                    INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                    (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation, SessionId, RequestId, CreatedAt)
                    VALUES (
                        '${operation.CodeOperateur}',
                        '${operation.CodeLanctImprod}',
                        '${operation.CodePoste || '929'}',
                        '${operation.Ident}',
                        '${operation.Phase || 'PRODUCTION'}',
                        '${operation.Statut}',
                        GETDATE(),
                        GETDATE(),
                        GETDATE(),
                        NULL,
                        '${requestId}',
                        GETDATE()
                    )
                `;

                await executeQuery(insertQuery);
                transferredCount++;
                console.log(` Opération ${operation.CodeLanctImprod} transférée`);

            } catch (insertError) {
                console.error(` Erreur lors du transfert de l'opération ${operation.CodeLanctImprod}:`, insertError);
            }
        }

        console.log(` Transfert terminé: ${transferredCount}/${completedOperations.length} opérations transférées`);

        res.json({
            success: true,
            message: 'Transfert terminé avec succès',
            totalFound: completedOperations.length,
            transferredCount: transferredCount,
            errors: completedOperations.length - transferredCount,
            testColumns: Object.keys(testResult[0] || {})
        });

    } catch (error) {
        console.error(' Erreur lors du transfert:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du transfert vers SEDI_APP_INDEPENDANTE',
            details: error.message
        });
    }
});

// Route de test pour abetemps_temp
router.get('/debug/temp-table', async (req, res) => {
    try {
        const query = `SELECT TOP 10 * FROM [SEDI_ERP].[GPSQL].[abetemps_temp]`;
        const results = await executeQuery(query);
        res.json({ 
            success: true, 
            count: results.length,
            data: results
        });
    } catch (error) {
        console.error('Erreur debug abetemps_temp:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route de débogage pour voir le contenu des 3 tables
router.get('/debug/tables-content', async (req, res) => {
    try {
        const tempQuery = `SELECT COUNT(*) as count FROM [SEDI_ERP].[GPSQL].[abetemps_temp]`;
        const pauseQuery = `SELECT COUNT(*) as count FROM [SEDI_ERP].[GPSQL].[abetemps_Pause]`;
        const completedQuery = `SELECT COUNT(*) as count FROM [SEDI_ERP].[GPSQL].[abetemps] WHERE Ident = 'Prod'`;
        
        const [tempResults, pauseResults, completedResults] = await Promise.all([
            executeQuery(tempQuery),
            executeQuery(pauseQuery),
            executeQuery(completedQuery)
        ]);
        
        res.json({ 
            success: true, 
            tables: {
                abetemps_temp: tempResults[0].count,
                abetemps_Pause: pauseResults[0].count,
                abetemps_completed: completedResults[0].count
            }
        });
    } catch (error) {
        console.error('Erreur debug tables:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route de débogage pour voir les valeurs de Ident
router.get('/debug/ident-values', async (req, res) => {
    try {
        const query = `
            SELECT 
                Ident, 
                COUNT(*) as count
            FROM [SEDI_ERP].[GPSQL].[abetemps]
            GROUP BY Ident
            ORDER BY count DESC
        `;
        
        const results = await executeQuery(query);
        res.json({ success: true, identValues: results });
    } catch (error) {
        console.error('Erreur debug ident:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/validate-lancement/:code - Valider un code de lancement
router.get('/validate-lancement/:code', async (req, res) => {
    try {
        const { code } = req.params;
        
        console.log(`🔍 Validation du code lancement: ${code}`);
        
        // Valider le format du code (LT + 7 chiffres)
        const codePattern = /^LT\d{7}$/;
        if (!codePattern.test(code)) {
            return res.json({
                success: false,
                valid: false,
                error: 'Format invalide. Le code doit être au format LT + 7 chiffres (ex: LT2501145)'
            });
        }
        
        // Vérifier l'existence dans la base de données
        const validationQuery = `
            SELECT TOP 1 
                CodeLancement,
                DesignationLct1,
                DesignationLct2,
                StatutLancement
            FROM [SEDI_ERP].[dbo].[LCTE] 
            WHERE CodeLancement = @code
        `;
        
        const result = await executeQuery(validationQuery, { code });
        
        if (result.length === 0) {
            return res.json({
                success: true,
                valid: false,
                error: 'Code de lancement non trouvé dans la base de données'
            });
        }
        
        const lancement = result[0];
        
        res.json({
            success: true,
            valid: true,
            data: {
                code: lancement.CodeLancement,
                designation: lancement.DesignationLct1,
                designationDetail: lancement.DesignationLct2,
                statut: lancement.StatutLancement
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur validation code lancement:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la validation'
        });
    }
});

// Route pour recréer les tables SEDI_APP_INDEPENDANTE avec la bonne structure
// Route pour supprimer toutes les tables SEDI_APP_INDEPENDANTE
router.post('/delete-all-sedi-tables', async (req, res) => {
    try {
        console.log('🗑️ Suppression de toutes les tables SEDI_APP_INDEPENDANTE...');
        
        // Supprimer toutes les données des tables
        const deleteQueries = [
            'DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]',
            'DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]',
            'DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]'
        ];
        
        for (const query of deleteQueries) {
            try {
                await executeQuery(query);
                console.log(`✅ Données supprimées: ${query.split('.')[3]}`);
            } catch (error) {
                console.log(`⚠️ Table peut-être inexistante: ${query.split('.')[3]}`);
            }
        }
        
        // Optionnel: Supprimer complètement les tables
        const dropQueries = [
            'DROP TABLE IF EXISTS [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]',
            'DROP TABLE IF EXISTS [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]',
            'DROP TABLE IF EXISTS [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]'
        ];
        
        for (const query of dropQueries) {
            try {
                await executeQuery(query);
                console.log(`✅ Table supprimée: ${query.split('.')[3]}`);
            } catch (error) {
                console.log(`⚠️ Erreur suppression table: ${error.message}`);
            }
        }
        
        console.log('✅ Suppression terminée');
        
        res.json({
            success: true,
            message: 'Toutes les tables SEDI_APP_INDEPENDANTE ont été supprimées',
            deletedTables: [
                'ABHISTORIQUE_OPERATEURS',
                'ABSESSIONS_OPERATEURS', 
                'ABTEMPS_OPERATEURS'
            ]
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la suppression des tables:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la suppression des tables',
            details: error.message
        });
    }
});

router.post('/recreate-tables', async (req, res) => {
    try {
        console.log('🔧 Recréation des tables SEDI_APP_INDEPENDANTE...');

        // Supprimer et recréer ABSESSIONS_OPERATEURS
        const dropSessionsTable = `
            IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]', 'U') IS NOT NULL
            DROP TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
        `;

        const createSessionsTable = `
            CREATE TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] (
                SessionId INT IDENTITY(1,1) PRIMARY KEY,
                OperatorCode NVARCHAR(50) NOT NULL,
                LoginTime DATETIME2 NOT NULL,
                LogoutTime DATETIME2 NULL,
                SessionStatus NVARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
                DeviceInfo NVARCHAR(255) NULL,
                DateCreation DATETIME2 NOT NULL DEFAULT GETDATE()
            )
        `;

        // Supprimer et recréer ABTEMPS_OPERATEURS
        const dropTempsTable = `
            IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]', 'U') IS NOT NULL
            DROP TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
        `;

        const createTempsTable = `
            CREATE TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] (
                TempsId INT IDENTITY(1,1) PRIMARY KEY,
                OperatorCode NVARCHAR(50) NOT NULL,
                LancementCode NVARCHAR(50) NOT NULL,
                StartTime DATETIME2 NOT NULL,
                EndTime DATETIME2 NOT NULL,
                TotalDuration INT NOT NULL, -- en minutes
                PauseDuration INT NOT NULL DEFAULT 0, -- en minutes
                ProductiveDuration INT NOT NULL, -- en minutes
                EventsCount INT NOT NULL DEFAULT 0,
                DateCreation DATETIME2 NOT NULL DEFAULT GETDATE(),
                UNIQUE(OperatorCode, LancementCode, StartTime)
            )
        `;

        await executeQuery(dropSessionsTable);
        await executeQuery(createSessionsTable);
        console.log('✅ Table ABSESSIONS_OPERATEURS recréée');

        await executeQuery(dropTempsTable);
        await executeQuery(createTempsTable);
        console.log('✅ Table ABTEMPS_OPERATEURS recréée');

        // Supprimer et recréer ABHISTORIQUE_OPERATEURS
        const dropHistoriqueTable = `
            IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]', 'U') IS NOT NULL
            DROP TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
        `;

        const createHistoriqueTable = `
            CREATE TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] (
                NoEnreg INT IDENTITY(1,1) PRIMARY KEY,
                OperatorCode NVARCHAR(50) NOT NULL,
                CodeLanctImprod NVARCHAR(50) NOT NULL,
                CodeRubrique NVARCHAR(50) NOT NULL,
                Ident NVARCHAR(20) NOT NULL, -- DEBUT, PAUSE, REPRISE, FIN
                Phase NVARCHAR(50) NULL,
                Statut NVARCHAR(20) NULL,
                HeureDebut TIME NULL, -- Format HH:mm seulement
                HeureFin TIME NULL, -- Format HH:mm seulement
                DateCreation DATE NOT NULL DEFAULT CAST(GETDATE() AS DATE), -- Date seulement
                SessionId INT NULL,
                RequestId NVARCHAR(100) NULL,
                CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
                INDEX IX_Historique_Operator_Lancement (OperatorCode, CodeLanctImprod),
                INDEX IX_Historique_Date (DateCreation)
            )
        `;

        try {
            await executeQuery(dropHistoriqueTable);
            console.log('🗑️ Table ABHISTORIQUE_OPERATEURS supprimée (si elle existait)');
    } catch (error) {
            console.log('⚠️ Table ABHISTORIQUE_OPERATEURS n\'existait pas');
        }
        
        await executeQuery(createHistoriqueTable);
        console.log('✅ Table ABHISTORIQUE_OPERATEURS recréée');

        res.json({
            success: true,
            message: 'Tables SEDI_APP_INDEPENDANTE recréées avec succès',
            tables: ['ABHISTORIQUE_OPERATEURS', 'ABSESSIONS_OPERATEURS', 'ABTEMPS_OPERATEURS']
        });

    } catch (error) {
        console.error('❌ Erreur recréation tables:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la recréation des tables',
            details: error.message
        });
    }
});

// Route pour initialiser les tables manquantes SEDI_APP_INDEPENDANTE
router.post('/init-tables', async (req, res) => {
    try {
        console.log('🔧 Initialisation des tables SEDI_APP_INDEPENDANTE...');

        // Créer ABSESSIONS_OPERATEURS si elle n'existe pas
        const createSessionsTable = `
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ABSESSIONS_OPERATEURS' AND xtype='U')
            CREATE TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] (
                SessionId INT IDENTITY(1,1) PRIMARY KEY,
                OperatorCode NVARCHAR(50) NOT NULL,
                LoginTime DATETIME2 NOT NULL,
                LogoutTime DATETIME2 NULL,
                SessionStatus NVARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
                DeviceInfo NVARCHAR(255) NULL,
                DateCreation DATETIME2 NOT NULL DEFAULT GETDATE()
            )
        `;

        // Créer ABTEMPS_OPERATEURS si elle n'existe pas
        const createTempsTable = `
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ABTEMPS_OPERATEURS' AND xtype='U')
            CREATE TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] (
                TempsId INT IDENTITY(1,1) PRIMARY KEY,
                OperatorCode NVARCHAR(50) NOT NULL,
                LancementCode NVARCHAR(50) NOT NULL,
                StartTime DATETIME2 NOT NULL,
                EndTime DATETIME2 NOT NULL,
                TotalDuration INT NOT NULL, -- en minutes
                PauseDuration INT NOT NULL DEFAULT 0, -- en minutes
                ProductiveDuration INT NOT NULL, -- en minutes
                EventsCount INT NOT NULL DEFAULT 0,
                DateCreation DATETIME2 NOT NULL DEFAULT GETDATE(),
                UNIQUE(OperatorCode, LancementCode, StartTime)
            )
        `;

        await executeQuery(createSessionsTable);
        console.log('✅ Table ABSESSIONS_OPERATEURS créée/vérifiée');

        await executeQuery(createTempsTable);
        console.log('✅ Table ABTEMPS_OPERATEURS créée/vérifiée');

        res.json({
            success: true,
            message: 'Tables SEDI_APP_INDEPENDANTE initialisées avec succès',
            tables: ['ABHISTORIQUE_OPERATEURS', 'ABSESSIONS_OPERATEURS', 'ABTEMPS_OPERATEURS']
        });
        
    } catch (error) {
        console.error('❌ Erreur initialisation tables:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de l\'initialisation des tables',
            details: error.message
        });
    }
});

// Route de débogage pour analyser les 3 tables SEDI_APP_INDEPENDANTE
router.get('/debug/sedi-tables', async (req, res) => {
    try {
        console.log('🔍 Analyse des 3 tables SEDI_APP_INDEPENDANTE...');

        // Analyser ABHISTORIQUE_OPERATEURS
        const historiqueQuery = `
            SELECT TOP 5 * 
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            ORDER BY DateCreation DESC
        `;

        // Analyser ABSESSIONS_OPERATEURS
        const sessionsQuery = `
            SELECT TOP 5 * 
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
            ORDER BY DateCreation DESC
        `;

        // Analyser ABTEMPS_OPERATEURS
        const tempsQuery = `
            SELECT TOP 5 * 
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            -- Note: Les colonnes Phase, CodeRubrique, StatutTraitement sont maintenant disponibles
            ORDER BY DateCreation DESC
        `;

        const [historiqueResults, sessionsResults, tempsResults] = await Promise.all([
            executeQuery(historiqueQuery).catch(err => ({ error: err.message })),
            executeQuery(sessionsQuery).catch(err => ({ error: err.message })),
            executeQuery(tempsQuery).catch(err => ({ error: err.message }))
        ]);

        // Compter les enregistrements
        const countHistoriqueQuery = `SELECT COUNT(*) as count FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]`;
        const countSessionsQuery = `SELECT COUNT(*) as count FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]`;
        const countTempsQuery = `SELECT COUNT(*) as count FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]`;

        const [countHistorique, countSessions, countTemps] = await Promise.all([
            executeQuery(countHistoriqueQuery).catch(err => [{ count: 0, error: err.message }]),
            executeQuery(countSessionsQuery).catch(err => [{ count: 0, error: err.message }]),
            executeQuery(countTempsQuery).catch(err => [{ count: 0, error: err.message }])
        ]);

        res.json({
            success: true,
            tables: {
                ABHISTORIQUE_OPERATEURS: {
                    count: countHistorique[0]?.count || 0,
                    sample: historiqueResults.error ? { error: historiqueResults.error } : historiqueResults,
                    columns: historiqueResults.length > 0 ? Object.keys(historiqueResults[0]) : []
                },
                ABSESSIONS_OPERATEURS: {
                    count: countSessions[0]?.count || 0,
                    sample: sessionsResults.error ? { error: sessionsResults.error } : sessionsResults,
                    columns: sessionsResults.length > 0 ? Object.keys(sessionsResults[0]) : []
                },
                ABTEMPS_OPERATEURS: {
                    count: countTemps[0]?.count || 0,
                    sample: tempsResults.error ? { error: tempsResults.error } : tempsResults,
                    columns: tempsResults.length > 0 ? Object.keys(tempsResults[0]) : []
                }
            }
        });
        
    } catch (error) {
        console.error('Erreur debug tables SEDI:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/admin/lancement/:code - Rechercher un lancement dans LCTE
router.get('/lancement/:code', async (req, res) => {
    try {
        const { code } = req.params;
        
        console.log(` Recherche du lancement ${code}...`);
        
        const validation = await validateLancement(code);
        
        if (validation.valid) {
            res.json({
                success: true,
                data: validation.data
            });
        } else {
            res.status(404).json({
                success: false,
                error: validation.error
            });
        }
        
    } catch (error) {
        console.error(' Erreur lors de la recherche du lancement:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la recherche du lancement'
        });
    }
});

// GET /api/admin/abetemps - Voir les données de la table abetemps
router.get('/abetemps', async (req, res) => {
    try {
        const { lancement } = req.query;
        
        if (lancement) {
            console.log(`🔍 Recherche du lancement ${lancement} dans abetemps...`);
            
            const query = `
                SELECT TOP 10
                    [NoEnreg],
                    [Ident],
                    [CodeLanctImprod],
                    [Phase],
                    [CodeOperateur]
                FROM [SEDI_ERP].[GPSQL].[abetemps]
                WHERE [CodeLanctImprod] = '${lancement}'
                ORDER BY [NoEnreg] DESC
            `;
            
            const result = await executeQuery(query);
            console.log(`✅ ${result.length} entrées trouvées pour ${lancement} dans abetemps`);
            
            res.json({
                success: true,
                data: result || [],
                lancement: lancement
            });
        } else {
            console.log('🔍 Récupération de 10 entrées depuis abetemps...');
            
            const query = `
                SELECT TOP 10
                    [NoEnreg],
                    [Ident],
                    [CodeLanctImprod],
                    [Phase],
                    [CodeOperateur]
                FROM [SEDI_ERP].[GPSQL].[abetemps]
                ORDER BY [NoEnreg] DESC
            `;
            
            const result = await executeQuery(query);
            console.log(`✅ ${result.length} entrées récupérées depuis abetemps`);
            
            res.json({
                success: true,
                data: result || []
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de la récupération de abetemps:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la récupération de abetemps'
        });
    }
});

// GET /api/admin/lcte - Voir les données de la table LCTE
router.get('/lcte', async (req, res) => {
    try {
        const { limit = 10 } = req.query;
        
        console.log(`🔍 Récupération de ${limit} lancements depuis LCTE...`);
        
        const query = `
            SELECT TOP ${parseInt(limit)} 
                [CodeLancement],
                [CodeArticle],
                [DesignationLct1],
                [CodeModele],
                [DesignationArt1],
                [DesignationArt2]
            FROM [SEDI_ERP].[dbo].[LCTE]
            ORDER BY [CodeLancement]
        `;
        
        const result = await executeQuery(query);
        
        console.log(` ${result.length} lancements récupérés depuis LCTE`);
        
        res.json({
            success: true,
            data: result || [],
            count: result.length
        });
        
    } catch (error) {
        console.error(' Erreur lors de la récupération des lancements LCTE:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la récupération des lancements'
        });
    }
});

// GET /api/admin/lancements/search - Rechercher des lancements par terme
router.get('/lancements/search', async (req, res) => {
    try {
        const { term, limit = 10 } = req.query;
        
        if (!term || term.length < 2) {
            return res.json({
                success: true,
                data: []
            });
        }
        
        console.log(`🔍 Recherche de lancements avec le terme: ${term}`);
        
        const searchTerm = `%${term}%`;
        const query = `
            SELECT TOP ${parseInt(limit)} 
                [CodeLancement],
                [CodeArticle],
                [DesignationLct1],
                [CodeModele],
                [DesignationArt1],
                [DesignationArt2]
            FROM [SEDI_ERP].[dbo].[LCTE]
            WHERE [CodeLancement] LIKE '${searchTerm}'
               OR [DesignationLct1] LIKE '${searchTerm}'
               OR [CodeArticle] LIKE '${searchTerm}'
            ORDER BY [CodeLancement]
        `;
        
        const result = await executeQuery(query);
        
        console.log(` ${result.length} lancements trouvés`);
        
        res.json({
            success: true,
            data: result || []
        });
        
    } catch (error) {
        console.error(' Erreur lors de la recherche de lancements:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la recherche'
        });
    }
});

// Route spécifique pour créer ABHISTORIQUE_OPERATEURS
router.post('/create-historique-table', async (req, res) => {
    try {
        console.log('🔧 Création de la table ABHISTORIQUE_OPERATEURS...');

        // Supprimer et recréer ABHISTORIQUE_OPERATEURS
        const dropHistoriqueTable = `
            IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]', 'U') IS NOT NULL
            DROP TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
        `;

        const createHistoriqueTable = `
            CREATE TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] (
                NoEnreg INT IDENTITY(1,1) PRIMARY KEY,
                OperatorCode NVARCHAR(50) NOT NULL,
                CodeLanctImprod NVARCHAR(50) NOT NULL,
                CodeRubrique NVARCHAR(50) NOT NULL,
                Ident NVARCHAR(20) NOT NULL, -- DEBUT, PAUSE, REPRISE, FIN
                Phase NVARCHAR(50) NULL,
                Statut NVARCHAR(20) NULL,
                HeureDebut TIME NULL, -- Format HH:mm seulement
                HeureFin TIME NULL, -- Format HH:mm seulement
                DateCreation DATE NOT NULL DEFAULT CAST(GETDATE() AS DATE), -- Date seulement
                SessionId INT NULL,
                RequestId NVARCHAR(100) NULL,
                CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE(),
                INDEX IX_Historique_Operator_Lancement (OperatorCode, CodeLanctImprod),
                INDEX IX_Historique_Date (DateCreation)
            )
        `;

        await executeQuery(dropHistoriqueTable);
        await executeQuery(createHistoriqueTable);
        console.log(' Table ABHISTORIQUE_OPERATEURS créée avec succès');

        res.json({
            success: true,
            message: 'Table ABHISTORIQUE_OPERATEURS créée avec succès'
        });

    } catch (error) {
        console.error(' Erreur création table ABHISTORIQUE_OPERATEURS:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la création de la table ABHISTORIQUE_OPERATEURS',
            details: error.message
        });
    }
});

// Route de debug pour tester la logique de tous les lancements
router.get('/debug/all-lancements-status', async (req, res) => {
    try {
        console.log('🔍 Debug de tous les lancements...');
        
        // Récupérer tous les événements
        const eventsQuery = `
            SELECT 
                h.NoEnreg,
                h.Ident,
                h.CodeLanctImprod,
                h.CodeRubrique,
                h.HeureDebut,
                h.HeureFin,
                h.DateCreation
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
            ORDER BY h.CodeLanctImprod, h.CodeRubrique, h.DateCreation ASC
        `;
        
        const events = await executeQuery(eventsQuery);
        
        // Grouper par lancement
        const lancementGroups = {};
        events.forEach(event => {
            const key = `${event.CodeLanctImprod}_${event.CodeRubrique}`;
            if (!lancementGroups[key]) {
                lancementGroups[key] = [];
            }
            lancementGroups[key].push(event);
        });
        
        const analysis = [];
        
        Object.keys(lancementGroups).forEach(key => {
            const groupEvents = lancementGroups[key].sort((a, b) => 
                new Date(a.DateCreation) - new Date(b.DateCreation)
            );
            
            const [lancementCode, operatorCode] = key.split('_');
            const lastEvent = groupEvents[groupEvents.length - 1];
            const finEvent = groupEvents.find(e => e.Ident === 'FIN');
            const pauseEvents = groupEvents.filter(e => e.Ident === 'PAUSE');
            const repriseEvents = groupEvents.filter(e => e.Ident === 'REPRISE');
            
            // Déterminer le statut selon la nouvelle logique
            let currentStatus = 'EN_COURS';
            if (finEvent) {
                currentStatus = 'TERMINE';
            } else if (lastEvent.Ident === 'PAUSE') {
                currentStatus = 'PAUSE';
            } else if (lastEvent.Ident === 'REPRISE') {
                currentStatus = 'EN_COURS';
            }
            
            analysis.push({
                lancementCode,
                operatorCode,
                totalEvents: groupEvents.length,
                pauseEvents: pauseEvents.length,
                repriseEvents: repriseEvents.length,
                lastEvent: lastEvent ? {
                    ident: lastEvent.Ident,
                    date: lastEvent.DateCreation,
                    heure: lastEvent.HeureDebut
                } : null,
                currentStatus,
                isFinished: !!finEvent,
                events: groupEvents.map(e => ({
                    id: e.NoEnreg,
                    ident: e.Ident,
                    date: e.DateCreation,
                    heure: e.HeureDebut
                }))
            });
        });
        
        console.log(`📊 Analyse de ${analysis.length} lancements terminée`);
        
        res.json({
            success: true,
            totalLancements: analysis.length,
            analysis: analysis.sort((a, b) => a.lancementCode.localeCompare(b.lancementCode))
        });
        
    } catch (error) {
        console.error('❌ Erreur debug tous les lancements:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du debug de tous les lancements',
            details: error.message
        });
    }
});

// Route pour nettoyer les données de test et créer des pauses terminées
router.post('/debug/create-test-pause-reprise', async (req, res) => {
    try {
        console.log('🧪 Création de données de test pause/reprise...');
        
        const { operatorCode = '929', lancementCode = 'LT2501148' } = req.body;
        const requestId = req.audit?.requestId || generateRequestId();
        
        // Créer une pause terminée pour tester
        const pauseQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation, SessionId, RequestId, CreatedAt)
            VALUES (
                '${operatorCode}',
                '${lancementCode}',
                '${operatorCode}',
                'PAUSE',
                'PRODUCTION',
                'EN_PAUSE',
                CAST('14:30:00' AS TIME),
                NULL,
                CAST(GETDATE() AS DATE),
                NULL,
                '${requestId}',
                GETDATE()
            )
        `;
        
        const repriseQuery = `
            INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation, SessionId, RequestId, CreatedAt)
            VALUES (
                '${operatorCode}',
                '${lancementCode}',
                '${operatorCode}',
                'REPRISE',
                'PRODUCTION',
                'EN_COURS',
                CAST('14:45:00' AS TIME),
                NULL,
                CAST(GETDATE() AS DATE),
                NULL,
                '${requestId}',
                GETDATE()
            )
        `;
        
        await executeQuery(pauseQuery);
        await executeQuery(repriseQuery);
        
        console.log('✅ Données de test créées');
        
        res.json({
            success: true,
            message: 'Données de test pause/reprise créées',
            data: {
                operatorCode,
                lancementCode,
                pauseTime: '14:30:00',
                repriseTime: '14:45:00'
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur création données test:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors de la création des données de test',
            details: error.message
        });
    }
});

// Route de debug pour voir tous les lancements avec leurs pauses
router.get('/debug/all-pauses', async (req, res) => {
    try {
        console.log('🔍 Debug de tous les lancements avec pauses...');
        
        // Récupérer tous les événements
        const eventsQuery = `
            SELECT 
                h.NoEnreg,
                h.Ident,
                h.CodeLanctImprod,
                h.CodeRubrique,
                h.HeureDebut,
                h.HeureFin,
                h.DateCreation
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
            ORDER BY h.CodeLanctImprod, h.CodeRubrique, h.DateCreation ASC
        `;
        
        const events = await executeQuery(eventsQuery);
        
        // Grouper par lancement
        const lancementGroups = {};
        events.forEach(event => {
            const key = `${event.CodeLanctImprod}_${event.CodeRubrique}`;
            if (!lancementGroups[key]) {
                lancementGroups[key] = [];
            }
            lancementGroups[key].push(event);
        });
        
        const analysis = [];
        
        Object.keys(lancementGroups).forEach(key => {
            const groupEvents = lancementGroups[key].sort((a, b) => 
                new Date(a.DateCreation) - new Date(b.DateCreation)
            );
            
            const [lancementCode, operatorCode] = key.split('_');
            const pauseEvents = groupEvents.filter(e => e.Ident === 'PAUSE');
            const repriseEvents = groupEvents.filter(e => e.Ident === 'REPRISE');
            
            analysis.push({
                lancementCode,
                operatorCode,
                totalEvents: groupEvents.length,
                pauseEvents: pauseEvents.length,
                repriseEvents: repriseEvents.length,
                events: groupEvents.map(e => ({
                    id: e.NoEnreg,
                    ident: e.Ident,
                    date: e.DateCreation,
                    heure: e.HeureDebut
                })),
                pauseAnalysis: pauseEvents.map(pause => {
                    const reprise = repriseEvents.find(r => 
                        new Date(r.DateCreation) > new Date(pause.DateCreation) &&
                        r.CodeLanctImprod === pause.CodeLanctImprod &&
                        r.CodeRubrique === pause.CodeRubrique
                    );
                    return {
                        pauseId: pause.NoEnreg,
                        pauseDate: pause.DateCreation,
                        pauseHeure: pause.HeureDebut,
                        hasReprise: !!reprise,
                        repriseDate: reprise ? reprise.DateCreation : null,
                        repriseHeure: reprise ? reprise.HeureDebut : null,
                        status: reprise ? 'PAUSE_TERMINEE' : 'PAUSE'
                    };
                })
            });
        });
        
        res.json({
            success: true,
            totalLancements: analysis.length,
            analysis: analysis.sort((a, b) => a.lancementCode.localeCompare(b.lancementCode))
        });
        
    } catch (error) {
        console.error('❌ Erreur debug toutes les pauses:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du debug de toutes les pauses',
            details: error.message
        });
    }
});

// Route de debug pour tester la logique pause/reprise
router.get('/debug/pause-reprise/:lancementCode', async (req, res) => {
    try {
        const { lancementCode } = req.params;
        
        console.log(`🔍 Debug pause/reprise pour le lancement ${lancementCode}...`);
        
        // Récupérer tous les événements pour ce lancement
        const eventsQuery = `
            SELECT 
                h.NoEnreg,
                h.Ident,
                h.CodeLanctImprod,
                h.CodeRubrique,
                h.HeureDebut,
                h.HeureFin,
                h.DateCreation
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
            WHERE h.CodeLanctImprod = '${lancementCode}'
            ORDER BY h.DateCreation ASC, h.NoEnreg ASC
        `;
        
        const events = await executeQuery(eventsQuery);
        
        // Analyser les événements
        const pauseEvents = events.filter(e => e.Ident === 'PAUSE');
        const repriseEvents = events.filter(e => e.Ident === 'REPRISE');
        
        console.log(`📊 Événements trouvés pour ${lancementCode}:`, {
            total: events.length,
            pauses: pauseEvents.length,
            reprises: repriseEvents.length,
            events: events.map(e => ({
                id: e.NoEnreg,
                ident: e.Ident,
                operator: e.CodeRubrique,
                date: e.DateCreation,
                heure: e.HeureDebut
            }))
        });
        
        res.json({
            success: true,
            lancementCode,
            analysis: {
                totalEvents: events.length,
                pauseEvents: pauseEvents.length,
                repriseEvents: repriseEvents.length,
                events: events.map(e => ({
                    id: e.NoEnreg,
                    ident: e.Ident,
                    operator: e.CodeRubrique,
                    date: e.DateCreation,
                    heure: e.HeureDebut
                })),
                pauseReprisePairs: pauseEvents.map(pause => {
                    const reprise = repriseEvents.find(r => 
                        new Date(r.DateCreation) > new Date(pause.DateCreation) &&
                        r.CodeLanctImprod === pause.CodeLanctImprod &&
                        r.CodeRubrique === pause.CodeRubrique
                    );
                    return {
                        pause: {
                            id: pause.NoEnreg,
                            date: pause.DateCreation,
                            heure: pause.HeureDebut
                        },
                        reprise: reprise ? {
                            id: reprise.NoEnreg,
                            date: reprise.DateCreation,
                            heure: reprise.HeureDebut
                        } : null,
                        status: reprise ? 'PAUSE_TERMINEE' : 'PAUSE'
                    };
                })
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur debug pause/reprise:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du debug pause/reprise',
            details: error.message
        });
    }
});

// Route de test pour vérifier le format HH:mm
router.get('/test/time-format', async (req, res) => {
    try {
        console.log('🧪 Test du format HH:mm...');
        
        // Tests de formatTimeForSQL
        const testCases = [
            '14:30',      // Format HH:mm standard
            '09:15',      // Format HH:mm avec zéro
            '14:30:45',   // Format HH:mm:ss existant
            '9:5',        // Format H:m (sans zéros)
            null,         // Valeur null
            '',           // Chaîne vide
            'invalid'     // Format invalide
        ];
        
        const results = testCases.map(input => ({
            input: input,
            output: formatTimeForSQL(input),
            type: typeof input
        }));
        
        console.log('🧪 Résultats des tests:', results);
        
        res.json({
            success: true,
            message: 'Tests du format HH:mm terminés',
            format: 'HH:mm → HH:mm:ss (pour SQL)',
            tests: results,
            examples: {
                'Frontend': '14:30',
                'API': '14:30', 
                'SQL': '14:30:00',
                'Display': '14:30'
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur test format:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur lors du test du format'
        });
    }
});

// ============================================
// ROUTES MONITORING - Gestion des enregistrements de temps
// ============================================

const MonitoringService = require('../services/MonitoringService');

// GET /api/admin/monitoring - Récupérer tous les enregistrements de temps avec filtres
router.get('/monitoring', async (req, res) => {
    try {
        // Éviter le cache (sinon le navigateur peut recevoir 304 sans body JSON)
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        const { statutTraitement, operatorCode, lancementCode, date, dateStart, dateEnd } = req.query;
        
        const filters = {};
        if (statutTraitement !== undefined) filters.statutTraitement = statutTraitement;
        if (operatorCode) filters.operatorCode = operatorCode;
        if (lancementCode) filters.lancementCode = lancementCode;
        if (date) filters.date = date;
        if (dateStart) filters.dateStart = dateStart;
        if (dateEnd) filters.dateEnd = dateEnd;
        
        const result = await MonitoringService.getTempsRecords(filters);
        
        if (result.success) {
            // Enrichir les lignes consolidées (ABTEMPS) avec la fabrication (CodeOperation) depuis l'ERP
            try {
                const lts = [...new Set((result.data || []).map(r => String(r?.LancementCode || '').trim()).filter(Boolean))];
                const fabMap = await getFabricationMapForLaunches(lts);
                (result.data || []).forEach(r => {
                    const key = `${String(r.LancementCode || '').trim()}_${String(r.Phase || '').trim()}_${String(r.CodeRubrique || '').trim()}`;
                    const fabrication = fabMap.get(key) || '-';
                    r.Fabrication = fabrication;
                    r.fabrication = fabrication;
                });
            } catch (e) {
                console.warn('⚠️ Impossible d\'enrichir /admin/monitoring avec la fabrication:', e.message);
            }

            res.json({
                success: true,
                data: result.data,
                count: result.count
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de la récupération des enregistrements:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la récupération des enregistrements'
        });
    }
});

// PUT /api/admin/monitoring/:tempsId - Corriger un enregistrement
router.put('/monitoring/:tempsId', async (req, res) => {
    try {
        const { tempsId } = req.params;
        const corrections = req.body;
        
        // Convertir tempsId en nombre
        const tempsIdNum = parseInt(tempsId, 10);
        if (isNaN(tempsIdNum)) {
            console.error(`❌ TempsId invalide reçu: ${tempsId}`);
            return res.status(400).json({
                success: false,
                error: 'ID d\'enregistrement invalide'
            });
        }
        
        console.log(`🔍 Recherche de l'enregistrement TempsId: ${tempsIdNum} (type: ${typeof tempsIdNum})`);
        
        // 🔒 VÉRIFICATION DE SÉCURITÉ : Vérifier que l'enregistrement existe
        const checkQuery = `
            SELECT OperatorCode, LancementCode, StatutTraitement
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            WHERE TempsId = @tempsId
        `;
        const existing = await executeQuery(checkQuery, { tempsId: tempsIdNum });
        
        console.log(`📊 Résultat de la recherche: ${existing.length} enregistrement(s) trouvé(s) pour TempsId ${tempsIdNum}`);
        
        if (existing.length === 0) {
            // Si un NoEnreg existe dans ABHISTORIQUE_OPERATEURS avec ce même numéro,
            // alors l'UI est très probablement en train d'envoyer un ID d'événement (non consolidé)
            // vers la route de monitoring (consolidé).
            try {
                const histCheckQuery = `
                    SELECT TOP 1 NoEnreg, OperatorCode, CodeLanctImprod, Ident, DateCreation
                    FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                    WHERE NoEnreg = @id
                `;
                const hist = await executeQuery(histCheckQuery, { id: tempsIdNum });
                if (hist.length > 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'ID invalide pour le monitoring',
                        hint: 'Cet ID correspond à un événement (ABHISTORIQUE_OPERATEURS.NoEnreg) et non à un TempsId consolidé. Utilisez /api/admin/operations/:id ou consolidez avant correction.',
                        received: { tempsId: tempsIdNum },
                        detectedEvent: {
                            NoEnreg: hist[0].NoEnreg,
                            OperatorCode: hist[0].OperatorCode,
                            LancementCode: hist[0].CodeLanctImprod,
                            Ident: hist[0].Ident,
                            DateCreation: hist[0].DateCreation
                        }
                    });
                }
            } catch (e) {
                // best-effort uniquement
            }

            // Vérifier si l'enregistrement existe avec un autre type de données
            const debugQuery = `
                SELECT TOP 5 TempsId, OperatorCode, LancementCode, StatutTraitement
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
                ORDER BY TempsId DESC
            `;
            const recentRecords = await executeQuery(debugQuery, {});
            console.log(`🔍 Enregistrements récents (pour debug):`, recentRecords.map(r => ({ TempsId: r.TempsId, type: typeof r.TempsId })));
            
            return res.status(404).json({
                success: false,
                error: 'Enregistrement non trouvé',
                tempsId: tempsIdNum
            });
        }
        
        // Si un operatorCode est fourni dans le body, vérifier qu'il correspond
        if (corrections.OperatorCode && corrections.OperatorCode !== existing[0].OperatorCode) {
            return res.status(403).json({
                success: false,
                error: 'Vous ne pouvez modifier que vos propres enregistrements',
                security: 'DATA_OWNERSHIP_VIOLATION'
            });
        }
        
        const result = await MonitoringService.correctRecord(parseInt(tempsId), corrections);
        
        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                data: result
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de la correction:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la correction'
        });
    }
});

// DELETE /api/admin/monitoring/:tempsId - Supprimer un enregistrement
router.delete('/monitoring/:tempsId', async (req, res) => {
    try {
        const { tempsId } = req.params;
        const tempsIdNum = parseInt(tempsId, 10);

        if (!Number.isFinite(tempsIdNum)) {
            return res.status(400).json({
                success: false,
                error: 'TempsId invalide'
            });
        }
        
        // 🔒 VÉRIFICATION DE SÉCURITÉ : Vérifier que l'enregistrement existe
        const checkQuery = `
            SELECT OperatorCode, LancementCode, StatutTraitement
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            WHERE TempsId = @tempsId
        `;
        const existing = await executeQuery(checkQuery, { tempsId: tempsIdNum });
        
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Enregistrement non trouvé'
            });
        }
        
        // Si un operatorCode est fourni dans le body, vérifier qu'il correspond
        if (req.body?.operatorCode && req.body.operatorCode !== existing[0].OperatorCode) {
            return res.status(403).json({
                success: false,
                error: 'Vous ne pouvez supprimer que vos propres enregistrements',
                security: 'DATA_OWNERSHIP_VIOLATION'
            });
        }
        
        const result = await MonitoringService.deleteRecord(tempsIdNum);
        
        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                data: result
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de la suppression:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la suppression',
            details: error?.message
        });
    }
});

// POST /api/admin/monitoring/:tempsId/validate - Valider un enregistrement
router.post('/monitoring/:tempsId/validate', async (req, res) => {
    try {
        const { tempsId } = req.params;
        
        const result = await MonitoringService.validateRecord(parseInt(tempsId));
        
        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                data: result
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de la validation:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la validation'
        });
    }
});

// POST /api/admin/monitoring/:tempsId/on-hold - Mettre en attente un enregistrement
router.post('/monitoring/:tempsId/on-hold', async (req, res) => {
    try {
        const { tempsId } = req.params;
        
        const result = await MonitoringService.setOnHold(parseInt(tempsId));
        
        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                data: result
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de la mise en attente:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la mise en attente'
        });
    }
});

// POST /api/admin/monitoring/:tempsId/transmit - Marquer comme transmis et déclencher EDI_JOB
router.post('/monitoring/:tempsId/transmit', async (req, res) => {
    try {
        const { tempsId } = req.params;
        const { triggerEdiJob = false, codeTache = null } = req.body;

        const remoteMode = String(process.env.SILOG_REMOTE_MODE || '').trim().toLowerCase();
        const isScheduledMode = ['scheduled', 'disable', 'disabled', 'none'].includes(remoteMode);

        // Nouveau flux:
        // 1) Valider en 'O' (si nécessaire)
        // 2) Exécuter EDI_JOB (si demandé)
        // 3) Marquer en 'T' uniquement si EDI_JOB OK (sinon laisser en 'O' pour retry)
        const idNum = parseInt(tempsId, 10);
        const validate = await MonitoringService.validateRecord(idNum);
        if (!validate.success) {
            return res.status(400).json({ success: false, error: validate.error });
        }

        let ediJobResult = null;
        if (triggerEdiJob && !isScheduledMode) {
            ediJobResult = await EdiJobService.executeEdiJobForTransmittedRecords([idNum], codeTache);
            if (!ediJobResult.success) {
                return res.status(500).json({
                    success: false,
                    error: 'EDI_JOB_FAILED',
                    details: ediJobResult.error || 'EDI_JOB a échoué'
                });
            }
        } else if (triggerEdiJob && isScheduledMode) {
            ediJobResult = {
                success: true,
                skipped: true,
                message: `EDI_JOB non déclenché par le backend (SILOG_REMOTE_MODE=${remoteMode}). Tâche planifiée Windows attendue.`
            };
        }

        // En mode scheduled/disabled, ne pas marquer en 'T' (laisser 'O' pour consommation par SILOG).
        let mark = null;
        if (!isScheduledMode) {
            mark = await MonitoringService.markAsTransmitted(idNum);
            if (!mark.success) {
                return res.status(400).json({ success: false, error: mark.error });
            }
        }

        return res.json({
            success: true,
            message: isScheduledMode ? 'Enregistrement validé (planifié: tâche SILOG sur SERVEURERP)' : 'Enregistrement transmis',
            data: isScheduledMode ? { validated: validate } : { validated: validate, transmitted: mark },
            ediJob: ediJobResult
        });
        
    } catch (error) {
        console.error('❌ Erreur lors du marquage comme transmis:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors du marquage comme transmis'
        });
    }
});

// POST /api/admin/monitoring/consolidate-batch - Consolider un lot d'opérations terminées
router.post('/monitoring/consolidate-batch', async (req, res) => {
    try {
        const { operations, options = {} } = req.body; // Array of { OperatorCode, LancementCode }
        
        if (!Array.isArray(operations) || operations.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Liste d\'opérations requise'
            });
        }
        
        // Utiliser le nouveau service de consolidation
        const ConsolidationService = require('../services/ConsolidationService');
        const results = await ConsolidationService.consolidateBatch(operations, {
            force: options.force || false,
            autoFix: options.autoFix !== false // true par défaut
        });
        
        res.json({
            success: true,
            message: `${results.success.length} opération(s) consolidée(s), ${results.skipped.length} ignorée(s), ${results.errors.length} erreur(s)`,
            results: results
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la consolidation par lot:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la consolidation par lot',
            details: error.message
        });
    }
});

// POST /api/admin/monitoring/validate-and-transmit-batch - Valider et transmettre un lot
router.post('/monitoring/validate-and-transmit-batch', async (req, res) => {
    try {
        const { tempsIds, triggerEdiJob = true, codeTache = null } = req.body;
        
        if (!Array.isArray(tempsIds) || tempsIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Liste d\'IDs requise'
            });
        }
        
        const result = await MonitoringService.validateAndTransmitBatch(tempsIds);
        
        if (!result.success) {
            // Si des enregistrements invalides sont retournés, les inclure dans l'erreur
            let errorMessage = result.error || 'Erreur lors de la validation/transmission';
            if (result.invalidIds && result.invalidIds.length > 0) {
                const invalidDetails = result.invalidIds.map(inv => {
                    const errors = Array.isArray(inv.errors) ? inv.errors.join(', ') : inv.errors;
                    return `TempsId ${inv.tempsId}: ${errors}`;
                }).join('; ');
                errorMessage += ` - Détails: ${invalidDetails}`;
            }
            return res.status(400).json({
                success: false,
                error: errorMessage,
                invalidIds: result.invalidIds
            });
        }
        
        const remoteMode = String(process.env.SILOG_REMOTE_MODE || '').trim().toLowerCase();
        const isScheduledMode = ['scheduled', 'disable', 'disabled', 'none'].includes(remoteMode);

        // Déclencher l'EDI_JOB après validation (les lignes sont en 'O', donc visibles via V_REMONTE_TEMPS)
        // En mode "scheduled/disabled", on ne déclenche rien ici: une tâche planifiée Windows sur SERVEURERP s'en charge.
        let ediJobResult = null;
        if (triggerEdiJob && !isScheduledMode) {
            try {
                const idsForJob = result.validatedIds || tempsIds;
                ediJobResult = await EdiJobService.executeEdiJobForTransmittedRecords(idsForJob, codeTache);
                console.log(`✅ EDI_JOB exécuté pour ${idsForJob.length} enregistrements validés`);
            } catch (ediError) {
                console.error('❌ Erreur lors du déclenchement de l\'EDI_JOB:', ediError);
                ediJobResult = { success: false, error: ediError.message };
            }
        } else if (triggerEdiJob && isScheduledMode) {
            ediJobResult = {
                success: true,
                skipped: true,
                message: `EDI_JOB non déclenché par le backend (SILOG_REMOTE_MODE=${remoteMode}). Tâche planifiée Windows attendue.`
            };
        }

        // Marquer comme transmis uniquement si l'EDI_JOB est OK
        let markResult = null;
        // ⚠️ En mode scheduled/disabled, ne PAS marquer en 'T' (SILOG doit consommer les lignes 'O').
        if (!isScheduledMode && (!triggerEdiJob || (ediJobResult && ediJobResult.success && !ediJobResult.skipped))) {
            const idsToMark = result.validatedIds || tempsIds;
            markResult = await MonitoringService.markBatchAsTransmitted(idsToMark);
        }

        return res.json({
            success: isScheduledMode || !triggerEdiJob || (ediJobResult && ediJobResult.success),
            message: isScheduledMode
                ? `${result.message} (planifié: tâche SILOG sur SERVEURERP)`
                : result.message,
            count: result.count,
            ediJob: ediJobResult,
            marked: markResult
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la validation/transmission par lot:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la validation/transmission par lot'
        });
    }
});

// POST /api/admin/monitoring/repair-times-batch - Réparer StartTime/EndTime depuis ABHISTORIQUE_OPERATEURS
router.post('/monitoring/repair-times-batch', async (req, res) => {
    try {
        const { tempsIds } = req.body;
        if (!Array.isArray(tempsIds) || tempsIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Liste d\'IDs requise'
            });
        }

        const results = { success: [], errors: [] };
        for (const id of tempsIds) {
            const tempsId = parseInt(id, 10);
            if (!Number.isFinite(tempsId)) {
                results.errors.push({ tempsId: id, error: 'TempsId invalide' });
                continue;
            }
            const r = await MonitoringService.repairRecordTimes(tempsId);
            if (r.success) results.success.push({ tempsId, ...r.data });
            else results.errors.push({ tempsId, error: r.error });
        }

        return res.json({
            success: results.errors.length === 0,
            message: `${results.success.length} réparé(s), ${results.errors.length} erreur(s)`,
            results
        });
    } catch (error) {
        console.error('❌ Erreur repair-times-batch:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la réparation des heures',
            details: error.message
        });
    }
});

// ============================================
// ROUTES EDI_JOB - Exécution de l'EDI_JOB de SILOG
// ============================================

const EdiJobService = require('../services/EdiJobService');

// POST /api/admin/edi-job/execute - Déclencher l'EDI_JOB
router.post('/edi-job/execute', async (req, res) => {
    try {
        const { codeTache, options } = req.body;
        
        if (!codeTache) {
            return res.status(400).json({
                success: false,
                error: 'codeTache requis'
            });
        }
        
        const result = await EdiJobService.executeEdiJob(codeTache, options || {});
        
        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                data: {
                    codeTache: result.codeTache,
                    stdout: result.stdout,
                    warnings: result.warnings || false
                }
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error,
                details: result.details
            });
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'exécution de l\'EDI_JOB:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de l\'exécution de l\'EDI_JOB'
        });
    }
});

// GET /api/admin/edi-job/config - Vérifier la configuration de l'EDI_JOB
router.get('/edi-job/config', async (req, res) => {
    try {
        const result = await EdiJobService.checkConfiguration();
        
        res.json({
            success: result.success,
            config: result.config,
            pathExists: result.pathExists,
            pathError: result.pathError,
            ready: result.ready
        });
        
    } catch (error) {
        console.error('❌ Erreur lors de la vérification de la configuration:', error);
        res.status(500).json({
            success: false,
            error: 'Erreur serveur lors de la vérification de la configuration'
        });
    }
});

module.exports = router;
module.exports.processLancementEventsWithPauses = processLancementEventsWithPauses;
module.exports.getAdminOperations = getAdminOperations;