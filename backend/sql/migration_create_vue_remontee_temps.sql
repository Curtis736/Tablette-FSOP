-- Migration: Créer une vue pour la remontée des temps vers l'ERP
-- Date: 2026-01-20
-- Base: SEDI_APP_INDEPENDANTE
-- 
-- Spécification Franck MAILLARD:
-- Pour la remonttée des temps dans l'ERP, ne prendre que StatutTraitement = 'O' (Validé)
-- Format attendu: DateCreation, LancementCode, Phase, CodeRubrique, DureeExecution

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Création vue remontée des temps ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- Supprimer la vue si elle existe déjà
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[V_REMONTE_TEMPS]', 'V') IS NOT NULL
BEGIN
    DROP VIEW [dbo].[V_REMONTE_TEMPS];
    PRINT '✅ Ancienne vue V_REMONTE_TEMPS supprimée';
END
GO

-- Créer la vue pour la remontée des temps
-- IMPORTANT: Selon Franck MAILLARD, ne prendre que StatutTraitement = 'O' (Validé)
CREATE VIEW [dbo].[V_REMONTE_TEMPS]
AS
SELECT 
    DateCreation,
    LancementCode,
    Phase,
    CodeRubrique,
    -- DureeExecution en heures (ProductiveDuration est en minutes)
    CAST(ProductiveDuration AS FLOAT) / 60.0 AS DureeExecution,
    OperatorCode,
    StartTime,
    EndTime,
    TotalDuration,
    PauseDuration,
    ProductiveDuration,
    TempsId
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
WHERE StatutTraitement = 'O'
  AND ProductiveDuration > 0;  -- SILOG n'accepte pas les temps à 0
GO

PRINT '✅ Vue V_REMONTE_TEMPS créée';
PRINT '   - Filtre: StatutTraitement = ''O'' (seulement les enregistrements validés)';
PRINT '   - Filtre: ProductiveDuration > 0 (SILOG n''accepte pas les temps à 0)';
PRINT '   - DureeExecution en heures (ProductiveDuration / 60)';
GO

-- Vérification
PRINT '';
PRINT '🔍 Vérification de V_REMONTE_TEMPS...';
SELECT TOP 5 
    DateCreation,
    LancementCode,
    Phase,
    CodeRubrique,
    DureeExecution
FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_REMONTE_TEMPS];
GO

PRINT '';
PRINT '=== Migration vue remontée terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO
