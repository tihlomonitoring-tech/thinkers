-- Optional: link tracking_vehicle_link and fleet_trip to contractor_trucks (Contractor page fleet).
-- Run after: npm run db:tracking-integration
-- Run: node scripts/run-tracking-expand-contractor-truck.js

IF COL_LENGTH('tracking_vehicle_link', 'contractor_truck_id') IS NULL
  ALTER TABLE tracking_vehicle_link ADD contractor_truck_id UNIQUEIDENTIFIER NULL;
GO

-- No FK to contractor_trucks: SQL Server multiple cascade paths (tenant -> contractor_trucks vs tenant -> fleet_trip / provider chain).
-- Enforce contractor_truck_id in application; optional indexes:
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tvl_contractor_truck' AND object_id = OBJECT_ID('tracking_vehicle_link'))
  CREATE INDEX IX_tvl_contractor_truck ON tracking_vehicle_link(contractor_truck_id) WHERE contractor_truck_id IS NOT NULL;
GO

IF COL_LENGTH('fleet_trip', 'contractor_truck_id') IS NULL
  ALTER TABLE fleet_trip ADD contractor_truck_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fleet_trip_contractor_truck' AND object_id = OBJECT_ID('fleet_trip'))
  CREATE INDEX IX_fleet_trip_contractor_truck ON fleet_trip(contractor_truck_id) WHERE contractor_truck_id IS NOT NULL;
GO
