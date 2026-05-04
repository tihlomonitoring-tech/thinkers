-- Fuel Data v2: supplier/customer extra fields, transaction registration, attachments, advanced dashboard tab grants compatibility (tab id is app-level only).
-- Run: npm run db:fuel-data-expand-v2

IF COL_LENGTH('dbo.fuel_data_suppliers', 'vehicle_registration') IS NULL
  ALTER TABLE dbo.fuel_data_suppliers ADD vehicle_registration NVARCHAR(120) NULL;
GO
IF COL_LENGTH('dbo.fuel_data_suppliers', 'fuel_attendant_name') IS NULL
  ALTER TABLE dbo.fuel_data_suppliers ADD fuel_attendant_name NVARCHAR(255) NULL;
GO

IF COL_LENGTH('dbo.fuel_data_customers', 'vehicle_registration') IS NULL
  ALTER TABLE dbo.fuel_data_customers ADD vehicle_registration NVARCHAR(120) NULL;
GO
IF COL_LENGTH('dbo.fuel_data_customers', 'responsible_user_name') IS NULL
  ALTER TABLE dbo.fuel_data_customers ADD responsible_user_name NVARCHAR(255) NULL;
GO
IF COL_LENGTH('dbo.fuel_data_customers', 'authorizer_name') IS NULL
  ALTER TABLE dbo.fuel_data_customers ADD authorizer_name NVARCHAR(255) NULL;
GO

IF COL_LENGTH('dbo.fuel_data_transactions', 'vehicle_registration') IS NULL
  ALTER TABLE dbo.fuel_data_transactions ADD vehicle_registration NVARCHAR(120) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fuel_data_transaction_attachments')
BEGIN
  CREATE TABLE dbo.fuel_data_transaction_attachments (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID() PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    transaction_id UNIQUEIDENTIFIER NOT NULL,
    file_path NVARCHAR(1024) NOT NULL,
    original_name NVARCHAR(512) NULL,
    uploaded_by_user_id UNIQUEIDENTIFIER NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_fuel_data_tx_att_tx FOREIGN KEY (transaction_id) REFERENCES dbo.fuel_data_transactions (id) ON DELETE CASCADE
  );
  CREATE INDEX IX_fuel_data_tx_att_tx ON dbo.fuel_data_transaction_attachments (transaction_id);
END
GO
