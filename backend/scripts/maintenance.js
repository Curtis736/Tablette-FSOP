#!/usr/bin/env node

/**
 * Script de maintenance pour le serveur de production
 * Usage: node scripts/maintenance.js [command]
 * 
 * Commands:
 * - cleanup: Nettoyer les données incohérentes
 * - validate: Valider l'intégrité des données
 * - report: Générer un rapport de santé
 * - fix-duplicates: Corriger les doublons de pauses
 */

const { executeQuery } = require('../config/database');
const fs = require('fs');
const path = require('path');
const FactorialService = require('../services/FactorialService');
const OperationStopService = require('../services/OperationStopService');
const FactorialOperatorMappingService = require('../services/FactorialOperatorMappingService');
const FactorialShiftSyncService = require('../services/FactorialShiftSyncService');
const FactorialClockOutClosureService = require('../services/FactorialClockOutClosureService');

class MaintenanceManager {
    constructor() {
        this.logFile = path.join(__dirname, '../logs/maintenance.log');
        this.ensureLogDirectory();
        this._fileLoggingDisabled = false;
    }

    ensureLogDirectory() {
        try {
            const logDir = path.dirname(this.logFile);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
        } catch (e) {
            // Ne jamais bloquer la maintenance pour un problème de filesystem (Docker volume permissions, etc.)
            this._fileLoggingDisabled = true;
        }
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        console.log(message);
        if (this._fileLoggingDisabled) return;
        try {
            fs.appendFileSync(this.logFile, logMessage);
        } catch (e) {
            // Si /app/logs est monté en volume avec mauvais owner/perms, éviter de crasher
            this._fileLoggingDisabled = true;
            console.warn('⚠️ Logging fichier désactivé (permission/FS):', e?.message || e);
        }
    }

    async autoCloseOpenOperations() {
        this.log('⏰ Fermeture automatique des opérations encore en cours pour la journée...');
        try {
            const closeQuery = `
                ;WITH LastEvents AS (
                    SELECT
                        OperatorCode,
                        CodeLanctImprod,
                        COALESCE(Phase, 'PRODUCTION') AS Phase,
                        CodeRubrique,
                        Ident,
                        Statut,
                        DateCreation,
                        NoEnreg,
                        ROW_NUMBER() OVER (
                            PARTITION BY OperatorCode,
                                         CodeLanctImprod,
                                         COALESCE(Phase, 'PRODUCTION'),
                                         CodeRubrique,
                                         CAST(DateCreation AS DATE)
                            ORDER BY DateCreation DESC, NoEnreg DESC
                        ) AS rn
                    FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                    WHERE CAST(DateCreation AS DATE) = CAST(GETDATE() AS DATE)
                      AND OperatorCode IS NOT NULL
                      AND OperatorCode != ''
                      AND OperatorCode != '0'
                )
                INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation)
                SELECT
                    OperatorCode,
                    CodeLanctImprod,
                    ISNULL(CodeRubrique, OperatorCode) AS CodeRubrique,
                    'FIN' AS Ident,
                    Phase,
                    'TERMINE' AS Statut,
                    NULL AS HeureDebut,
                    CAST(CONVERT(VARCHAR(8), GETDATE(), 108) AS TIME) AS HeureFin,
                    CAST(DateCreation AS DATE) AS DateCreation
                FROM LastEvents
                WHERE rn = 1
                  AND (Ident IN ('DEBUT', 'REPRISE', 'PAUSE') OR Statut IN ('EN_COURS', 'EN_PAUSE'))
                  AND NOT (Ident = 'FIN' OR Statut IN ('TERMINE', 'TERMINÉ'));
            `;

            const result = await executeQuery(closeQuery);
            const affected = Array.isArray(result?.rowsAffected)
                ? result.rowsAffected.reduce((a, b) => a + b, 0)
                : (result?.rowsAffected || 0);

            this.log(`✅ ${affected} opération(s) clôturée(s) automatiquement pour la journée en cours.`);
        } catch (error) {
            this.log(`❌ Erreur lors de la clôture automatique des opérations: ${error.message}`);
            throw error;
        }
    }

    async autoCloseFactorialDepointedOperations() {
        this.log('⏰ Contrôle Factorial: clôture des opérateurs dépointés...');

        if (!FactorialService.isEnabled()) {
            this.log('ℹ️ Contrôle Factorial désactivé (ENABLE_FACTORIAL_AUTOCLOSE!=true).');
            return { checkedOperators: 0, closedOperations: 0, skipped: true, reason: 'disabled' };
        }

        const now = new Date();
        const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        try {
            const openOpsQuery = `
                ;WITH LastEventPerStep AS (
                    SELECT
                        h.OperatorCode,
                        h.CodeLanctImprod,
                        COALESCE(h.Phase, 'PRODUCTION') AS Phase,
                        h.CodeRubrique,
                        h.Ident,
                        h.Statut,
                        h.DateCreation,
                        h.NoEnreg,
                        ROW_NUMBER() OVER (
                            PARTITION BY h.OperatorCode, h.CodeLanctImprod, COALESCE(h.Phase, 'PRODUCTION'), h.CodeRubrique
                            ORDER BY h.DateCreation DESC, h.NoEnreg DESC
                        ) AS rn
                    FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
                    WHERE h.DateCreation >= CONVERT(date, GETDATE())
                      AND h.DateCreation <  DATEADD(day, 1, CONVERT(date, GETDATE()))
                      AND h.OperatorCode IS NOT NULL
                      AND h.OperatorCode != ''
                      AND h.OperatorCode != '0'
                )
                SELECT OperatorCode, CodeLanctImprod, Phase, CodeRubrique
                FROM LastEventPerStep
                WHERE rn = 1
                  AND UPPER(LTRIM(RTRIM(COALESCE(Ident, '')))) <> 'FIN'
                  AND UPPER(LTRIM(RTRIM(COALESCE(Statut, '')))) IN ('EN_COURS', 'EN_PAUSE')
            `;

            const openOps = await executeQuery(openOpsQuery);
            if (!openOps || openOps.length === 0) {
                this.log('✅ Aucun lancement actif à vérifier.');
                return { checkedOperators: 0, closedOperations: 0, skipped: false, reason: 'nothing_open' };
            }

            const operators = [...new Set(openOps.map(o => String(o.OperatorCode).trim()).filter(Boolean))];
            const mappingByOperatorCode = await FactorialOperatorMappingService.getMappingsByOperatorCodes(operators);
            const depointedOperators = new Set();

            for (const operatorId of operators) {
                const mapping = mappingByOperatorCode[operatorId];
                if (!mapping || !mapping.FactorialEmployeeId) {
                    this.log(`ℹ️ Mapping Factorial absent pour opérateur ${operatorId} (clôture auto ignorée).`);
                    continue;
                }

                const factorialEmployeeId = String(mapping.FactorialEmployeeId).trim();
                const status = await FactorialService.getOperatorDepointedStatus(factorialEmployeeId, dateKey);
                if (!status.success) {
                    this.log(`⚠️ Factorial indisponible pour opérateur ${operatorId} (employeeId=${factorialEmployeeId}): ${JSON.stringify(status.error || status.reason)}`);
                    continue;
                }
                if (status.depointed === true) depointedOperators.add(operatorId);
            }

            if (depointedOperators.size === 0) {
                this.log('✅ Aucun opérateur dépointé à clôturer.');
                return { checkedOperators: operators.length, closedOperations: 0, skipped: false, reason: 'none_depointed' };
            }

            let closedOperations = 0;
            const nowTime = new Date().toTimeString().slice(0, 8);

            for (const op of openOps) {
                const operatorId = String(op.OperatorCode || '').trim();
                if (!depointedOperators.has(operatorId)) continue;

                const lancementCode = op.CodeLanctImprod;
                const phase = op.Phase || 'PRODUCTION';
                const codeRubrique = op.CodeRubrique || operatorId;

                try {
                    const stopResult = await OperationStopService.stopOperation({
                        operatorId,
                        lancementCode,
                        phase,
                        codeRubrique,
                        currentTime: nowTime,
                        currentDate: dateKey
                    });

                    if (stopResult?.alreadyFinished) {
                        this.log(`ℹ️ Étape déjà terminée (idempotence) ${operatorId}/${lancementCode}/${phase}`);
                        continue;
                    }

                    closedOperations += 1;
                    this.log(`✅ Auto-FIN (Factorial dépointé) ${operatorId}/${lancementCode}/${phase}`);
                } catch (error) {
                    this.log(`⚠️ Échec Auto-FIN (Factorial) ${operatorId}/${lancementCode}: ${error?.message || error}`);
                }
            }

            this.log(`✅ Contrôle Factorial terminé: ${closedOperations} opération(s) clôturée(s).`);
            return {
                checkedOperators: operators.length,
                closedOperations,
                skipped: false,
                reason: 'ok'
            };
        } catch (error) {
            this.log(`❌ Erreur contrôle Factorial: ${error?.message || error}`);
            throw error;
        }
    }

    async syncFactorialInOutAndAutoCloseClockOut() {
        this.log('⏰ Factorial IN/OUT sync: polling open_shifts + shifts (clock_in/clock_out) ...');

        if (!FactorialService.isEnabled()) {
            this.log('ℹ️ Factorial IN/OUT sync désactivé (ENABLE_FACTORIAL_AUTOCLOSE!=true).');
            return { success: true, skipped: true, reason: 'disabled' };
        }

        // On applique la règle uniquement à partir de l'heure serveur config.
        const startHour = Number.parseInt(process.env.FACTORIAL_CHECK_START_HOUR || '17', 10);
        const now = new Date();
        const currentHour = now.getHours();
        if (!Number.isNaN(startHour) && currentHour < startHour) {
            this.log(`🕔 IN/OUT sync ignorée: avant ${startHour}h.`);
            return { success: true, skipped: true, reason: 'before_start_hour' };
        }

        // 1) Récupérer les étapes ouvertes côté tablette pour aujourd'hui
        const openOpsQuery = `
            ;WITH LastEventPerStep AS (
                SELECT
                    h.OperatorCode,
                    h.CodeLanctImprod,
                    COALESCE(h.Phase, 'PRODUCTION') AS Phase,
                    h.CodeRubrique,
                    h.Ident,
                    h.Statut,
                    h.DateCreation,
                    h.NoEnreg,
                    ROW_NUMBER() OVER (
                        PARTITION BY h.OperatorCode, h.CodeLanctImprod, COALESCE(h.Phase, 'PRODUCTION'), h.CodeRubrique
                        ORDER BY h.DateCreation DESC, h.NoEnreg DESC
                    ) AS rn
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
                WHERE h.DateCreation >= CONVERT(date, GETDATE())
                  AND h.DateCreation <  DATEADD(day, 1, CONVERT(date, GETDATE()))
                  AND h.OperatorCode IS NOT NULL
                  AND h.OperatorCode != ''
                  AND h.OperatorCode != '0'
            )
            SELECT OperatorCode, CodeLanctImprod, Phase, CodeRubrique
            FROM LastEventPerStep
            WHERE rn = 1
              AND UPPER(LTRIM(RTRIM(COALESCE(Ident, '')))) <> 'FIN'
              AND UPPER(LTRIM(RTRIM(COALESCE(Statut, '')))) IN ('EN_COURS', 'EN_PAUSE')
        `;

        const openOps = await executeQuery(openOpsQuery);
        if (!openOps || openOps.length === 0) {
            this.log("✅ Aucun step ouvert aujourd'hui à clôturer.");
            return { success: true, skipped: true, reason: 'no_open_steps' };
        }

        const operatorCodes = [...new Set(openOps.map(o => String(o.OperatorCode).trim()).filter(Boolean))];
        if (operatorCodes.length === 0) {
            this.log('ℹ️ Aucun OperatorCode valide dans les steps ouverts.');
            return { success: true, skipped: true, reason: 'no_operator_codes' };
        }

        // 2) Mapping OperatorCode -> FactorialEmployeeId (ID-only)
        const mappingByOperatorCode = await FactorialOperatorMappingService.getMappingsByOperatorCodes(operatorCodes);
        const factorialEmployeeIds = [...new Set(
            operatorCodes
                .map(op => mappingByOperatorCode[op]?.FactorialEmployeeId)
                .filter(Boolean)
                .map(v => String(v).trim())
        )];

        if (factorialEmployeeIds.length === 0) {
            this.log('ℹ️ Aucun mapping Factorial actif pour les opérateurs ouverts. Pas de clôture.');
            return { success: true, skipped: true, reason: 'no_factorial_mapping' };
        }

        // 3) Sync IN/OUT events Factorial
        const lookbackDays = Number.parseInt(process.env.FACTORIAL_SHIFTS_LOOKBACK_DAYS || '2', 10) || 2;
        const rawRetentionDays = Number.parseInt(process.env.FACTORIAL_RAW_PAYLOAD_RETENTION_DAYS || '30', 10) || 30;

        const syncResult = await FactorialShiftSyncService.sync({
            factorialEmployeeIds,
            lookbackDays,
            rawRetentionDays
        });

        const insertedOutEvents = syncResult?.insertedOutEvents || [];
        if (insertedOutEvents.length === 0) {
            this.log('✅ Aucun clock_out nouveau détecté sur Factorial.');
            return { success: true, closedOperations: 0, insertedOutEvents: 0, reason: 'no_new_clock_out' };
        }

        // 4) Pour chaque clock_out OUT nouveau: clôturer les steps ouverts côté tablette
        // Préindex openOps par OperatorCode
        const openOpsByOperatorCode = openOps.reduce((acc, row) => {
            const op = String(row.OperatorCode).trim();
            if (!acc[op]) acc[op] = [];
            acc[op].push(row);
            return acc;
        }, {});

        let closedOperations = 0;

        // Trier par EventAt croissant: logique plus simple et plus prédictible
        insertedOutEvents
            .sort((a, b) => (a.EventAt?.getTime?.() || 0) - (b.EventAt?.getTime?.() || 0))
            .forEach(() => {});

        for (const outEvent of insertedOutEvents) {
            const factorialEmployeeId = String(outEvent.FactorialEmployeeId).trim();
            // Rechercher operatorCodes associés à ce FactorialEmployeeId
            const operatorCodesForEmployeeMap = await FactorialOperatorMappingService.getOperatorCodesByFactorialEmployeeIds([factorialEmployeeId]);
            const operatorCodesForEmployee = operatorCodesForEmployeeMap[factorialEmployeeId] || [];

            if (operatorCodesForEmployee.length === 0) continue;

            // Construire la liste des steps ouvertes à clôturer pour ces opérateurs
            const stepsToClose = [];
            for (const opCode of operatorCodesForEmployee) {
                const steps = openOpsByOperatorCode[opCode] || [];
                stepsToClose.push(...steps);
            }

            const closureResult = await FactorialClockOutClosureService.closeOpenOperatorSteps({
                operatorSteps: stepsToClose,
                clockOutAt: outEvent.EventAt
            });

            closedOperations += closureResult?.closedCount || 0;
        }

        this.log(`✅ Factorial IN/OUT terminé: clôture(s) effectuée(s): ${closedOperations}`);
        return { success: true, closedOperations, insertedOutEvents: insertedOutEvents.length };
    }

