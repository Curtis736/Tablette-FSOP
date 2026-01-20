-- Migration: Rendre Phase et CodeRubrique NOT NULL dans ABTEMPS_OPERATEURS
-- Date: 2026-01-20
-- Raison: Phase et CodeRubrique font partie des clés dans l'ERP (demande Franck MAILLARD)
-- IMPORTANT: Cette migration nécessite que tous les enregistrements existants aient des valeurs valides

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Phase et CodeRubrique NOT NULL ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- 1. Vérifier s'il y a des enregistrements avec Phase ou CodeRubrique NULL
PRINT '🔍 Vérification des enregistrements avec Phase ou CodeRubrique NULL...';
GO

DECLARE @nullPhaseCount INT;
DECLARE @nullCodeRubriqueCount INT;

SELECT @nullPhaseCount = COUNT(*) 
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
WHERE Phase IS NULL;

SELECT @nullCodeRubriqueCount = COUNT(*) 
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
WHERE CodeRubrique IS NULL;

IF @nullPhaseCount > 0 OR @nullCodeRubriqueCount > 0
BEGIN
    PRINT '⚠️  ATTENTION: Des enregistrements ont Phase ou CodeRubrique NULL';
    PRINT '   Phase NULL: ' + CAST(@nullPhaseCount AS VARCHAR);
    PRINT '   CodeRubrique NULL: ' + CAST(@nullCodeRubriqueCount AS VARCHAR);
    PRINT '   Ces enregistrements doivent être corrigés avant de continuer.';
    PRINT '   Utilisez V_LCTC pour mettre à jour les valeurs manquantes.';
    
    -- Afficher les enregistrements problématiques
    SELECT 
        TempsId,
        OperatorCode,
        LancementCode,
        Phase,
        CodeRubrique,
        StatutTraitement
    FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
    WHERE Phase IS NULL OR CodeRubrique IS NULL;
    
    -- Ne pas continuer si des valeurs NULL existent
    RAISERROR('Migration interrompue: Des enregistrements ont Phase ou CodeRubrique NULL. Corrigez-les d''abord.', 16, 1);
    RETURN;
END
ELSE
BEGIN
    PRINT '✅ Aucun enregistrement avec Phase ou CodeRubrique NULL';
END
GO

-- 2. Supprimer les index qui dépendent de Phase et CodeRubrique
PRINT '🗑️  Suppression des index dépendants...';
GO

-- Index IX_Temps_Phase_CodeRubrique
IF EXISTS (SELECT * FROM sys.indexes 
           WHERE name = 'IX_Temps_Phase_CodeRubrique' 
           AND object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]'))
BEGIN
    DROP INDEX [IX_Temps_Phase_CodeRubrique] ON [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS];
    PRINT '✅ Index IX_Temps_Phase_CodeRubrique supprimé';
END
ELSE
BEGIN
    PRINT 'ℹ️  Index IX_Temps_Phase_CodeRubrique n''existe pas';
END
GO

-- Index IX_Temps_StatutTraitement (vérifier s'il inclut Phase)
IF EXISTS (SELECT * FROM sys.indexes 
           WHERE name = 'IX_Temps_StatutTraitement' 
           AND object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]'))
BEGIN
    -- Vérifier si l'index inclut Phase dans ses colonnes incluses ou clés
    DECLARE @indexIncludesPhase BIT = 0;
    DECLARE @indexId INT;
    
    SELECT @indexId = index_id 
    FROM sys.indexes 
    WHERE name = 'IX_Temps_StatutTraitement' 
      AND object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]');
    
    SELECT @indexIncludesPhase = 1
    FROM sys.index_columns ic
    INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    WHERE ic.object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]')
      AND ic.index_id = @indexId
      AND c.name = 'Phase';
    
    IF @indexIncludesPhase = 1
    BEGIN
        DROP INDEX [IX_Temps_StatutTraitement] ON [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS];
        PRINT '✅ Index IX_Temps_StatutTraitement supprimé (contient Phase)';
    END
    ELSE
    BEGIN
        PRINT 'ℹ️  Index IX_Temps_StatutTraitement ne contient pas Phase, pas besoin de le supprimer';
    END
END
ELSE
BEGIN
    PRINT 'ℹ️  Index IX_Temps_StatutTraitement n''existe pas';
END
GO

-- 3. Modifier Phase en NOT NULL
PRINT '📝 Modification de Phase en NOT NULL...';
GO

-- D'abord, mettre à jour les valeurs NULL avec une valeur par défaut (si nécessaire)
-- Mais normalement, on a déjà vérifié qu'il n'y en a pas
UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
SET Phase = 'PRODUCTION'
WHERE Phase IS NULL;

-- Maintenant, modifier la colonne
ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
ALTER COLUMN Phase VARCHAR(30) NOT NULL;

PRINT '✅ Colonne Phase modifiée en NOT NULL';
GO

-- 4. Modifier CodeRubrique en NOT NULL
PRINT '📝 Modification de CodeRubrique en NOT NULL...';
GO

-- D'abord, mettre à jour les valeurs NULL avec une valeur par défaut (si nécessaire)
UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
SET CodeRubrique = OperatorCode
WHERE CodeRubrique IS NULL;

-- Maintenant, modifier la colonne
ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
ALTER COLUMN CodeRubrique VARCHAR(30) NOT NULL;

PRINT '✅ Colonne CodeRubrique modifiée en NOT NULL';
GO

-- 5. Recréer l'index IX_Temps_Phase_CodeRubrique
PRINT '🔨 Recréation de l''index IX_Temps_Phase_CodeRubrique...';
GO

IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE name = 'IX_Temps_Phase_CodeRubrique' 
               AND object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]'))
BEGIN
    -- Note: Pas de clause WHERE car Phase et CodeRubrique sont maintenant NOT NULL
    CREATE NONCLUSTERED INDEX [IX_Temps_Phase_CodeRubrique] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
    ([Phase] ASC, [CodeRubrique] ASC)
    INCLUDE ([OperatorCode], [LancementCode], [StatutTraitement]);
    
    PRINT '✅ Index IX_Temps_Phase_CodeRubrique recréé';
END
ELSE
BEGIN
    PRINT 'ℹ️  Index IX_Temps_Phase_CodeRubrique existe déjà';
END
GO

-- 6. Recréer l'index IX_Temps_StatutTraitement si nécessaire
-- (Seulement si on l'a supprimé précédemment)
PRINT '🔨 Vérification de l''index IX_Temps_StatutTraitement...';
GO

IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE name = 'IX_Temps_StatutTraitement' 
               AND object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]'))
BEGIN
    -- Recréer l'index selon la structure originale (depuis migration_extend_temps.sql)
    CREATE NONCLUSTERED INDEX [IX_Temps_StatutTraitement] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
    ([StatutTraitement] ASC, [DateCreation] DESC)
    INCLUDE ([OperatorCode], [LancementCode], [Phase], [CodeRubrique])
    WHERE StatutTraitement IS NOT NULL;
    
    PRINT '✅ Index IX_Temps_StatutTraitement recréé';
END
ELSE
BEGIN
    PRINT 'ℹ️  Index IX_Temps_StatutTraitement existe déjà';
END
GO

PRINT '=== Migration Phase et CodeRubrique NOT NULL terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
PRINT '';
PRINT '✅ Les colonnes Phase et CodeRubrique sont maintenant NOT NULL';
PRINT '✅ Les index ont été recréés';
PRINT '';
PRINT '⚠️  IMPORTANT: Assurez-vous que le code Node.js récupère toujours Phase et CodeRubrique depuis V_LCTC';
GO
