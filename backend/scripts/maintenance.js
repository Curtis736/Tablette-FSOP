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

class MaintenanceManager {
    constructor() {
        this.logFile = path.join(__dirname, '../logs/maintenance.log');
        this.ensureLogDirectory();
    }

    ensureLogDirectory() {
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        console.log(message);
        fs.appendFileSync(this.logFile, logMessage);
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


























