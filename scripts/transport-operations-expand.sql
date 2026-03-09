-- Transport Operations expand: controller_user_ids, price_per_quantity, driver user_id.
-- Run: node scripts/run-transport-operations-expand.js

-- Shift reports: multiple controllers (tenant user IDs as JSON array)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('to_shift_reports') AND name = 'controller_user_ids')
  ALTER TABLE to_shift_reports ADD controller_user_ids NVARCHAR(MAX) NULL;
GO

-- Routes: price per quantity for revenue calculation
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('to_routes') AND name = 'price_per_quantity')
  ALTER TABLE to_routes ADD price_per_quantity DECIMAL(14,2) NULL;
GO

-- Drivers: link to portal user
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('to_drivers') AND name = 'user_id')
  ALTER TABLE to_drivers ADD user_id UNIQUEIDENTIFIER NULL;
GO
