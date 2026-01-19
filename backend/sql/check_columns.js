/**
 * Script pour vérifier les colonnes existantes dans les tables SILOG
 */

const sql = require('mssql');
const path = require('path');

// Charger la configuration
let productionConfig = null;
try {
    productionConfig = require('../config-production');
} catch (error) {
    // Ignorer
}

const config = {
    server: productionConfig?.DB_ERP_SERVER || process.env.DB_ERP_SERVER || '192.168.1.14',
    database: productionConfig?.DB_ERP_DATABASE || process.env.DB_ERP_DATABASE || 'SEDI_ERP',
    user: productionConfig?.DB_ERP_USER || process.env.DB_ERP_USER || 'QUALITE',
    password: productionConfig?.DB_ERP_PASSWORD || process.env.DB_ERP_PASSWORD || 'QUALITE',
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        requestTimeout: 30000,
        connectionTimeout: 30000
    }
};

async function checkColumns() {
    let pool;
    
    try {
        console.log('🔗 Connexion à la base ERP...');
        pool = await sql.connect(config);
        console.log('✅ Connecté\n');
        
        // Vérifier RESSOURC
        console.log('=== Colonnes dans RESSOURC (recherche Statut/Consultation) ===');
        const ressourcQuery = `
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH,
                IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo'
              AND TABLE_NAME = 'RESSOURC'
              AND (
                COLUMN_NAME LIKE '%Statut%' OR
                COLUMN_NAME LIKE '%STATUT%' OR
                COLUMN_NAME LIKE '%DateConsultation%' OR
                COLUMN_NAME LIKE '%DATE_CONSULTATION%' OR
                COLUMN_NAME LIKE '%Date_Consultation%' OR
                COLUMN_NAME LIKE '%Consultation%' OR
                COLUMN_NAME LIKE '%CONSULTATION%'
              )
            ORDER BY COLUMN_NAME
        `;
        
        const ressourcResult = await pool.request().query(ressourcQuery);
        if (ressourcResult.recordset.length > 0) {
            console.table(ressourcResult.recordset);
        } else {
            console.log('❌ Aucune colonne trouvée correspondant aux critères');
        }
        
        console.log('\n=== Colonnes dans LCTC (recherche Consultation) ===');
        const lctcQuery = `
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH,
                IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo'
              AND TABLE_NAME = 'LCTC'
              AND (
                COLUMN_NAME LIKE '%DateConsultation%' OR
                COLUMN_NAME LIKE '%DATE_CONSULTATION%' OR
                COLUMN_NAME LIKE '%Date_Consultation%' OR
                COLUMN_NAME LIKE '%Consultation%' OR
                COLUMN_NAME LIKE '%CONSULTATION%'
              )
            ORDER BY COLUMN_NAME
        `;
        
        const lctcResult = await pool.request().query(lctcQuery);
        if (lctcResult.recordset.length > 0) {
            console.table(lctcResult.recordset);
        } else {
            console.log('❌ Aucune colonne trouvée correspondant aux critères');
        }
        
        console.log('\n=== Colonnes dans LCTE (recherche Consultation) ===');
        const lcteQuery = `
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH,
                IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo'
              AND TABLE_NAME = 'LCTE'
              AND (
                COLUMN_NAME LIKE '%DateConsultation%' OR
                COLUMN_NAME LIKE '%DATE_CONSULTATION%' OR
                COLUMN_NAME LIKE '%Date_Consultation%' OR
                COLUMN_NAME LIKE '%Consultation%' OR
                COLUMN_NAME LIKE '%CONSULTATION%'
              )
            ORDER BY COLUMN_NAME
        `;
        
        const lcteResult = await pool.request().query(lcteQuery);
        if (lcteResult.recordset.length > 0) {
            console.table(lcteResult.recordset);
        } else {
            console.log('❌ Aucune colonne trouvée correspondant aux critères');
        }
        
        // Afficher toutes les colonnes de RESSOURC pour référence
        console.log('\n=== Toutes les colonnes de RESSOURC (premiers 30) ===');
        const allRessourcQuery = `
            SELECT TOP 30
                COLUMN_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo'
              AND TABLE_NAME = 'RESSOURC'
            ORDER BY ORDINAL_POSITION
        `;
        
        const allRessourcResult = await pool.request().query(allRessourcQuery);
        console.table(allRessourcResult.recordset);
        
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

checkColumns()
    .then(() => {
        console.log('\n✅ Vérification terminée');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Erreur fatale:', error);
        process.exit(1);
    });
