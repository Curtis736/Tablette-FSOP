-- Migration: Création d'une table de mapping pour StatutOperateur et DateConsultation
-- Cette table permet de stocker temporairement ces valeurs en attendant l'implémentation dans SILOG
-- Base: SEDI_APP_INDEPENDANTE
-- Date: 2026-01-07

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Table de mapping opérateurs ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- Créer la table de mapping si elle n'existe pas
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[AB_OPERATEURS_MAPPING]') AND type in (N'U'))
BEGIN
    CREATE TABLE [SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING](
        [CodeOperateur] [nvarchar](50) NOT NULL,
        [StatutOperateur] [nvarchar](50) NULL,
        [DateConsultation] [datetime2](7) NULL,
        [DateCreation] [datetime2](7) NOT NULL DEFAULT (GETDATE()),
        [DateModification] [datetime2](7) NOT NULL DEFAULT (GETDATE()),
        CONSTRAINT [PK_AB_OPERATEURS_MAPPING] PRIMARY KEY CLUSTERED ([CodeOperateur] ASC)
    );
    
    PRINT '✅ Table AB_OPERATEURS_MAPPING créée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Table AB_OPERATEURS_MAPPING existe déjà';
END
GO

-- Créer index pour améliorer les performances
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING]') 
               AND name = 'IX_AB_OPERATEURS_MAPPING_CodeOperateur')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_AB_OPERATEURS_MAPPING_CodeOperateur] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING] 
    ([CodeOperateur] ASC);
    
    PRINT '✅ Index IX_AB_OPERATEURS_MAPPING_CodeOperateur créé';
END
GO

-- Mettre à jour la vue V_RESSOURC pour utiliser la table de mapping
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[V_RESSOURC]', 'V') IS NOT NULL
    DROP VIEW [dbo].[V_RESSOURC];
GO

CREATE VIEW [dbo].[V_RESSOURC]
AS
SELECT 
    r.CodeRessource AS CodeOperateur,
    r.Designation1 AS NomOperateur,
    -- StatutOperateur : Depuis la table de mapping, sinon NULL
    COALESCE(m.StatutOperateur, CAST(NULL AS VARCHAR(50))) AS StatutOperateur,
    -- DateConsultation : Depuis la table de mapping, sinon NULL
    COALESCE(m.DateConsultation, CAST(NULL AS DATETIME2)) AS DateConsultation
FROM [SEDI_ERP].[dbo].[RESSOURC] r
LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING] m 
    ON r.CodeRessource = m.CodeOperateur;
GO

PRINT '✅ Vue V_RESSOURC mise à jour pour utiliser la table de mapping';
PRINT '⚠️  Note: StatutOperateur et DateConsultation peuvent être gérés via AB_OPERATEURS_MAPPING';
PRINT '⚠️  Une fois implémenté dans SILOG, la vue pourra être mise à jour pour utiliser directement les colonnes SILOG';
GO

PRINT '=== Migration table de mapping terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

