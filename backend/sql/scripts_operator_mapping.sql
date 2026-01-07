-- Scripts utilitaires pour gérer StatutOperateur et DateConsultation
-- Base: SEDI_APP_INDEPENDANTE

USE [SEDI_APP_INDEPENDANTE];
GO

-- ============================================
-- 1. Insérer ou mettre à jour le statut d'un opérateur
-- ============================================
-- Exemple d'utilisation:
-- EXEC sp_UpdateOperatorStatus @CodeOperateur = '929', @StatutOperateur = 'ACTIF'

IF OBJECT_ID('sp_UpdateOperatorStatus', 'P') IS NOT NULL
    DROP PROCEDURE sp_UpdateOperatorStatus;
GO

CREATE PROCEDURE sp_UpdateOperatorStatus
    @CodeOperateur NVARCHAR(50),
    @StatutOperateur NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    
    IF EXISTS (SELECT 1 FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING] WHERE CodeOperateur = @CodeOperateur)
    BEGIN
        UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING]
        SET StatutOperateur = @StatutOperateur,
            DateModification = GETDATE()
        WHERE CodeOperateur = @CodeOperateur;
        
        PRINT '✅ Statut opérateur ' + @CodeOperateur + ' mis à jour: ' + @StatutOperateur;
    END
    ELSE
    BEGIN
        INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING]
        (CodeOperateur, StatutOperateur, DateCreation, DateModification)
        VALUES (@CodeOperateur, @StatutOperateur, GETDATE(), GETDATE());
        
        PRINT '✅ Statut opérateur ' + @CodeOperateur + ' créé: ' + @StatutOperateur;
    END
END
GO

-- ============================================
-- 2. Mettre à jour la date de consultation d'un opérateur
-- ============================================
-- Exemple d'utilisation:
-- EXEC sp_UpdateOperatorConsultationDate @CodeOperateur = '929'

IF OBJECT_ID('sp_UpdateOperatorConsultationDate', 'P') IS NOT NULL
    DROP PROCEDURE sp_UpdateOperatorConsultationDate;
GO

CREATE PROCEDURE sp_UpdateOperatorConsultationDate
    @CodeOperateur NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    
    IF EXISTS (SELECT 1 FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING] WHERE CodeOperateur = @CodeOperateur)
    BEGIN
        UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING]
        SET DateConsultation = GETDATE(),
            DateModification = GETDATE()
        WHERE CodeOperateur = @CodeOperateur;
        
        PRINT '✅ Date de consultation opérateur ' + @CodeOperateur + ' mise à jour';
    END
    ELSE
    BEGIN
        INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING]
        (CodeOperateur, DateConsultation, DateCreation, DateModification)
        VALUES (@CodeOperateur, GETDATE(), GETDATE(), GETDATE());
        
        PRINT '✅ Date de consultation opérateur ' + @CodeOperateur + ' créée';
    END
END
GO

-- ============================================
-- 3. Mettre à jour automatiquement DateConsultation lors de la consultation
-- ============================================
-- Cette procédure peut être appelée depuis l'application web
-- Exemple: EXEC sp_RecordOperatorConsultation @CodeOperateur = '929'

IF OBJECT_ID('sp_RecordOperatorConsultation', 'P') IS NOT NULL
    DROP PROCEDURE sp_RecordOperatorConsultation;
GO

CREATE PROCEDURE sp_RecordOperatorConsultation
    @CodeOperateur NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Mettre à jour ou créer l'enregistrement avec la date de consultation actuelle
    IF EXISTS (SELECT 1 FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING] WHERE CodeOperateur = @CodeOperateur)
    BEGIN
        UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING]
        SET DateConsultation = GETDATE(),
            DateModification = GETDATE()
        WHERE CodeOperateur = @CodeOperateur;
    END
    ELSE
    BEGIN
        INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[AB_OPERATEURS_MAPPING]
        (CodeOperateur, DateConsultation, DateCreation, DateModification)
        VALUES (@CodeOperateur, GETDATE(), GETDATE(), GETDATE());
    END
END
GO

-- ============================================
-- 4. Voir tous les opérateurs avec leur mapping
-- ============================================
-- SELECT * FROM [SEDI_APP_INDEPENDANTE].[dbo].[V_RESSOURC] ORDER BY CodeOperateur;

PRINT '✅ Procédures stockées créées pour la gestion du mapping opérateurs';
GO

