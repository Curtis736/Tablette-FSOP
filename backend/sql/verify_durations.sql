-- Script de vérification des durées dans ABTEMPS_OPERATEURS
-- Vérifie la cohérence entre TotalDuration, PauseDuration et ProductiveDuration

USE [SEDI_APP_INDEPENDANTE];
GO

-- 1. Vérifier les durées nulles ou négatives
SELECT 
    'Durées nulles ou négatives' AS CheckType,
    TempsId,
    OperatorCode,
    LancementCode,
    TotalDuration,
    PauseDuration,
    ProductiveDuration,
    StartTime,
    EndTime,
    StatutTraitement,
    DateCreation
FROM [dbo].[ABTEMPS_OPERATEURS]
WHERE TotalDuration < 0 
   OR PauseDuration < 0 
   OR ProductiveDuration < 0
   OR TotalDuration IS NULL
   OR PauseDuration IS NULL
   OR ProductiveDuration IS NULL
ORDER BY DateCreation DESC;

-- 2. Vérifier les incohérences : ProductiveDuration != TotalDuration - PauseDuration
SELECT 
    'Incohérence ProductiveDuration' AS CheckType,
    TempsId,
    OperatorCode,
    LancementCode,
    TotalDuration,
    PauseDuration,
    ProductiveDuration,
    (TotalDuration - PauseDuration) AS CalculatedProductive,
    (ProductiveDuration - (TotalDuration - PauseDuration)) AS Difference,
    StartTime,
    EndTime,
    StatutTraitement,
    DateCreation
FROM [dbo].[ABTEMPS_OPERATEURS]
WHERE ABS(ProductiveDuration - (TotalDuration - PauseDuration)) > 1  -- Tolérance de 1 minute
ORDER BY ABS(ProductiveDuration - (TotalDuration - PauseDuration)) DESC;

-- 3. Vérifier les ProductiveDuration = 0 pour les opérations terminées
SELECT 
    'ProductiveDuration = 0 pour opérations terminées' AS CheckType,
    TempsId,
    OperatorCode,
    LancementCode,
    TotalDuration,
    PauseDuration,
    ProductiveDuration,
    StartTime,
    EndTime,
    StatutTraitement,
    DateCreation,
    CASE 
        WHEN ProductiveDuration = 0 AND TotalDuration > 0 THEN '⚠️ ProductiveDuration = 0 mais TotalDuration > 0'
        WHEN ProductiveDuration = 0 AND TotalDuration = 0 THEN 'ℹ️ TotalDuration = 0 (opération très courte ou erreur)'
        ELSE 'OK'
    END AS Status
FROM [dbo].[ABTEMPS_OPERATEURS]
WHERE ProductiveDuration = 0
ORDER BY DateCreation DESC;

-- 4. Statistiques générales
SELECT 
    'Statistiques générales' AS CheckType,
    COUNT(*) AS TotalRecords,
    COUNT(CASE WHEN ProductiveDuration > 0 THEN 1 END) AS RecordsWithProductiveDuration,
    COUNT(CASE WHEN ProductiveDuration = 0 THEN 1 END) AS RecordsWithZeroProductiveDuration,
    COUNT(CASE WHEN ProductiveDuration < 0 THEN 1 END) AS RecordsWithNegativeProductiveDuration,
    COUNT(CASE WHEN ABS(ProductiveDuration - (TotalDuration - PauseDuration)) > 1 THEN 1 END) AS RecordsWithInconsistency,
    AVG(TotalDuration) AS AvgTotalDuration,
    AVG(PauseDuration) AS AvgPauseDuration,
    AVG(ProductiveDuration) AS AvgProductiveDuration,
    MIN(ProductiveDuration) AS MinProductiveDuration,
    MAX(ProductiveDuration) AS MaxProductiveDuration
FROM [dbo].[ABTEMPS_OPERATEURS];

-- 5. Vérifier les durées pour les enregistrements non transférés (StatutTraitement != 'T')
SELECT 
    'Enregistrements non transférés avec ProductiveDuration = 0' AS CheckType,
    TempsId,
    OperatorCode,
    LancementCode,
    TotalDuration,
    PauseDuration,
    ProductiveDuration,
    StartTime,
    EndTime,
    StatutTraitement,
    DateCreation
FROM [dbo].[ABTEMPS_OPERATEURS]
WHERE (StatutTraitement IS NULL OR StatutTraitement != 'T')
  AND ProductiveDuration = 0
ORDER BY DateCreation DESC;

-- 6. Vérifier les durées pour les enregistrements transférés (StatutTraitement = 'T')
SELECT 
    'Enregistrements transférés avec ProductiveDuration = 0' AS CheckType,
    TempsId,
    OperatorCode,
    LancementCode,
    TotalDuration,
    PauseDuration,
    ProductiveDuration,
    StartTime,
    EndTime,
    StatutTraitement,
    DateCreation
FROM [dbo].[ABTEMPS_OPERATEURS]
WHERE StatutTraitement = 'T'
  AND ProductiveDuration = 0
ORDER BY DateCreation DESC;
