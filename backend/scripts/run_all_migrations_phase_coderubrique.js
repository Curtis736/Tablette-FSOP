/**
 * Script pour exécuter toutes les migrations Phase et CodeRubrique dans le bon ordre
 * Usage: node backend/scripts/run_all_migrations_phase_coderubrique.js
 */

require('dotenv').config();
const { executeQuery, executeNonQuery, getConnection } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function runSQLFile(filePath) {
    const sqlContent = fs.readFileSync(filePath, 'utf8');
    
    // Séparer les commandes par GO
    const commands = sqlContent.split(/\n\s*GO\s*\n/i).filter(cmd => cmd.trim().length > 0);
    
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
    console.log('=== Migration complète Phase et CodeRubrique ===');
    console.log('Début:', new Date().toISOString());
    console.log('');
    
    const sqlDir = path.join(__dirname, '..', 'sql');
    
    try {
        // 1. Corriger la vue V_LCTC pour pointer vers SEDI_2025
        console.log('🔧 ÉTAPE 1/3: Correction de la vue V_LCTC vers SEDI_2025...');
        const fixViewPath = path.join(sqlDir, 'migration_fix_v_lctc_database.sql');
        if (!fs.existsSync(fixViewPath)) {
            throw new Error(`Fichier non trouvé: ${fixViewPath}`);
        }
        await runSQLFile(fixViewPath);
        console.log('✅ Vue V_LCTC corrigée\n');
        
        // 2. Corriger les données existantes depuis V_LCTC
        console.log('🔧 ÉTAPE 2/3: Correction des données existantes depuis V_LCTC...');
        const fixDataPath = path.join(sqlDir, 'fix_phase_coderubrique_from_vlctc.sql');
        if (!fs.existsSync(fixDataPath)) {
            throw new Error(`Fichier non trouvé: ${fixDataPath}`);
        }
        await runSQLFile(fixDataPath);
        console.log('✅ Données corrigées\n');
        
        // 3. Vérifier qu'il n'y a plus de NULL avant de continuer
        console.log('🔍 Vérification finale avant migration NOT NULL...');
        const nullCheckQuery = `
            SELECT 
                COUNT(*) as nullPhaseCount
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            WHERE Phase IS NULL
        `;
        
        const nullCodeRubriqueQuery = `
            SELECT 
                COUNT(*) as nullCodeRubriqueCount
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            WHERE CodeRubrique IS NULL
        `;
        
        const phaseResult = await executeQuery(nullCheckQuery);
        const codeRubriqueResult = await executeQuery(nullCodeRubriqueQuery);
        
        const nullPhaseCount = phaseResult[0]?.nullPhaseCount || 0;
        const nullCodeRubriqueCount = codeRubriqueResult[0]?.nullCodeRubriqueCount || 0;
        
        if (nullPhaseCount > 0 || nullCodeRubriqueCount > 0) {
            console.error('❌ ERREUR: Des enregistrements ont encore Phase ou CodeRubrique NULL');
            console.error(`   Phase NULL: ${nullPhaseCount}`);
            console.error(`   CodeRubrique NULL: ${nullCodeRubriqueCount}`);
            console.error('   La migration NOT NULL ne peut pas continuer.');
            process.exit(1);
        }
        
        console.log('✅ Aucun enregistrement avec Phase ou CodeRubrique NULL\n');
        
        // 4. Rendre les colonnes NOT NULL
        console.log('🔧 ÉTAPE 3/3: Migration NOT NULL...');
        const migrationPath = path.join(sqlDir, 'migration_make_phase_coderubrique_not_null.sql');
        if (!fs.existsSync(migrationPath)) {
            throw new Error(`Fichier non trouvé: ${migrationPath}`);
        }
        await runSQLFile(migrationPath);
        console.log('✅ Migration NOT NULL terminée\n');
        
        console.log('');
        console.log('=== Migration complète terminée ===');
        console.log('Fin:', new Date().toISOString());
        console.log('');
        console.log('✅ La vue V_LCTC pointe maintenant vers SEDI_2025.dbo.LCTC');
        console.log('✅ Tous les enregistrements ont Phase et CodeRubrique renseignés');
        console.log('✅ Les colonnes Phase et CodeRubrique sont maintenant NOT NULL');
        console.log('✅ Les index ont été recréés');
        console.log('');
        console.log('⚠️  IMPORTANT: Assurez-vous que le code Node.js récupère toujours Phase et CodeRubrique depuis V_LCTC');
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Erreur lors de la migration:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Exécuter les migrations
runMigrations();
