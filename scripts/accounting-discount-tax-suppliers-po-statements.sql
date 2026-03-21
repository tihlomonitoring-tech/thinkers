-- Discount/tax on quotations and invoices; suppliers; purchase orders; statements.
-- Run: node scripts/run-accounting-discount-tax-suppliers-po-statements.js

-- Quotations: add discount and tax
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'accounting_quotations')
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_quotations') AND name = 'discount_percent')
    ALTER TABLE accounting_quotations ADD discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'accounting_quotations')
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_quotations') AND name = 'tax_percent')
    ALTER TABLE accounting_quotations ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
GO

-- Invoices: add discount and tax
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'accounting_invoices')
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_invoices') AND name = 'discount_percent')
    ALTER TABLE accounting_invoices ADD discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'accounting_invoices')
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_invoices') AND name = 'tax_percent')
    ALTER TABLE accounting_invoices ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
GO

-- Suppliers (like customers)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_suppliers')
CREATE TABLE accounting_suppliers (
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
  CONSTRAINT FK_accounting_suppliers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounting_suppliers_tenant' AND object_id = OBJECT_ID('accounting_suppliers'))
  CREATE INDEX IX_accounting_suppliers_tenant ON accounting_suppliers(tenant_id);
GO

-- Purchase orders
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_purchase_orders')
CREATE TABLE accounting_purchase_orders (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  number NVARCHAR(50) NOT NULL,
  supplier_id UNIQUEIDENTIFIER NULL,
  supplier_name NVARCHAR(300) NULL,
  supplier_address NVARCHAR(1000) NULL,
  supplier_email NVARCHAR(255) NULL,
  [date] DATE NULL,
  due_date DATE NULL,
  status NVARCHAR(50) NOT NULL DEFAULT N'draft',
  notes NVARCHAR(MAX) NULL,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_accounting_po_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT FK_accounting_po_supplier FOREIGN KEY (supplier_id) REFERENCES accounting_suppliers(id)
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_purchase_order_lines')
CREATE TABLE accounting_purchase_order_lines (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  purchase_order_id UNIQUEIDENTIFIER NOT NULL,
  [description] NVARCHAR(500) NULL,
  quantity DECIMAL(18,4) NOT NULL DEFAULT 1,
  unit_price DECIMAL(18,2) NOT NULL DEFAULT 0,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT FK_accounting_po_lines_po FOREIGN KEY (purchase_order_id) REFERENCES accounting_purchase_orders(id) ON DELETE CASCADE
);
GO

-- PO lines: per-line discount/tax (upgrade tables created before these columns existed)
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_purchase_order_lines')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_purchase_order_lines') AND name = 'discount_percent')
    ALTER TABLE accounting_purchase_order_lines ADD discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_purchase_order_lines') AND name = 'tax_percent')
    ALTER TABLE accounting_purchase_order_lines ADD tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounting_po_tenant' AND object_id = OBJECT_ID('accounting_purchase_orders'))
  CREATE INDEX IX_accounting_po_tenant ON accounting_purchase_orders(tenant_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounting_po_lines_po' AND object_id = OBJECT_ID('accounting_purchase_order_lines'))
  CREATE INDEX IX_accounting_po_lines_po ON accounting_purchase_order_lines(purchase_order_id);
GO

-- Statements (customer statements & other; manual draft + PDF/Excel/email)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_statements')
CREATE TABLE accounting_statements (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  type NVARCHAR(50) NOT NULL DEFAULT N'customer',
  customer_id UNIQUEIDENTIFIER NULL,
  title NVARCHAR(300) NULL,
  content NVARCHAR(MAX) NULL,
  statement_date DATE NULL,
  date_from DATE NULL,
  date_to DATE NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_accounting_statements_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'accounting_customers')
  IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'accounting_statements')
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_accounting_statements_customer')
      ALTER TABLE accounting_statements ADD CONSTRAINT FK_accounting_statements_customer FOREIGN KEY (customer_id) REFERENCES accounting_customers(id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounting_statements_tenant' AND object_id = OBJECT_ID('accounting_statements'))
  CREATE INDEX IX_accounting_statements_tenant ON accounting_statements(tenant_id);
GO
