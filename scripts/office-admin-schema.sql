-- Office Admin: assets, consumables, maintenance, requests, tab grants
-- Run: npm run db:office-admin

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'office_admin_grants')
CREATE TABLE office_admin_grants (
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tab_id NVARCHAR(80) NOT NULL,
  granted_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  granted_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (user_id, tab_id)
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'office_admin_assets')
CREATE TABLE office_admin_assets (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_code NVARCHAR(64) NOT NULL,
  name NVARCHAR(300) NOT NULL,
  category NVARCHAR(100) NULL,
  location NVARCHAR(255) NULL,
  serial_number NVARCHAR(128) NULL,
  purchase_date DATE NULL,
  purchase_value DECIMAL(18, 2) NULL,
  status NVARCHAR(50) NOT NULL DEFAULT N'active',
  accounting_item_id UNIQUEIDENTIFIER NULL,
  accounting_supplier_id UNIQUEIDENTIFIER NULL,
  notes NVARCHAR(MAX) NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_office_admin_assets_tenant' AND object_id = OBJECT_ID('office_admin_assets'))
CREATE INDEX IX_office_admin_assets_tenant ON office_admin_assets (tenant_id, asset_code);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'office_admin_consumables')
CREATE TABLE office_admin_consumables (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name NVARCHAR(300) NOT NULL,
  category NVARCHAR(80) NOT NULL DEFAULT N'other',
  unit NVARCHAR(40) NOT NULL DEFAULT N'unit',
  quantity_on_hand DECIMAL(18, 3) NOT NULL DEFAULT 0,
  reorder_level DECIMAL(18, 3) NOT NULL DEFAULT 0,
  unit_cost DECIMAL(18, 2) NULL,
  accounting_item_id UNIQUEIDENTIFIER NULL,
  notes NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'office_admin_maintenance_reports')
CREATE TABLE office_admin_maintenance_reports (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id UNIQUEIDENTIFIER NULL,
  asset_name_snapshot NVARCHAR(300) NULL,
  reported_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  title NVARCHAR(500) NOT NULL,
  description NVARCHAR(MAX) NULL,
  priority NVARCHAR(30) NOT NULL DEFAULT N'medium',
  status NVARCHAR(50) NOT NULL DEFAULT N'open',
  manager_notes NVARCHAR(MAX) NULL,
  resolved_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'office_admin_maintenance_records')
CREATE TABLE office_admin_maintenance_records (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id UNIQUEIDENTIFIER NOT NULL,
  report_id UNIQUEIDENTIFIER NULL,
  maintenance_type NVARCHAR(80) NOT NULL DEFAULT N'repair',
  description NVARCHAR(MAX) NOT NULL,
  cost DECIMAL(18, 2) NULL,
  performed_by NVARCHAR(255) NULL,
  performed_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  next_due_at DATE NULL,
  accounting_reference NVARCHAR(255) NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'office_admin_requests')
CREATE TABLE office_admin_requests (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_type NVARCHAR(80) NOT NULL DEFAULT N'general',
  title NVARCHAR(500) NOT NULL,
  description NVARCHAR(MAX) NULL,
  priority NVARCHAR(30) NOT NULL DEFAULT N'medium',
  status NVARCHAR(50) NOT NULL DEFAULT N'pending',
  requested_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  assigned_to_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  due_date DATE NULL,
  manager_response NVARCHAR(MAX) NULL,
  fulfilled_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'office_admin_request_messages')
CREATE TABLE office_admin_request_messages (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  request_id UNIQUEIDENTIFIER NOT NULL REFERENCES office_admin_requests(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  message NVARCHAR(MAX) NOT NULL,
  message_type NVARCHAR(40) NOT NULL DEFAULT N'comment',
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
