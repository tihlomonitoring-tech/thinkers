-- Tenant shift windows + fixed-schedule support. Run: npm run db:work-schedule-shift-settings

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tenant_shift_settings')
CREATE TABLE tenant_shift_settings (
  tenant_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  day_start NVARCHAR(8) NOT NULL DEFAULT N'06:00',
  day_end NVARCHAR(8) NOT NULL DEFAULT N'17:00',
  night_start NVARCHAR(8) NOT NULL DEFAULT N'17:00',
  night_end NVARCHAR(8) NOT NULL DEFAULT N'06:00',
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_by UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('work_schedules') AND name = 'schedule_kind')
  ALTER TABLE work_schedules ADD schedule_kind NVARCHAR(20) NOT NULL DEFAULT N'rotating';
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('work_schedule_entries') AND name = 'start_time')
  ALTER TABLE work_schedule_entries ADD start_time NVARCHAR(8) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('work_schedule_entries') AND name = 'end_time')
  ALTER TABLE work_schedule_entries ADD end_time NVARCHAR(8) NULL;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_shift_type' AND parent_object_id = OBJECT_ID('work_schedule_entries'))
  ALTER TABLE work_schedule_entries DROP CONSTRAINT CK_shift_type;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_shift_type' AND parent_object_id = OBJECT_ID('work_schedule_entries'))
  ALTER TABLE work_schedule_entries ADD CONSTRAINT CK_shift_type CHECK (shift_type IN (N'day', N'night', N'fixed'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_work_schedules_kind' AND parent_object_id = OBJECT_ID('work_schedules'))
  ALTER TABLE work_schedules ADD CONSTRAINT CK_work_schedules_kind CHECK (schedule_kind IN (N'rotating', N'fixed'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_work_schedules_kind' AND object_id = OBJECT_ID('work_schedules'))
  CREATE INDEX IX_work_schedules_kind ON work_schedules(tenant_id, schedule_kind);
GO
