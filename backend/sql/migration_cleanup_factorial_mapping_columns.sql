USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: nettoyage colonnes mapping Factorial ===';
GO

IF EXISTS (
    SELECT 1
    FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[dbo].[AB_FACTORIAL_OPERATOR_MAPPING]')
      AND type = N'U'
)
BEGIN
    IF EXISTS (
        SELECT 1
        FROM sys.columns
        WHERE object_id = OBJECT_ID(N'[dbo].[AB_FACTORIAL_OPERATOR_MAPPING]')
          AND name = N'FactorialFullName'
    )
    BEGIN
        ALTER TABLE [dbo].[AB_FACTORIAL_OPERATOR_MAPPING]
        DROP COLUMN [FactorialFullName];
        PRINT '✅ Colonne FactorialFullName supprimée';
    END
    ELSE
    BEGIN
        PRINT 'ℹ️ Colonne FactorialFullName déjà absente';
    END

    IF EXISTS (
        SELECT 1
        FROM sys.columns
        WHERE object_id = OBJECT_ID(N'[dbo].[AB_FACTORIAL_OPERATOR_MAPPING]')
          AND name = N'FactorialEmail'
    )
    BEGIN
        ALTER TABLE [dbo].[AB_FACTORIAL_OPERATOR_MAPPING]
        DROP COLUMN [FactorialEmail];
        PRINT '✅ Colonne FactorialEmail supprimée';
    END
    ELSE
    BEGIN
        PRINT 'ℹ️ Colonne FactorialEmail déjà absente';
    END
END
ELSE
BEGIN
    PRINT 'ℹ️ Table AB_FACTORIAL_OPERATOR_MAPPING absente (nettoyage ignoré)';
END
GO

PRINT '=== Nettoyage mapping Factorial terminé ===';
GO
