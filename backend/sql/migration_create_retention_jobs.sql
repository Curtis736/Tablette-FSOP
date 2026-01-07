-- Migration: Création des jobs SQL Agent pour rétention des données d'audit
-- Scripts pour gérer la rétention et l'archivage des données d'audit
-- Base: SEDI_APP_INDEPENDANTE
-- Note: Ces scripts doivent être adaptés selon la stratégie de rétention définie avec le DBA

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Scripts de rétention AB_AUDIT_EVENTS ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- Procédure stockée: Purger les événements d'audit anciens
-- Paramètre: @RetentionDays (défaut: 90 jours)
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[spPurgeAuditEvents]', 'P') IS NOT NULL
    DROP PROCEDURE [SEDI_APP_INDEPENDANTE].[dbo].[spPurgeAuditEvents];
GO

CREATE PROCEDURE [SEDI_APP_INDEPENDANTE].[dbo].[spPurgeAuditEvents]
    @RetentionDays INT = 90,
    @BatchSize INT = 10000,
    @DeletedRows INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @CutoffDate DATETIME2 = DATEADD(DAY, -@RetentionDays, GETUTCDATE());
    DECLARE @RowCount INT = 1;
    SET @DeletedRows = 0;
    
    PRINT 'Début purge des événements d''audit antérieurs à ' + CONVERT(VARCHAR, @CutoffDate, 120);
    
    -- Suppression par batch pour éviter les verrous prolongés
    WHILE @RowCount > 0
    BEGIN
        DELETE TOP (@BatchSize)
        FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS]
        WHERE OccurredAt < @CutoffDate;
        
        SET @RowCount = @@ROWCOUNT;
        SET @DeletedRows = @DeletedRows + @RowCount;
        
        IF @RowCount > 0
        BEGIN
            PRINT 'Supprimé ' + CAST(@RowCount AS VARCHAR) + ' lignes (total: ' + CAST(@DeletedRows AS VARCHAR) + ')';
            WAITFOR DELAY '00:00:01'; -- Pause d'1 seconde entre les batches
        END
    END
    
    PRINT 'Purge terminée. Total supprimé: ' + CAST(@DeletedRows AS VARCHAR) + ' lignes';
END
GO

PRINT '✅ Procédure spPurgeAuditEvents créée';
GO

-- Procédure stockée: Archiver les événements d'audit (optionnel)
-- Cette procédure peut être utilisée pour archiver vers une autre base/table avant purge
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[spArchiveAuditEvents]', 'P') IS NOT NULL
    DROP PROCEDURE [SEDI_APP_INDEPENDANTE].[dbo].[spArchiveAuditEvents];
GO

CREATE PROCEDURE [SEDI_APP_INDEPENDANTE].[dbo].[spArchiveAuditEvents]
    @ArchiveDays INT = 90,
    @ArchiveTableName NVARCHAR(255) = 'AB_AUDIT_EVENTS_ARCHIVE',
    @ArchivedRows INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @CutoffDate DATETIME2 = DATEADD(DAY, -@ArchiveDays, GETUTCDATE());
    DECLARE @Sql NVARCHAR(MAX);
    
    -- Note: Cette procédure nécessite que la table d'archive existe
    -- Créer la table d'archive avec la même structure que AB_AUDIT_EVENTS
    
    SET @Sql = N'
        INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[' + @ArchiveTableName + N']
        SELECT * FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS]
        WHERE OccurredAt < @CutoffDate;
        
        SET @ArchivedRows = @@ROWCOUNT;
        
        DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS]
        WHERE OccurredAt < @CutoffDate;
    ';
    
    EXEC sp_executesql @Sql, 
        N'@CutoffDate DATETIME2, @ArchivedRows INT OUTPUT',
        @CutoffDate, @ArchivedRows OUTPUT;
    
    PRINT 'Archivage terminé. ' + CAST(@ArchivedRows AS VARCHAR) + ' lignes archivées';
END
GO

PRINT '✅ Procédure spArchiveAuditEvents créée';
GO

-- Procédure stockée: Statistiques d'audit (pour monitoring)
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[spGetAuditStatistics]', 'P') IS NOT NULL
    DROP PROCEDURE [SEDI_APP_INDEPENDANTE].[dbo].[spGetAuditStatistics];
GO

CREATE PROCEDURE [SEDI_APP_INDEPENDANTE].[dbo].[spGetAuditStatistics]
    @StartDate DATETIME2 = NULL,
    @EndDate DATETIME2 = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    IF @StartDate IS NULL SET @StartDate = DATEADD(DAY, -7, GETUTCDATE());
    IF @EndDate IS NULL SET @EndDate = GETUTCDATE();
    
    SELECT 
        -- Statistiques générales
        COUNT(*) AS TotalEvents,
        COUNT(DISTINCT OperatorCode) AS DistinctOperators,
        COUNT(DISTINCT SessionId) AS DistinctSessions,
        COUNT(DISTINCT LancementCode) AS DistinctLancements,
        
        -- Par action
        Action,
        COUNT(*) AS ActionCount,
        AVG(CAST(DurationMs AS FLOAT)) AS AvgDurationMs,
        MAX(DurationMs) AS MaxDurationMs,
        MIN(DurationMs) AS MinDurationMs,
        
        -- Par sévérité
        Severity,
        COUNT(*) AS SeverityCount,
        
        -- Par code de statut HTTP
        StatusCode,
        COUNT(*) AS StatusCount
        
    FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS]
    WHERE OccurredAt BETWEEN @StartDate AND @EndDate
    GROUP BY Action, Severity, StatusCode
    ORDER BY ActionCount DESC;
END
GO

PRINT '✅ Procédure spGetAuditStatistics créée';
GO

PRINT '=== Migration scripts de rétention terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- Note: Pour créer un job SQL Agent qui exécute la purge automatiquement:
-- 1. Ouvrir SQL Server Management Studio
-- 2. SQL Server Agent > Jobs > New Job
-- 3. Nom: "Purge Audit Events - Daily"
-- 4. Steps: Exécuter "EXEC spPurgeAuditEvents @RetentionDays = 90"
-- 5. Schedule: Tous les jours à 2h du matin
-- 
-- Exemple de commande pour créer le job via T-SQL:
/*
USE msdb;
GO

EXEC sp_add_job
    @job_name = N'Purge Audit Events - Daily',
    @enabled = 1,
    @description = N'Purge quotidienne des événements d''audit > 90 jours';

EXEC sp_add_jobstep
    @job_name = N'Purge Audit Events - Daily',
    @step_name = N'Purge Audit Events',
    @subsystem = N'TSQL',
    @command = N'USE [SEDI_APP_INDEPENDANTE]; EXEC spPurgeAuditEvents @RetentionDays = 90;';

EXEC sp_add_schedule
    @schedule_name = N'Daily at 2 AM',
    @freq_type = 4, -- Daily
    @freq_interval = 1,
    @active_start_time = 020000; -- 2:00 AM

EXEC sp_attach_schedule
    @job_name = N'Purge Audit Events - Daily',
    @schedule_name = N'Daily at 2 AM';
*/


