-- Fuel economics for tracking completed deliveries + per-truck fuel regulation.
-- Run: node scripts/run-tracking-fuel-economics.js

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'distance_km')
  ALTER TABLE tracking_delivery_record ADD distance_km DECIMAL(10,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'avg_speed_kmh')
  ALTER TABLE tracking_delivery_record ADD avg_speed_kmh DECIMAL(8,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'origin_name')
  ALTER TABLE tracking_delivery_record ADD origin_name NVARCHAR(200) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'truck_make_model')
  ALTER TABLE tracking_delivery_record ADD truck_make_model NVARCHAR(200) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'truck_year_model')
  ALTER TABLE tracking_delivery_record ADD truck_year_model NVARCHAR(40) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'fuel_litres_per_100km')
  ALTER TABLE tracking_delivery_record ADD fuel_litres_per_100km DECIMAL(8,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'fuel_price_per_litre')
  ALTER TABLE tracking_delivery_record ADD fuel_price_per_litre DECIMAL(10,4) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'fuel_litres_estimated')
  ALTER TABLE tracking_delivery_record ADD fuel_litres_estimated DECIMAL(12,3) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'fuel_cost_estimated')
  ALTER TABLE tracking_delivery_record ADD fuel_cost_estimated DECIMAL(14,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'fuel_litres')
  ALTER TABLE tracking_delivery_record ADD fuel_litres DECIMAL(12,3) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'fuel_cost')
  ALTER TABLE tracking_delivery_record ADD fuel_cost DECIMAL(14,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'revenue_amount')
  ALTER TABLE tracking_delivery_record ADD revenue_amount DECIMAL(14,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'revenue_per_ton')
  ALTER TABLE tracking_delivery_record ADD revenue_per_ton DECIMAL(12,4) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'fuel_calc_source')
  ALTER TABLE tracking_delivery_record ADD fuel_calc_source NVARCHAR(40) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'fuel_snapshot_at')
  ALTER TABLE tracking_delivery_record ADD fuel_snapshot_at DATETIME2 NULL;
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tracking_fuel_regulation')
CREATE TABLE tracking_fuel_regulation (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  contractor_truck_id UNIQUEIDENTIFIER NULL,
  fuel_price_per_litre DECIMAL(10,4) NOT NULL,
  fuel_litres_per_100km DECIMAL(8,2) NULL,
  notes NVARCHAR(500) NULL,
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_tfr_updated DEFAULT SYSUTCDATETIME(),
  updated_by NVARCHAR(200) NULL,
  CONSTRAINT FK_tfr_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tfr_tenant_truck' AND object_id = OBJECT_ID('tracking_fuel_regulation'))
  CREATE UNIQUE INDEX IX_tfr_tenant_truck ON tracking_fuel_regulation(tenant_id, contractor_truck_id)
    WHERE contractor_truck_id IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tfr_tenant_default' AND object_id = OBJECT_ID('tracking_fuel_regulation'))
  CREATE UNIQUE INDEX IX_tfr_tenant_default ON tracking_fuel_regulation(tenant_id)
    WHERE contractor_truck_id IS NULL;
GO
