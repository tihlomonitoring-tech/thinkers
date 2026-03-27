-- Tracking & integration: providers, weighbridges, trips, settings, deliveries, alarms
-- Run: node scripts/run-tracking-integration-schema.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tracking_integration_provider')
CREATE TABLE tracking_integration_provider (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  display_name NVARCHAR(200) NOT NULL,
  provider_type NVARCHAR(80) NOT NULL,
  api_base_url NVARCHAR(500) NULL,
  api_key NVARCHAR(MAX) NULL,
  api_secret NVARCHAR(MAX) NULL,
  username NVARCHAR(200) NULL,
  extra_json NVARCHAR(MAX) NULL,
  is_active BIT NOT NULL CONSTRAINT DF_tip_active DEFAULT 1,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_tip_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_tip_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_tip_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tip_tenant' AND object_id = OBJECT_ID('tracking_integration_provider'))
  CREATE INDEX IX_tip_tenant ON tracking_integration_provider(tenant_id, is_active);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tracking_vehicle_link')
CREATE TABLE tracking_vehicle_link (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  provider_id UNIQUEIDENTIFIER NOT NULL,
  truck_registration NVARCHAR(80) NOT NULL,
  external_vehicle_id NVARCHAR(200) NULL,
  fleet_no NVARCHAR(80) NULL,
  contractor_truck_id UNIQUEIDENTIFIER NULL,
  notes NVARCHAR(500) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_tvl_created DEFAULT SYSUTCDATETIME(),
  -- NO ACTION on tenant avoids SQL Server "multiple cascade paths" (tenant also cascades to provider -> this table)
  CONSTRAINT FK_tvl_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE NO ACTION,
  CONSTRAINT FK_tvl_provider FOREIGN KEY (provider_id) REFERENCES tracking_integration_provider(id) ON DELETE CASCADE
);
-- FK to contractor_trucks added by tracking-expand-contractor-truck.sql (after contractor tables exist)
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tvl_tenant_reg' AND object_id = OBJECT_ID('tracking_vehicle_link'))
  CREATE INDEX IX_tvl_tenant_reg ON tracking_vehicle_link(tenant_id, truck_registration);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tracking_weighbridge')
CREATE TABLE tracking_weighbridge (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  colliery_name NVARCHAR(200) NOT NULL,
  site_code NVARCHAR(80) NULL,
  api_endpoint NVARCHAR(500) NOT NULL,
  api_key NVARCHAR(MAX) NULL,
  auth_type NVARCHAR(40) NOT NULL CONSTRAINT DF_tw_auth DEFAULT N'api_key',
  extra_json NVARCHAR(MAX) NULL,
  is_active BIT NOT NULL CONSTRAINT DF_tw_active DEFAULT 1,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_tw_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_tw_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_tw_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tw_tenant' AND object_id = OBJECT_ID('tracking_weighbridge'))
  CREATE INDEX IX_tw_tenant ON tracking_weighbridge(tenant_id, is_active);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tracking_monitor_route')
CREATE TABLE tracking_monitor_route (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  name NVARCHAR(200) NOT NULL,
  collection_point_name NVARCHAR(200) NULL,
  destination_name NVARCHAR(200) NULL,
  origin_lat DECIMAL(10,7) NULL,
  origin_lng DECIMAL(10,7) NULL,
  dest_lat DECIMAL(10,7) NULL,
  dest_lng DECIMAL(10,7) NULL,
  waypoints_json NVARCHAR(MAX) NULL,
  is_active BIT NOT NULL CONSTRAINT DF_tmr_active DEFAULT 1,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_tmr_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_tmr_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tracking_geofence')
CREATE TABLE tracking_geofence (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  name NVARCHAR(200) NOT NULL,
  fence_type NVARCHAR(40) NOT NULL,
  center_lat DECIMAL(10,7) NULL,
  center_lng DECIMAL(10,7) NULL,
  radius_m INT NULL,
  polygon_json NVARCHAR(MAX) NULL,
  alert_on_exit BIT NOT NULL CONSTRAINT DF_tgf_exit DEFAULT 1,
  alert_on_entry BIT NOT NULL CONSTRAINT DF_tgf_entry DEFAULT 0,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_tgf_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_tgf_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tracking_tenant_settings')
CREATE TABLE tracking_tenant_settings (
  tenant_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  max_enroute_minutes INT NOT NULL CONSTRAINT DF_tts_enroute DEFAULT 240,
  alarm_overspeed_kmh INT NOT NULL CONSTRAINT DF_tts_os DEFAULT 90,
  alarm_harsh_braking BIT NOT NULL CONSTRAINT DF_tts_hb DEFAULT 1,
  alarm_harsh_accel BIT NOT NULL CONSTRAINT DF_tts_ha DEFAULT 1,
  alarm_seatbelt BIT NOT NULL CONSTRAINT DF_tts_sb DEFAULT 1,
  alarm_idle_minutes INT NOT NULL CONSTRAINT DF_tts_idle DEFAULT 30,
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_tts_upd DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_tts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'fleet_trip')
CREATE TABLE fleet_trip (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  trip_ref NVARCHAR(64) NOT NULL,
  truck_registration NVARCHAR(80) NOT NULL,
  contractor_truck_id UNIQUEIDENTIFIER NULL,
  weighbridge_id UNIQUEIDENTIFIER NULL,
  route_id UNIQUEIDENTIFIER NULL,
  collection_point_name NVARCHAR(200) NULL,
  destination_name NVARCHAR(200) NULL,
  status NVARCHAR(40) NOT NULL,
  declared_destination_at DATETIME2 NULL,
  started_at DATETIME2 NULL,
  completed_at DATETIME2 NULL,
  eta_due_at DATETIME2 NULL,
  deviation_count INT NOT NULL CONSTRAINT DF_ft_dev DEFAULT 0,
  is_overdue BIT NOT NULL CONSTRAINT DF_ft_over DEFAULT 0,
  trip_leg_index INT NOT NULL CONSTRAINT DF_ft_leg DEFAULT 1,
  last_lat DECIMAL(10,7) NULL,
  last_lng DECIMAL(10,7) NULL,
  last_speed_kmh DECIMAL(8,2) NULL,
  last_heading_deg DECIMAL(6,2) NULL,
  last_seen_at DATETIME2 NULL,
  gross_weight_kg DECIMAL(14,2) NULL,
  notes NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_ft_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_ft_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_ft_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT CK_ft_status CHECK (status IN (N'pending', N'enroute', N'deviated', N'completed', N'cancelled', N'overdue'))
);
GO

-- No FK to tracking_weighbridge / tracking_monitor_route: SQL Server rejects them with FK_ft_tenant CASCADE
-- (multiple cascade paths from tenants). Enforce IDs in application; optional indexes below.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fleet_trip_weighbridge' AND object_id = OBJECT_ID('fleet_trip'))
  CREATE INDEX IX_fleet_trip_weighbridge ON fleet_trip(weighbridge_id) WHERE weighbridge_id IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fleet_trip_route' AND object_id = OBJECT_ID('fleet_trip'))
  CREATE INDEX IX_fleet_trip_route ON fleet_trip(route_id) WHERE route_id IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fleet_trip_tenant_status' AND object_id = OBJECT_ID('fleet_trip'))
  CREATE INDEX IX_fleet_trip_tenant_status ON fleet_trip(tenant_id, status, updated_at);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'fleet_trip_deviation')
CREATE TABLE fleet_trip_deviation (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  trip_id UNIQUEIDENTIFIER NOT NULL,
  occurred_at DATETIME2 NOT NULL,
  deviation_type NVARCHAR(80) NOT NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  detail NVARCHAR(MAX) NULL,
  -- NO ACTION on tenant: avoids multiple cascade paths (tenant -> fleet_trip -> this table)
  CONSTRAINT FK_ftd_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE NO ACTION,
  CONSTRAINT FK_ftd_trip FOREIGN KEY (trip_id) REFERENCES fleet_trip(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tracking_delivery_record')
CREATE TABLE tracking_delivery_record (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  trip_id UNIQUEIDENTIFIER NULL,
  truck_registration NVARCHAR(80) NOT NULL,
  delivered_at DATETIME2 NOT NULL,
  net_weight_kg DECIMAL(14,2) NULL,
  destination_name NVARCHAR(200) NULL,
  status NVARCHAR(40) NOT NULL CONSTRAINT DF_tdr_stat DEFAULT N'completed',
  notes NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_tdr_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_tdr_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT FK_tdr_trip FOREIGN KEY (trip_id) REFERENCES fleet_trip(id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tdr_tenant_delivered' AND object_id = OBJECT_ID('tracking_delivery_record'))
  CREATE INDEX IX_tdr_tenant_delivered ON tracking_delivery_record(tenant_id, delivered_at DESC);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tracking_alarm_record')
CREATE TABLE tracking_alarm_record (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  trip_id UNIQUEIDENTIFIER NULL,
  truck_registration NVARCHAR(80) NOT NULL,
  alarm_type NVARCHAR(80) NOT NULL,
  severity NVARCHAR(20) NOT NULL CONSTRAINT DF_tar_sev DEFAULT N'warning',
  occurred_at DATETIME2 NOT NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  speed_kmh DECIMAL(8,2) NULL,
  detail NVARCHAR(MAX) NULL,
  acknowledged BIT NOT NULL CONSTRAINT DF_tar_ack DEFAULT 0,
  acknowledged_at DATETIME2 NULL,
  acknowledged_by NVARCHAR(200) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_tar_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_tar_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT FK_tar_trip FOREIGN KEY (trip_id) REFERENCES fleet_trip(id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tar_tenant_time' AND object_id = OBJECT_ID('tracking_alarm_record'))
  CREATE INDEX IX_tar_tenant_time ON tracking_alarm_record(tenant_id, occurred_at DESC);
GO
