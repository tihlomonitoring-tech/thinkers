-- Truck inspection: SA-standard side tipper coal truck inspections
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'truck_inspections')
CREATE TABLE truck_inspections (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  truck_id UNIQUEIDENTIFIER NULL,
  fleet_registration NVARCHAR(100) NULL,
  trailer_registration NVARCHAR(100) NULL,
  odometer_reading DECIMAL(12,1) NULL,
  inspection_date DATE NOT NULL,
  inspection_type NVARCHAR(50) NOT NULL DEFAULT N'pre_trip',
  inspector_role NVARCHAR(50) NOT NULL DEFAULT N'driver',
  inspector_user_id UNIQUEIDENTIFIER NULL,
  inspector_name NVARCHAR(255) NOT NULL,
  inspector_company NVARCHAR(255) NULL,
  overall_result NVARCHAR(20) NOT NULL DEFAULT N'pending',
  total_items INT NOT NULL DEFAULT 0,
  passed_items INT NOT NULL DEFAULT 0,
  failed_items INT NOT NULL DEFAULT 0,
  na_items INT NOT NULL DEFAULT 0,
  failure_summary NVARCHAR(MAX) NULL,
  general_comments NVARCHAR(MAX) NULL,
  next_inspection_date DATE NULL,
  signed_off BIT NOT NULL DEFAULT 0,
  signed_off_at DATETIME2 NULL,
  reference_number NVARCHAR(20) NULL,
  created_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'truck_inspection_items')
CREATE TABLE truck_inspection_items (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  inspection_id UNIQUEIDENTIFIER NOT NULL REFERENCES truck_inspections(id) ON DELETE CASCADE,
  category NVARCHAR(100) NOT NULL,
  item_code NVARCHAR(20) NOT NULL,
  item_label NVARCHAR(255) NOT NULL,
  result NVARCHAR(20) NOT NULL DEFAULT N'not_checked',
  severity NVARCHAR(20) NULL,
  comment NVARCHAR(MAX) NULL,
  sort_order INT NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'truck_inspection_attachments')
CREATE TABLE truck_inspection_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  inspection_id UNIQUEIDENTIFIER NOT NULL REFERENCES truck_inspections(id) ON DELETE CASCADE,
  item_id UNIQUEIDENTIFIER NULL REFERENCES truck_inspection_items(id) ON DELETE NO ACTION,
  file_name NVARCHAR(255) NOT NULL,
  file_path NVARCHAR(500) NOT NULL,
  file_size INT NULL,
  mime_type NVARCHAR(100) NULL,
  uploaded_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ti_tenant_date' AND object_id = OBJECT_ID('truck_inspections'))
  CREATE INDEX IX_ti_tenant_date ON truck_inspections(tenant_id, inspection_date DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ti_truck' AND object_id = OBJECT_ID('truck_inspections'))
  CREATE INDEX IX_ti_truck ON truck_inspections(truck_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tii_insp' AND object_id = OBJECT_ID('truck_inspection_items'))
  CREATE INDEX IX_tii_insp ON truck_inspection_items(inspection_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tia_insp' AND object_id = OBJECT_ID('truck_inspection_attachments'))
  CREATE INDEX IX_tia_insp ON truck_inspection_attachments(inspection_id);
GO
