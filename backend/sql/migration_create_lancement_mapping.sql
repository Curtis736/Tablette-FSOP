-- Migration: Création d'une table de mapping pour DateConsultation des lancements
-- Cette table permet de stocker temporairement DateConsultation en attendant une éventuelle implémentation dans SILOG
-- Base: SEDI_APP_INDEPENDANTE
-- Date: 2026-01-07

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Table de mapping lancements ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- 1) Créer la table de mapping si elle n'existe pas
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[AB_LANCEMENTS_MAPPING]') AND type in (N'U'))
BEGIN
    CREATE TABLE [SEDI_APP_INDEPENDANTE].[dbo].[AB_LANCEMENTS_MAPPING](
        [CodeLancement] [nvarchar](50) NOT NULL,
        [DateConsultation] [datetime2](7) NULL,
        [DateCreation] [datetime2](7) NOT NULL DEFAULT (GETDATE()),
        [DateModification] [datetime2](7) NOT NULL DEFAULT (GETDATE()),
        CONSTRAINT [PK_AB_LANCEMENTS_MAPPING] PRIMARY KEY CLUSTERED ([CodeLancement] ASC)
    );

    PRINT '✅ Table AB_LANCEMENTS_MAPPING créée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Table AB_LANCEMENTS_MAPPING existe déjà';
END
GO

-- 2) Index (optionnel) pour lecture par date
IF NOT EXISTS (SELECT * FROM sys.indexes
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[AB_LANCEMENTS_MAPPING]')
               AND name = 'IX_AB_LANCEMENTS_MAPPING_DateConsultation')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_AB_LANCEMENTS_MAPPING_DateConsultation]
    ON [SEDI_APP_INDEPENDANTE].[dbo].[AB_LANCEMENTS_MAPPING] ([DateConsultation] DESC)
    INCLUDE ([CodeLancement])
    WHERE DateConsultation IS NOT NULL;

    PRINT '✅ Index IX_AB_LANCEMENTS_MAPPING_DateConsultation créé';
END
GO

-- 3) Mettre à jour la vue V_LCTC pour utiliser la table de mapping
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]', 'V') IS NOT NULL
    DROP VIEW [dbo].[V_LCTC];
GO

CREATE VIEW [dbo].[V_LCTC]
AS
SELECT
    E.CodeLancement,
    C.Phase,
    C.CodeRubrique,
    COALESCE(m.DateConsultation, CAST(NULL AS DATETIME2)) AS DateConsultation
FROM [SEDI_ERP].[dbo].[LCTC] C
INNER JOIN [SEDI_ERP].[dbo].[LCTE] E
    ON C.CodeLancement = E.CodeLancement
    AND E.LancementSolde = 'N'
LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[AB_LANCEMENTS_MAPPING] m
    ON E.CodeLancement = m.CodeLancement;
GO

PRINT '✅ Vue V_LCTC mise à jour pour utiliser AB_LANCEMENTS_MAPPING';
PRINT '⚠️  Note: DateConsultation est gérée côté application via AB_LANCEMENTS_MAPPING (pas dans SILOG)';
GO

PRINT '=== Migration table de mapping lancements terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO


