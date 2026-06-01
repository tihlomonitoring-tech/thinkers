-- Internal vehicle fuel expenditure (Excel import, linked to contractor trucks).
-- Run: npm run db:fuel-internal-expenditure

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_internal_expenditure_imports')
CREATE TABLE fuel_internal_expenditure_imports (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  file_name NVARCHAR(500) NULL,
  row_count INT NOT NULL DEFAULT 0,
  matched_count INT NOT NULL DEFAULT 0,
  imported_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fuel_internal_exp_imports_tenant' AND object_id = OBJECT_ID('fuel_internal_expenditure_imports'))
  CREATE INDEX IX_fuel_internal_exp_imports_tenant ON fuel_internal_expenditure_imports(tenant_id, created_at DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_internal_expenditure')
CREATE TABLE fuel_internal_expenditure (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  import_id UNIQUEIDENTIFIER NULL REFERENCES fuel_internal_expenditure_imports(id) ON DELETE SET NULL,
  transaction_date DATE NULL,
  vehicle_registration NVARCHAR(120) NOT NULL,
  contractor_truck_id UNIQUEIDENTIFIER NULL,
  contractor_id UNIQUEIDENTIFIER NULL,
  contractor_name NVARCHAR(255) NULL,
  fleet_no NVARCHAR(80) NULL,
  make_model NVARCHAR(255) NULL,
  liters DECIMAL(18, 4) NULL,
  amount DECIMAL(18, 2) NULL,
  price_per_litre DECIMAL(18, 4) NULL,
  fuel_station NVARCHAR(255) NULL,
  driver_name NVARCHAR(255) NULL,
  odometer_km DECIMAL(18, 2) NULL,
  product_type NVARCHAR(80) NULL,
  reference_no NVARCHAR(120) NULL,
  notes NVARCHAR(MAX) NULL,
  match_status NVARCHAR(32) NOT NULL DEFAULT N'unmatched',
  source_row_index INT NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  updated_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fuel_internal_exp_tenant_date' AND object_id = OBJECT_ID('fuel_internal_expenditure'))
  CREATE INDEX IX_fuel_internal_exp_tenant_date ON fuel_internal_expenditure(tenant_id, transaction_date DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fuel_internal_exp_truck' AND object_id = OBJECT_ID('fuel_internal_expenditure'))
  CREATE INDEX IX_fuel_internal_exp_truck ON fuel_internal_expenditure(tenant_id, contractor_truck_id);
GO
