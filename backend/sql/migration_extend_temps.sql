-- Migration: Extension de la table ABTEMPS_OPERATEURS
-- Amélioration de la cohérence et ajout de métadonnées
-- Base: SEDI_APP_INDEPENDANTE

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: Extension ABTEMPS_OPERATEURS ===';
PRINT 'Début: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO

-- 1. Ajouter SessionId (corrélation avec la session)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABTEMPS_OPERATEURS' 
               AND COLUMN_NAME = 'SessionId')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
    ADD SessionId INT NULL;
    
    PRINT '✅ Colonne SessionId ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne SessionId existe déjà';
END
GO

-- Corréler avec les sessions existantes (dans un batch séparé)
-- Note: Cette corrélation est optionnelle et peut échouer si la table est vide
-- ou si les sessions n'existent pas encore. On l'ignore silencieusement.
-- Cette corrélation sera effectuée manuellement ou via un script séparé si nécessaire.
-- Pour l'instant, on la commente pour éviter les erreurs de colonne inexistante.
/*
IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
           WHERE TABLE_NAME = 'ABTEMPS_OPERATEURS' 
           AND COLUMN_NAME = 'SessionId')
BEGIN
    BEGIN TRY
        UPDATE t
        SET t.SessionId = s.SessionId
        FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
        INNER JOIN [SEDI_APP_INDEPENDANTE].[dbo].[ABSESSIONS_OPERATEURS] s
            ON t.OperatorCode = s.OperatorCode
            AND CAST(t.DateCreation AS DATE) = CAST(s.DateCreation AS DATE)
            AND s.SessionStatus = 'ACTIVE'
        WHERE t.SessionId IS NULL
            AND t.DateCreation >= DATEADD(day, -7, GETDATE());
        
        PRINT '✅ Corrélation avec sessions effectuée';
    END TRY
    BEGIN CATCH
        PRINT '⚠️ Corrélation avec sessions ignorée (table vide ou sessions inexistantes)';
    END CATCH
END
*/
GO

-- 2. Ajouter CalculatedAt (timestamp du calcul des durées)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABTEMPS_OPERATEURS' 
               AND COLUMN_NAME = 'CalculatedAt')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
    ADD CalculatedAt DATETIME2 NULL;

    PRINT '✅ Colonne CalculatedAt ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne CalculatedAt existe déjà';
END
GO

-- 2.b Initialiser CalculatedAt (batch séparé pour éviter Invalid column name 'CalculatedAt')
IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME = 'ABTEMPS_OPERATEURS'
           AND COLUMN_NAME = 'CalculatedAt')
BEGIN
    UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
    SET CalculatedAt = DateCreation
    WHERE CalculatedAt IS NULL;

    PRINT '✅ CalculatedAt initialisé pour les enregistrements existants';
END
GO

-- 3. Ajouter CalculationMethod (méthode utilisée pour calculer les durées)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABTEMPS_OPERATEURS' 
               AND COLUMN_NAME = 'CalculationMethod')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
    ADD CalculationMethod NVARCHAR(50) DEFAULT 'EVENTS_BASED';
    
    -- Valeurs possibles: 'EVENTS_BASED', 'APPROXIMATION', 'MANUAL'
    PRINT '✅ Colonne CalculationMethod ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne CalculationMethod existe déjà';
END
GO

-- 4. Créer index pour améliorer les requêtes
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]') 
               AND name = 'IX_Temps_Operator_Lancement_Date')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Temps_Operator_Lancement_Date] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] 
    ([OperatorCode], [LancementCode], [DateCreation] DESC)
    INCLUDE ([TotalDuration], [PauseDuration], [ProductiveDuration]);
    
    PRINT '✅ Index IX_Temps_Operator_Lancement_Date créé';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]') 
               AND name = 'IX_Temps_SessionId')
BEGIN
    -- Vérifier que SessionId existe avant de créer l'index
    IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABTEMPS_OPERATEURS' 
               AND COLUMN_NAME = 'SessionId')
    BEGIN
        CREATE NONCLUSTERED INDEX [IX_Temps_SessionId] 
        ON [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] 
        ([SessionId], [DateCreation] DESC)
        WHERE SessionId IS NOT NULL;
        
        PRINT '✅ Index IX_Temps_SessionId créé';
    END
    ELSE
    BEGIN
        PRINT '⚠️ Index IX_Temps_SessionId non créé: SessionId n''existe pas encore';
    END
END
GO

-- 4. Ajouter Phase (code de phase - déjà présent dans ABHISTORIQUE_OPERATEURS)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABTEMPS_OPERATEURS' 
               AND COLUMN_NAME = 'Phase')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
    ADD Phase VARCHAR(30) NULL;
    
    PRINT '✅ Colonne Phase ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne Phase existe déjà';
END
GO

-- 5. Ajouter CodeRubrique (code rubrique - déjà présent dans ABHISTORIQUE_OPERATEURS)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABTEMPS_OPERATEURS' 
               AND COLUMN_NAME = 'CodeRubrique')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
    ADD CodeRubrique VARCHAR(30) NULL;
    
    PRINT '✅ Colonne CodeRubrique ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne CodeRubrique existe déjà';
END
GO

-- 6. Ajouter StatutTraitement (statut de traitement pour le workflow de validation/transmission)
-- NULL = non traitée
-- O = Validé
-- A = Mis en Attente
-- T = Transmis à l'ERP
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
               WHERE TABLE_NAME = 'ABTEMPS_OPERATEURS' 
               AND COLUMN_NAME = 'StatutTraitement')
BEGIN
    ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
    ADD StatutTraitement VARCHAR(1) NULL;

    PRINT '✅ Colonne StatutTraitement ajoutée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Colonne StatutTraitement existe déjà';
END
GO

-- 6.b Ajouter la contrainte CHECK (dans un batch séparé, après création de la colonne)
IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME = 'ABTEMPS_OPERATEURS'
           AND COLUMN_NAME = 'StatutTraitement')
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM sys.check_constraints
        WHERE name = 'CK_ABTEMPS_OPERATEURS_StatutTraitement'
          AND parent_object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]')
    )
    BEGIN
        ALTER TABLE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]
        ADD CONSTRAINT [CK_ABTEMPS_OPERATEURS_StatutTraitement]
        CHECK (StatutTraitement IS NULL OR StatutTraitement IN ('O', 'A', 'T'));

        PRINT '✅ Contrainte CHECK CK_ABTEMPS_OPERATEURS_StatutTraitement ajoutée';
    END
    ELSE
    BEGIN
        PRINT 'ℹ️ Contrainte CHECK CK_ABTEMPS_OPERATEURS_StatutTraitement existe déjà';
    END
END
GO

-- 7. Créer index pour améliorer les requêtes de filtrage par StatutTraitement
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]') 
               AND name = 'IX_Temps_StatutTraitement')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Temps_StatutTraitement] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] 
    ([StatutTraitement] ASC, [DateCreation] DESC)
    INCLUDE ([OperatorCode], [LancementCode], [Phase], [CodeRubrique])
    WHERE StatutTraitement IS NOT NULL;
    
    PRINT '✅ Index IX_Temps_StatutTraitement créé';
END
GO

-- 8. Créer index pour améliorer les requêtes incluant Phase et CodeRubrique
IF NOT EXISTS (SELECT * FROM sys.indexes 
               WHERE object_id = OBJECT_ID('[SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS]') 
               AND name = 'IX_Temps_Phase_CodeRubrique')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_Temps_Phase_CodeRubrique] 
    ON [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] 
    ([Phase] ASC, [CodeRubrique] ASC)
    INCLUDE ([OperatorCode], [LancementCode], [StatutTraitement])
    WHERE Phase IS NOT NULL AND CodeRubrique IS NOT NULL;
    
    PRINT '✅ Index IX_Temps_Phase_CodeRubrique créé';
END
GO

PRINT '=== Migration ABTEMPS_OPERATEURS terminée ===';
PRINT 'Fin: ' + CONVERT(VARCHAR, GETDATE(), 120);
GO


