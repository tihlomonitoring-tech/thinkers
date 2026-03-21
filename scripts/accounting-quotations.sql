-- Quotations and line items for accounting module.
-- Run: node scripts/run-accounting-quotations.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_quotations')
CREATE TABLE accounting_quotations (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  number NVARCHAR(50) NOT NULL,
  customer_name NVARCHAR(300) NULL,
  customer_address NVARCHAR(1000) NULL,
  customer_email NVARCHAR(255) NULL,
  [date] DATE NULL,
  valid_until DATE NULL,
  status NVARCHAR(50) NOT NULL DEFAULT N'draft',
  notes NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_accounting_quotations_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_quotation_lines')
CREATE TABLE accounting_quotation_lines (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  quotation_id UNIQUEIDENTIFIER NOT NULL,
  [description] NVARCHAR(500) NULL,
  quantity DECIMAL(18,4) NOT NULL DEFAULT 1,
  unit_price DECIMAL(18,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT FK_accounting_quotation_lines_quotation FOREIGN KEY (quotation_id) REFERENCES accounting_quotations(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounting_quotations_tenant' AND object_id = OBJECT_ID('accounting_quotations'))
  CREATE INDEX IX_accounting_quotations_tenant ON accounting_quotations(tenant_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounting_quotation_lines_quotation' AND object_id = OBJECT_ID('accounting_quotation_lines'))
  CREATE INDEX IX_accounting_quotation_lines_quotation ON accounting_quotation_lines(quotation_id);
GO
