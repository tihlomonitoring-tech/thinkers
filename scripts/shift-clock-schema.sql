-- Shift clock-in, breaks, overtime. Run: npm run db:shift-clock
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'shift_clock_sessions')
CREATE TABLE shift_clock_sessions (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  schedule_entry_id UNIQUEIDENTIFIER NOT NULL REFERENCES work_schedule_entries(id) ON DELETE NO ACTION,
  work_date DATE NOT NULL,
  shift_type NVARCHAR(20) NOT NULL,
  clock_in_at DATETIME2 NOT NULL,
  clock_out_at DATETIME2 NULL,
  overtime_minutes INT NOT NULL DEFAULT 0,
  status NVARCHAR(20) NOT NULL DEFAULT N'active',
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_shift_clock_ot CHECK (overtime_minutes >= 0 AND overtime_minutes <= 360),
  CONSTRAINT CK_shift_clock_status CHECK (status IN (N'active', N'completed', N'cancelled'))
);
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'shift_clock_sessions')
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_shift_clock_sessions_user_date' AND object_id = OBJECT_ID('shift_clock_sessions'))
    CREATE INDEX IX_shift_clock_sessions_user_date ON shift_clock_sessions(tenant_id, user_id, work_date);
GO
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'shift_clock_sessions')
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_shift_clock_sessions_entry' AND object_id = OBJECT_ID('shift_clock_sessions'))
    CREATE UNIQUE INDEX IX_shift_clock_sessions_entry ON shift_clock_sessions(schedule_entry_id, work_date);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'shift_clock_breaks')
CREATE TABLE shift_clock_breaks (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  session_id UNIQUEIDENTIFIER NOT NULL REFERENCES shift_clock_sessions(id) ON DELETE CASCADE,
  break_type NVARCHAR(20) NOT NULL,
  expected_minutes INT NOT NULL,
  started_at DATETIME2 NOT NULL,
  ended_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_shift_clock_break_type CHECK (break_type IN (N'minor_30', N'major_60'))
);
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'shift_clock_breaks')
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_shift_clock_breaks_session' AND object_id = OBJECT_ID('shift_clock_breaks'))
    CREATE INDEX IX_shift_clock_breaks_session ON shift_clock_breaks(session_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'shift_clock_alert_sent')
CREATE TABLE shift_clock_alert_sent (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  session_id UNIQUEIDENTIFIER NULL REFERENCES shift_clock_sessions(id) ON DELETE CASCADE,
  -- NO ACTION avoids SQL Server "multiple cascade paths" (session and break both chain to this table).
  break_id UNIQUEIDENTIFIER NULL REFERENCES shift_clock_breaks(id) ON DELETE NO ACTION,
  alert_type NVARCHAR(80) NOT NULL,
  sent_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_shift_clock_alert UNIQUE (session_id, alert_type)
);
GO
