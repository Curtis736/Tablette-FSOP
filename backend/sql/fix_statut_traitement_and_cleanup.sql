-- ==========================================================================
-- CORRECTIF ABTEMPS_OPERATEURS : StatutTraitement + nettoyage durées 0
-- À exécuter sur SEDI_APP_INDEPENDANTE après déploiement du correctif backend.
-- ==========================================================================
USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '========================================';
PRINT '  DIAGNOSTIC AVANT CORRECTION';
PRINT '========================================';

-- 1. État actuel
SELECT
    StatutTraitement,
    COUNT(*) AS NbLignes,
    SUM(CASE WHEN ProductiveDuration = 0 AND TotalDuration = 0 THEN 1 ELSE 0 END) AS LignesDureeZero,
    SUM(CASE WHEN ProductiveDuration > 0 THEN 1 ELSE 0 END) AS LignesAvecDuree
FROM [dbo].[ABTEMPS_OPERATEURS]
GROUP BY StatutTraitement;
GO

-- 2. Lignes à durée 0 (créées par l'ancien bug DEBUT prématuré)
SELECT COUNT(*) AS LignesDureeZero_ASupprimer
FROM [dbo].[ABTEMPS_OPERATEURS]
WHERE ProductiveDuration = 0
  AND TotalDuration = 0
  AND StatutTraitement IS NULL;
GO

-- 3. Lignes éligibles à validation (durée > 0, statut NULL)
SELECT COUNT(*) AS LignesAValider
FROM [dbo].[ABTEMPS_OPERATEURS]
WHERE StatutTraitement IS NULL
  AND ProductiveDuration > 0;
GO

PRINT '';
PRINT '========================================';
PRINT '  ÉTAPE 1 : SUPPRIMER les lignes durée 0';
PRINT '========================================';

-- DÉCOMMENTER QUAND PRÊT (après vérification du diagnostic ci-dessus)
-- BEGIN TRAN;
-- DELETE FROM [dbo].[ABTEMPS_OPERATEURS]
-- WHERE ProductiveDuration = 0
--   AND TotalDuration = 0
--   AND StatutTraitement IS NULL;
-- PRINT '✅ Lignes à durée 0 supprimées : ' + CAST(@@ROWCOUNT AS VARCHAR);
-- COMMIT;
GO

PRINT '';
PRINT '========================================';
PRINT '  ÉTAPE 2 : VALIDER les lignes restantes';
PRINT '  (StatutTraitement NULL → O)';
PRINT '========================================';

-- DÉCOMMENTER QUAND PRÊT
-- BEGIN TRAN;
-- UPDATE [dbo].[ABTEMPS_OPERATEURS]
-- SET StatutTraitement = 'O'
-- WHERE StatutTraitement IS NULL
--   AND ProductiveDuration > 0;
-- PRINT '✅ Lignes validées : ' + CAST(@@ROWCOUNT AS VARCHAR);
-- COMMIT;
GO

PRINT '';
PRINT '========================================';
PRINT '  VÉRIFICATION APRÈS CORRECTION';
PRINT '========================================';

SELECT
    StatutTraitement,
    COUNT(*) AS NbLignes,
    MIN(DateCreation) AS PremiereDdate,
    MAX(DateCreation) AS DerniereDate
FROM [dbo].[ABTEMPS_OPERATEURS]
GROUP BY StatutTraitement;
GO

-- Contenu de V_REMONTE_TEMPS (devrait maintenant retourner des lignes)
SELECT TOP 10
    OperatorCode,
    LancementCode,
    Phase,
    CodeRubrique,
    DureeExecution,
    DateCreation
FROM [dbo].[V_REMONTE_TEMPS]
ORDER BY DateCreation DESC;
GO

PRINT '========================================';
PRINT '  TERMINÉ';
PRINT '========================================';
GO
