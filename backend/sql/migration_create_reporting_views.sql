-- Migration: Création des vues de reporting pour cohérence des logs
-- Vues pour faciliter les requêtes de reporting et d'analyse
-- Base: SEDI_APP_INDEPENDANTE

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Création vues de reporting ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- 1. Vue: Sessions opérateurs avec durée et dernière activité
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[vwOperatorSessions]', 'V') IS NOT NULL
    DROP VIEW [dbo].[vwOperatorSessions];
GO

CREATE VIEW [dbo].[vwOperatorSessions]
AS
SELECT 
    s.SessionId,
    s.OperatorCode,
    r.Designation1 AS OperatorName,
    s.LoginTime,
    s.LogoutTime,
    s.SessionStatus,
    s.ActivityStatus,
    s.LastActivityTime,
    s.DeviceId,
    s.IpAddress,
    s.DeviceInfo,
    s.DateCreation,
    -- Calcul de la durée de session
    CASE 
        WHEN s.LogoutTime IS NOT NULL THEN 
            DATEDIFF(MINUTE, s.LoginTime, s.LogoutTime)
        ELSE 
            DATEDIFF(MINUTE, s.LoginTime, COALESCE(s.LastActivityTime, GETDATE()))
    END AS SessionDurationMinutes,
    -- Temps depuis dernière activité (pour détecter AFK)
    CASE 
        WHEN s.SessionStatus = 'ACTIVE' AND s.LastActivityTime IS NOT NULL THEN
            DATEDIFF(MINUTE, s.LastActivityTime, GETDATE())
        ELSE NULL
    END AS MinutesSinceLastActivity,
    -- Nombre d'opérations pendant cette session
    (SELECT COUNT(*) 
     FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
     WHERE h.SessionId = s.SessionId) AS OperationsCount
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] s
LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r ON s.OperatorCode = r.Coderessource;
GO

PRINT '✅ Vue vwOperatorSessions créée';
GO

-- 2. Vue: Temps par opérateur et lancement
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[vwOperatorLancementTimes]', 'V') IS NOT NULL
    DROP VIEW [dbo].[vwOperatorLancementTimes];
GO

CREATE VIEW [dbo].[vwOperatorLancementTimes]
AS
SELECT 
    t.TempsId,
    t.OperatorCode,
    r.Designation1 AS OperatorName,
    t.LancementCode,
    l.DesignationLct1 AS LancementName,
    t.SessionId,
    t.StartTime,
    t.EndTime,
    t.TotalDuration AS TotalDurationMinutes,
    t.PauseDuration AS PauseDurationMinutes,
    t.ProductiveDuration AS ProductiveDurationMinutes,
    t.EventsCount,
    t.CalculationMethod,
    t.CalculatedAt,
    t.DateCreation,
    -- Calculs dérivés
    CAST(t.TotalDuration AS FLOAT) / 60.0 AS TotalDurationHours,
    CAST(t.ProductiveDuration AS FLOAT) / 60.0 AS ProductiveDurationHours,
    CASE 
        WHEN t.TotalDuration > 0 THEN 
            CAST(t.ProductiveDuration AS FLOAT) / CAST(t.TotalDuration AS FLOAT) * 100.0
        ELSE 0
    END AS ProductivityPercentage
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r ON t.OperatorCode = r.Coderessource
LEFT JOIN [SEDI_ERP].[dbo].[LCTE] l ON t.LancementCode = l.CodeLancement;
GO

PRINT '✅ Vue vwOperatorLancementTimes créée';
GO

-- 3. Vue: Audit trail complet (filtrable par opérateur, session, lancement)
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[vwAuditTrail]', 'V') IS NOT NULL
    DROP VIEW [dbo].[vwAuditTrail];
GO

CREATE VIEW [dbo].[vwAuditTrail]
AS
SELECT 
    a.AuditId,
    a.OccurredAt,
    a.OperatorCode,
    r.Designation1 AS OperatorName,
    a.SessionId,
    s.LoginTime AS SessionLoginTime,
    a.DeviceId,
    a.Action,
    a.Endpoint,
    a.Method,
    a.StatusCode,
    a.DurationMs,
    a.LancementCode,
    l.DesignationLct1 AS LancementName,
    a.IpAddress,
    a.UserAgent,
    a.CorrelationId,
    a.RequestId,
    a.PayloadJson,
    a.ErrorMessage,
    a.Severity,
    -- Calculs dérivés
    CASE 
        WHEN a.StatusCode >= 200 AND a.StatusCode < 300 THEN 'SUCCESS'
        WHEN a.StatusCode >= 400 AND a.StatusCode < 500 THEN 'CLIENT_ERROR'
        WHEN a.StatusCode >= 500 THEN 'SERVER_ERROR'
        ELSE 'UNKNOWN'
    END AS StatusCategory
FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_AUDIT_EVENTS] a
LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r ON a.OperatorCode = r.Coderessource
LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] s ON a.SessionId = s.SessionId
LEFT JOIN [SEDI_ERP].[dbo].[LCTE] l ON a.LancementCode = l.CodeLancement;
GO

PRINT '✅ Vue vwAuditTrail créée';
GO

-- 4. Vue: Résumé quotidien par opérateur (temps total, nombre de lancements, etc.)
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[vwDailyOperatorSummary]', 'V') IS NOT NULL
    DROP VIEW [dbo].[vwDailyOperatorSummary];
GO

CREATE VIEW [dbo].[vwDailyOperatorSummary]
AS
SELECT 
    CAST(t.DateCreation AS DATE) AS WorkDate,
    t.OperatorCode,
    r.Designation1 AS OperatorName,
    -- Statistiques de temps
    SUM(t.TotalDuration) AS TotalMinutes,
    SUM(t.PauseDuration) AS TotalPauseMinutes,
    SUM(t.ProductiveDuration) AS TotalProductiveMinutes,
    CAST(SUM(t.TotalDuration) AS FLOAT) / 60.0 AS TotalHours,
    CAST(SUM(t.ProductiveDuration) AS FLOAT) / 60.0 AS ProductiveHours,
    -- Statistiques de lancements
    COUNT(DISTINCT t.LancementCode) AS DistinctLancementsCount,
    COUNT(*) AS OperationsCount,
    -- Statistiques de sessions
    COUNT(DISTINCT t.SessionId) AS DistinctSessionsCount,
    -- Calcul de productivité moyenne
    CASE 
        WHEN SUM(t.TotalDuration) > 0 THEN 
            CAST(SUM(t.ProductiveDuration) AS FLOAT) / CAST(SUM(t.TotalDuration) AS FLOAT) * 100.0
        ELSE 0
    END AS AverageProductivityPercentage
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r ON t.OperatorCode = r.Coderessource
GROUP BY CAST(t.DateCreation AS DATE), t.OperatorCode, r.Designation1;
GO

PRINT '✅ Vue vwDailyOperatorSummary créée';
GO

-- 5. Vue: Sessions actives avec détails
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[vwActiveSessions]', 'V') IS NOT NULL
    DROP VIEW [dbo].[vwActiveSessions];
GO

CREATE VIEW [dbo].[vwActiveSessions]
AS
SELECT 
    s.SessionId,
    s.OperatorCode,
    r.Designation1 AS OperatorName,
    s.LoginTime,
    s.LastActivityTime,
    s.ActivityStatus,
    s.DeviceId,
    s.IpAddress,
    DATEDIFF(MINUTE, s.LoginTime, COALESCE(s.LastActivityTime, GETDATE())) AS SessionDurationMinutes,
    DATEDIFF(MINUTE, s.LastActivityTime, GETDATE()) AS MinutesSinceLastActivity,
    -- Opérations en cours
    (SELECT COUNT(*) 
     FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
     WHERE h.SessionId = s.SessionId 
       AND h.Statut IN ('EN_COURS', 'EN_PAUSE')
       AND CAST(h.DateCreation AS DATE) = CAST(GETDATE() AS DATE)) AS ActiveOperationsCount,
    -- Dernière action
    (SELECT TOP 1 h.Ident + ' - ' + h.CodeLanctImprod
     FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] h
     WHERE h.SessionId = s.SessionId
     ORDER BY h.CreatedAt DESC) AS LastAction
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] s
LEFT JOIN [SEDI_ERP].[dbo].[RESSOURC] r ON s.OperatorCode = r.Coderessource
WHERE s.SessionStatus = 'ACTIVE'
  AND CAST(s.DateCreation AS DATE) = CAST(GETDATE() AS DATE);
GO

PRINT '✅ Vue vwActiveSessions créée';
GO

PRINT '=== Migration vues de reporting terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO


