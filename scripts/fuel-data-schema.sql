-- Fuel Data: diesel transactions, suppliers, customers, receipts, tab grants.
-- Run: npm run db:fuel-data

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_data_tab_grants')
BEGIN
  CREATE TABLE fuel_data_tab_grants (
    user_id UNIQUEIDENTIFIER NOT NULL,
    tab_id NVARCHAR(64) NOT NULL,
    granted_by_user_id UNIQUEIDENTIFIER NULL,
    granted_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_fuel_data_tab_grants PRIMARY KEY (user_id, tab_id)
  );
  CREATE INDEX IX_fuel_data_tab_grants_tab ON fuel_data_tab_grants (tab_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_data_suppliers')
BEGIN
  CREATE TABLE fuel_data_suppliers (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(255) NOT NULL,
    logo_file_path NVARCHAR(1024) NULL,
    address NVARCHAR(MAX) NULL,
    vat_number NVARCHAR(120) NULL,
    price_per_litre DECIMAL(18, 4) NOT NULL DEFAULT 0,
    created_by_user_id UNIQUEIDENTIFIER NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_fuel_data_suppliers_tenant ON fuel_data_suppliers (tenant_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_data_customers')
BEGIN
  CREATE TABLE fuel_data_customers (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(255) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_fuel_data_customers_tenant ON fuel_data_customers (tenant_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_data_customer_receipts')
BEGIN
  CREATE TABLE fuel_data_customer_receipts (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    customer_id UNIQUEIDENTIFIER NOT NULL,
    file_path NVARCHAR(1024) NOT NULL,
    original_name NVARCHAR(512) NULL,
    uploaded_by_user_id UNIQUEIDENTIFIER NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_fuel_data_receipts_customer FOREIGN KEY (customer_id) REFERENCES fuel_data_customers (id) ON DELETE CASCADE
  );
  CREATE INDEX IX_fuel_data_receipts_customer ON fuel_data_customer_receipts (customer_id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_data_transactions')
BEGIN
  CREATE TABLE fuel_data_transactions (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    supplier_id UNIQUEIDENTIFIER NULL,
    supplier_name NVARCHAR(255) NOT NULL,
    customer_id UNIQUEIDENTIFIER NULL,
    customer_name NVARCHAR(255) NOT NULL,
    vehicle_tank NVARCHAR(255) NULL,
    delivery_time DATETIME2 NULL,
    kilos DECIMAL(18, 4) NULL,
    responsible_user_name NVARCHAR(255) NULL,
    pump_start DECIMAL(18, 4) NULL,
    pump_stop DECIMAL(18, 4) NULL,
    liters_filled DECIMAL(18, 4) NULL,
    fuel_attendant_name NVARCHAR(255) NULL,
    authorizer_name NVARCHAR(255) NULL,
    price_per_litre DECIMAL(18, 4) NULL,
    amount_rand DECIMAL(18, 2) NULL,
    verification_status NVARCHAR(32) NOT NULL DEFAULT N'verified',
    source NVARCHAR(32) NOT NULL DEFAULT N'manual',
    slip_image_path NVARCHAR(1024) NULL,
    created_by_user_id UNIQUEIDENTIFIER NULL,
    verified_by_user_id UNIQUEIDENTIFIER NULL,
    verified_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_fuel_data_tx_supplier FOREIGN KEY (supplier_id) REFERENCES fuel_data_suppliers (id) ON DELETE SET NULL,
    CONSTRAINT FK_fuel_data_tx_customer FOREIGN KEY (customer_id) REFERENCES fuel_data_customers (id) ON DELETE SET NULL
  );
  CREATE INDEX IX_fuel_data_tx_tenant ON fuel_data_transactions (tenant_id);
  CREATE INDEX IX_fuel_data_tx_status ON fuel_data_transactions (tenant_id, verification_status);
END
GO
