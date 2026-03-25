USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== Migration: tables Factorial IN/OUT clock events + poll state ===';
GO

-- Table AB_FACTORIAL_CLOCK_EVENTS: stockage des événements clock_in/clock_out
IF NOT EXISTS (
    SELECT 1
    FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[dbo].[AB_FACTORIAL_CLOCK_EVENTS]')
      AND type = N'U'
)
BEGIN
    CREATE TABLE [dbo].[AB_FACTORIAL_CLOCK_EVENTS](
        [Id] BIGINT IDENTITY(1,1) NOT NULL,
        [FactorialEmployeeId] NVARCHAR(100) NOT NULL,
        [ShiftId] NVARCHAR(100) NOT NULL,
        [EventType] NVARCHAR(3) NOT NULL, -- IN / OUT
        [EventAt] DATETIME2(7) NOT NULL,
        [RawPayload] NVARCHAR(MAX) NOT NULL,
        [CreatedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_AB_FACTORIAL_CLOCK_EVENTS_CreatedAt] DEFAULT (GETDATE()),
        CONSTRAINT [PK_AB_FACTORIAL_CLOCK_EVENTS] PRIMARY KEY CLUSTERED ([Id] ASC),
        CONSTRAINT [CK_AB_FACTORIAL_CLOCK_EVENTS_EventType] CHECK ([EventType] IN (N'IN', N'OUT'))
    );

    PRINT '✅ Table AB_FACTORIAL_CLOCK_EVENTS créée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Table AB_FACTORIAL_CLOCK_EVENTS existe déjà';
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'[dbo].[AB_FACTORIAL_CLOCK_EVENTS]')
      AND name = N'IX_AB_FACTORIAL_CLOCK_EVENTS_FactorialEmployeeId_EventType_EventAt'
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_AB_FACTORIAL_CLOCK_EVENTS_FactorialEmployeeId_EventType_EventAt]
    ON [dbo].[AB_FACTORIAL_CLOCK_EVENTS]([FactorialEmployeeId] ASC, [EventType] ASC, [EventAt] ASC);
    PRINT '✅ Index AB_FACTORIAL_CLOCK_EVENTS créé';
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'[dbo].[AB_FACTORIAL_CLOCK_EVENTS]')
      AND name = N'UQ_AB_FACTORIAL_CLOCK_EVENTS_EventKey'
)
BEGIN
    -- Unicité logique: FactorialEmployeeId + ShiftId + EventType
    CREATE UNIQUE NONCLUSTERED INDEX [UQ_AB_FACTORIAL_CLOCK_EVENTS_EventKey]
    ON [dbo].[AB_FACTORIAL_CLOCK_EVENTS]([FactorialEmployeeId] ASC, [ShiftId] ASC, [EventType] ASC);
    PRINT '✅ Unicité logique AB_FACTORIAL_CLOCK_EVENTS créée';
END
GO

-- Table AB_FACTORIAL_POLL_STATE: état de traitement par employee
IF NOT EXISTS (
    SELECT 1
    FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[dbo].[AB_FACTORIAL_POLL_STATE]')
      AND type = N'U'
)
BEGIN
    CREATE TABLE [dbo].[AB_FACTORIAL_POLL_STATE](
        [FactorialEmployeeId] NVARCHAR(100) NOT NULL,
        [LastProcessedClockInAt] DATETIME2(7) NULL,
        [LastProcessedClockOutAt] DATETIME2(7) NULL,
        [LastProcessedShiftId] NVARCHAR(100) NULL,
        [UpdatedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_AB_FACTORIAL_POLL_STATE_UpdatedAt] DEFAULT (GETDATE()),
        CONSTRAINT [PK_AB_FACTORIAL_POLL_STATE] PRIMARY KEY CLUSTERED ([FactorialEmployeeId] ASC)
    );

    PRINT '✅ Table AB_FACTORIAL_POLL_STATE créée';
END
ELSE
BEGIN
    PRINT 'ℹ️ Table AB_FACTORIAL_POLL_STATE existe déjà';
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'[dbo].[AB_FACTORIAL_POLL_STATE]')
      AND name = N'IX_AB_FACTORIAL_POLL_STATE_LastProcessedClockOutAt'
)
BEGIN
    CREATE NONCLUSTERED INDEX [IX_AB_FACTORIAL_POLL_STATE_LastProcessedClockOutAt]
    ON [dbo].[AB_FACTORIAL_POLL_STATE]([LastProcessedClockOutAt] ASC);
    PRINT '✅ Index AB_FACTORIAL_POLL_STATE créé';
END
GO

PRINT '=== Migration Factorial IN/OUT terminé ===';
GO

