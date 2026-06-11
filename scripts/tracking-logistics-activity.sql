-- Logistics Activity board: trip stages, loading/offloading slips
-- Run: node scripts/run-tracking-logistics-activity-schema.js

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fleet_trip') AND name = N'activity_stage')
  ALTER TABLE fleet_trip ADD activity_stage NVARCHAR(40) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fleet_trip') AND name = N'scheduled_at')
  ALTER TABLE fleet_trip ADD scheduled_at DATETIME2 NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fleet_trip') AND name = N'at_loading_at')
  ALTER TABLE fleet_trip ADD at_loading_at DATETIME2 NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fleet_trip') AND name = N'at_destination_at')
  ALTER TABLE fleet_trip ADD at_destination_at DATETIME2 NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fleet_trip') AND name = N'loading_slip_no')
  ALTER TABLE fleet_trip ADD loading_slip_no NVARCHAR(120) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fleet_trip') AND name = N'loading_slip_deferred')
  ALTER TABLE fleet_trip ADD loading_slip_deferred BIT NOT NULL CONSTRAINT DF_ft_loading_deferred DEFAULT 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fleet_trip') AND name = N'offloading_slip_no')
  ALTER TABLE fleet_trip ADD offloading_slip_no NVARCHAR(120) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'activity_phase')
  ALTER TABLE tracking_delivery_record ADD activity_phase NVARCHAR(20) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'loading_slip_no')
  ALTER TABLE tracking_delivery_record ADD loading_slip_no NVARCHAR(120) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'offloading_slip_no')
  ALTER TABLE tracking_delivery_record ADD offloading_slip_no NVARCHAR(120) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'loading_slip_deferred')
  ALTER TABLE tracking_delivery_record ADD loading_slip_deferred BIT NOT NULL CONSTRAINT DF_tdr_loading_deferred DEFAULT 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fleet_trip_activity' AND object_id = OBJECT_ID('fleet_trip'))
  CREATE INDEX IX_fleet_trip_activity ON fleet_trip(tenant_id, activity_stage, updated_at DESC)
  WHERE activity_stage IS NOT NULL;
GO
