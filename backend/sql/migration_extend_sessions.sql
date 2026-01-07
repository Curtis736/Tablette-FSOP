-- Migration: Extension de la table ABSESSIONS_OPERATEURS
-- Ajout de colonnes pour tracking d'activité et identification device
-- Base: SEDI_APP_INDEPENDANTE

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Extension ABSESSIONS_OPERATEURS ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- 1. Ajouter LastActivityTime (si n'existe pas déjà)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABSESSIONS_OPERATEURS' 
               AND COLUMN_NAME = 'LastActivityTime')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
    ADD LastActivityTime DATETIME2 NULL;
    
    -- Initialiser avec LoginTime pour les sessions existantes
    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
    SET LastActivityTime = LoginTime
    WHERE LastActivityTime IS NULL;
    
    PRINT '✅ Colonne LastActivityTime ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne LastActivityTime existe déjà';
END
GO

-- 2. Ajouter ActivityStatus (si n'existe pas déjà)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABSESSIONS_OPERATEURS' 
               AND COLUMN_NAME = 'ActivityStatus')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
    ADD ActivityStatus NVARCHAR(20) DEFAULT 'INACTIVE';
    
    -- Initialiser selon SessionStatus
    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
    SET ActivityStatus = CASE 
        WHEN SessionStatus = 'ACTIVE' THEN 'ACTIVE'
        ELSE 'INACTIVE'
    END
    WHERE ActivityStatus IS NULL;
    
    PRINT '✅ Colonne ActivityStatus ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne ActivityStatus existe déjà';
END
GO

-- 3. Ajouter DeviceId (identifiant stable du device/tablette)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABSESSIONS_OPERATEURS' 
               AND COLUMN_NAME = 'DeviceId')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
    ADD DeviceId NVARCHAR(100) NULL;
    
    PRINT '✅ Colonne DeviceId ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne DeviceId existe déjà';
END
GO

-- 4. Ajouter IpAddress (pour audit)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABSESSIONS_OPERATEURS' 
               AND COLUMN_NAME = 'IpAddress')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]
    ADD IpAddress NVARCHAR(45) NULL; -- IPv6 max length
    
    PRINT '✅ Colonne IpAddress ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne IpAddress existe déjà';
END
GO

-- 5. Créer index pour améliorer les requêtes de recherche
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]') 
               AND name = 'IX_Sessions_Operator_Status')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Sessions_Operator_Status] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] 
    ([OperatorCode], [SessionStatus], [DateCreation] DESC);
    
    PRINT '✅ Index IX_Sessions_Operator_Status créé';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS]') 
               AND name = 'IX_Sessions_LastActivity')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Sessions_LastActivity] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] 
    ([LastActivityTime] DESC)
    INCLUDE ([OperatorCode], [SessionStatus]);
    
    PRINT '✅ Index IX_Sessions_LastActivity créé';
END
GO

PRINT '=== Migration ABSESSIONS_OPERATEURS terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO


