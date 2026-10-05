-- PauseTypeCode sur l'événement PAUSE (source de vérité atomique)
-- Fallback historique : AB_PAUSE_TYPE_LOG reste en lecture pour l'existant.
USE [SEDI_APP_INDEPENDANTE];
GO

IF COL_LENGTH('dbo.ABHISTORIQUE_OPERATEURS', 'PauseTypeCode') IS NULL
BEGIN
    ALTER TABLE [dbo].[ABHISTORIQUE_OPERATEURS]
        ADD [PauseTypeCode] NVARCHAR(32) NULL;
    PRINT 'Colonne PauseTypeCode ajoutée sur ABHISTORIQUE_OPERATEURS';
END
ELSE
BEGIN
    PRINT 'Colonne PauseTypeCode déjà présente';
END
GO

-- Backfill depuis le journal des types (meilleur effort)
IF COL_LENGTH('dbo.ABHISTORIQUE_OPERATEURS', 'PauseTypeCode') IS NOT NULL
   AND OBJECT_ID('dbo.AB_PAUSE_TYPE_LOG', 'U') IS NOT NULL
BEGIN
    UPDATE h
    SET h.PauseTypeCode = p.PauseTypeCode
    FROM [dbo].[ABHISTORIQUE_OPERATEURS] h
    INNER JOIN [dbo].[AB_PAUSE_TYPE_LOG] p
        ON p.OperatorCode = h.OperatorCode
       AND p.LancementCode = h.CodeLanctImprod
       AND CAST(p.DateCreation AS DATE) = CAST(h.DateCreation AS DATE)
       AND (
            p.HeureDebut IS NULL
            OR CONVERT(VARCHAR(8), p.HeureDebut, 108) = CONVERT(VARCHAR(8), h.HeureDebut, 108)
            OR LEFT(CONVERT(VARCHAR(8), p.HeureDebut, 108), 5) = LEFT(CONVERT(VARCHAR(8), h.HeureDebut, 108), 5)
       )
    WHERE UPPER(LTRIM(RTRIM(h.Ident))) = 'PAUSE'
      AND (h.PauseTypeCode IS NULL OR LTRIM(RTRIM(h.PauseTypeCode)) = '');

    PRINT 'Backfill PauseTypeCode depuis AB_PAUSE_TYPE_LOG terminé';
END
GO
