-- Migration: Optimisation des index pour améliorer les performances
-- Base: SEDI_APP_INDEPENDANTE
-- Date: 2026-01-13

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Optimisation des index ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- 1. Index composite pour les requêtes d'historique opérateur avec filtrage StatutTraitement
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]') 
               AND name = 'IX_Historique_Operator_Date_Statut')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Historique_Operator_Date_Statut] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS] 
    ([OperatorCode], [DateCreation] DESC, [CodeLanctImprod])
    INCLUDE ([Ident], [Phase], [Statut], [HeureDebut], [HeureFin]);
    
    PRINT '✅ Index IX_Historique_Operator_Date_Statut créé';
END
ELSE
BEGIN
    PRINT 'ℹ️ Index IX_Historique_Operator_Date_Statut existe déjà';
END
GO

-- 2. Index pour optimiser le JOIN entre ABHISTORIQUE et ABTEMPS sur DateCreation
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]') 
               AND name = 'IX_Temps_Operator_Lancement_Date_Statut')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Temps_Operator_Lancement_Date_Statut] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] 
    ([OperatorCode], [LancementCode], [DateCreation] DESC, [StatutTraitement])
    INCLUDE ([Phase], [CodeRubrique], [TotalDuration], [PauseDuration], [ProductiveDuration])
    WHERE StatutTraitement IS NOT NULL;
    
    PRINT '✅ Index IX_Temps_Operator_Lancement_Date_Statut créé';
END
ELSE
BEGIN
    PRINT 'ℹ️ Index IX_Temps_Operator_Lancement_Date_Statut existe déjà';
END
GO

-- 3. Index pour optimiser les requêtes de Phase depuis abetemps
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_ERP].[GPSQL].[abetemps]') 
               AND name = 'IX_abetemps_Lancement_Phase')
BEGIN
    -- Note: Cet index doit être créé dans la base SEDI_ERP
    PRINT '⚠️ Index IX_abetemps_Lancement_Phase doit être créé dans SEDI_ERP';
    PRINT '   CREATE NONCLUSTERED INDEX [IX_abetemps_Lancement_Phase]';
    PRINT '   ON [SEDI_ERP].[GPSQL].[abetemps] ([CodeLanctImprod], [NoEnreg] DESC)';
    PRINT '   INCLUDE ([Phase]);';
END
ELSE
BEGIN
    PRINT 'ℹ️ Index IX_abetemps_Lancement_Phase existe déjà';
END
GO

-- 4. Index pour optimiser les requêtes LCTE (CodeLancement est probablement déjà indexé, mais vérifions)
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_ERP].[dbo].[LCTE]') 
               AND name = 'IX_LCTE_CodeLancement')
BEGIN
    -- Note: Cet index doit être créé dans la base SEDI_ERP
    PRINT '⚠️ Index IX_LCTE_CodeLancement doit être créé dans SEDI_ERP';
    PRINT '   CREATE NONCLUSTERED INDEX [IX_LCTE_CodeLancement]';
    PRINT '   ON [SEDI_ERP].[dbo].[LCTE] ([CodeLancement])';
    PRINT '   INCLUDE ([DesignationLct1], [DesignationLct2], [CodeArticle]);';
END
ELSE
BEGIN
    PRINT 'ℹ️ Index IX_LCTE_CodeLancement existe déjà';
END
GO

PRINT '=== Migration terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO
