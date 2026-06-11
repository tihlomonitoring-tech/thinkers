-- Delivery Activity Ledger — truck diesel, expenses, CC deliveries, trial balance
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'logistics_delivery_ledger_diesel')
CREATE TABLE logistics_delivery_ledger_diesel (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  truck_id UNIQUEIDENTIFIER NOT NULL,
  driver_id UNIQUEIDENTIFIER NULL,
  route_id UNIQUEIDENTIFIER NULL,
  transaction_at DATETIME2 NOT NULL,
  location NVARCHAR(500) NOT NULL,
  litres DECIMAL(12, 3) NOT NULL,
  price_per_litre DECIMAL(12, 4) NULL,
  amount_rand DECIMAL(14, 2) NOT NULL,
  odometer_km DECIMAL(12, 2) NULL,
  supplier NVARCHAR(255) NULL,
  receipt_ref NVARCHAR(100) NULL,
  notes NVARCHAR(MAX) NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  updated_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ldl_diesel_tenant_date' AND object_id = OBJECT_ID(N'logistics_delivery_ledger_diesel'))
CREATE INDEX IX_ldl_diesel_tenant_date ON logistics_delivery_ledger_diesel (tenant_id, transaction_at);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ldl_diesel_truck' AND object_id = OBJECT_ID(N'logistics_delivery_ledger_diesel'))
CREATE INDEX IX_ldl_diesel_truck ON logistics_delivery_ledger_diesel (tenant_id, truck_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'logistics_delivery_ledger_expenses')
CREATE TABLE logistics_delivery_ledger_expenses (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  truck_id UNIQUEIDENTIFIER NOT NULL,
  driver_id UNIQUEIDENTIFIER NULL,
  route_id UNIQUEIDENTIFIER NULL,
  expense_type NVARCHAR(50) NOT NULL DEFAULT N'other',
  expense_date DATE NOT NULL,
  amount_rand DECIMAL(14, 2) NOT NULL,
  vendor NVARCHAR(255) NULL,
  location NVARCHAR(500) NULL,
  odometer_km DECIMAL(12, 2) NULL,
  description NVARCHAR(MAX) NULL,
  receipt_ref NVARCHAR(100) NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  updated_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ldl_exp_tenant_date' AND object_id = OBJECT_ID(N'logistics_delivery_ledger_expenses'))
CREATE INDEX IX_ldl_exp_tenant_date ON logistics_delivery_ledger_expenses (tenant_id, expense_date);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'logistics_delivery_ledger_batches')
CREATE TABLE logistics_delivery_ledger_batches (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  date_from DATE NULL,
  date_to DATE NULL,
  report_count INT NOT NULL DEFAULT 0,
  delivery_count INT NOT NULL DEFAULT 0,
  imported_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'logistics_delivery_ledger_deliveries')
CREATE TABLE logistics_delivery_ledger_deliveries (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  batch_id UNIQUEIDENTIFIER NULL,
  source_type NVARCHAR(40) NOT NULL DEFAULT N'manual',
  source_report_id UNIQUEIDENTIFIER NULL,
  source_delivery_id UNIQUEIDENTIFIER NULL,
  delivery_date DATE NOT NULL,
  shift_date DATE NULL,
  truck_id UNIQUEIDENTIFIER NULL,
  truck_registration NVARCHAR(100) NULL,
  driver_id UNIQUEIDENTIFIER NULL,
  driver_name NVARCHAR(255) NULL,
  route_id UNIQUEIDENTIFIER NULL,
  route_name NVARCHAR(255) NULL,
  contractor_name NVARCHAR(255) NULL,
  completed_deliveries INT NOT NULL DEFAULT 0,
  tons DECIMAL(14, 4) NULL,
  revenue_per_load DECIMAL(14, 2) NULL,
  revenue_amount DECIMAL(16, 2) NULL,
  remarks NVARCHAR(MAX) NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  updated_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ldl_del_tenant_date' AND object_id = OBJECT_ID(N'logistics_delivery_ledger_deliveries'))
CREATE INDEX IX_ldl_del_tenant_date ON logistics_delivery_ledger_deliveries (tenant_id, delivery_date);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ldl_del_route' AND object_id = OBJECT_ID(N'logistics_delivery_ledger_deliveries'))
CREATE INDEX IX_ldl_del_route ON logistics_delivery_ledger_deliveries (tenant_id, route_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_ldl_del_cc_source' AND object_id = OBJECT_ID(N'logistics_delivery_ledger_deliveries'))
CREATE UNIQUE INDEX UQ_ldl_del_cc_source ON logistics_delivery_ledger_deliveries (tenant_id, source_delivery_id)
WHERE source_delivery_id IS NOT NULL;
GO
