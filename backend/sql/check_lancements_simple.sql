-- Script simplifié pour vérifier pourquoi des lancements ne sont pas dans V_LCTC
-- Usage: Exécuter dans SSMS pour diagnostiquer les lancements manquants

USE [SEDI_APP_INDEPENDANTE];
GO

-- Vérifier les lancements spécifiques mentionnés dans l'erreur
PRINT '=== Vérification des lancements LT2400189 et LT2501139 ===';
PRINT '';

-- 1. Vérifier si les lancements existent dans LCTC avec TypeRubrique='O'
PRINT '1. Lancements avec TypeRubrique=''O'' dans SEDI_ERP.dbo.LCTC:';
SELECT 
    LCTC.CodeLancement,
    LCTC.Phase,
    LCTC.CodeRubrique,
    LCTC.TypeRubrique
FROM [SEDI_ERP].[dbo].[LCTC]
WHERE LCTC.CodeLancement IN ('LT2400189', 'LT2501139')
  AND LCTC.TypeRubrique = 'O';
GO

-- 2. Vérifier tous les TypeRubrique pour ces lancements
PRINT '';
PRINT '2. Tous les TypeRubrique pour ces lancements:';
SELECT 
    LCTC.CodeLancement,
    LCTC.TypeRubrique,
    COUNT(*) as NombreLignes,
    STRING_AGG(CAST(LCTC.Phase AS VARCHAR), ', ') as Phases
FROM [SEDI_ERP].[dbo].[LCTC]
WHERE LCTC.CodeLancement IN ('LT2400189', 'LT2501139')
GROUP BY LCTC.CodeLancement, LCTC.TypeRubrique;
GO

-- 3. Vérifier LancementSolde dans LCTE
PRINT '';
PRINT '3. LancementSolde dans SEDI_ERP.dbo.LCTE:';
SELECT 
    CodeLancement,
    LancementSolde
FROM [SEDI_ERP].[dbo].[LCTE]
WHERE CodeLancement IN ('LT2400189', 'LT2501139');
GO

-- 4. Vérifier ce que V_LCTC retourne pour ces lancements
PRINT '';
PRINT '4. Résultat de V_LCTC pour ces lancements:';
SELECT 
    CodeLancement,
    Phase,
    CodeRubrique,
    DateConsultation
FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_LCTC]
WHERE CodeLancement IN ('LT2400189', 'LT2501139');
GO

-- 5. Vérifier les opérations dans ABHISTORIQUE_OPERATEURS
PRINT '';
PRINT '5. Opérations dans ABHISTORIQUE_OPERATEURS:';
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

PRINT '';
PRINT '=== Diagnostic terminé ===';
PRINT '';
PRINT 'Si TypeRubrique <> ''O'', le lancement ne sera pas dans V_LCTC';
PRINT 'Si LancementSolde <> ''N'', le lancement ne sera pas dans V_LCTC';
PRINT 'Si le lancement n''existe pas dans SEDI_ERP.dbo.LCTC, il ne sera pas dans V_LCTC';
GO
