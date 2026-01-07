/**
 * Script Node.js pour exécuter toutes les migrations SQL dans l'ordre
 * Utilise la configuration de connexion existante
 */

const fs = require('fs');
const path = require('path');
const sql = require('mssql');

// Charger la configuration de production si disponible
let productionConfig = null;
try {
    productionConfig = require('../config-production');
    console.log('✅ Configuration de production chargée');
} catch (error) {
    console.log('📝 Utilisation des variables d\'environnement');
}

// Configuration de la base de données
const config = {
    server: productionConfig?.DB_SERVER || process.env.DB_SERVER || '192.168.1.14',
    database: productionConfig?.DB_DATABASE || process.env.DB_DATABASE || 'SEDI_APP_INDEPENDANTE',
    user: productionConfig?.DB_USER || process.env.DB_USER || 'QUALITE',
    password: productionConfig?.DB_PASSWORD || process.env.DB_PASSWORD || 'QUALITE',
    options: {
        encrypt: productionConfig?.DB_ENCRYPT || process.env.DB_ENCRYPT === 'true' || false,
        trustServerCertificate: productionConfig?.DB_TRUST_CERT || process.env.DB_TRUST_CERT === 'true' || true,
        enableArithAbort: true,
        requestTimeout: 60000,
        connectionTimeout: 30000
    }
};

// Liste des scripts à exécuter dans l'ordre
const scripts = [
    { name: '1. Migration: Extension AB_COMMENTAIRES_OPERATEURS', file: 'migration_extend_comments.sql' },
    { name: '2. Migration: Extension ABHISTORIQUE_OPERATEURS', file: 'migration_extend_historique.sql' },
    { name: '3. Migration: Extension ABTEMPS_OPERATEURS', file: 'migration_extend_temps.sql' },
    { name: '4. Migration: Création vues SILOG', file: 'migration_create_silog_views.sql' },
    { name: '5. Migration: Table de mapping opérateurs', file: 'migration_create_operator_mapping.sql' },
    { name: '6. Scripts: Procédures stockées mapping opérateurs', file: 'scripts_operator_mapping.sql' },
    { name: '7. Migration: Table de mapping lancements (V_LCTC)', file: 'migration_create_lancement_mapping.sql' },
    { name: '8. Scripts: Procédures stockées mapping lancements', file: 'scripts_lancement_mapping.sql' },
    { name: '9. Migration: Update V_LCTC (ajout désignations)', file: 'migration_update_v_lctc_add_designations.sql' }
];

function splitSqlBatches(sqlContent) {
    // SQL Server: GO est un séparateur de batch quand il est SEUL sur une ligne (espaces autorisés)
    return sqlContent
        .replace(/^\uFEFF/, '') // BOM
        .split(/^\s*GO\s*$/gim)
        .map(b => b.trim());
}

function isMeaningfulBatch(batch) {
    // Considérer un batch "vide" s'il ne contient que des commentaires/espaces
    const withoutLineComments = batch.replace(/--.*$/gm, '');
    const withoutBlockComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
    return withoutBlockComments.trim().length > 0;
}

async function executeScript(pool, scriptPath, scriptName) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(scriptName);
    console.log('='.repeat(50));
    
    try {
        const sqlContent = fs.readFileSync(scriptPath, 'utf8');
        
        // Diviser le script en batches (séparés par GO sur une ligne)
        const batches = splitSqlBatches(sqlContent);
        
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            if (!isMeaningfulBatch(batch)) continue;
            
            // Créer une nouvelle requête pour chaque batch pour garantir l'isolation
            const request = pool.request();
            
            try {
                await request.query(batch);
                console.log(`✅ Batch ${i + 1}/${batches.length} exécuté`);
            } catch (error) {
                // Certaines erreurs peuvent être ignorées (ex: "déjà existe")
                if (error.message && (
                    error.message.includes('already exists') ||
                    error.message.includes('existe déjà') ||
                    error.message.includes('There is already') ||
                    error.message.includes('Cannot drop') && error.message.includes('because it does not exist')
                )) {
                    console.log(`ℹ️  Batch ${i + 1}: ${error.message.substring(0, 80)}...`);
                } else {
                    throw error;
                }
            }
        }
        
        console.log(`✅ ${scriptName} - TERMINÉ`);
        return true;
        
    } catch (error) {
        console.error(`❌ ERREUR lors de l'exécution de ${scriptName}:`);
        console.error(`   ${error.message}`);
        if (error.stack) {
            console.error(`   Stack: ${error.stack.substring(0, 200)}...`);
        }
        return false;
    }
}

async function executeAllMigrations() {
    console.log('\n' + '='.repeat(50));
    console.log('EXECUTION DE TOUTES LES MIGRATIONS SQL');
    console.log('='.repeat(50));
    console.log(`Serveur: ${config.server}`);
    console.log(`Base de données: ${config.database}`);
    console.log(`Utilisateur: ${config.user}`);
    console.log('');
    
    let pool;
    
    try {
        // Connexion à la base de données
        console.log('🔗 Connexion à la base de données...');
        pool = await sql.connect(config);
        console.log('✅ Connecté à la base de données\n');
        
        // Obtenir le répertoire des scripts
        const scriptsDir = __dirname;
        
        // Exécuter chaque script dans l'ordre
        for (const script of scripts) {
            const scriptPath = path.join(scriptsDir, script.file);
            
            if (!fs.existsSync(scriptPath)) {
                console.error(`❌ Fichier non trouvé: ${scriptPath}`);
                process.exit(1);
            }
            
            const success = await executeScript(pool, scriptPath, script.name);
            
            if (!success) {
                console.error(`\n❌ Échec de l'exécution de ${script.name}`);
                console.error('Arrêt de l\'exécution des migrations');
                process.exit(1);
            }
        }
        
        console.log('\n' + '='.repeat(50));
        console.log('✅ TOUTES LES MIGRATIONS ONT ÉTÉ EXÉCUTÉES AVEC SUCCÈS!');
        console.log('='.repeat(50));
        
    } catch (error) {
        console.error('\n❌ ERREUR CRITIQUE:');
        console.error(error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    } finally {
        if (pool) {
            await pool.close();
            console.log('\n🔌 Connexion fermée');
        }
    }
}

// Exécuter les migrations
executeAllMigrations()
    .then(() => {
        console.log('\n✅ Script terminé avec succès');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Erreur fatale:', error);
        process.exit(1);
    });

