-- Types de pause associés aux événements PAUSE (compteurs tablette)
USE [SEDI_APP_INDEPENDANTE];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AB_PAUSE_TYPE_LOG')
BEGIN
    CREATE TABLE [dbo].[AB_PAUSE_TYPE_LOG] (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        RequestId NVARCHAR(64) NULL,
        OperatorCode NVARCHAR(50) NOT NULL,
        LancementCode NVARCHAR(50) NOT NULL,
        PauseTypeCode NVARCHAR(32) NOT NULL,
        DateCreation DATE NOT NULL,
        HeureDebut TIME NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AB_PAUSE_TYPE_LOG_CreatedAt DEFAULT SYSUTCDATETIME()
    );

    CREATE INDEX IX_AB_PAUSE_TYPE_LOG_Operator_Date
        ON [dbo].[AB_PAUSE_TYPE_LOG] (OperatorCode, DateCreation);

    PRINT 'Table AB_PAUSE_TYPE_LOG créée';
END
ELSE
BEGIN
    PRINT 'Table AB_PAUSE_TYPE_LOG existe déjà';
END
GO
