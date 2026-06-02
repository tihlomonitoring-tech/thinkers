-- Chart of accounts, general ledger, and default account mappings.
-- Run: npm run db:accounting-account-types

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_account_types')
CREATE TABLE accounting_account_types (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_code NVARCHAR(20) NOT NULL,
  account_name NVARCHAR(255) NOT NULL,
  account_class NVARCHAR(30) NOT NULL,
  account_subtype NVARCHAR(50) NULL,
  parent_id UNIQUEIDENTIFIER NULL,
  description NVARCHAR(500) NULL,
  normal_balance NVARCHAR(10) NOT NULL DEFAULT N'debit',
  is_system BIT NOT NULL DEFAULT 0,
  is_active BIT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_aat_class CHECK (account_class IN (N'asset', N'liability', N'equity', N'income', N'expense')),
  CONSTRAINT CK_aat_normal CHECK (normal_balance IN (N'debit', N'credit')),
  CONSTRAINT UQ_aat_tenant_code UNIQUE (tenant_id, account_code)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_aat_tenant_class' AND object_id = OBJECT_ID('accounting_account_types'))
  CREATE INDEX IX_aat_tenant_class ON accounting_account_types(tenant_id, account_class, sort_order);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_account_defaults')
CREATE TABLE accounting_account_defaults (
  tenant_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  bank_account_id UNIQUEIDENTIFIER NULL,
  accounts_receivable_id UNIQUEIDENTIFIER NULL,
  sales_revenue_id UNIQUEIDENTIFIER NULL,
  accounts_payable_id UNIQUEIDENTIFIER NULL,
  default_expense_account_id UNIQUEIDENTIFIER NULL,
  default_income_account_id UNIQUEIDENTIFIER NULL,
  vat_output_account_id UNIQUEIDENTIFIER NULL,
  vat_input_account_id UNIQUEIDENTIFIER NULL,
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_journal_entries')
CREATE TABLE accounting_journal_entries (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  journal_number NVARCHAR(30) NOT NULL,
  entry_date DATE NOT NULL,
  description NVARCHAR(500) NOT NULL,
  source_type NVARCHAR(50) NOT NULL,
  source_id UNIQUEIDENTIFIER NULL,
  [status] NVARCHAR(20) NOT NULL DEFAULT N'posted',
  created_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_aje_status CHECK ([status] IN (N'draft', N'posted', N'voided'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_aje_tenant_date' AND object_id = OBJECT_ID('accounting_journal_entries'))
  CREATE INDEX IX_aje_tenant_date ON accounting_journal_entries(tenant_id, entry_date DESC);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_journal_lines')
CREATE TABLE accounting_journal_lines (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  journal_entry_id UNIQUEIDENTIFIER NOT NULL REFERENCES accounting_journal_entries(id) ON DELETE CASCADE,
  account_type_id UNIQUEIDENTIFIER NOT NULL REFERENCES accounting_account_types(id) ON DELETE NO ACTION,
  line_description NVARCHAR(500) NULL,
  debit DECIMAL(18, 2) NOT NULL DEFAULT 0,
  credit DECIMAL(18, 2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ajl_journal' AND object_id = OBJECT_ID('accounting_journal_lines'))
  CREATE INDEX IX_ajl_journal ON accounting_journal_lines(journal_entry_id);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_journal_counter')
CREATE TABLE accounting_journal_counter (
  tenant_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_number INT NOT NULL DEFAULT 0
);
GO

IF COL_LENGTH('expense_entries', 'journal_entry_id') IS NULL
  ALTER TABLE expense_entries ADD journal_entry_id UNIQUEIDENTIFIER NULL;
GO

IF COL_LENGTH('expense_entries', 'debit_account_id') IS NULL
  ALTER TABLE expense_entries ADD debit_account_id UNIQUEIDENTIFIER NULL;
GO

IF COL_LENGTH('expense_entries', 'credit_account_id') IS NULL
  ALTER TABLE expense_entries ADD credit_account_id UNIQUEIDENTIFIER NULL;
GO

IF COL_LENGTH('expense_categories', 'account_type_id') IS NULL
  ALTER TABLE expense_categories ADD account_type_id UNIQUEIDENTIFIER NULL;
GO

IF COL_LENGTH('accounting_invoices', 'accrual_journal_entry_id') IS NULL
  ALTER TABLE accounting_invoices ADD accrual_journal_entry_id UNIQUEIDENTIFIER NULL;
GO

IF COL_LENGTH('accounting_invoices', 'payment_journal_entry_id') IS NULL
  ALTER TABLE accounting_invoices ADD payment_journal_entry_id UNIQUEIDENTIFIER NULL;
GO
