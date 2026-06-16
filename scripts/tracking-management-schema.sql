-- Tracking management: link geofences to Access Management routes, delivery notes, presence state
-- Run: node scripts/run-tracking-management-schema.js

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_geofence') AND name = N'contractor_route_id')
  ALTER TABLE tracking_geofence ADD contractor_route_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_geofence') AND name = N'leg')
  ALTER TABLE tracking_geofence ADD leg NVARCHAR(20) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_monitor_route') AND name = N'contractor_route_id')
  ALTER TABLE tracking_monitor_route ADD contractor_route_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'contractor_route_id')
  ALTER TABLE tracking_delivery_record ADD contractor_route_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'driver_name')
  ALTER TABLE tracking_delivery_record ADD driver_name NVARCHAR(200) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'tons_loaded')
  ALTER TABLE tracking_delivery_record ADD tons_loaded DECIMAL(12,3) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'delivery_note_no')
  ALTER TABLE tracking_delivery_record ADD delivery_note_no NVARCHAR(120) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'pending_note')
  ALTER TABLE tracking_delivery_record ADD pending_note BIT NOT NULL CONSTRAINT DF_tdr_pending_note DEFAULT 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'deleted_at')
  ALTER TABLE tracking_delivery_record ADD deleted_at DATETIME2 NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'deleted_by')
  ALTER TABLE tracking_delivery_record ADD deleted_by NVARCHAR(200) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tdr_tenant_deleted' AND object_id = OBJECT_ID('tracking_delivery_record'))
  CREATE INDEX IX_tdr_tenant_deleted ON tracking_delivery_record(tenant_id, deleted_at) WHERE deleted_at IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fleet_trip') AND name = N'contractor_route_id')
  ALTER TABLE fleet_trip ADD contractor_route_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fleet_trip') AND name = N'driver_name')
  ALTER TABLE fleet_trip ADD driver_name NVARCHAR(200) NULL;
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tracking_geofence_presence')
CREATE TABLE tracking_geofence_presence (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  geofence_id UNIQUEIDENTIFIER NOT NULL,
  truck_registration NVARCHAR(80) NOT NULL,
  contractor_truck_id UNIQUEIDENTIFIER NULL,
  is_inside BIT NOT NULL CONSTRAINT DF_tgp_inside DEFAULT 0,
  last_lat DECIMAL(10,7) NULL,
  last_lng DECIMAL(10,7) NULL,
  last_changed_at DATETIME2 NOT NULL CONSTRAINT DF_tgp_changed DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_tgp_upd DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_tgp_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tgp_tenant_geofence_reg' AND object_id = OBJECT_ID('tracking_geofence_presence'))
  CREATE UNIQUE INDEX IX_tgp_tenant_geofence_reg ON tracking_geofence_presence(tenant_id, geofence_id, truck_registration);
GO
