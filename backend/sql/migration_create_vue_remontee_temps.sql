-- Migration: Créer une vue pour la remontée des temps vers l'ERP
-- Date: 2026-01-20
-- Base: SEDI_APP_INDEPENDANTE
-- 
-- Spécification Franck MAILLARD:
-- Pour la remontée des temps dans l'ERP, ne prendre que StatutTraitement = 'O' (Validé)
-- Format attendu: DateCreation, LancementCode, Phase, CodeRubrique, DureeExecution
-- 23/09/2026 : CommentaireHeureDebut / CommentaireHeureFin / CommentaireHoraires (VARCHAR)
-- 23/09/2026 : HeureDebut / MinutesDebut / HeureFin / MinutesFin (INT, mapping SILOG VarNumUtil8-11)

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
-- HeureDebut / MinutesDebut / HeureFin / MinutesFin : INT pour SEDI_ETDIFF
--   → VarNumUtil8 / VarNumUtil9 / VarNumUtil10 / VarNumUtil11 (écran « Suivi de Production »).
-- CommentaireHeureDebut / CommentaireHeureFin : VARCHAR HH:mm:ss (info, plus le mappage horaire).
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
    DATEPART(HOUR, StartTime) AS HeureDebut,
    DATEPART(MINUTE, StartTime) AS MinutesDebut,
    DATEPART(HOUR, EndTime) AS HeureFin,
    DATEPART(MINUTE, EndTime) AS MinutesFin,
    CONVERT(VARCHAR(8), StartTime, 108) AS CommentaireHeureDebut,
    CONVERT(VARCHAR(8), EndTime, 108) AS CommentaireHeureFin,
    LEFT(
        ISNULL(CONVERT(VARCHAR(8), StartTime, 108), '')
        + CASE WHEN StartTime IS NOT NULL AND EndTime IS NOT NULL THEN ' - ' ELSE '' END
        + ISNULL(CONVERT(VARCHAR(8), EndTime, 108), ''),
        50
    ) AS CommentaireHoraires,
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
PRINT '   - HeureDebut / MinutesDebut / HeureFin / MinutesFin (INT, secondes ignorées, NULL si horaire absent)';
PRINT '   - CommentaireHeureDebut / CommentaireHeureFin / CommentaireHoraires en VARCHAR (info SILOG)';
GO

-- Vérification
PRINT '';
PRINT '🔍 Vérification de V_REMONTE_TEMPS...';
SELECT TOP 5 
    DateCreation,
    LancementCode,
    Phase,
    CodeRubrique,
    DureeExecution,
    HeureDebut,
    MinutesDebut,
    HeureFin,
    MinutesFin,
    CommentaireHeureDebut,
    CommentaireHeureFin,
    CommentaireHoraires
FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_REMONTE_TEMPS];
GO

PRINT '';
PRINT '=== Migration vue remontée terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO
