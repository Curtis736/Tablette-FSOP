-- Script: Corriger Phase et CodeRubrique depuis V_LCTC pour les enregistrements existants
-- Date: 2026-01-20
-- Usage: Exécuter AVANT migration_make_phase_coderubrique_not_null.sql
-- Ce script met à jour les enregistrements ABTEMPS_OPERATEURS qui ont Phase ou CodeRubrique NULL

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Correction Phase et CodeRubrique depuis V_LCTC ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- 1. Identifier les enregistrements à corriger
PRINT '🔍 Identification des enregistrements à corriger...';
GO

SELECT 
    t.TempsId,
    t.OperatorCode,
    t.LancementCode,
    t.Phase AS PhaseActuelle,
    t.CodeRubrique AS CodeRubriqueActuel,
    v.Phase AS PhaseV_LCTC,
    v.CodeRubrique AS CodeRubriqueV_LCTC,
    CASE 
        WHEN t.Phase IS NULL AND v.Phase IS NOT NULL THEN 'Phase à corriger'
        WHEN t.CodeRubrique IS NULL AND v.CodeRubrique IS NOT NULL THEN 'CodeRubrique à corriger'
        WHEN t.Phase IS NULL AND v.Phase IS NULL THEN 'Phase NULL dans V_LCTC'
        WHEN t.CodeRubrique IS NULL AND v.CodeRubrique IS NULL THEN 'CodeRubrique NULL dans V_LCTC'
        ELSE 'OK'
    END AS Statut
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC] v 
    ON t.LancementCode = v.CodeLancement
WHERE t.Phase IS NULL OR t.CodeRubrique IS NULL;
GO

-- 2. Mettre à jour Phase depuis V_LCTC
PRINT '📝 Mise à jour de Phase depuis V_LCTC...';
GO

UPDATE t
SET t.Phase = v.Phase
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
INNER JOIN [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC] v 
    ON t.LancementCode = v.CodeLancement
WHERE t.Phase IS NULL 
  AND v.Phase IS NOT NULL;

DECLARE @phaseUpdated INT = @@ROWCOUNT;
PRINT '✅ ' + CAST(@phaseUpdated AS VARCHAR) + ' enregistrement(s) mis à jour pour Phase';
GO

-- 3. Mettre à jour CodeRubrique depuis V_LCTC
PRINT '📝 Mise à jour de CodeRubrique depuis V_LCTC...';
GO

UPDATE t
SET t.CodeRubrique = v.CodeRubrique
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
INNER JOIN [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC] v 
    ON t.LancementCode = v.CodeLancement
WHERE t.CodeRubrique IS NULL 
  AND v.CodeRubrique IS NOT NULL;

DECLARE @codeRubriqueUpdated INT = @@ROWCOUNT;
PRINT '✅ ' + CAST(@codeRubriqueUpdated AS VARCHAR) + ' enregistrement(s) mis à jour pour CodeRubrique';
GO

-- 4. Gérer les lancements non trouvés dans V_LCTC
PRINT '⚠️  Gestion des lancements non trouvés dans V_LCTC...';
GO

-- Pour les lancements non trouvés dans V_LCTC, utiliser des valeurs par défaut
-- Phase = 'PRODUCTION' (valeur par défaut)
UPDATE t
SET t.Phase = 'PRODUCTION'
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC] v 
    ON t.LancementCode = v.CodeLancement
WHERE t.Phase IS NULL 
  AND v.CodeLancement IS NULL;

DECLARE @phaseDefault INT = @@ROWCOUNT;
IF @phaseDefault > 0
BEGIN
    PRINT '⚠️  ' + CAST(@phaseDefault AS VARCHAR) + ' enregistrement(s) avec Phase = PRODUCTION (valeur par défaut, lancement non trouvé dans V_LCTC)';
END
ELSE
BEGIN
    PRINT '✅ Aucun enregistrement nécessitant des valeurs par défaut';
END
GO

-- CodeRubrique = OperatorCode (valeur par défaut)
UPDATE t
SET t.CodeRubrique = t.OperatorCode
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
LEFT JOIN [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC] v 
    ON t.LancementCode = v.CodeLancement
WHERE t.CodeRubrique IS NULL 
  AND v.CodeLancement IS NULL;

DECLARE @codeRubriqueDefault INT = @@ROWCOUNT;
IF @codeRubriqueDefault > 0
BEGIN
    PRINT '⚠️  ' + CAST(@codeRubriqueDefault AS VARCHAR) + ' enregistrement(s) avec CodeRubrique = OperatorCode (valeur par défaut, lancement non trouvé dans V_LCTC)';
END
GO

-- 5. Vérification finale
PRINT '🔍 Vérification finale...';
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
    PRINT '⚠️  ATTENTION: Des enregistrements ont encore Phase ou CodeRubrique NULL';
    PRINT '   Phase NULL: ' + CAST(@nullPhaseCount AS VARCHAR);
    PRINT '   CodeRubrique NULL: ' + CAST(@nullCodeRubriqueCount AS VARCHAR);
    PRINT '   Ces enregistrements doivent être corrigés manuellement avant de continuer.';
END
ELSE
BEGIN
    PRINT '✅ Tous les enregistrements ont maintenant Phase et CodeRubrique renseignés';
    PRINT '✅ Vous pouvez maintenant exécuter migration_make_phase_coderubrique_not_null.sql';
END
GO

PRINT '=== Correction terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO
