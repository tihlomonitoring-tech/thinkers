-- Fuel Data v3: default supplier, transaction order number, supplier vehicle on transaction (vs customer fleet).
-- Run: npm run db:fuel-data-expand-v3

IF COL_LENGTH('dbo.fuel_data_suppliers', 'is_default') IS NULL
  ALTER TABLE dbo.fuel_data_suppliers ADD is_default BIT NOT NULL CONSTRAINT DF_fuel_suppliers_is_default DEFAULT (0);
GO

IF COL_LENGTH('dbo.fuel_data_transactions', 'order_number') IS NULL
  ALTER TABLE dbo.fuel_data_transactions ADD order_number NVARCHAR(120) NULL;
GO

IF COL_LENGTH('dbo.fuel_data_transactions', 'supplier_vehicle_registration') IS NULL
  ALTER TABLE dbo.fuel_data_transactions ADD supplier_vehicle_registration NVARCHAR(120) NULL;
GO
