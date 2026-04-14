-- Fuel supply v2: activity columns, order reorder chain, delivery vehicles, trips, stops, list reconciliations support.
-- Idempotent ALTER / CREATE. Run after fuel-supply-schema.sql.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fuel_diesel_orders') AND name = N'prior_order_id')
BEGIN
  ALTER TABLE fuel_diesel_orders ADD prior_order_id UNIQUEIDENTIFIER NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fuel_supply_activities') AND name = N'location_label')
BEGIN
  ALTER TABLE fuel_supply_activities ADD location_label NVARCHAR(255) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fuel_supply_activities') AND name = N'odometer_km')
BEGIN
  ALTER TABLE fuel_supply_activities ADD odometer_km DECIMAL(12,2) NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fuel_supply_activities') AND name = N'duration_minutes')
BEGIN
  ALTER TABLE fuel_supply_activities ADD duration_minutes INT NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fuel_supply_activities') AND name = N'tags')
BEGIN
  ALTER TABLE fuel_supply_activities ADD tags NVARCHAR(300) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_delivery_vehicles')
BEGIN
  CREATE TABLE fuel_delivery_vehicles (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NULL,
    name NVARCHAR(200) NOT NULL,
    registration NVARCHAR(80) NULL,
    tank_capacity_liters DECIMAL(12,2) NULL,
    current_liters_estimate DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_by_user_id UNIQUEIDENTIFIER NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_fuel_vehicles_tenant ON fuel_delivery_vehicles (tenant_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_vehicle_trips')
BEGIN
  CREATE TABLE fuel_vehicle_trips (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NULL,
    vehicle_id UNIQUEIDENTIFIER NOT NULL,
    diesel_order_id UNIQUEIDENTIFIER NULL,
    driver_name NVARCHAR(200) NOT NULL,
    driver_employee_number NVARCHAR(80) NOT NULL,
    status NVARCHAR(40) NOT NULL DEFAULT N'planned',
    started_at DATETIME2 NULL,
    completed_at DATETIME2 NULL,
    odometer_start_km DECIMAL(14,2) NULL,
    odometer_end_km DECIMAL(14,2) NULL,
    opening_liters_estimate DECIMAL(12,2) NULL,
    closing_liters_estimate DECIMAL(12,2) NULL,
    notes NVARCHAR(MAX) NULL,
    created_by_user_id UNIQUEIDENTIFIER NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_fuel_trips_vehicle FOREIGN KEY (vehicle_id) REFERENCES fuel_delivery_vehicles (id) ON DELETE NO ACTION,
    CONSTRAINT FK_fuel_trips_order FOREIGN KEY (diesel_order_id) REFERENCES fuel_diesel_orders (id) ON DELETE SET NULL
  );
  CREATE INDEX IX_fuel_trips_vehicle ON fuel_vehicle_trips (vehicle_id);
  CREATE INDEX IX_fuel_trips_tenant ON fuel_vehicle_trips (tenant_id);
  CREATE INDEX IX_fuel_trips_status ON fuel_vehicle_trips (status);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_trip_stops')
BEGIN
  CREATE TABLE fuel_trip_stops (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    trip_id UNIQUEIDENTIFIER NOT NULL,
    sequence_no INT NOT NULL,
    place_label NVARCHAR(255) NULL,
    arrived_at DATETIME2 NOT NULL,
    departed_at DATETIME2 NULL,
    odometer_km DECIMAL(14,2) NULL,
    liters_on_gauge DECIMAL(12,2) NULL,
    gauge_photo_path NVARCHAR(500) NULL,
    gauge_original_name NVARCHAR(255) NULL,
    is_refuel BIT NOT NULL DEFAULT 0,
    refuel_liters DECIMAL(12,2) NULL,
    slip_photo_path NVARCHAR(500) NULL,
    slip_original_name NVARCHAR(255) NULL,
    notes NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_fuel_trip_stops_trip FOREIGN KEY (trip_id) REFERENCES fuel_vehicle_trips (id) ON DELETE CASCADE
  );
  CREATE INDEX IX_fuel_trip_stops_trip ON fuel_trip_stops (trip_id);
END
GO
