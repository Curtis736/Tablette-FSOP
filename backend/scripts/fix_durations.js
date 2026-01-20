/**
 * Script Node.js pour corriger les durées dans ABTEMPS_OPERATEURS
 * Corrige les incohérences et recalcule ProductiveDuration si nécessaire
 */

const sql = require('mssql');

// Configuration de la base de données depuis les variables d'environnement
const dbConfig = {
    server: process.env.DB_SERVER || 'SERVEURERP',
    database: process.env.DB_DATABASE || 'SEDI_APP_INDEPENDANTE',
    user: process.env.DB_USER || 'QUALITE',
    password: process.env.DB_PASSWORD || 'QUALITE',
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
        enableArithAbort: true
    }
};

async function fixDurations() {
    let pool;
    
    try {
        console.log('🔍 Connexion à la base de données...');
        pool = await sql.connect(dbConfig);
        console.log('✅ Connecté à la base de données');
        
        // 1. Corriger les incohérences : ProductiveDuration != TotalDuration - PauseDuration
        console.log('\n1️⃣ Correction des incohérences ProductiveDuration...');
        const fixInconsistenciesQuery = `
            UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            SET ProductiveDuration = TotalDuration - PauseDuration
            WHERE ABS(ProductiveDuration - (TotalDuration - PauseDuration)) > 1
              AND TotalDuration >= 0
              AND PauseDuration >= 0
        `;
        const inconsistencyResult = await pool.request().query(fixInconsistenciesQuery);
        console.log(`   ✅ ${inconsistencyResult.rowsAffected[0]} enregistrements corrigés`);
        
        // 2. Corriger les ProductiveDuration = 0 quand TotalDuration > 0
        console.log('\n2️⃣ Correction des ProductiveDuration = 0 avec TotalDuration > 0...');
        const fixZeroProductiveQuery = `
            UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            SET ProductiveDuration = TotalDuration - PauseDuration
            WHERE ProductiveDuration = 0
              AND TotalDuration > 0
              AND TotalDuration >= PauseDuration
        `;
        const zeroProductiveResult = await pool.request().query(fixZeroProductiveQuery);
        console.log(`   ✅ ${zeroProductiveResult.rowsAffected[0]} enregistrements corrigés`);
        
        // 3. Corriger les durées négatives (mettre à 0)
        console.log('\n3️⃣ Correction des durées négatives...');
        const fixNegativeQuery = `
            UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            SET 
                TotalDuration = CASE WHEN TotalDuration < 0 THEN 0 ELSE TotalDuration END,
                PauseDuration = CASE WHEN PauseDuration < 0 THEN 0 ELSE PauseDuration END,
                ProductiveDuration = CASE 
                    WHEN TotalDuration < 0 OR PauseDuration < 0 THEN 
                        CASE WHEN TotalDuration < 0 THEN 0 ELSE TotalDuration END - 
                        CASE WHEN PauseDuration < 0 THEN 0 ELSE PauseDuration END
                    ELSE ProductiveDuration 
                END
            WHERE TotalDuration < 0 OR PauseDuration < 0 OR ProductiveDuration < 0
        `;
        const negativeResult = await pool.request().query(fixNegativeQuery);
        console.log(`   ✅ ${negativeResult.rowsAffected[0]} enregistrements corrigés`);
        
        // 4. Vérifier les résultats après correction
        console.log('\n4️⃣ Vérification après correction...');
        const verifyQuery = `
            SELECT 
                COUNT(*) AS TotalRecords,
                COUNT(CASE WHEN ProductiveDuration > 0 THEN 1 END) AS RecordsWithProductiveDuration,
                COUNT(CASE WHEN ProductiveDuration = 0 THEN 1 END) AS RecordsWithZeroProductiveDuration,
                COUNT(CASE WHEN ProductiveDuration < 0 THEN 1 END) AS RecordsWithNegativeProductiveDuration,
                COUNT(CASE WHEN ABS(ProductiveDuration - (TotalDuration - PauseDuration)) > 1 THEN 1 END) AS RecordsWithInconsistency
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
        `;
        const verifyResult = await pool.request().query(verifyQuery);
        console.table(verifyResult.recordset[0]);
        
        // 5. Afficher les enregistrements avec ProductiveDuration = 0 restants (TotalDuration = 0, c'est normal)
        console.log('\n5️⃣ Enregistrements avec ProductiveDuration = 0 restants (TotalDuration = 0, normal)...');
        const remainingZeroQuery = `
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
        const remainingZero = await pool.request().query(remainingZeroQuery);
        console.log(`   ${remainingZero.recordset.length} enregistrements avec ProductiveDuration = 0 (TotalDuration = 0, opérations très courtes)`);
        if (remainingZero.recordset.length > 0 && remainingZero.recordset.length <= 20) {
            console.table(remainingZero.recordset);
        } else if (remainingZero.recordset.length > 20) {
            console.table(remainingZero.recordset.slice(0, 20));
            console.log(`   ... et ${remainingZero.recordset.length - 20} autres`);
        }
        
        // 6. Afficher les incohérences restantes (s'il y en a)
        console.log('\n6️⃣ Vérification des incohérences restantes...');
        const remainingInconsistenciesQuery = `
            SELECT 
                TempsId,
                OperatorCode,
                LancementCode,
                TotalDuration,
                PauseDuration,
                ProductiveDuration,
                (TotalDuration - PauseDuration) AS CalculatedProductive,
                (ProductiveDuration - (TotalDuration - PauseDuration)) AS Difference
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
            WHERE ABS(ProductiveDuration - (TotalDuration - PauseDuration)) > 1
        `;
        const remainingInconsistencies = await pool.request().query(remainingInconsistenciesQuery);
        if (remainingInconsistencies.recordset.length > 0) {
            console.warn(`   ⚠️ ${remainingInconsistencies.recordset.length} incohérences restantes:`);
            console.table(remainingInconsistencies.recordset);
        } else {
            console.log('   ✅ Aucune incohérence restante');
        }
        
        console.log('\n✅ Correction terminée');
        
    } catch (error) {
        console.error('❌ Erreur lors de la correction:', error);
        process.exit(1);
    } finally {
        if (pool) {
            await pool.close();
            console.log('🔌 Connexion fermée');
        }
    }
}

// Exécuter le script
fixDurations();
