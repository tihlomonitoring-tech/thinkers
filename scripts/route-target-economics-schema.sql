-- Extend route target regulations with corridor economics (distance, rate, revenue, costs)
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'access_route_target_regulations')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_route_target_regulations') AND name = 'distance_km')
    ALTER TABLE access_route_target_regulations ADD distance_km DECIMAL(10,2) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_route_target_regulations') AND name = 'rate_per_ton')
    ALTER TABLE access_route_target_regulations ADD rate_per_ton DECIMAL(12,2) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_route_target_regulations') AND name = 'revenue_target')
    ALTER TABLE access_route_target_regulations ADD revenue_target DECIMAL(14,2) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_route_target_regulations') AND name = 'avg_payload_tons')
    ALTER TABLE access_route_target_regulations ADD avg_payload_tons DECIMAL(10,2) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_route_target_regulations') AND name = 'fuel_litres_per_100km')
    ALTER TABLE access_route_target_regulations ADD fuel_litres_per_100km DECIMAL(8,2) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_route_target_regulations') AND name = 'fuel_price_per_litre')
    ALTER TABLE access_route_target_regulations ADD fuel_price_per_litre DECIMAL(10,4) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_route_target_regulations') AND name = 'driver_cost_per_trip')
    ALTER TABLE access_route_target_regulations ADD driver_cost_per_trip DECIMAL(12,2) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_route_target_regulations') AND name = 'maintenance_cost_per_km')
    ALTER TABLE access_route_target_regulations ADD maintenance_cost_per_km DECIMAL(10,4) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_route_target_regulations') AND name = 'toll_cost_per_trip')
    ALTER TABLE access_route_target_regulations ADD toll_cost_per_trip DECIMAL(12,2) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_route_target_regulations') AND name = 'other_cost_per_trip')
    ALTER TABLE access_route_target_regulations ADD other_cost_per_trip DECIMAL(12,2) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_route_target_regulations') AND name = 'overhead_percent')
    ALTER TABLE access_route_target_regulations ADD overhead_percent DECIMAL(5,2) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_route_target_regulations') AND name = 'target_period_days')
    ALTER TABLE access_route_target_regulations ADD target_period_days INT NULL;
END
GO
