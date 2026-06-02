-- Office Admin consumables: purchasing, capacity, dates, storage
-- Run: npm run db:office-admin-consumables-expand

IF COL_LENGTH('office_admin_consumables', 'brand') IS NULL
  ALTER TABLE office_admin_consumables ADD brand NVARCHAR(200) NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'sku') IS NULL
  ALTER TABLE office_admin_consumables ADD sku NVARCHAR(80) NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'storage_location') IS NULL
  ALTER TABLE office_admin_consumables ADD storage_location NVARCHAR(200) NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'purchase_location') IS NULL
  ALTER TABLE office_admin_consumables ADD purchase_location NVARCHAR(300) NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'supplier_name') IS NULL
  ALTER TABLE office_admin_consumables ADD supplier_name NVARCHAR(200) NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'capacity') IS NULL
  ALTER TABLE office_admin_consumables ADD capacity NVARCHAR(80) NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'capacity_amount') IS NULL
  ALTER TABLE office_admin_consumables ADD capacity_amount DECIMAL(18, 3) NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'capacity_unit') IS NULL
  ALTER TABLE office_admin_consumables ADD capacity_unit NVARCHAR(40) NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'last_purchase_date') IS NULL
  ALTER TABLE office_admin_consumables ADD last_purchase_date DATE NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'last_purchase_price') IS NULL
  ALTER TABLE office_admin_consumables ADD last_purchase_price DECIMAL(18, 2) NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'restock_date') IS NULL
  ALTER TABLE office_admin_consumables ADD restock_date DATE NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'expiry_date') IS NULL
  ALTER TABLE office_admin_consumables ADD expiry_date DATE NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'opened_date') IS NULL
  ALTER TABLE office_admin_consumables ADD opened_date DATE NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'max_stock_level') IS NULL
  ALTER TABLE office_admin_consumables ADD max_stock_level DECIMAL(18, 3) NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'is_perishable') IS NULL
  ALTER TABLE office_admin_consumables ADD is_perishable BIT NOT NULL CONSTRAINT DF_office_admin_consumables_perishable DEFAULT 0;
GO
IF COL_LENGTH('office_admin_consumables', 'batch_number') IS NULL
  ALTER TABLE office_admin_consumables ADD batch_number NVARCHAR(80) NULL;
GO
