-- Logistics finance: load transaction imports (revenue) linked to fuel & accounting expenses.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'logistics_finance_imports')
CREATE TABLE logistics_finance_imports (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  file_name NVARCHAR(500) NULL,
  row_count INT NOT NULL DEFAULT 0,
  imported_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'logistics_finance_load_transactions')
CREATE TABLE logistics_finance_load_transactions (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  import_id UNIQUEIDENTIFIER NULL,
  transaction_date DATE NOT NULL,
  vehicle_id NVARCHAR(50) NULL,
  vehicle_desc NVARCHAR(500) NULL,
  vehicle_registration NVARCHAR(100) NULL,
  haulier NVARCHAR(255) NULL,
  completed INT NULL,
  cancelled INT NULL,
  avg_hours DECIMAL(12, 4) NULL,
  tons DECIMAL(14, 4) NULL,
  turnover DECIMAL(16, 2) NULL,
  target_turnover DECIMAL(16, 2) NULL,
  variance DECIMAL(16, 2) NULL,
  turnover_points DECIMAL(14, 4) NULL,
  target_points DECIMAL(14, 4) NULL,
  variance_points DECIMAL(14, 4) NULL,
  comment NVARCHAR(MAX) NULL,
  contractor_truck_id UNIQUEIDENTIFIER NULL,
  contractor_id UNIQUEIDENTIFIER NULL,
  is_manual BIT NOT NULL DEFAULT 0,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  updated_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_lf_load_tx_tenant_date' AND object_id = OBJECT_ID(N'logistics_finance_load_transactions'))
CREATE INDEX IX_lf_load_tx_tenant_date ON logistics_finance_load_transactions (tenant_id, transaction_date);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_lf_load_tx_tenant_reg' AND object_id = OBJECT_ID(N'logistics_finance_load_transactions'))
CREATE INDEX IX_lf_load_tx_tenant_reg ON logistics_finance_load_transactions (tenant_id, vehicle_registration);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_lf_load_tx_tenant_haulier' AND object_id = OBJECT_ID(N'logistics_finance_load_transactions'))
CREATE INDEX IX_lf_load_tx_tenant_haulier ON logistics_finance_load_transactions (tenant_id, haulier);
GO
