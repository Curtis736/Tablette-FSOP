-- Migration: Création des vues SQL pour lecture des données SILOG
-- Vues V_RESSOURC et V_LCTC pour l'application WEB
-- Base: SEDI_APP_INDEPENDANTE
-- Date: 2026-01-07
-- Note: Les colonnes StatutOperateur et DateConsultation doivent être implémentées dans SILOG par Franck MAILLARD

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Création vues SILOG ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- 1. Vue V_RESSOURC : Liste des opérateurs
-- Cette vue remplace l'accès direct à SEDI_ERP.dbo.RESSOURC
-- Les colonnes StatutOperateur et DateConsultation sont temporairement NULL
-- et devront être implémentées dans SILOG par Franck MAILLARD
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[V_RESSOURC]', 'V') IS NOT NULL
    DROP VIEW [dbo].[V_RESSOURC];
GO

CREATE VIEW [dbo].[V_RESSOURC]
AS
SELECT 
    CodeRessource AS CodeOperateur,
    Designation1 AS NomOperateur,
    -- StatutOperateur : À implémenter dans SILOG par Franck MAILLARD
    -- Pour l'instant, retourner NULL ou une valeur par défaut
    CAST(NULL AS VARCHAR(50)) AS StatutOperateur,
    -- DateConsultation : À implémenter dans SILOG par Franck MAILLARD
    -- Pour l'instant, retourner NULL ou GETDATE()
    CAST(NULL AS DATETIME2) AS DateConsultation
FROM [SEDI_ERP].[dbo].[RESSOURC];
GO

PRINT '✅ Vue V_RESSOURC créée';
PRINT '⚠️  Note: StatutOperateur et DateConsultation doivent être implémentées dans SILOG';
GO

-- 2. Vue V_LCTC : Liste des lancements en cours
-- Cette vue remplace l'accès direct à SEDI_ERP.dbo.LCTC et LCTE
-- La colonne DateConsultation est temporairement NULL
-- et devra être implémentée dans SILOG par Franck MAILLARD
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]', 'V') IS NOT NULL
    DROP VIEW [dbo].[V_LCTC];
GO

CREATE VIEW [dbo].[V_LCTC]
AS
SELECT 
    E.CodeLancement,
    C.Phase,
    C.CodeRubrique,
    -- DateConsultation : À implémenter dans SILOG par Franck MAILLARD
    -- Pour l'instant, retourner NULL ou GETDATE()
    CAST(NULL AS DATETIME2) AS DateConsultation
FROM [SEDI_ERP].[dbo].[LCTC] C
INNER JOIN [SEDI_ERP].[dbo].[LCTE] E 
    ON C.CodeLancement = E.CodeLancement 
    AND E.LancementSolde = 'N';
GO

PRINT '✅ Vue V_LCTC créée';
PRINT '⚠️  Note: DateConsultation doit être implémentée dans SILOG';
GO

-- 3. Créer des index sur les tables ERP si nécessaire (optionnel, dépend de la configuration)
-- Note: Ces index sont créés sur les tables ERP, donc nécessitent les permissions appropriées
-- Pour l'instant, on ne crée pas d'index car ils doivent être gérés dans SILOG

PRINT '=== Migration vues SILOG terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
PRINT '';
PRINT '⚠️  IMPORTANT: Les colonnes suivantes doivent être implémentées dans SILOG:';
PRINT '   - V_RESSOURC.StatutOperateur';
PRINT '   - V_RESSOURC.DateConsultation';
PRINT '   - V_LCTC.DateConsultation';
PRINT '   Contact: Franck MAILLARD pour l''implémentation';
GO

