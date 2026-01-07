-- Migration: Création de la table d'audit append-only AB_AUDIT_EVENTS
-- Table pour tracer toutes les actions API et événements système
-- Base: SEDI_APP_INDEPENDANTE

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Création table AB_AUDIT_EVENTS ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- Créer la table d'audit si elle n'existe pas
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[AB_AUDIT_EVENTS]') AND type in (N'U'))
BEGIN
    CREATE TABLE [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS] (
        AuditId BIGINT IDENTITY(1,1) NOT NULL,
        OccurredAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(), -- UTC pour cohérence
        OperatorCode NVARCHAR(50) NULL,
        SessionId INT NULL,
        DeviceId NVARCHAR(100) NULL,
        Action NVARCHAR(100) NOT NULL, -- OperatorLogin, StartLancement, PauseLancement, HttpRequest, etc.
        Endpoint NVARCHAR(500) NULL, -- Route API appelée
        Method NVARCHAR(10) NULL, -- GET, POST, PUT, DELETE
        StatusCode INT NULL, -- Code HTTP de réponse
        DurationMs INT NULL, -- Durée de la requête en millisecondes
        LancementCode NVARCHAR(50) NULL,
        IpAddress NVARCHAR(45) NULL, -- IPv6 max length
        UserAgent NVARCHAR(500) NULL,
        CorrelationId NVARCHAR(100) NULL, -- Pour corréler plusieurs événements
        RequestId NVARCHAR(100) NULL, -- ID unique de la requête
        PayloadJson NVARCHAR(MAX) NULL, -- Détails JSON (flexible)
        ErrorMessage NVARCHAR(MAX) NULL, -- Message d'erreur si applicable
        Severity NVARCHAR(20) DEFAULT 'INFO', -- INFO, WARNING, ERROR
        CONSTRAINT [PK_AB_AUDIT_EVENTS] PRIMARY KEY CLUSTERED ([AuditId] ASC)
    );
    
    PRINT '✅ Table AB_AUDIT_EVENTS créée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Table AB_AUDIT_EVENTS existe déjà';
END
GO

-- Créer les index pour optimiser les requêtes de recherche
-- Index principal par date (pour recherche temporelle)
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS]') 
               AND name = 'IX_Audit_OccurredAt')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Audit_OccurredAt] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS] 
    ([OccurredAt] DESC)
    INCLUDE ([OperatorCode], [Action], [Endpoint], [StatusCode], [Severity]);
    
    PRINT '✅ Index IX_Audit_OccurredAt créé';
END
GO

-- Index par opérateur (pour recherche par utilisateur)
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS]') 
               AND name = 'IX_Audit_Operator')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Audit_Operator] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS] 
    ([OperatorCode], [OccurredAt] DESC)
    INCLUDE ([Action], [Endpoint], [StatusCode], [LancementCode]);
    
    PRINT '✅ Index IX_Audit_Operator créé';
END
GO

-- Index par session (pour tracer une session complète)
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS]') 
               AND name = 'IX_Audit_Session')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Audit_Session] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS] 
    ([SessionId], [OccurredAt] DESC)
    WHERE SessionId IS NOT NULL
    INCLUDE ([Action], [Endpoint], [StatusCode]);
    
    PRINT '✅ Index IX_Audit_Session créé';
END
GO

-- Index par lancement (pour tracer un lancement spécifique)
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS]') 
               AND name = 'IX_Audit_Lancement')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Audit_Lancement] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS] 
    ([LancementCode], [OccurredAt] DESC)
    WHERE LancementCode IS NOT NULL
    INCLUDE ([OperatorCode], [Action], [StatusCode]);
    
    PRINT '✅ Index IX_Audit_Lancement créé';
END
GO

-- Index par action (pour recherche par type d'action)
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS]') 
               AND name = 'IX_Audit_Action')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Audit_Action] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS] 
    ([Action], [OccurredAt] DESC)
    INCLUDE ([OperatorCode], [StatusCode], [Severity]);
    
    PRINT '✅ Index IX_Audit_Action créé';
END
GO

-- Index pour les erreurs (pour monitoring)
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS]') 
               AND name = 'IX_Audit_Errors')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Audit_Errors] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS] 
    ([Severity], [OccurredAt] DESC)
    WHERE Severity IN ('ERROR', 'WARNING')
    INCLUDE ([OperatorCode], [Action], [ErrorMessage]);
    
    PRINT '✅ Index IX_Audit_Errors créé';
END
GO

-- Index pour corrélation (RequestId, CorrelationId)
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS]') 
               AND name = 'IX_Audit_Correlation')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Audit_Correlation] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS] 
    ([CorrelationId], [RequestId])
    WHERE CorrelationId IS NOT NULL OR RequestId IS NOT NULL;
    
    PRINT '✅ Index IX_Audit_Correlation créé';
END
GO

PRINT '=== Migration AB_AUDIT_EVENTS terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- Note: La stratégie de rétention et partitionnement sera gérée par des jobs SQL Agent
-- Voir migration_create_retention_jobs.sql (à créer si nécessaire)


