-- Migration: Extension de la table ABHISTORIQUE_OPERATEURS
-- Ajout de colonnes pour corrélation avec sessions et précision temporelle
-- Base: SEDI_APP_INDEPENDANTE

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Extension ABHISTORIQUE_OPERATEURS ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- 1. Ajouter SessionId (corrélation avec ABSESSIONS_OPERATEURS)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABHISTORIQUE_OPERATEURS' 
               AND COLUMN_NAME = 'SessionId')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
    ADD SessionId INT NULL;

    PRINT '✅ Colonne SessionId ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne SessionId existe déjà';
END
GO

-- 1.b Corréler avec les sessions existantes (batch séparé pour éviter Invalid column name 'SessionId')
IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME = 'ABHISTORIQUE_OPERATEURS'
           AND COLUMN_NAME = 'SessionId')
BEGIN
    BEGIN TRY
        UPDATE h
        SET h.SessionId = s.SessionId
        FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
        INNER JOIN [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] s
            ON h.OperatorCode = s.OperatorCode
            AND CAST(h.DateCreation AS DATE) = CAST(s.DateCreation AS DATE)
            AND s.SessionStatus = 'ACTIVE'
        WHERE h.SessionId IS NULL
            AND h.DateCreation >= DATEADD(day, -7, GETDATE()); -- Seulement les 7 derniers jours

        PRINT '✅ Corrélation SessionId effectuée (historique)';
    END TRY
    BEGIN CATCH
        PRINT '⚠️ Corrélation SessionId ignorée (sessions inexistantes ou contraintes)';
    END CATCH
END
GO

-- 2. Ajouter CreatedAt (précision DATETIME2 au lieu de DATE)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABHISTORIQUE_OPERATEURS' 
               AND COLUMN_NAME = 'CreatedAt')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
    ADD CreatedAt DATETIME2 NULL; -- Créer d'abord comme NULL
    PRINT '✅ Colonne CreatedAt ajoutée (NULL)';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne CreatedAt existe déjà';
END
GO

-- 2.b Initialiser CreatedAt pour les lignes existantes (batch séparé pour éviter Invalid column name 'CreatedAt')
IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME = 'ABHISTORIQUE_OPERATEURS'
           AND COLUMN_NAME = 'CreatedAt')
BEGIN
    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
    SET CreatedAt = DATEADD(HOUR, 12, CAST(DateCreation AS DATETIME2))
    WHERE CreatedAt IS NULL;

    PRINT '✅ CreatedAt initialisé pour les lignes existantes';
END
GO

-- 2.c Rendre CreatedAt NOT NULL (batch séparé)
IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME = 'ABHISTORIQUE_OPERATEURS'
           AND COLUMN_NAME = 'CreatedAt')
BEGIN
    BEGIN TRY
        ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
        ALTER COLUMN CreatedAt DATETIME2 NOT NULL;

        PRINT '✅ Colonne CreatedAt passée en NOT NULL';
    END TRY
    BEGIN CATCH
        PRINT '⚠️ Impossible de passer CreatedAt en NOT NULL (valeurs NULL restantes ou contrainte)';
    END CATCH
END
GO

-- 2.d Ajouter la contrainte DEFAULT pour les futures insertions (batch séparé)
IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME = 'ABHISTORIQUE_OPERATEURS'
           AND COLUMN_NAME = 'CreatedAt')
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM sys.default_constraints
        WHERE name = 'DF_ABHISTORIQUE_OPERATEURS_CreatedAt'
          AND parent_object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]')
    )
    BEGIN
        ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
        ADD CONSTRAINT DF_ABHISTORIQUE_OPERATEURS_CreatedAt DEFAULT GETDATE() FOR CreatedAt;

        PRINT '✅ Contrainte DEFAULT DF_ABHISTORIQUE_OPERATEURS_CreatedAt ajoutée';
    END
    ELSE
    BEGIN
        PRINT 'ℹ️ Contrainte DEFAULT DF_ABHISTORIQUE_OPERATEURS_CreatedAt existe déjà';
    END
END
GO

-- 3. Ajouter RequestId (corrélation avec requêtes API)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABHISTORIQUE_OPERATEURS' 
               AND COLUMN_NAME = 'RequestId')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
    ADD RequestId NVARCHAR(100) NULL;
    
    PRINT '✅ Colonne RequestId ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne RequestId existe déjà';
END
GO

-- 4. Créer index pour améliorer les requêtes
-- Note: Les index utilisant CreatedAt doivent être créés après que la colonne CreatedAt existe
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]') 
               AND name = 'IX_Historique_SessionId')
BEGIN
    -- Vérifier que CreatedAt existe avant de créer l'index
    IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABHISTORIQUE_OPERATEURS' 
               AND COLUMN_NAME = 'CreatedAt')
    BEGIN
        CREATE NONCLUSTERED INDEX [IX_Historique_SessionId] 
        ON [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] 
        ([SessionId], [CreatedAt] DESC)
        WHERE SessionId IS NOT NULL;
        
        PRINT '✅ Index IX_Historique_SessionId créé';
    END
    ELSE
    BEGIN
        PRINT '⚠️ Index IX_Historique_SessionId non créé: CreatedAt n''existe pas encore';
    END
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]') 
               AND name = 'IX_Historique_CreatedAt')
BEGIN
    -- Vérifier que CreatedAt existe avant de créer l'index
    IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABHISTORIQUE_OPERATEURS' 
               AND COLUMN_NAME = 'CreatedAt')
    BEGIN
        CREATE NONCLUSTERED INDEX [IX_Historique_CreatedAt] 
        ON [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] 
        ([CreatedAt] DESC)
        INCLUDE ([OperatorCode], [CodeLanctImprod], [Ident], [Statut]);
        
        PRINT '✅ Index IX_Historique_CreatedAt créé';
    END
    ELSE
    BEGIN
        PRINT '⚠️ Index IX_Historique_CreatedAt non créé: CreatedAt n''existe pas encore';
    END
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]') 
               AND name = 'IX_Historique_Operator_Lancement_Date')
BEGIN
    -- Vérifier que CreatedAt existe avant de créer l'index
    IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABHISTORIQUE_OPERATEURS' 
               AND COLUMN_NAME = 'CreatedAt')
    BEGIN
        CREATE NONCLUSTERED INDEX [IX_Historique_Operator_Lancement_Date] 
        ON [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] 
        ([OperatorCode], [CodeLanctImprod], [CreatedAt] DESC)
        INCLUDE ([Ident], [Statut], [HeureDebut], [HeureFin]);
        
        PRINT '✅ Index IX_Historique_Operator_Lancement_Date créé';
    END
    ELSE
    BEGIN
        PRINT '⚠️ Index IX_Historique_Operator_Lancement_Date non créé: CreatedAt n''existe pas encore';
    END
END
GO

PRINT '=== Migration ABHISTORIQUE_OPERATEURS terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO


