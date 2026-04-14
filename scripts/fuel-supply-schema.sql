-- Fuel supply management: diesel orders, activities, deliveries, reconciliations, tab grants, alerts/events.
-- Run on SQL Server (same DB as main app). Idempotent where possible.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_supply_grants')
BEGIN
  CREATE TABLE fuel_supply_grants (
    user_id UNIQUEIDENTIFIER NOT NULL,
    tab_id NVARCHAR(50) NOT NULL,
    granted_by_user_id UNIQUEIDENTIFIER NULL,
    granted_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_fuel_supply_grants PRIMARY KEY (user_id, tab_id)
  );
  CREATE INDEX IX_fuel_supply_grants_tab ON fuel_supply_grants (tab_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_diesel_orders')
BEGIN
  CREATE TABLE fuel_diesel_orders (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NULL,
    created_by_user_id UNIQUEIDENTIFIER NOT NULL,
    status NVARCHAR(40) NOT NULL DEFAULT N'draft',
    depot_name NVARCHAR(255) NOT NULL,
    depot_address NVARCHAR(500) NOT NULL,
    supplier_code NVARCHAR(120) NOT NULL,
    driver_name NVARCHAR(200) NOT NULL,
    driver_employee_number NVARCHAR(80) NOT NULL,
    delivery_site_name NVARCHAR(255) NOT NULL,
    delivery_site_address NVARCHAR(500) NOT NULL,
    site_responsible_name NVARCHAR(200) NOT NULL,
    site_responsible_phone NVARCHAR(80) NULL,
    site_responsible_email NVARCHAR(255) NULL,
    site_responsible_role NVARCHAR(120) NULL,
    expected_liters DECIMAL(12,2) NULL,
    notes NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_fuel_orders_tenant ON fuel_diesel_orders (tenant_id);
  CREATE INDEX IX_fuel_orders_status ON fuel_diesel_orders (status);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_supply_activities')
BEGIN
  CREATE TABLE fuel_supply_activities (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    order_id UNIQUEIDENTIFIER NOT NULL,
    activity_type NVARCHAR(40) NOT NULL,
    title NVARCHAR(255) NOT NULL,
    notes NVARCHAR(MAX) NULL,
    liters_related DECIMAL(12,2) NULL,
    created_by_user_id UNIQUEIDENTIFIER NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_fuel_activities_order FOREIGN KEY (order_id) REFERENCES fuel_diesel_orders (id) ON DELETE CASCADE
  );
  CREATE INDEX IX_fuel_activities_order ON fuel_supply_activities (order_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_deliveries')
BEGIN
  CREATE TABLE fuel_deliveries (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    order_id UNIQUEIDENTIFIER NOT NULL,
    liters_delivered DECIMAL(12,2) NOT NULL,
    receipt_stored_path NVARCHAR(500) NOT NULL,
    receipt_original_name NVARCHAR(255) NULL,
    accepted_by_name NVARCHAR(200) NOT NULL,
    filled_into_description NVARCHAR(500) NOT NULL,
    vehicle_references NVARCHAR(MAX) NULL,
    delivered_at DATETIME2 NOT NULL,
    created_by_user_id UNIQUEIDENTIFIER NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_fuel_deliveries_order FOREIGN KEY (order_id) REFERENCES fuel_diesel_orders (id) ON DELETE CASCADE
  );
  CREATE INDEX IX_fuel_deliveries_order ON fuel_deliveries (order_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_reconciliations')
BEGIN
  CREATE TABLE fuel_reconciliations (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    order_id UNIQUEIDENTIFIER NOT NULL,
    invoice_reference NVARCHAR(120) NOT NULL,
    invoice_amount DECIMAL(14,2) NOT NULL,
    handling_fee DECIMAL(14,2) NULL,
    payment_status NVARCHAR(40) NOT NULL DEFAULT N'pending',
    payment_date DATE NULL,
    payment_reference NVARCHAR(200) NULL,
    notes NVARCHAR(MAX) NULL,
    created_by_user_id UNIQUEIDENTIFIER NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_fuel_recon_order FOREIGN KEY (order_id) REFERENCES fuel_diesel_orders (id) ON DELETE CASCADE
  );
  CREATE INDEX IX_fuel_recon_order ON fuel_reconciliations (order_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_supply_events')
BEGIN
  CREATE TABLE fuel_supply_events (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NULL,
    event_type NVARCHAR(40) NOT NULL,
    order_id UNIQUEIDENTIFIER NULL,
    title NVARCHAR(255) NOT NULL,
    message NVARCHAR(1000) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_fuel_events_created ON fuel_supply_events (created_at DESC);
  CREATE INDEX IX_fuel_events_tenant ON fuel_supply_events (tenant_id);
END
GO
