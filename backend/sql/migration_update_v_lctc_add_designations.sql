-- Migration: Mise à jour de la vue V_LCTC pour inclure les champs de désignation
-- Base: SEDI_APP_INDEPENDANTE
-- Date: 2026-01-07

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Update V_LCTC (ajout désignations) ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

IF OBJECT_ID('[dbo].[V_LCTC]', 'V') IS NOT NULL
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
    COALESCE(m.DateConsultation, CAST(NULL AS DATETIME2)) AS DateConsultation
FROM [SEDI_ERP].[dbo].[LCTC] C
INNER JOIN [SEDI_ERP].[dbo].[LCTE] E
    ON C.CodeLancement = E.CodeLancement
    AND E.LancementSolde = 'N'
LEFT JOIN [dbo].[AB_LANCEMENTS_MAPPING] m
    ON E.CodeLancement = m.CodeLancement;
GO

PRINT '✅ Vue V_LCTC mise à jour (désignations + mapping DateConsultation)';
PRINT '=== Migration Update V_LCTC terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO


