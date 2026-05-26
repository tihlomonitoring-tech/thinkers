-- Expense management: categories, journal entries, attachments, budget item requests.

-- 1) Expense categories (classification system)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'expense_categories')
CREATE TABLE expense_categories (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name NVARCHAR(255) NOT NULL,
  parent_id UNIQUEIDENTIFIER NULL,
  code NVARCHAR(50) NULL,
  description NVARCHAR(500) NULL,
  category_type NVARCHAR(30) NOT NULL DEFAULT N'expense',
  is_active BIT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_ec_type CHECK (category_type IN (N'expense', N'income', N'overhead', N'capital', N'operational', N'payroll', N'travel', N'utilities', N'maintenance', N'other'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ec_tenant' AND object_id = OBJECT_ID('expense_categories'))
  CREATE INDEX IX_ec_tenant ON expense_categories(tenant_id, is_active, sort_order);
GO

-- 2) Expense entries (the journal)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'expense_entries')
CREATE TABLE expense_entries (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_number NVARCHAR(30) NULL,
  entry_date DATE NOT NULL,
  category_id UNIQUEIDENTIFIER NULL,
  department_name NVARCHAR(255) NULL,
  budget_id UNIQUEIDENTIFIER NULL,
  budget_category_id UNIQUEIDENTIFIER NULL,
  budget_line_item_id UNIQUEIDENTIFIER NULL,
  is_budgeted BIT NOT NULL DEFAULT 0,
  entry_type NVARCHAR(20) NOT NULL DEFAULT N'expense',
  description NVARCHAR(500) NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_amount AS (amount + tax_amount) PERSISTED,
  currency NVARCHAR(10) NOT NULL DEFAULT N'ZAR',
  payment_method NVARCHAR(30) NULL,
  reference_number NVARCHAR(100) NULL,
  vendor_supplier NVARCHAR(255) NULL,
  receipt_number NVARCHAR(100) NULL,
  [status] NVARCHAR(20) NOT NULL DEFAULT N'draft',
  approved_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  approved_at DATETIME2 NULL,
  rejection_reason NVARCHAR(500) NULL,
  notes NVARCHAR(MAX) NULL,
  tags NVARCHAR(500) NULL,
  is_recurring BIT NOT NULL DEFAULT 0,
  recurring_frequency NVARCHAR(20) NULL,
  recorded_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_ee_type CHECK (entry_type IN (N'expense', N'income', N'refund', N'adjustment', N'reimbursement')),
  CONSTRAINT CK_ee_status CHECK ([status] IN (N'draft', N'pending', N'approved', N'rejected', N'paid', N'voided')),
  CONSTRAINT CK_ee_payment CHECK (payment_method IS NULL OR payment_method IN (N'cash', N'card', N'eft', N'cheque', N'petty_cash', N'company_card', N'reimbursement', N'other')),
  CONSTRAINT CK_ee_recurring CHECK (recurring_frequency IS NULL OR recurring_frequency IN (N'weekly', N'bi_weekly', N'monthly', N'quarterly', N'annually'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ee_tenant_date' AND object_id = OBJECT_ID('expense_entries'))
  CREATE INDEX IX_ee_tenant_date ON expense_entries(tenant_id, entry_date DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ee_budget' AND object_id = OBJECT_ID('expense_entries'))
  CREATE INDEX IX_ee_budget ON expense_entries(budget_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ee_category' AND object_id = OBJECT_ID('expense_entries'))
  CREATE INDEX IX_ee_category ON expense_entries(category_id);
GO

-- 3) Expense attachments (receipts, invoices, etc.)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'expense_attachments')
CREATE TABLE expense_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  expense_id UNIQUEIDENTIFIER NOT NULL REFERENCES expense_entries(id) ON DELETE CASCADE,
  file_name NVARCHAR(500) NOT NULL,
  file_path NVARCHAR(1000) NOT NULL,
  file_size INT NULL,
  mime_type NVARCHAR(100) NULL,
  uploaded_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- 4) Budget item requests (department users requesting budget items)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'budget_item_requests')
CREATE TABLE budget_item_requests (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  budget_id UNIQUEIDENTIFIER NULL,
  department_name NVARCHAR(255) NOT NULL,
  item_name NVARCHAR(500) NOT NULL,
  description NVARCHAR(MAX) NULL,
  estimated_cost DECIMAL(18,2) NOT NULL DEFAULT 0,
  quantity INT NOT NULL DEFAULT 1,
  total_cost AS (estimated_cost * quantity) PERSISTED,
  priority NVARCHAR(20) NOT NULL DEFAULT N'medium',
  category_id UNIQUEIDENTIFIER NULL,
  justification NVARCHAR(MAX) NULL,
  [status] NVARCHAR(20) NOT NULL DEFAULT N'pending',
  approved_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  approved_at DATETIME2 NULL,
  rejection_reason NVARCHAR(500) NULL,
  requested_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_bir_priority CHECK (priority IN (N'low', N'medium', N'high', N'critical')),
  CONSTRAINT CK_bir_status CHECK ([status] IN (N'pending', N'approved', N'rejected', N'deferred', N'purchased'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bir_tenant_dept' AND object_id = OBJECT_ID('budget_item_requests'))
  CREATE INDEX IX_bir_tenant_dept ON budget_item_requests(tenant_id, department_name, [status]);
GO

-- 5) Auto-generate entry numbers
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'expense_entry_counter')
CREATE TABLE expense_entry_counter (
  tenant_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_number INT NOT NULL DEFAULT 0
);
GO
