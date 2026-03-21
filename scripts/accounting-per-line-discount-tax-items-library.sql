-- Per-line discount and tax on quotation, invoice, purchase order lines
-- Items library for reusable line items (used in quotations, invoices, POs)

-- Quotation lines: add discount_percent, tax_percent (only if table exists)
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_quotation_lines')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_quotation_lines') AND name = 'discount_percent')
    ALTER TABLE accounting_quotation_lines ADD discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_quotation_lines') AND name = 'tax_percent')
    ALTER TABLE accounting_quotation_lines ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
END
GO

-- Invoice lines: add discount_percent, tax_percent (only if table exists)
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_invoice_lines')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_invoice_lines') AND name = 'discount_percent')
    ALTER TABLE accounting_invoice_lines ADD discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_invoice_lines') AND name = 'tax_percent')
    ALTER TABLE accounting_invoice_lines ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
END
GO

-- Purchase order lines: add discount_percent, tax_percent (only if table exists)
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_purchase_order_lines')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_purchase_order_lines') AND name = 'discount_percent')
    ALTER TABLE accounting_purchase_order_lines ADD discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_purchase_order_lines') AND name = 'tax_percent')
    ALTER TABLE accounting_purchase_order_lines ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
END
GO

-- Items library (reusable line items for quotations, invoices, POs)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_items')
CREATE TABLE accounting_items (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  [description] NVARCHAR(500) NULL,
  default_quantity DECIMAL(18,4) NOT NULL DEFAULT 1,
  default_unit_price DECIMAL(18,2) NOT NULL DEFAULT 0,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_accounting_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounting_items_tenant' AND object_id = OBJECT_ID('accounting_items'))
  CREATE INDEX IX_accounting_items_tenant ON accounting_items(tenant_id);
GO
