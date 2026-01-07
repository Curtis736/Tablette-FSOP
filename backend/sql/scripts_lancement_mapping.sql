-- Scripts utilitaires pour gérer DateConsultation des lancements
-- Base: SEDI_APP_INDEPENDANTE

USE [SEDI_APP_INDEPENDANTE];
GO

-- ============================================
-- 1. Mettre à jour automatiquement DateConsultation lors de la consultation
-- ============================================
-- Exemple: EXEC sp_RecordLancementConsultation @CodeLancement = 'LT2501332'

IF OBJECT_ID('sp_RecordLancementConsultation', 'P') IS NOT NULL
    DROP PROCEDURE sp_RecordLancementConsultation;
GO

CREATE PROCEDURE sp_RecordLancementConsultation
    @CodeLancement NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    IF @CodeLancement IS NULL OR LTRIM(RTRIM(@CodeLancement)) = ''
    BEGIN
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_LANCEMENTS_MAPPING] WHERE CodeLancement = @CodeLancement)
    BEGIN
        UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[AB_LANCEMENTS_MAPPING]
        SET DateConsultation = GETDATE(),
            DateModification = GETDATE()
        WHERE CodeLancement = @CodeLancement;
    END
    ELSE
    BEGIN
        INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[AB_LANCEMENTS_MAPPING]
        (CodeLancement, DateConsultation, DateCreation, DateModification)
        VALUES (@CodeLancement, GETDATE(), GETDATE(), GETDATE());
    END
END
GO

PRINT '✅ Procédure stockée sp_RecordLancementConsultation créée';
GO


