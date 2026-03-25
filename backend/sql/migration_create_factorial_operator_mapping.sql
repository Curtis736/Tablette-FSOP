USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: table mapping opérateurs Factorial ===';
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[dbo].[AB_FACTORIAL_OPERATOR_MAPPING]')
      AND type = N'U'
)
BEGIN
    CREATE TABLE [dbo].[AB_FACTORIAL_OPERATOR_MAPPING](
        [OperatorCode] NVARCHAR(50) NOT NULL,
        [FactorialEmployeeId] NVARCHAR(100) NOT NULL,
        [FactorialFullName] NVARCHAR(255) NULL,
        [FactorialEmail] NVARCHAR(255) NULL,
        [IsActive] BIT NOT NULL CONSTRAINT [DF_AB_FACTORIAL_OPERATOR_MAPPING_IsActive] DEFAULT (1),
        [CreatedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_AB_FACTORIAL_OPERATOR_MAPPING_CreatedAt] DEFAULT (GETDATE()),
        [UpdatedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_AB_FACTORIAL_OPERATOR_MAPPING_UpdatedAt] DEFAULT (GETDATE()),
        CONSTRAINT [PK_AB_FACTORIAL_OPERATOR_MAPPING] PRIMARY KEY CLUSTERED ([OperatorCode] ASC)
    );

    PRINT '✅ Table AB_FACTORIAL_OPERATOR_MAPPING créée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Table AB_FACTORIAL_OPERATOR_MAPPING déjà existante';
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'[dbo].[AB_FACTORIAL_OPERATOR_MAPPING]')
      AND name = N'IX_AB_FACTORIAL_OPERATOR_MAPPING_FactorialEmployeeId'
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_AB_FACTORIAL_OPERATOR_MAPPING_FactorialEmployeeId]
    ON [dbo].[AB_FACTORIAL_OPERATOR_MAPPING]([FactorialEmployeeId] ASC);

    PRINT '✅ Index IX_AB_FACTORIAL_OPERATOR_MAPPING_FactorialEmployeeId créé';
END
GO

IF EXISTS (
    SELECT 1
    FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[dbo].[AB_FACTORIAL_OPERATOR_MAPPING]')
      AND type = N'U'
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM sys.check_constraints
        WHERE name = N'CK_AB_FACTORIAL_OPERATOR_MAPPING_OperatorCode_NotBlank'
    )
    BEGIN
        ALTER TABLE [dbo].[AB_FACTORIAL_OPERATOR_MAPPING]
        ADD CONSTRAINT [CK_AB_FACTORIAL_OPERATOR_MAPPING_OperatorCode_NotBlank]
            CHECK (LEN(LTRIM(RTRIM(ISNULL([OperatorCode], '')))) > 0);
    END

    IF NOT EXISTS (
        SELECT 1
        FROM sys.check_constraints
        WHERE name = N'CK_AB_FACTORIAL_OPERATOR_MAPPING_FactorialEmployeeId_NotBlank'
    )
    BEGIN
        ALTER TABLE [dbo].[AB_FACTORIAL_OPERATOR_MAPPING]
        ADD CONSTRAINT [CK_AB_FACTORIAL_OPERATOR_MAPPING_FactorialEmployeeId_NotBlank]
            CHECK (LEN(LTRIM(RTRIM(ISNULL([FactorialEmployeeId], '')))) > 0);
    END
END
GO

PRINT '=== Migration mapping Factorial terminée ===';
GO
