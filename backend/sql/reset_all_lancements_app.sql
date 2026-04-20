-- ==========================================================================
-- RESET TOTAL DES LANCEMENTS CÔTÉ APP FSOP
--   Base cible  : SEDI_APP_INDEPENDANTE
--   Tables      : ABSESSIONS_OPERATEURS, ABHISTORIQUE_OPERATEURS, ABTEMPS_OPERATEURS
--   NON CONCERNÉ : SEDI_ERP (SILOG), GPSQL.abetemps_temp, dbo.LCTE — intouchés.
--
-- ⚠️  DESTRUCTIF — perte totale de l'historique applicatif FSOP.
--     Le script est en mode "DRY RUN" par défaut (ROLLBACK à la fin).
--     Pour exécuter réellement : changer ROLLBACK TRAN en COMMIT TRAN à la fin.
--
-- Recommandé : faire une sauvegarde SQL de SEDI_APP_INDEPENDANTE AVANT :
--     BACKUP DATABASE [SEDI_APP_INDEPENDANTE]
--       TO DISK = N'C:\Backups\SEDI_APP_INDEPENDANTE_reset_YYYYMMDD.bak'
--       WITH COMPRESSION, INIT;
-- ==========================================================================

USE [SEDI_APP_INDEPENDANTE];
GO

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

PRINT '================================================================';
PRINT '  DIAGNOSTIC AVANT RESET';
PRINT '================================================================';

SELECT 'ABSESSIONS_OPERATEURS'    AS TableName, COUNT(*) AS NbLignes FROM [dbo].[ABSESSIONS_OPERATEURS]
UNION ALL SELECT 'ABHISTORIQUE_OPERATEURS',      COUNT(*)          FROM [dbo].[ABHISTORIQUE_OPERATEURS]
UNION ALL SELECT 'ABTEMPS_OPERATEURS',           COUNT(*)          FROM [dbo].[ABTEMPS_OPERATEURS];
GO

PRINT '';
PRINT '================================================================';
PRINT '  RESET — ouverture transaction';
PRINT '================================================================';

BEGIN TRAN;

-- Ordre : sessions, historique, temps.
-- DELETE (pas TRUNCATE) pour compatibilité triggers / FK éventuels.

DELETE FROM [dbo].[ABSESSIONS_OPERATEURS];
PRINT 'ABSESSIONS_OPERATEURS    supprimées : ' + CAST(@@ROWCOUNT AS VARCHAR(20));

DELETE FROM [dbo].[ABHISTORIQUE_OPERATEURS];
PRINT 'ABHISTORIQUE_OPERATEURS  supprimées : ' + CAST(@@ROWCOUNT AS VARCHAR(20));

DELETE FROM [dbo].[ABTEMPS_OPERATEURS];
PRINT 'ABTEMPS_OPERATEURS       supprimées : ' + CAST(@@ROWCOUNT AS VARCHAR(20));

PRINT '';
PRINT '================================================================';
PRINT '  VÉRIFICATION APRÈS RESET (toujours dans la transaction)';
PRINT '================================================================';

SELECT 'ABSESSIONS_OPERATEURS'    AS TableName, COUNT(*) AS NbLignes FROM [dbo].[ABSESSIONS_OPERATEURS]
UNION ALL SELECT 'ABHISTORIQUE_OPERATEURS',      COUNT(*)          FROM [dbo].[ABHISTORIQUE_OPERATEURS]
UNION ALL SELECT 'ABTEMPS_OPERATEURS',           COUNT(*)          FROM [dbo].[ABTEMPS_OPERATEURS];

PRINT '';
PRINT '================================================================';
PRINT '  MODE DRY-RUN : ROLLBACK par défaut.';
PRINT '  Pour APPLIQUER : remplacer ROLLBACK TRAN par COMMIT TRAN ci-dessous.';
PRINT '================================================================';

ROLLBACK TRAN;   -- ⚠️ changer en COMMIT TRAN pour appliquer réellement

-- -------------------------------------------------------------------------
-- (Optionnel) Reset des identités IDENTITY après suppression :
-- -------------------------------------------------------------------------
-- DBCC CHECKIDENT ('[dbo].[ABSESSIONS_OPERATEURS]',    RESEED, 0);
-- DBCC CHECKIDENT ('[dbo].[ABHISTORIQUE_OPERATEURS]',  RESEED, 0);
-- DBCC CHECKIDENT ('[dbo].[ABTEMPS_OPERATEURS]',       RESEED, 0);
-- GO
