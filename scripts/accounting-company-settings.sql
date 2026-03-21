-- Accounting: company settings per tenant (logo, address, VAT, etc.)
-- Run: node scripts/run-accounting-company-settings.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_company_settings')
CREATE TABLE accounting_company_settings (
  tenant_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  logo_path NVARCHAR(500) NULL,
  company_name NVARCHAR(200) NULL,
  address NVARCHAR(1000) NULL,
  vat_number NVARCHAR(100) NULL,
  company_registration NVARCHAR(100) NULL,
  website NVARCHAR(500) NULL,
  email NVARCHAR(255) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_accounting_company_settings_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

-- Payment terms & banking (shown on quotation / invoice / PO PDFs)
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_company_settings')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_company_settings') AND name = 'payment_terms')
    ALTER TABLE accounting_company_settings ADD payment_terms NVARCHAR(MAX) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_company_settings') AND name = 'banking_details')
    ALTER TABLE accounting_company_settings ADD banking_details NVARCHAR(MAX) NULL;
END
GO
