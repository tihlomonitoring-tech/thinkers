-- Department budget tables.

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'department_budgets')
CREATE TABLE department_budgets (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_name NVARCHAR(255) NOT NULL,
  fiscal_year INT NOT NULL,
  fiscal_period NVARCHAR(20) NOT NULL DEFAULT N'annual',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_budget DECIMAL(18,2) NOT NULL DEFAULT 0,
  currency NVARCHAR(10) NOT NULL DEFAULT N'ZAR',
  [status] NVARCHAR(20) NOT NULL DEFAULT N'draft',
  notes NVARCHAR(MAX) NULL,
  approved_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  approved_at DATETIME2 NULL,
  created_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_db_status CHECK ([status] IN (N'draft', N'pending', N'approved', N'active', N'closed', N'cancelled')),
  CONSTRAINT CK_db_period CHECK (fiscal_period IN (N'annual', N'quarterly', N'monthly')),
  CONSTRAINT UQ_db_tenant_dept_year UNIQUE (tenant_id, department_name, fiscal_year, fiscal_period, period_start)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_db_tenant_year' AND object_id = OBJECT_ID('department_budgets'))
  CREATE INDEX IX_db_tenant_year ON department_budgets(tenant_id, fiscal_year DESC);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'budget_categories')
CREATE TABLE budget_categories (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  budget_id UNIQUEIDENTIFIER NOT NULL REFERENCES department_budgets(id) ON DELETE CASCADE,
  category_name NVARCHAR(255) NOT NULL,
  allocated_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  notes NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bc_budget' AND object_id = OBJECT_ID('budget_categories'))
  CREATE INDEX IX_bc_budget ON budget_categories(budget_id);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'budget_line_items')
CREATE TABLE budget_line_items (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  budget_id UNIQUEIDENTIFIER NOT NULL REFERENCES department_budgets(id) ON DELETE CASCADE,
  category_id UNIQUEIDENTIFIER NULL REFERENCES budget_categories(id) ON DELETE NO ACTION,
  description NVARCHAR(500) NOT NULL,
  estimated_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  actual_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  variance AS (estimated_amount - actual_amount) PERSISTED,
  vendor NVARCHAR(255) NULL,
  [month] INT NULL,
  quarter INT NULL,
  notes NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bli_budget_cat' AND object_id = OBJECT_ID('budget_line_items'))
  CREATE INDEX IX_bli_budget_cat ON budget_line_items(budget_id, category_id);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'budget_transactions')
CREATE TABLE budget_transactions (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  budget_id UNIQUEIDENTIFIER NOT NULL REFERENCES department_budgets(id) ON DELETE CASCADE,
  category_id UNIQUEIDENTIFIER NULL REFERENCES budget_categories(id) ON DELETE NO ACTION,
  line_item_id UNIQUEIDENTIFIER NULL REFERENCES budget_line_items(id) ON DELETE NO ACTION,
  transaction_date DATE NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  transaction_type NVARCHAR(20) NOT NULL DEFAULT N'expense',
  reference NVARCHAR(255) NULL,
  description NVARCHAR(500) NULL,
  recorded_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_bt_type CHECK (transaction_type IN (N'expense', N'income', N'adjustment', N'transfer'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bt_budget_date' AND object_id = OBJECT_ID('budget_transactions'))
  CREATE INDEX IX_bt_budget_date ON budget_transactions(budget_id, transaction_date DESC);
GO
