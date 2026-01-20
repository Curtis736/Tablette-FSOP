-- Migration: Corriger V_LCTC pour pointer vers SEDI_2025 au lieu de SEDI_ERP
-- Date: 2026-01-20
-- Raison: Les données Phase et CodeRubrique sont dans SEDI_2025.dbo.LCTC, pas SEDI_ERP.dbo.LCTC

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Correction V_LCTC vers SEDI_2025 ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- Supprimer l'ancienne vue si elle existe
IF OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]', 'V') IS NOT NULL
BEGIN
    DROP VIEW [dbo].[V_LCTC];
    PRINT '✅ Ancienne vue V_LCTC supprimée';
END
GO

-- Recréer la vue en pointant vers SEDI_2025
CREATE VIEW [dbo].[V_LCTC]
AS
SELECT 
    CodeLancement,
    Phase,
    CodeRubrique,
    -- DateConsultation : À implémenter dans SILOG par Franck MAILLARD
    -- Pour l'instant, retourner NULL ou GETDATE()
    CAST(NULL AS DATETIME2) AS DateConsultation
FROM [SEDI_2025].[dbo].[LCTC];
GO

PRINT '✅ Vue V_LCTC recréée pointant vers SEDI_2025.dbo.LCTC';
PRINT '⚠️  Note: DateConsultation doit être implémentée dans SILOG';
GO

-- Vérifier que la vue fonctionne
PRINT '🔍 Vérification de la vue V_LCTC...';
GO

SELECT TOP 5 
    CodeLancement,
    Phase,
    CodeRubrique
FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC];
GO

PRINT '=== Migration V_LCTC terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
PRINT '';
PRINT '✅ La vue V_LCTC pointe maintenant vers SEDI_2025.dbo.LCTC';
PRINT '✅ Phase et CodeRubrique seront récupérés depuis la bonne base de données';
GO
