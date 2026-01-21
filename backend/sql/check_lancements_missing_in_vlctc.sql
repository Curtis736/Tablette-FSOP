-- Script pour vérifier pourquoi des lancements ne sont pas dans V_LCTC
-- Usage: Exécuter dans SSMS pour diagnostiquer les lancements manquants

USE [SEDI_APP_INDEPENDANTE];
GO

-- Vérifier les lancements spécifiques mentionnés dans l'erreur
DECLARE @Lancement1 VARCHAR(50) = 'LT2400189';
DECLARE @Lancement2 VARCHAR(50) = 'LT2501139';

PRINT '=== Vérification des lancements manquants dans V_LCTC ===';
PRINT '';

-- 1. Vérifier si les lancements existent dans LCTC (SEDI_ERP)
PRINT '1. Vérification dans SEDI_ERP.dbo.LCTC:';
SELECT 
    LCTC.CodeLancement,
    LCTC.Phase,
    LCTC.CodeRubrique,
    LCTC.TypeRubrique,
    LCTE.LancementSolde
FROM [SEDI_ERP].[dbo].[LCTC]
LEFT JOIN [SEDI_ERP].[dbo].[LCTE] ON LCTE.CodeLancement = LCTC.CodeLancement
WHERE LCTC.CodeLancement IN (@Lancement1, @Lancement2);
GO

-- 2. Vérifier ce que V_LCTC retourne pour ces lancements
PRINT '';
PRINT '2. Vérification dans V_LCTC:';
SELECT 
    CodeLancement,
    Phase,
    CodeRubrique,
    DateConsultation
FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]
WHERE CodeLancement IN ('LT2400189', 'LT2501139');
GO

-- 3. Vérifier les opérations dans ABHISTORIQUE_OPERATEURS
PRINT '';
PRINT '3. Opérations dans ABHISTORIQUE_OPERATEURS:';
SELECT 
    OperatorCode,
    CodeLanctImprod,
    Phase,
    CodeRubrique,
    Statut,
    DateCreation
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
WHERE CodeLanctImprod IN ('LT2400189', 'LT2501139')
ORDER BY CodeLanctImprod, DateCreation;
GO

-- 4. Vérifier tous les TypeRubrique possibles pour ces lancements
PRINT '';
PRINT '4. Tous les TypeRubrique pour ces lancements:';
SELECT 
    LCTC.CodeLancement,
    LCTC.TypeRubrique,
    LCTE.LancementSolde,
    COUNT(*) as NombreLignes,
    STRING_AGG(CAST(LCTC.Phase AS VARCHAR), ', ') as Phases
FROM [SEDI_ERP].[dbo].[LCTC]
LEFT JOIN [SEDI_ERP].[dbo].[LCTE] ON LCTE.CodeLancement = LCTC.CodeLancement
WHERE LCTC.CodeLancement IN ('LT2400189', 'LT2501139')
GROUP BY LCTC.CodeLancement, LCTC.TypeRubrique, LCTE.LancementSolde;
GO

PRINT '';
PRINT '=== Diagnostic terminé ===';
PRINT '';
PRINT 'Si TypeRubrique <> ''O'', le lancement ne sera pas dans V_LCTC';
PRINT 'Si LancementSolde <> ''N'', le lancement ne sera pas dans V_LCTC';
PRINT 'Si le lancement n''existe pas dans SEDI_ERP.dbo.LCTC, il ne sera pas dans V_LCTC';
GO