    async cleanupInconsistentData() {
        this.log('🧹 Début du nettoyage des données incohérentes...');
        
        try {
            // 1. Trouver tous les lancements avec des OperatorCode incohérents
            const inconsistentQuery = `
                SELECT 
                    CodeLanctImprod,
                    COUNT(DISTINCT OperatorCode) as operatorCount,
                    STRING_AGG(CAST(OperatorCode AS VARCHAR), ', ') as operatorCodes
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode IS NOT NULL 
                AND OperatorCode != ''
                AND OperatorCode != '0'
                GROUP BY CodeLanctImprod
                HAVING COUNT(DISTINCT OperatorCode) > 1
            `;
            
            const inconsistentLancements = await executeQuery(inconsistentQuery);
            
            if (inconsistentLancements.length === 0) {
                this.log('✅ Aucune donnée incohérente trouvée');
                return;
            }
            
            this.log(`⚠️ ${inconsistentLancements.length} lancements avec des données incohérentes trouvés`);
            
            for (const lancement of inconsistentLancements) {
                this.log(`🔍 Traitement du lancement ${lancement.CodeLanctImprod} (opérateurs: ${lancement.operatorCodes})`);
                
                // Garder seulement l'opérateur avec le plus d'événements
                const operatorCountQuery = `
                    SELECT 
                        OperatorCode,
                        COUNT(*) as eventCount
                    FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                    WHERE CodeLanctImprod = @lancementCode
                    GROUP BY OperatorCode
                    ORDER BY eventCount DESC
                `;
                
                const operatorCounts = await executeQuery(operatorCountQuery, { 
                    lancementCode: lancement.CodeLanctImprod 
                });
                
                if (operatorCounts.length > 0) {
                    const correctOperator = operatorCounts[0].OperatorCode;
                    this.log(`✅ Opérateur correct identifié: ${correctOperator} (${operatorCounts[0].eventCount} événements)`);
                    
                    // Supprimer les événements des autres opérateurs
                    const deleteQuery = `
                        DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                        WHERE CodeLanctImprod = @lancementCode 
                        AND OperatorCode != @correctOperator
                    `;
                    
                    const result = await executeQuery(deleteQuery, { 
                        lancementCode: lancement.CodeLanctImprod,
                        correctOperator 
                    });
                    
                    this.log(`✅ ${result.rowsAffected} événements incohérents supprimés`);
                }
            }
            
            this.log('✅ Nettoyage terminé avec succès');
            
        } catch (error) {
            this.log(`❌ Erreur lors du nettoyage: ${error.message}`);
            throw error;
        }
    }

    async fixDuplicatePauses() {
        this.log('🔧 Correction des doublons de pauses...');
        
        try {
            // Trouver les pauses en doublon
            const duplicatePausesQuery = `
                SELECT 
                    CodeLanctImprod,
                    OperatorCode,
                    Ident,
                    DateCreation,
                    COUNT(*) as duplicateCount
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE Ident = 'PAUSE'
                GROUP BY CodeLanctImprod, OperatorCode, Ident, DateCreation
                HAVING COUNT(*) > 1
            `;
            
            const duplicatePauses = await executeQuery(duplicatePausesQuery);
            
            if (duplicatePauses.length === 0) {
                this.log('✅ Aucun doublon de pause trouvé');
                return;
            }
            
            this.log(`⚠️ ${duplicatePauses.length} groupes de pauses en doublon trouvés`);
            
            for (const duplicate of duplicatePauses) {
                // Garder seulement la première pause, supprimer les autres
                const keepFirstQuery = `
                    WITH RankedPauses AS (
                        SELECT NoEnreg,
                               ROW_NUMBER() OVER (ORDER BY NoEnreg ASC) as rn
                        FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                        WHERE CodeLanctImprod = @lancementCode
                        AND OperatorCode = @operatorCode
                        AND Ident = 'PAUSE'
                        AND DateCreation = @dateCreation
                    )
                    DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                    WHERE NoEnreg IN (
                        SELECT NoEnreg FROM RankedPauses WHERE rn > 1
                    )
                `;
                
                await executeQuery(keepFirstQuery, {
                    lancementCode: duplicate.CodeLanctImprod,
                    operatorCode: duplicate.OperatorCode,
                    dateCreation: duplicate.DateCreation
                });
                
                this.log(`✅ ${duplicate.duplicateCount - 1} doublons supprimés pour ${duplicate.CodeLanctImprod}`);
            }
            
            this.log('✅ Correction des doublons terminée');
            
        } catch (error) {
            this.log(`❌ Erreur lors de la correction des doublons: ${error.message}`);
            throw error;
        }
    }

    async validateDataIntegrity() {
        this.log("🔍 Validation de l'intégrité des données...");
        
        const issues = [];
        
        try {
            // 1. Vérifier les lancements avec plusieurs opérateurs
            const multiOperatorQuery = `
                SELECT 
                    CodeLanctImprod,
                    COUNT(DISTINCT OperatorCode) as operatorCount
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode IS NOT NULL 
                AND OperatorCode != ''
                AND OperatorCode != '0'
                GROUP BY CodeLanctImprod
                HAVING COUNT(DISTINCT OperatorCode) > 1
            `;
            
            const multiOperatorLancements = await executeQuery(multiOperatorQuery);
            if (multiOperatorLancements.length > 0) {
                issues.push(`${multiOperatorLancements.length} lancements assignés à plusieurs opérateurs`);
            }
            
            // 2. Vérifier les pauses orphelines (sans reprise)
            const orphanPausesQuery = `
                SELECT COUNT(*) as orphanCount
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] p
                WHERE p.Ident = 'PAUSE'
                AND NOT EXISTS (
                    SELECT 1 FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] r
                    WHERE r.Ident = 'REPRISE'
                    AND r.CodeLanctImprod = p.CodeLanctImprod
                    AND r.OperatorCode = p.OperatorCode
                    AND r.DateCreation > p.DateCreation
                )
            `;
            
            const orphanPauses = await executeQuery(orphanPausesQuery);
            if (orphanPauses[0].orphanCount > 0) {
                issues.push(`${orphanPauses[0].orphanCount} pauses orphelines (sans reprise)`);
            }
            
            // 3. Vérifier les événements avec des OperatorCode invalides
            const invalidOperatorQuery = `
                SELECT COUNT(*) as invalidCount
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
                LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r ON h.OperatorCode = r.Coderessource
                WHERE h.OperatorCode IS NOT NULL 
                AND h.OperatorCode != ''
                AND h.OperatorCode != '0'
                AND r.Coderessource IS NULL
            `;
            
            const invalidOperators = await executeQuery(invalidOperatorQuery);
            if (invalidOperators[0].invalidCount > 0) {
                issues.push(`${invalidOperators[0].invalidCount} événements avec des OperatorCode invalides`);
            }
            
            if (issues.length === 0) {
                this.log('✅ Aucun problème d\'intégrité détecté');
            } else {
                this.log('⚠️ Problèmes d\'intégrité détectés:');
                issues.forEach(issue => this.log(`  - ${issue}`));
            }
            
            return issues;
            
        } catch (error) {
            this.log(`❌ Erreur lors de la validation: ${error.message}`);
            throw error;
        }
    }

