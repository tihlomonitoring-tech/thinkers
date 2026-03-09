-- Transport Operations: standalone trucks, drivers, routes (with rates/targets), shift reports.
-- Run: node scripts/run-transport-operations-schema.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'to_trucks')
CREATE TABLE to_trucks (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  registration NVARCHAR(100) NULL,
  make_model NVARCHAR(255) NULL,
  fleet_no NVARCHAR(100) NULL,
  trailer_1_reg_no NVARCHAR(100) NULL,
  trailer_2_reg_no NVARCHAR(100) NULL,
  commodity_type NVARCHAR(100) NULL,
  capacity_tonnes DECIMAL(10,2) NULL,
  year_model NVARCHAR(20) NULL,
  notes NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_to_trucks_tenant' AND object_id = OBJECT_ID('to_trucks'))
  CREATE INDEX IX_to_trucks_tenant ON to_trucks(tenant_id);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'to_drivers')
CREATE TABLE to_drivers (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  full_name NVARCHAR(255) NULL,
  license_number NVARCHAR(100) NULL,
  license_expiry DATE NULL,
  phone NVARCHAR(50) NULL,
  email NVARCHAR(255) NULL,
  id_number NVARCHAR(50) NULL,
  notes NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_to_drivers_tenant' AND object_id = OBJECT_ID('to_drivers'))
  CREATE INDEX IX_to_drivers_tenant ON to_drivers(tenant_id);
GO

-- Routes with collection point, destination, rate, delivery target, amount target (accounting)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'to_routes')
CREATE TABLE to_routes (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  name NVARCHAR(255) NULL,
  collection_point NVARCHAR(255) NULL,
  destination NVARCHAR(255) NULL,
  rate DECIMAL(14,2) NULL,
  delivery_target INT NULL,
  amount_target DECIMAL(14,2) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_to_routes_tenant' AND object_id = OBJECT_ID('to_routes'))
  CREATE INDEX IX_to_routes_tenant ON to_routes(tenant_id);
GO

-- Shift reports (payload as JSON for flexibility)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'to_shift_reports')
CREATE TABLE to_shift_reports (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  controller_name NVARCHAR(255) NULL,
  shift NVARCHAR(50) NULL,
  report_date DATE NULL,
  available_route_ids NVARCHAR(MAX) NULL,
  active_fleet_log NVARCHAR(MAX) NULL,
  non_participating NVARCHAR(MAX) NULL,
  notes_for_next_controller NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_to_shift_reports_tenant' AND object_id = OBJECT_ID('to_shift_reports'))
  CREATE INDEX IX_to_shift_reports_tenant ON to_shift_reports(tenant_id);
GO
