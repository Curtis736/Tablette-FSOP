-- Migration: contrôle cohérence LCTC avant validation StatutTraitement = 'O'
-- Franck MAILLARD (juillet 2026) : LancementCode + Phase + CodeRubrique doivent exister dans SEDI_ERP.LCTC

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: spValiderTempsSILOG + contrôle LCTC ===';
GO

IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[spValiderTempsSILOG]', 'P') IS NOT NULL
    DROP PROCEDURE [SEDI_APP_INDEPENDANTE].[dbo].[spValiderTempsSILOG];
GO

CREATE PROCEDURE [SEDI_APP_INDEPENDANTE].[dbo].[spValiderTempsSILOG]
    @TempsId INT = NULL,
    @DateTravail DATE = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @DateTravail IS NULL SET @DateTravail = CAST(GETDATE() AS DATE);

    DECLARE @UpdatedRows INT = 0;

    IF @TempsId IS NOT NULL
    BEGIN
        UPDATE t
        SET StatutTraitement = 'O'
        FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
        WHERE t.TempsId = @TempsId
          AND t.Phase IS NOT NULL
          AND t.CodeRubrique IS NOT NULL
          AND t.ProductiveDuration > 0
          AND t.EndTime IS NOT NULL
          AND EXISTS (
              SELECT 1
              FROM [SEDI_ERP].[dbo].[LCTC] AS LCTC
              WHERE LCTC.CodeLancement = t.LancementCode
                AND LCTC.Phase = t.Phase
                AND LCTC.CodeRubrique = t.CodeRubrique
          );

        SET @UpdatedRows = @@ROWCOUNT;
    END
    ELSE
    BEGIN
        UPDATE t
        SET StatutTraitement = 'O'
        FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
        WHERE t.StatutTraitement IS NULL
          AND CAST(t.DateCreation AS DATE) = @DateTravail
          AND t.Phase IS NOT NULL
          AND t.CodeRubrique IS NOT NULL
          AND t.ProductiveDuration > 0
          AND t.EndTime IS NOT NULL
          AND EXISTS (
              SELECT 1
              FROM [SEDI_ERP].[dbo].[LCTC] AS LCTC
              WHERE LCTC.CodeLancement = t.LancementCode
                AND LCTC.Phase = t.Phase
                AND LCTC.CodeRubrique = t.CodeRubrique
          );

        SET @UpdatedRows = @@ROWCOUNT;
    END

    PRINT 'Temps validés (cohérents LCTC): ' + CAST(@UpdatedRows AS VARCHAR);
    RETURN @UpdatedRows;
END
GO

PRINT '✅ spValiderTempsSILOG mise à jour avec contrôle LCTC';
GO
