/**
 * Script pour exécuter les migrations selon les spécifications de Franck MAILLARD
 * 
 * Usage depuis la VM:
 *   docker exec -it sedi-tablette-backend node /app/scripts/run_maillard_migrations.js
 * 
 * Ou depuis le conteneur:
 *   node /app/scripts/run_maillard_migrations.js
 * 
 * Migrations:
 * 1. migration_apply_maillard_specifications.sql - Met à jour V_LCTC et V_RESSOURC
 * 2. migration_create_vue_remontee_temps.sql - Crée V_REMONTE_TEMPS
 */

// Charger les variables d'environnement si disponibles
try {
    require('dotenv').config();
} catch (e) {
    // Ignorer si dotenv n'est pas disponible (dans Docker, les env vars sont déjà chargées)
}

const { executeQuery, executeNonQuery } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function runSQLFile(filePath) {
    const sqlContent = fs.readFileSync(filePath, 'utf8');
    
    // Séparer les commandes par GO
    const commands = sqlContent.split(/\n[ \t]*GO[ \t]*\n/i).filter(cmd => cmd.trim().length > 0);
    
    console.log(`\n📄 Exécution de ${path.basename(filePath)}...`);
    console.log(`   ${commands.length} commande(s) à exécuter\n`);
    
    for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i].trim();
        if (cmd.length === 0) continue;
        
        try {
            // Exécuter la commande
            if (cmd.toUpperCase().includes('SELECT') || cmd.toUpperCase().includes('PRINT')) {
                // Pour SELECT et PRINT, utiliser executeQuery
                const result = await executeQuery(cmd);
                // Afficher les résultats si c'est un SELECT
                if (cmd.toUpperCase().includes('SELECT') && result && result.length > 0) {
                    console.log(`   Résultat: ${result.length} ligne(s)`);
                    if (result.length <= 5) {
                        console.log(JSON.stringify(result, null, 2));
                    }
                }
            } else {
                // Pour les autres commandes (UPDATE, ALTER, CREATE, DROP, etc.)
                await executeNonQuery(cmd);
            }
        } catch (error) {
            // Si c'est un PRINT qui échoue (car executeQuery ne gère pas PRINT), ignorer
            if (cmd.toUpperCase().startsWith('PRINT')) {
                // PRINT est géré par SQL Server, on peut l'ignorer ici
                continue;
            }
            throw error;
        }
    }
}

async function runMigrations() {
    console.log('=== Migration selon spécifications Franck MAILLARD ===');
    console.log('Début:', new Date().toISOString());
    console.log('');
    
    const sqlDir = path.join(__dirname, '..', 'sql');
    
    try {
        // 1. Mettre à jour V_LCTC et V_RESSOURC
        console.log('🔧 ÉTAPE 1/2: Application spécifications Franck MAILLARD (V_LCTC et V_RESSOURC)...');
        const specificationsPath = path.join(sqlDir, 'migration_apply_maillard_specifications.sql');
        if (!fs.existsSync(specificationsPath)) {
            throw new Error(`Fichier non trouvé: ${specificationsPath}`);
        }
        await runSQLFile(specificationsPath);
        console.log('✅ V_LCTC et V_RESSOURC mises à jour\n');
        
        // 2. Créer la vue V_REMONTE_TEMPS
        console.log('🔧 ÉTAPE 2/2: Création vue remontée des temps...');
        const vueRemonteePath = path.join(sqlDir, 'migration_create_vue_remontee_temps.sql');
        if (!fs.existsSync(vueRemonteePath)) {
            throw new Error(`Fichier non trouvé: ${vueRemonteePath}`);
        }
        await runSQLFile(vueRemonteePath);
        console.log('✅ Vue V_REMONTE_TEMPS créée\n');
        
        // 3. Vérifications finales
        console.log('🔍 Vérifications finales...');
        
        // Vérifier V_LCTC
        const checkVLCTC = `
            SELECT TOP 1 
                CodeLancement,
                Phase,
                CodeRubrique,
                DateConsultation
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]
        `;
        const vlctcResult = await executeQuery(checkVLCTC);
        if (vlctcResult && vlctcResult.length > 0) {
            console.log('✅ V_LCTC fonctionne correctement');
            console.log(`   Exemple: CodeLancement=${vlctcResult[0].CodeLancement}, Phase=${vlctcResult[0].Phase}, CodeRubrique=${vlctcResult[0].CodeRubrique}`);
        } else {
            console.log('⚠️  V_LCTC ne retourne aucun résultat (peut être normal si aucune donnée)');
        }
        
        // Vérifier V_RESSOURC
        const checkVRESSOURC = `
            SELECT TOP 1 
                CodeOperateur,
                NomOperateur,
                StatutOperateur,
                DateConsultation
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_RESSOURC]
        `;
        const vressourcResult = await executeQuery(checkVRESSOURC);
        if (vressourcResult && vressourcResult.length > 0) {
            console.log('✅ V_RESSOURC fonctionne correctement');
            console.log(`   Exemple: CodeOperateur=${vressourcResult[0].CodeOperateur}, NomOperateur=${vressourcResult[0].NomOperateur}`);
        } else {
            console.log('⚠️  V_RESSOURC ne retourne aucun résultat (peut être normal si aucune donnée)');
        }
        
        // Vérifier V_REMONTE_TEMPS
        const checkVRemonte = `
            SELECT TOP 1 
                DateCreation,
                LancementCode,
                Phase,
                CodeRubrique,
                DureeExecution
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_REMONTE_TEMPS]
        `;
        const vremonteResult = await executeQuery(checkVRemonte);
        if (vremonteResult && vremonteResult.length > 0) {
            console.log('✅ V_REMONTE_TEMPS fonctionne correctement');
            console.log(`   Exemple: LancementCode=${vremonteResult[0].LancementCode}, DureeExecution=${vremonteResult[0].DureeExecution} heures`);
        } else {
            console.log('⚠️  V_REMONTE_TEMPS ne retourne aucun résultat (normal si aucun enregistrement avec StatutTraitement = \'O\')');
        }
        
        console.log('');
        console.log('=== Migration terminée ===');
        console.log('Fin:', new Date().toISOString());
        console.log('');
        console.log('✅ V_LCTC mise à jour selon spécifications:');
        console.log('   - Base: SEDI_ERP (pas SEDI_2025)');
        console.log('   - Filtre: TypeRubrique=\'O\' (seulement les temps, pas les composants)');
        console.log('   - Filtre: LancementSolde=\'N\' (seulement les lancements non soldés)');
        console.log('   - DateConsultation depuis LCTE.VARAlphaUtil5');
        console.log('');
        console.log('✅ V_RESSOURC mise à jour selon spécifications:');
        console.log('   - StatutOperateur depuis TableAlphaUtil');
        console.log('   - DateConsultation depuis TableAlphaUtil2');
        console.log('');
        console.log('✅ V_REMONTE_TEMPS créée:');
        console.log('   - Filtre: StatutTraitement = \'O\' (seulement les enregistrements validés)');
        console.log('   - Filtre: ProductiveDuration > 0 (SILOG n\'accepte pas les temps à 0)');
        console.log('   - DureeExecution en heures (ProductiveDuration / 60)');
        console.log('');
        console.log('⚠️  IMPORTANT: La vue filtre sur StatutTraitement = \'O\' (validé)');
        console.log('⚠️  IMPORTANT: Vérifier que les requêtes V_LCTC dans le code fonctionnent avec TypeRubrique=\'O\'');
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Erreur lors de la migration:', error);
        console.error('Détails:', error.message);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
        process.exit(1);
    }
}

// Exécuter les migrations
runMigrations();
