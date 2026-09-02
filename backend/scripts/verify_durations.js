/**
 * Script Node.js pour vérifier les durées dans ABTEMPS_OPERATEURS
 * Vérifie la cohérence entre TotalDuration, PauseDuration et ProductiveDuration
 */

const sql = require('mssql');
const { resolveDbCredentials } = require('../utils/sqlScriptEnv');

const { user, password } = resolveDbCredentials(null);

const dbConfig = {
    server: process.env.DB_SERVER || 'SERVEURERP',
    database: process.env.DB_DATABASE || 'SEDI_APP_INDEPENDANTE',
    user,
    password,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
        enableArithAbort: true
    }
};

async function verifyDurations() {
    let pool;
    
    try {
        console.log('🔍 Connexion à la base de données...');
        pool = await sql.connect(dbConfig);
        console.log('✅ Connecté à la base de données');
        
        // 1. Vérifier les durées nulles ou négatives
        console.log('\n1️⃣ Vérification des durées nulles ou négatives...');
        const nullOrNegativeQuery = `
            SELECT 
                TempsId,
                OperatorCode,
                LancementCode,
                TotalDuration,
                PauseDuration,
                ProductiveDuration,
                StartTime,
                EndTime,
                StatutTraitement,
                DateCreation
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            WHERE TotalDuration < 0 
               OR PauseDuration < 0 
               OR ProductiveDuration < 0
               OR TotalDuration IS NULL
               OR PauseDuration IS NULL
               OR ProductiveDuration IS NULL
            ORDER BY DateCreation DESC
        `;
        const nullOrNegative = await pool.request().query(nullOrNegativeQuery);
        console.log(`   ${nullOrNegative.recordset.length} enregistrements avec durées nulles ou négatives`);
        if (nullOrNegative.recordset.length > 0) {
            console.table(nullOrNegative.recordset);
        }
        
        // 2. Vérifier les incohérences
        console.log('\n2️⃣ Vérification des incohérences ProductiveDuration...');
        const inconsistencyQuery = `
            SELECT 
                TempsId,
                OperatorCode,
                LancementCode,
                TotalDuration,
                PauseDuration,
                ProductiveDuration,
                (TotalDuration - PauseDuration) AS CalculatedProductive,
                (ProductiveDuration - (TotalDuration - PauseDuration)) AS Difference,
                StartTime,
                EndTime,
                StatutTraitement
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            WHERE ABS(ProductiveDuration - (TotalDuration - PauseDuration)) > 1
            ORDER BY ABS(ProductiveDuration - (TotalDuration - PauseDuration)) DESC
        `;
        const inconsistencies = await pool.request().query(inconsistencyQuery);
        console.log(`   ${inconsistencies.recordset.length} enregistrements avec incohérences`);
        if (inconsistencies.recordset.length > 0) {
            console.table(inconsistencies.recordset);
        }
        
        // 3. Vérifier les ProductiveDuration = 0
        console.log('\n3️⃣ Vérification des ProductiveDuration = 0...');
        const zeroProductiveQuery = `
            SELECT 
                TempsId,
                OperatorCode,
                LancementCode,
                TotalDuration,
                PauseDuration,
                ProductiveDuration,
                StartTime,
                EndTime,
                StatutTraitement,
                DateCreation
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            WHERE ProductiveDuration = 0
            ORDER BY DateCreation DESC
        `;
        const zeroProductive = await pool.request().query(zeroProductiveQuery);
        console.log(`   ${zeroProductive.recordset.length} enregistrements avec ProductiveDuration = 0`);
        if (zeroProductive.recordset.length > 0 && zeroProductive.recordset.length <= 20) {
            console.table(zeroProductive.recordset);
        } else if (zeroProductive.recordset.length > 20) {
            console.table(zeroProductive.recordset.slice(0, 20));
            console.log(`   ... et ${zeroProductive.recordset.length - 20} autres`);
        }
        
        // 4. Statistiques générales
        console.log('\n4️⃣ Statistiques générales...');
        const statsQuery = `
            SELECT 
                COUNT(*) AS TotalRecords,
                COUNT(CASE WHEN ProductiveDuration > 0 THEN 1 END) AS RecordsWithProductiveDuration,
                COUNT(CASE WHEN ProductiveDuration = 0 THEN 1 END) AS RecordsWithZeroProductiveDuration,
                COUNT(CASE WHEN ProductiveDuration < 0 THEN 1 END) AS RecordsWithNegativeProductiveDuration,
                COUNT(CASE WHEN ABS(ProductiveDuration - (TotalDuration - PauseDuration)) > 1 THEN 1 END) AS RecordsWithInconsistency,
                AVG(CAST(TotalDuration AS FLOAT)) AS AvgTotalDuration,
                AVG(CAST(PauseDuration AS FLOAT)) AS AvgPauseDuration,
                AVG(CAST(ProductiveDuration AS FLOAT)) AS AvgProductiveDuration,
                MIN(ProductiveDuration) AS MinProductiveDuration,
                MAX(ProductiveDuration) AS MaxProductiveDuration
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
        `;
        const stats = await pool.request().query(statsQuery);
        console.table(stats.recordset[0]);
        
        // 5. Vérifier les enregistrements non transférés avec ProductiveDuration = 0
        console.log('\n5️⃣ Enregistrements non transférés avec ProductiveDuration = 0...');
        const nonTransferredQuery = `
            SELECT 
                TempsId,
                OperatorCode,
                LancementCode,
                TotalDuration,
                PauseDuration,
                ProductiveDuration,
                StartTime,
                EndTime,
                StatutTraitement,
                DateCreation
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            WHERE (StatutTraitement IS NULL OR StatutTraitement != 'T')
              AND ProductiveDuration = 0
            ORDER BY DateCreation DESC
        `;
        const nonTransferred = await pool.request().query(nonTransferredQuery);
        console.log(`   ${nonTransferred.recordset.length} enregistrements non transférés avec ProductiveDuration = 0`);
        if (nonTransferred.recordset.length > 0 && nonTransferred.recordset.length <= 20) {
            console.table(nonTransferred.recordset);
        } else if (nonTransferred.recordset.length > 20) {
            console.table(nonTransferred.recordset.slice(0, 20));
            console.log(`   ... et ${nonTransferred.recordset.length - 20} autres`);
        }
        
        // 6. Vérifier les enregistrements transférés avec ProductiveDuration = 0
        console.log('\n6️⃣ Enregistrements transférés avec ProductiveDuration = 0...');
        const transferredQuery = `
            SELECT 
                TempsId,
                OperatorCode,
                LancementCode,
                TotalDuration,
                PauseDuration,
                ProductiveDuration,
                StartTime,
                EndTime,
                StatutTraitement,
                DateCreation
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            WHERE StatutTraitement = 'T'
              AND ProductiveDuration = 0
            ORDER BY DateCreation DESC
        `;
        const transferred = await pool.request().query(transferredQuery);
        console.log(`   ${transferred.recordset.length} enregistrements transférés avec ProductiveDuration = 0`);
        if (transferred.recordset.length > 0) {
            console.warn('   ⚠️ ATTENTION: Des enregistrements transférés ont ProductiveDuration = 0');
            console.table(transferred.recordset);
        }
        
        console.log('\n✅ Vérification terminée');
        
    } catch (error) {
        console.error('❌ Erreur lors de la vérification:', error);
        process.exit(1);
    } finally {
        if (pool) {
            await pool.close();
            console.log('🔌 Connexion fermée');
        }
    }
}

// Exécuter le script
verifyDurations();
