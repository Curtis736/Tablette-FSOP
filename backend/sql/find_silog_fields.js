/**
 * Script pour trouver les champs VarAlphaUtil dans RESSOURC
 */

const sql = require('mssql');
const { loadProductionConfig, resolveDbCredentials } = require('../utils/sqlScriptEnv');

const productionConfig = loadProductionConfig();
const { user, password } = resolveDbCredentials(productionConfig, { erp: true });

const erpConfig = {
    server: productionConfig?.DB_ERP_SERVER || process.env.DB_ERP_SERVER || process.env.DB_SERVER,
    database: productionConfig?.DB_ERP_DATABASE || process.env.DB_ERP_DATABASE || 'SEDI_ERP',
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

async function findFields() {
    let pool;
    
    try {
        console.log('🔗 Connexion à la base ERP...');
        pool = await sql.connect(erpConfig);
        console.log('✅ Connecté\n');
        
        // Chercher tous les champs VarAlphaUtil dans RESSOURC
        console.log('=== Champs VarAlphaUtil dans RESSOURC ===');
        const varAlphaQuery = `
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH,
                IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo'
              AND TABLE_NAME = 'RESSOURC'
              AND COLUMN_NAME LIKE 'VarAlphaUtil%'
            ORDER BY COLUMN_NAME
        `;
        
        const varAlphaResult = await pool.request().query(varAlphaQuery);
        console.table(varAlphaResult.recordset);
        
        // Vérifier si V_RESSOURC existe dans SEDI_APP_INDEPENDANTE
        console.log('\n=== Vérification de V_RESSOURC dans SEDI_APP_INDEPENDANTE ===');
        const appConfig = {
            ...erpConfig,
            database: productionConfig?.DB_DATABASE || process.env.DB_DATABASE || 'SEDI_APP_INDEPENDANTE'
        };
        
        await pool.close();
        pool = await sql.connect(appConfig);
        
        const checkViewQuery = `
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
        
        const viewResult = await pool.request().query(checkViewQuery);
        if (viewResult.recordset.length > 0) {
            console.table(viewResult.recordset);
            
            // Obtenir la définition
            const defQuery = `
                SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.V_RESSOURC')) AS ViewDefinition
            `;
            const defResult = await pool.request().query(defQuery);
            if (defResult.recordset[0] && defResult.recordset[0].ViewDefinition) {
                console.log('\n=== Définition SQL de V_RESSOURC ===');
                console.log(defResult.recordset[0].ViewDefinition);
            }
        } else {
            console.log('❌ La vue V_RESSOURC n\'existe pas ou n\'a pas de colonnes');
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

findFields()
    .then(() => {
        console.log('\n✅ Vérification terminée');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Erreur fatale:', error);
        process.exit(1);
    });
