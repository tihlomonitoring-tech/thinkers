-- Optional: show issue date row on invoice PDF (default on).
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'accounting_invoices')
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_invoices') AND name = 'show_issue_date_on_pdf')
    ALTER TABLE accounting_invoices ADD show_issue_date_on_pdf BIT NOT NULL DEFAULT 1;
GO
