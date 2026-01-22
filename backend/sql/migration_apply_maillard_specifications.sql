-- Migration: Application des spécifications de Franck MAILLARD pour V_LCTC et V_RESSOURC
-- Date: 2026-01-20
-- Base: SEDI_APP_INDEPENDANTE
-- 
-- Spécifications de Franck MAILLARD:
-- 1. V_LCTC doit pointer vers SEDI_ERP (pas SEDI_2025 qui est une archive figée)
-- 2. V_LCTC doit avoir WHERE TypeRubrique='O' (obligatoire pour exclure les composants)
-- 3. V_LCTC doit avoir LancementSolde='N' (seulement les lancements non soldés)
-- 4. V_RESSOURC doit utiliser TableAlphaUtil et TableAlphaUtil2
-- 5. DateConsultation doit être récupérée depuis LCTE.VARAlphaUtil5

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Application spécifications Franck MAILLARD ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- ============================================
-- 1. Mise à jour de la vue V_RESSOURC
-- ============================================

IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[V_RESSOURC]', 'V') IS NOT NULL
BEGIN
    DROP VIEW [dbo].[V_RESSOURC];
    PRINT '✅ Ancienne vue V_RESSOURC supprimée';
END
GO

CREATE VIEW [dbo].[V_RESSOURC]
AS
SELECT 
    r.CodeRessource AS CodeOperateur,
    r.Designation1 AS NomOperateur,
    CAST(r.TableAlphaUtil AS VARCHAR(50)) AS StatutOperateur,
    CAST(iif(r.TableAlphaUtil2='',NULL,r.TableAlphaUtil2) AS DATETIME2) AS DateConsultation
FROM [SEDI_ERP].[dbo].[RESSOURC] r;
GO

PRINT '✅ Vue V_RESSOURC recréée selon spécifications Franck MAILLARD';
PRINT '   - StatutOperateur depuis TableAlphaUtil';
PRINT '   - DateConsultation depuis TableAlphaUtil2';
GO

-- ============================================
-- 2. Mise à jour de la vue V_LCTC
-- ============================================

IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]', 'V') IS NOT NULL
BEGIN
    DROP VIEW [dbo].[V_LCTC];
    PRINT '✅ Ancienne vue V_LCTC supprimée';
END
GO

CREATE VIEW [dbo].[V_LCTC]
AS
SELECT 
    LCTC.CodeLancement,
    LCTC.Phase,
    LCTC.CodeRubrique,
    LCTC.CodeLot,
    CAST(iif(LCTE.VARAlphaUtil5='',NULL,LCTE.VARAlphaUtil5) AS DATETIME2) AS DateConsultation
FROM [SEDI_ERP].[dbo].[LCTC]
JOIN [SEDI_ERP].[dbo].[LCTE] on LCTE.CodeLancement=LCTC.CodeLancement
WHERE LancementSolde='N'
  AND TypeRubrique='O';
GO

PRINT '✅ Vue V_LCTC recréée selon spécifications Franck MAILLARD';
PRINT '   - Base: SEDI_ERP (pas SEDI_2025)';
PRINT '   - Filtre: LancementSolde=''N'' (lancements non soldés)';
PRINT '   - Filtre: TypeRubrique=''O'' (seulement les temps, pas les composants)';
PRINT '   - DateConsultation depuis LCTE.VARAlphaUtil5';
GO

-- ============================================
-- 3. Vérifications
-- ============================================

PRINT '';
PRINT '🔍 Vérification de V_RESSOURC...';
SELECT TOP 5 
    CodeOperateur,
    NomOperateur,
    StatutOperateur,
    DateConsultation
FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_RESSOURC];
GO

PRINT '';
PRINT '🔍 Vérification de V_LCTC...';
SELECT TOP 5 
    CodeLancement,
    Phase,
    CodeRubrique,
    DateConsultation
FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC];
GO

PRINT '';
PRINT '=== Migration terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
PRINT '';
PRINT '✅ V_RESSOURC et V_LCTC mises à jour selon spécifications Franck MAILLARD';
PRINT '✅ V_LCTC filtre maintenant TypeRubrique=''O'' pour exclure les composants';
PRINT '✅ V_LCTC utilise SEDI_ERP (base de travail quotidienne)';
GO
