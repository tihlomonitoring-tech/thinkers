-- Invoice: payment recording + recurring flag
-- Run: node scripts/run-accounting-invoice-paid-recurring.js

IF EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_invoices')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_invoices') AND name = 'payment_date')
    ALTER TABLE accounting_invoices ADD payment_date DATE NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_invoices') AND name = 'payment_reference')
    ALTER TABLE accounting_invoices ADD payment_reference NVARCHAR(500) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_invoices') AND name = 'is_recurring')
    ALTER TABLE accounting_invoices ADD is_recurring BIT NOT NULL DEFAULT 0;
END
GO
