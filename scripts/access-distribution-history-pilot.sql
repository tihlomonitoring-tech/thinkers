-- Tag list-distribution emails from Access Management pilot schedules.
-- Run: node scripts/run-access-distribution-history-pilot.js

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_distribution_history') AND name = 'is_pilot_distribution')
  ALTER TABLE access_distribution_history ADD is_pilot_distribution BIT NOT NULL CONSTRAINT DF_adh_pilot DEFAULT 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_distribution_history') AND name = 'pilot_schedule_id')
  ALTER TABLE access_distribution_history ADD pilot_schedule_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_distribution_history') AND name = 'pilot_schedule_name')
  ALTER TABLE access_distribution_history ADD pilot_schedule_name NVARCHAR(200) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_access_distribution_history_pilot' AND object_id = OBJECT_ID('access_distribution_history'))
  CREATE INDEX IX_access_distribution_history_pilot ON access_distribution_history(tenant_id, is_pilot_distribution, created_at DESC);
GO
