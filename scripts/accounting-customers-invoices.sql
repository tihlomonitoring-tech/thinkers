-- Customer book and Invoices; add customer_id to quotations.
-- Run: node scripts/run-accounting-customers-invoices.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_customers')
CREATE TABLE accounting_customers (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  name NVARCHAR(300) NOT NULL,
  address NVARCHAR(1000) NULL,
  email NVARCHAR(255) NULL,
  phone NVARCHAR(100) NULL,
  vat_number NVARCHAR(100) NULL,
  company_registration NVARCHAR(100) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_accounting_customers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounting_customers_tenant' AND object_id = OBJECT_ID('accounting_customers'))
  CREATE INDEX IX_accounting_customers_tenant ON accounting_customers(tenant_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_quotations') AND name = 'customer_id')
  ALTER TABLE accounting_quotations ADD customer_id UNIQUEIDENTIFIER NULL;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'accounting_customers')
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_accounting_quotations_customer')
    ALTER TABLE accounting_quotations ADD CONSTRAINT FK_accounting_quotations_customer FOREIGN KEY (customer_id) REFERENCES accounting_customers(id);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_invoices')
CREATE TABLE accounting_invoices (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  quotation_id UNIQUEIDENTIFIER NULL,
  number NVARCHAR(50) NOT NULL,
  customer_id UNIQUEIDENTIFIER NULL,
  customer_name NVARCHAR(300) NULL,
  customer_address NVARCHAR(1000) NULL,
  customer_email NVARCHAR(255) NULL,
  [date] DATE NULL,
  due_date DATE NULL,
  status NVARCHAR(50) NOT NULL DEFAULT N'draft',
  notes NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_accounting_invoices_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT FK_accounting_invoices_quotation FOREIGN KEY (quotation_id) REFERENCES accounting_quotations(id),
  CONSTRAINT FK_accounting_invoices_customer FOREIGN KEY (customer_id) REFERENCES accounting_customers(id)
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_invoice_lines')
CREATE TABLE accounting_invoice_lines (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  invoice_id UNIQUEIDENTIFIER NOT NULL,
  [description] NVARCHAR(500) NULL,
  quantity DECIMAL(18,4) NOT NULL DEFAULT 1,
  unit_price DECIMAL(18,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT FK_accounting_invoice_lines_invoice FOREIGN KEY (invoice_id) REFERENCES accounting_invoices(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounting_invoices_tenant' AND object_id = OBJECT_ID('accounting_invoices'))
  CREATE INDEX IX_accounting_invoices_tenant ON accounting_invoices(tenant_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounting_invoice_lines_invoice' AND object_id = OBJECT_ID('accounting_invoice_lines'))
  CREATE INDEX IX_accounting_invoice_lines_invoice ON accounting_invoice_lines(invoice_id);
GO
