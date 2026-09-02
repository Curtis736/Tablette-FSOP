/**
 * Script pour vérifier la structure des vues V_RESSOURC et V_LCTC
 */

const sql = require('mssql');
const { loadProductionConfig, resolveDbCredentials } = require('../utils/sqlScriptEnv');

const productionConfig = loadProductionConfig();
const { user, password } = resolveDbCredentials(productionConfig);

const config = {
    server: productionConfig?.DB_SERVER || process.env.DB_SERVER,
    database: productionConfig?.DB_DATABASE || process.env.DB_DATABASE || 'SEDI_APP_INDEPENDANTE',
    user,
    password,
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        requestTimeout: 30000,
        connectionTimeout: 30000
    }
};

async function checkViews() {
    let pool;
    
    try {
        console.log('🔗 Connexion à la base de données...');
        pool = await sql.connect(config);
        console.log('✅ Connecté\n');
        
        // Vérifier la définition de V_RESSOURC
        console.log('=== Définition de la vue V_RESSOURC ===');
        const viewRessourcQuery = `
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH,
                IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo'
              AND TABLE_NAME = 'V_RESSOURC'
            ORDER BY ORDINAL_POSITION
        `;
        
        const viewRessourcResult = await pool.request().query(viewRessourcQuery);
        console.table(viewRessourcResult.recordset);
        
        // Vérifier la définition de V_LCTC
        console.log('\n=== Définition de la vue V_LCTC ===');
        const viewLctcQuery = `
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH,
                IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo'
              AND TABLE_NAME = 'V_LCTC'
            ORDER BY ORDINAL_POSITION
        `;
        
        const viewLctcResult = await pool.request().query(viewLctcQuery);
        console.table(viewLctcResult.recordset);
        
        // Obtenir la définition SQL des vues
        console.log('\n=== Définition SQL de V_RESSOURC ===');
        const definitionRessourcQuery = `
            SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.V_RESSOURC')) AS ViewDefinition
        `;
        
        const defRessourcResult = await pool.request().query(definitionRessourcQuery);
        if (defRessourcResult.recordset[0] && defRessourcResult.recordset[0].ViewDefinition) {
            console.log(defRessourcResult.recordset[0].ViewDefinition);
        }
        
        console.log('\n=== Définition SQL de V_LCTC ===');
        const definitionLctcQuery = `
            SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.V_LCTC')) AS ViewDefinition
        `;
        
        const defLctcResult = await pool.request().query(definitionLctcQuery);
        if (defLctcResult.recordset[0] && defLctcResult.recordset[0].ViewDefinition) {
            console.log(defLctcResult.recordset[0].ViewDefinition);
        }
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
    } finally {
        if (pool) {
            await pool.close();
        }
    }
}

checkViews()
    .then(() => {
        console.log('\n✅ Vérification terminée');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Erreur fatale:', error);
        process.exit(1);
    });
