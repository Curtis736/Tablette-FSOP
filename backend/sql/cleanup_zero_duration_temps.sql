-- Nettoyage ponctuel : supprimer les lignes ABTEMPS_OPERATEURS à durée 0
-- créées par l'ancien bug (INSERT prématuré au DEBUT, avant correction).
-- À exécuter UNE SEULE FOIS après déploiement du correctif.

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Nettoyage des lignes ABTEMPS à durée 0 ===';

-- 1. Compter avant suppression
SELECT COUNT(*) AS LignesASupprimer
FROM [dbo].[ABTEMPS_OPERATEURS]
WHERE ProductiveDuration = 0
  AND TotalDuration = 0
  AND StatutTraitement IS NULL;
GO

-- 2. Supprimer (décommenter quand prêt)
-- DELETE FROM [dbo].[ABTEMPS_OPERATEURS]
-- WHERE ProductiveDuration = 0
--   AND TotalDuration = 0
--   AND StatutTraitement IS NULL;

-- PRINT '✅ Lignes à durée 0 supprimées.';
GO

PRINT '=== Nettoyage terminé ===';
GO
