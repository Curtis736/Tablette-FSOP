-- Migration: Mise à jour des vues V_RESSOURC et V_LCTC pour utiliser directement les champs SILOG
-- Base: SEDI_APP_INDEPENDANTE
-- Date: 2026-01-XX
-- Note: Les champs StatutOperateur et DateConsultation ont été implémentés dans SILOG par Franck MAILLARD
--       DateConsultation est stockée dans un champ VarChar dans SILOG et convertie en DateTime2 dans la vue
--       Les tables de mapping AB_OPERATEURS_MAPPING et AB_LANCEMENTS_MAPPING ne sont plus utilisées

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Mise à jour vues SILOG (utilisation directe des champs SILOG) ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- ============================================
-- 1. Mise à jour de la vue V_RESSOURC
-- ============================================
-- Les champs StatutOperateur et DateConsultation sont maintenant disponibles directement dans SILOG
-- DateConsultation est stockée en VarChar dans SILOG et doit être convertie en DateTime2

IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[V_RESSOURC]', 'V') IS NOT NULL
    DROP VIEW [dbo].[V_RESSOURC];
GO

CREATE VIEW [dbo].[V_RESSOURC]
AS
SELECT 
    r.CodeRessource AS CodeOperateur,
    r.Designation1 AS NomOperateur,
    -- StatutOperateur : Maintenant disponible directement dans SILOG
    -- NOTE: À vérifier avec Franck MAILLARD - peut être dans un champ VarAlphaUtil ou une colonne dédiée
    -- Pour l'instant, utiliser NULL en attendant confirmation
    CAST(NULL AS VARCHAR(50)) AS StatutOperateur,
    -- DateConsultation : Stockée en VarChar dans SILOG, convertie en DateTime2
    -- NOTE: À vérifier avec Franck MAILLARD - peut être dans un champ VarAlphaUtil ou une colonne dédiée
    -- Pour l'instant, utiliser NULL en attendant confirmation
    CAST(NULL AS DATETIME2) AS DateConsultation
FROM [SEDI_ERP].[dbo].[RESSOURC] r;
GO

PRINT '✅ Vue V_RESSOURC mise à jour (utilisation directe des champs SILOG)';
PRINT '⚠️  IMPORTANT: StatutOperateur et DateConsultation sont temporairement NULL';
PRINT '⚠️  ACTION REQUISE: Vérifier avec Franck MAILLARD les noms exacts des colonnes dans RESSOURC';
PRINT '⚠️  Les colonnes peuvent être dans des champs VarAlphaUtil ou avoir des noms spécifiques';
GO

-- ============================================
-- 2. Mise à jour de la vue V_LCTC
-- ============================================
-- Le champ DateConsultation est maintenant disponible directement dans SILOG
-- DateConsultation est stockée en VarChar dans SILOG et doit être convertie en DateTime2

IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]', 'V') IS NOT NULL
    DROP VIEW [dbo].[V_LCTC];
GO

CREATE VIEW [dbo].[V_LCTC]
AS
SELECT
    E.CodeLancement,
    E.CodeArticle,
    E.DesignationLct1,
    E.CodeModele,
    E.DesignationArt1,
    E.DesignationArt2,
    C.Phase,
    C.CodeRubrique,
    -- DateConsultation : Stockée en VarChar dans SILOG (VarAlphaUtil5), convertie en DateTime2
    -- D'après la vue existante, DateConsultation provient de E.VarAlphaUtil5 dans LCTE
    CAST(IIF(E.VarAlphaUtil5 = '' OR E.VarAlphaUtil5 IS NULL, NULL, E.VarAlphaUtil5) AS DATETIME2) AS DateConsultation
FROM [SEDI_ERP].[dbo].[LCTC] C
INNER JOIN [SEDI_ERP].[dbo].[LCTE] E
    ON C.CodeLancement = E.CodeLancement
    AND E.LancementSolde = 'N'
WHERE C.TypeRubrique = 'O';
GO

PRINT '✅ Vue V_LCTC mise à jour (utilisation directe des champs SILOG)';
PRINT '✅ DateConsultation utilise E.VarAlphaUtil5 depuis LCTE (confirmé par la vue existante)';
GO

-- ============================================
-- 3. Notes sur les tables de mapping
-- ============================================
-- Les tables AB_OPERATEURS_MAPPING et AB_LANCEMENTS_MAPPING ne sont plus utilisées
-- Elles peuvent être conservées pour référence historique ou supprimées si nécessaire
-- Pour supprimer les tables de mapping (optionnel, à faire manuellement si souhaité):
-- 
-- DROP TABLE IF EXISTS [SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING];
-- DROP TABLE IF EXISTS [SEDI_APP_INDEPENDANTE].[dbo].[AB_LANCEMENTS_MAPPING];
-- DROP PROCEDURE IF EXISTS sp_UpdateOperatorStatus;
-- DROP PROCEDURE IF EXISTS sp_UpdateOperatorConsultationDate;
-- DROP PROCEDURE IF EXISTS sp_RecordOperatorConsultation;
-- DROP PROCEDURE IF EXISTS sp_RecordLancementConsultation;

PRINT '';
PRINT '=== Migration vues SILOG terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
PRINT '';
PRINT '✅ Les vues V_RESSOURC et V_LCTC utilisent maintenant directement les champs SILOG';
PRINT '⚠️  ACTION REQUISE: Vérifier et ajuster les noms de colonnes selon la configuration réelle de SILOG';
PRINT '   - V_RESSOURC.StatutOperateur';
PRINT '   - V_RESSOURC.DateConsultation';
PRINT '   - V_LCTC.DateConsultation (vérifier si dans LCTC ou LCTE)';
PRINT '';
PRINT '📝 Contact: Franck MAILLARD pour confirmer les noms exacts des colonnes dans SILOG';
GO
