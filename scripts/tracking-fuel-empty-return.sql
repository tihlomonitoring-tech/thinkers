-- Empty return fuel (destination → logistics field) for completed deliveries.
-- Run: node scripts/run-tracking-fuel-empty-return.js

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_fuel_regulation') AND name = N'fuel_litres_per_100km_empty')
  ALTER TABLE tracking_fuel_regulation ADD fuel_litres_per_100km_empty DECIMAL(8,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_fuel_regulation') AND name = N'return_empty_consumption_factor')
  ALTER TABLE tracking_fuel_regulation ADD return_empty_consumption_factor DECIMAL(5,3) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'return_distance_km')
  ALTER TABLE tracking_delivery_record ADD return_distance_km DECIMAL(10,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'return_avg_speed_kmh')
  ALTER TABLE tracking_delivery_record ADD return_avg_speed_kmh DECIMAL(8,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'return_fuel_litres_per_100km')
  ALTER TABLE tracking_delivery_record ADD return_fuel_litres_per_100km DECIMAL(8,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'return_fuel_litres_estimated')
  ALTER TABLE tracking_delivery_record ADD return_fuel_litres_estimated DECIMAL(12,3) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'return_fuel_cost_estimated')
  ALTER TABLE tracking_delivery_record ADD return_fuel_cost_estimated DECIMAL(14,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'return_fuel_litres')
  ALTER TABLE tracking_delivery_record ADD return_fuel_litres DECIMAL(12,3) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'return_fuel_cost')
  ALTER TABLE tracking_delivery_record ADD return_fuel_cost DECIMAL(14,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'include_return_fuel_in_cost')
  ALTER TABLE tracking_delivery_record ADD include_return_fuel_in_cost BIT NOT NULL
    CONSTRAINT DF_tdr_include_return_fuel DEFAULT (0);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'return_fuel_calc_source')
  ALTER TABLE tracking_delivery_record ADD return_fuel_calc_source NVARCHAR(40) NULL;
GO
