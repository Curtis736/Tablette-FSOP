/**
 * Script Node.js pour exécuter une migration SQL spécifique
 * Usage: node execute_single_migration.js <nom_du_fichier.sql>
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

// Obtenir le nom du fichier depuis les arguments
const scriptFileName = process.argv[2] || 'migration_update_silog_views_from_silog.sql';

function splitSqlBatches(sqlContent) {
    return sqlContent
        .replace(/^\uFEFF/, '') // BOM
        .split(/^\s*GO\s*$/gim)
        .map(b => b.trim());
}

function isMeaningfulBatch(batch) {
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

async function executeMigration() {
    console.log('\n' + '='.repeat(50));
    console.log('EXECUTION DE LA MIGRATION SQL');
    console.log('='.repeat(50));
    console.log(`Serveur: ${config.server}`);
    console.log(`Base de données: ${config.database}`);
    console.log(`Utilisateur: ${config.user}`);
    console.log(`Fichier: ${scriptFileName}`);
    console.log('');
    
    let pool;
    
    try {
        // Connexion à la base de données
        console.log('🔗 Connexion à la base de données...');
        pool = await sql.connect(config);
        console.log('✅ Connecté à la base de données\n');
        
        // Obtenir le répertoire des scripts
        const scriptsDir = __dirname;
        const scriptPath = path.join(scriptsDir, scriptFileName);
        
        if (!fs.existsSync(scriptPath)) {
            console.error(`❌ Fichier non trouvé: ${scriptPath}`);
            process.exit(1);
        }
        
        const success = await executeScript(pool, scriptPath, scriptFileName);
        
        if (!success) {
            console.error(`\n❌ Échec de l'exécution de ${scriptFileName}`);
            process.exit(1);
        }
        
        console.log('\n' + '='.repeat(50));
        console.log('✅ MIGRATION EXÉCUTÉE AVEC SUCCÈS!');
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

// Exécuter la migration
executeMigration()
    .then(() => {
        console.log('\n✅ Script terminé avec succès');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Erreur fatale:', error);
        process.exit(1);
    });
