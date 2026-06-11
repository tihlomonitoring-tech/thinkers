-- Fleet fuel tank capacity and consumption (Contractor → Logistics finance estimates)
-- Run: npm run db:contractor-truck-fuel

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_trucks') AND name = 'fuel_tank_capacity_litres')
  ALTER TABLE contractor_trucks ADD fuel_tank_capacity_litres DECIMAL(12, 2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_trucks') AND name = 'fuel_consumption_litres_per_100km')
  ALTER TABLE contractor_trucks ADD fuel_consumption_litres_per_100km DECIMAL(8, 2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('logistics_delivery_ledger_deliveries') AND name = 'estimated_fuel_litres')
  ALTER TABLE logistics_delivery_ledger_deliveries ADD estimated_fuel_litres DECIMAL(12, 3) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('logistics_delivery_ledger_deliveries') AND name = 'estimated_fuel_cost')
  ALTER TABLE logistics_delivery_ledger_deliveries ADD estimated_fuel_cost DECIMAL(14, 2) NULL;
GO