    async generateHealthReport() {
        this.log('📊 Génération du rapport de santé...');
        
        try {
            const report = {
                timestamp: new Date().toISOString(),
                totalEvents: 0,
                totalOperators: 0,
                totalLancements: 0,
                issues: []
            };
            
            // Compter les événements
            const eventsCount = await executeQuery(`
                SELECT COUNT(*) as count 
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
            `);
            report.totalEvents = eventsCount[0].count;
            
            // Compter les opérateurs uniques
            const operatorsCount = await executeQuery(`
                SELECT COUNT(DISTINCT OperatorCode) as count 
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE OperatorCode IS NOT NULL AND OperatorCode != ''
            `);
            report.totalOperators = operatorsCount[0].count;
            
            // Compter les lancements uniques
            const lancementsCount = await executeQuery(`
                SELECT COUNT(DISTINCT CodeLanctImprod) as count 
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                WHERE CodeLanctImprod IS NOT NULL AND CodeLanctImprod != ''
            `);
            report.totalLancements = lancementsCount[0].count;
            
            // Identifier les problèmes
            report.issues = await this.validateDataIntegrity();
            
            // Sauvegarder le rapport
            const reportFile = path.join(__dirname, '../logs/health-report.json');
            fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
            
            this.log(`📊 Rapport sauvegardé: ${reportFile}`);
            this.log(`📊 Événements: ${report.totalEvents}, Opérateurs: ${report.totalOperators}, Lancements: ${report.totalLancements}`);
            
            return report;
            
        } catch (error) {
            this.log(`❌ Erreur lors de la génération du rapport: ${error.message}`);
            throw error;
        }
    }
}

// CLI
async function main() {
    const command = process.argv[2] || 'help';
    const maintenance = new MaintenanceManager();
    
    try {
        switch (command) {
            case 'cleanup':
                await maintenance.cleanupInconsistentData();
                break;
            case 'fix-duplicates':
                await maintenance.fixDuplicatePauses();
                break;
            case 'validate':
                await maintenance.validateDataIntegrity();
                break;
            case 'report':
                await maintenance.generateHealthReport();
                break;
            case 'auto-close-ops':
                await maintenance.autoCloseOpenOperations();
                break;
            case 'auto-close-factorial':
                await maintenance.autoCloseFactorialDepointedOperations();
                break;
            case 'all':
                await maintenance.cleanupInconsistentData();
                await maintenance.fixDuplicatePauses();
                await maintenance.generateHealthReport();
                break;
            default:
                console.log(`
Usage: node scripts/maintenance.js [command]

Commands:
  cleanup        - Nettoyer les données incohérentes
  fix-duplicates - Corriger les doublons de pauses
  validate       - Valider l'intégrité des données
  report         - Générer un rapport de santé
  auto-close-ops - Clôturer automatiquement les opérations encore en cours pour la journée
  auto-close-factorial - Clôturer les opérations d'opérateurs dépointés sur Factorial
  all            - Exécuter toutes les tâches de maintenance
                `);
        }
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = MaintenanceManager;


























