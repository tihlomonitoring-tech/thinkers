-- Internal vehicle fuel expenses (imported from fleet fuel Excel, linked to contractor trucks).
-- Run: npm run db:fuel-vehicle-expenses

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_vehicle_expense_imports')
CREATE TABLE fuel_vehicle_expense_imports (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  file_name NVARCHAR(500) NULL,
  row_count INT NOT NULL DEFAULT 0,
  matched_count INT NOT NULL DEFAULT 0,
  imported_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fuel_vehicle_expense_imports_tenant' AND object_id = OBJECT_ID('fuel_vehicle_expense_imports'))
  CREATE INDEX IX_fuel_vehicle_expense_imports_tenant ON fuel_vehicle_expense_imports(tenant_id, created_at DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_vehicle_expenses')
CREATE TABLE fuel_vehicle_expenses (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  import_id UNIQUEIDENTIFIER NULL REFERENCES fuel_vehicle_expense_imports(id) ON DELETE SET NULL,
  registration_number NVARCHAR(80) NOT NULL,
  transaction_at DATETIME2 NOT NULL,
  litres DECIMAL(18, 4) NULL,
  start_odometer DECIMAL(18, 2) NULL,
  end_odometer DECIMAL(18, 2) NULL,
  amount_rand DECIMAL(18, 2) NULL,
  source_type_name NVARCHAR(200) NULL,
  input_source NVARCHAR(200) NULL,
  price_per_litre DECIMAL(18, 4) NULL,
  truck_id UNIQUEIDENTIFIER NULL,
  contractor_id UNIQUEIDENTIFIER NULL,
  match_status NVARCHAR(32) NOT NULL DEFAULT N'unmatched',
  notes NVARCHAR(MAX) NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  updated_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fuel_vehicle_expenses_tenant_date' AND object_id = OBJECT_ID('fuel_vehicle_expenses'))
  CREATE INDEX IX_fuel_vehicle_expenses_tenant_date ON fuel_vehicle_expenses(tenant_id, transaction_at DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fuel_vehicle_expenses_truck' AND object_id = OBJECT_ID('fuel_vehicle_expenses'))
  CREATE INDEX IX_fuel_vehicle_expenses_truck ON fuel_vehicle_expenses(tenant_id, truck_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fuel_vehicle_expenses_reg' AND object_id = OBJECT_ID('fuel_vehicle_expenses'))
  CREATE INDEX IX_fuel_vehicle_expenses_reg ON fuel_vehicle_expenses(tenant_id, registration_number);
GO
