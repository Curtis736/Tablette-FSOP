-- Corrections RH sur les temps / banque d'heures (localhost → prod plus tard)
USE [SEDI_APP_INDEPENDANTE];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AB_RH_CORRECTIONS')
BEGIN
    CREATE TABLE [dbo].[AB_RH_CORRECTIONS] (
        Id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        OperatorCode NVARCHAR(50) NOT NULL,
        WorkDate DATE NOT NULL,
        -- DAY_PRESENCE : ajuste le temps fait du jour ; BANK : ajuste directement la banque du mois
        Kind NVARCHAR(20) NOT NULL CONSTRAINT CK_AB_RH_CORRECTIONS_Kind CHECK (Kind IN ('DAY_PRESENCE', 'BANK')),
        DeltaMinutes INT NOT NULL,
        Comment NVARCHAR(500) NULL,
        Status NVARCHAR(20) NOT NULL CONSTRAINT DF_AB_RH_CORRECTIONS_Status DEFAULT ('VALIDATED')
            CONSTRAINT CK_AB_RH_CORRECTIONS_Status CHECK (Status IN ('PENDING', 'VALIDATED', 'REJECTED')),
        CreatedBy NVARCHAR(80) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AB_RH_CORRECTIONS_CreatedAt DEFAULT SYSUTCDATETIME(),
        ValidatedBy NVARCHAR(80) NULL,
        ValidatedAt DATETIME2 NULL
    );

    CREATE INDEX IX_AB_RH_CORRECTIONS_Operator_Date
        ON [dbo].[AB_RH_CORRECTIONS] (OperatorCode, WorkDate);

    CREATE INDEX IX_AB_RH_CORRECTIONS_Status
        ON [dbo].[AB_RH_CORRECTIONS] (Status);

    PRINT 'Table AB_RH_CORRECTIONS créée';
END
ELSE
BEGIN
    PRINT 'Table AB_RH_CORRECTIONS existe déjà';
END
GO
