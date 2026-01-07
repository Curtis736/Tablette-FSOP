-- Migration: Extension de la table AB_COMMENTAIRES_OPERATEURS
-- Ajout des colonnes QteNonConforme et Statut pour la gestion des PNC
-- Base: SEDI_APP_INDEPENDANTE
-- Date: 2026-01-07

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Extension AB_COMMENTAIRES_OPERATEURS ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- 1. Ajouter QteNonConforme (quantité de pièces non conforme)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'AB_COMMENTAIRES_OPERATEURS' 
               AND COLUMN_NAME = 'QteNonConforme')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS]
    ADD QteNonConforme NUMERIC(19,8) NULL;
    
    PRINT '✅ Colonne QteNonConforme ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne QteNonConforme existe déjà';
END
GO

-- 2. Ajouter Statut (code statut de la ligne)
-- NULL = non traitée
-- V = Validée par l'AQ
-- I = Intégré en tant que non-conformité dans SILOG
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'AB_COMMENTAIRES_OPERATEURS' 
               AND COLUMN_NAME = 'Statut')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS]
    ADD Statut VARCHAR(1) NULL;

    PRINT '✅ Colonne Statut ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne Statut existe déjà';
END
GO

-- 2.b Ajouter la contrainte CHECK (dans un batch séparé, après création de la colonne)
IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME = 'AB_COMMENTAIRES_OPERATEURS'
           AND COLUMN_NAME = 'Statut')
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM sys.check_constraints
        WHERE name = 'CK_AB_COMMENTAIRES_OPERATEURS_Statut'
          AND parent_object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS]')
    )
    BEGIN
        ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS]
        ADD CONSTRAINT [CK_AB_COMMENTAIRES_OPERATEURS_Statut]
        CHECK (Statut IS NULL OR Statut IN ('V', 'I'));

        PRINT '✅ Contrainte CHECK CK_AB_COMMENTAIRES_OPERATEURS_Statut ajoutée';
    END
    ELSE
    BEGIN
        PRINT 'ℹ️ Contrainte CHECK CK_AB_COMMENTAIRES_OPERATEURS_Statut existe déjà';
    END
END
GO

-- 3. Créer index pour améliorer les requêtes de filtrage par statut
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS]') 
               AND name = 'IX_AB_COMMENTAIRES_OPERATEURS_Statut')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_AB_COMMENTAIRES_OPERATEURS_Statut] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS] 
    ([Statut] ASC)
    WHERE Statut IS NOT NULL;
    
    PRINT '✅ Index IX_AB_COMMENTAIRES_OPERATEURS_Statut créé';
END
GO

-- 4. Créer index pour améliorer les requêtes de filtrage par lancement et statut
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS]') 
               AND name = 'IX_AB_COMMENTAIRES_OPERATEURS_Lancement_Statut')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_AB_COMMENTAIRES_OPERATEURS_Lancement_Statut] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[AB_COMMENTAIRES_OPERATEURS] 
    ([LancementCode] ASC, [Statut] ASC)
    INCLUDE ([QteNonConforme], [CreatedAt]);
    
    PRINT '✅ Index IX_AB_COMMENTAIRES_OPERATEURS_Lancement_Statut créé';
END
GO

PRINT '=== Migration AB_COMMENTAIRES_OPERATEURS terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

