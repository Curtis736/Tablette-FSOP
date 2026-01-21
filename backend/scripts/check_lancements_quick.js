/**
 * Script rapide pour vérifier pourquoi des lancements ne sont pas dans V_LCTC
 * Usage: docker exec -it sedi-tablette-backend node /app/scripts/check_lancements_quick.js LT2400189 LT2501139
 */

const { executeQuery } = require('../config/database');

async function checkLancements() {
    const lancements = process.argv.slice(2);
    
    if (lancements.length === 0) {
        console.log('Usage: node check_lancements_quick.js LT2400189 LT2501139');
        process.exit(1);
    }
    
    console.log(`🔍 Vérification des lancements: ${lancements.join(', ')}\n`);
    
    try {
        // 1. Vérifier tous les TypeRubrique pour ces lancements
        console.log('1. Tous les TypeRubrique pour ces lancements:');
        const typeRubriqueQuery = `
            SELECT 
                LCTC.CodeLancement,
                LCTC.TypeRubrique,
                LCTE.LancementSolde,
                COUNT(*) as NombreLignes,
                STRING_AGG(CAST(LCTC.Phase AS VARCHAR), ', ') as Phases
            FROM [SEDI_ERP].[dbo].[LCTC]
            LEFT JOIN [SEDI_ERP].[dbo].[LCTE] ON LCTE.CodeLancement = LCTC.CodeLancement
            WHERE LCTC.CodeLancement IN (${lancements.map((_, i) => `@lancement${i}`).join(', ')})
            GROUP BY LCTC.CodeLancement, LCTC.TypeRubrique, LCTE.LancementSolde
        `;
        
        const params = {};
        lancements.forEach((l, i) => {
            params[`lancement${i}`] = l;
        });
        
        const typeRubriqueResult = await executeQuery(typeRubriqueQuery, params);
        if (typeRubriqueResult && typeRubriqueResult.length > 0) {
            console.log(JSON.stringify(typeRubriqueResult, null, 2));
        } else {
            console.log('❌ Aucun résultat - Les lancements n\'existent pas dans SEDI_ERP.dbo.LCTC\n');
        }
        
        // 2. Vérifier ce que V_LCTC retourne
        console.log('\n2. Résultat de V_LCTC pour ces lancements:');
        const vlctcQuery = `
            SELECT 
                CodeLancement,
                Phase,
                CodeRubrique,
                DateConsultation
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]
            WHERE CodeLancement IN (${lancements.map((_, i) => `@lancement${i}`).join(', ')})
        `;
        
        const vlctcResult = await executeQuery(vlctcQuery, params);
        if (vlctcResult && vlctcResult.length > 0) {
            console.log(JSON.stringify(vlctcResult, null, 2));
        } else {
            console.log('❌ Aucun résultat - Les lancements ne sont pas dans V_LCTC\n');
        }
        
        // 3. Résumé
        console.log('\n=== Résumé ===');
        if (typeRubriqueResult && typeRubriqueResult.length > 0) {
            const hasTypeO = typeRubriqueResult.some(r => r.TypeRubrique === 'O');
            const hasSoldeN = typeRubriqueResult.some(r => r.LancementSolde === 'N');
            
            if (!hasTypeO) {
                console.log('⚠️  Les lancements n\'ont pas TypeRubrique=\'O\' (ce sont des composants)');
                console.log('   → Normal: Ces opérations ne doivent PAS être consolidées');
            }
            if (!hasSoldeN) {
                console.log('⚠️  Les lancements ne sont pas avec LancementSolde=\'N\' (soldés)');
                console.log('   → Normal: Les lancements soldés ne peuvent pas être enregistrés dans SILOG');
            }
            if (hasTypeO && hasSoldeN && (!vlctcResult || vlctcResult.length === 0)) {
                console.log('❌ Problème: Les lancements devraient être dans V_LCTC mais ne le sont pas');
            }

            // 4. Test automatique du "dernier point":
            // Montrer un exemple concret:
            // - lancement soldé => absent de V_LCTC (déjà démontré par les résultats ci-dessus)
            // - lancement non soldé + TypeRubrique='O' => présent dans V_LCTC
            if (!vlctcResult || vlctcResult.length === 0) {
                console.log('\n=== Test automatique V_LCTC (preuve par exemple) ===');
                console.log('🔎 Recherche d\'un lancement NON soldé présent dans V_LCTC...');

                const sampleFromView = await executeQuery(`
                    SELECT TOP 1 CodeLancement
                    FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]
                    ORDER BY CodeLancement DESC
                `);

                const sampleCode = sampleFromView?.[0]?.CodeLancement;
                if (!sampleCode) {
                    console.log('❌ Aucun lancement trouvé dans V_LCTC (la vue est vide) → impossible de démontrer le filtre avec un exemple.');
                } else {
                    console.log(`✅ Exemple lancement NON soldé trouvé dans V_LCTC: ${sampleCode}`);

                    const sampleDetails = await executeQuery(`
                        SELECT TOP 5
                            LCTC.CodeLancement,
                            LCTC.TypeRubrique,
                            LCTE.LancementSolde,
                            LCTC.Phase,
                            LCTC.CodeRubrique
                        FROM [SEDI_ERP].[dbo].[LCTC]
                        JOIN [SEDI_ERP].[dbo].[LCTE] ON LCTE.CodeLancement = LCTC.CodeLancement
                        WHERE LCTC.CodeLancement = @code
                        ORDER BY LCTC.Phase, LCTC.CodeRubrique
                    `, { code: sampleCode });

                    const sampleViewRows = await executeQuery(`
                        SELECT TOP 5
                            CodeLancement,
                            Phase,
                            CodeRubrique,
                            DateConsultation
                        FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]
                        WHERE CodeLancement = @code
                        ORDER BY Phase, CodeRubrique
                    `, { code: sampleCode });

                    console.log('\n➡️ Données source SEDI_ERP (doit montrer LancementSolde=\'N\' et TypeRubrique=\'O\'):');
                    console.log(JSON.stringify(sampleDetails, null, 2));
                    console.log('\n➡️ Lignes retournées par V_LCTC (doit être non vide):');
                    console.log(JSON.stringify(sampleViewRows, null, 2));
                }
            }
        } else {
            console.log('❌ Les lancements n\'existent pas dans SEDI_ERP.dbo.LCTC');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erreur:', error.message);
        process.exit(1);
    }
}

checkLancements();
