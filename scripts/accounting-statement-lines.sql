-- Advanced customer statements: opening balance, ref, currency, preamble; transaction lines (bank-style).
-- Run: node scripts/run-accounting-statement-lines.js

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'accounting_statements')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_statements') AND name = 'opening_balance')
    ALTER TABLE accounting_statements ADD opening_balance DECIMAL(18,2) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_statements') AND name = 'currency')
    ALTER TABLE accounting_statements ADD currency NVARCHAR(10) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_statements') AND name = 'statement_ref')
    ALTER TABLE accounting_statements ADD statement_ref NVARCHAR(100) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('accounting_statements') AND name = 'preamble')
    ALTER TABLE accounting_statements ADD preamble NVARCHAR(MAX) NULL;
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_statement_lines')
CREATE TABLE accounting_statement_lines (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  statement_id UNIQUEIDENTIFIER NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  txn_date DATE NULL,
  reference NVARCHAR(200) NULL,
  description NVARCHAR(1000) NOT NULL DEFAULT N'',
  debit DECIMAL(18,2) NULL,
  credit DECIMAL(18,2) NULL,
  balance_after DECIMAL(18,2) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_accounting_statement_lines_statement FOREIGN KEY (statement_id) REFERENCES accounting_statements(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounting_statement_lines_statement' AND object_id = OBJECT_ID('accounting_statement_lines'))
  CREATE INDEX IX_accounting_statement_lines_statement ON accounting_statement_lines(statement_id);
GO
