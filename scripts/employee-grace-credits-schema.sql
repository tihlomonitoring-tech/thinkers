-- Grace credits, debtor sanctions (demerits), categories, and credit applications.
-- Run: npm run db:employee-grace-credits

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_credit_demerit_categories')
CREATE TABLE employee_credit_demerit_categories (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind NVARCHAR(20) NOT NULL CHECK (kind IN (N'credit', N'demerit')),
  name NVARCHAR(200) NOT NULL,
  description NVARCHAR(MAX) NULL,
  default_points INT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BIT NOT NULL DEFAULT 1,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_grace_credits')
CREATE TABLE employee_grace_credits (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  category_id UNIQUEIDENTIFIER NULL,
  points INT NOT NULL DEFAULT 1,
  justification NVARCHAR(MAX) NOT NULL,
  productivity_score_total DECIMAL(10, 2) NULL,
  source NVARCHAR(50) NOT NULL DEFAULT N'management_manual',
  credit_application_id UNIQUEIDENTIFIER NULL,
  issued_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_debtor_sanctions')
CREATE TABLE employee_debtor_sanctions (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  category_id UNIQUEIDENTIFIER NULL,
  points INT NOT NULL DEFAULT 1,
  justification NVARCHAR(MAX) NOT NULL,
  productivity_score_total DECIMAL(10, 2) NULL,
  source NVARCHAR(50) NOT NULL DEFAULT N'management_manual',
  issued_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_credit_applications')
CREATE TABLE employee_credit_applications (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  category_id UNIQUEIDENTIFIER NULL,
  requested_points INT NOT NULL DEFAULT 1,
  justification NVARCHAR(MAX) NOT NULL,
  status NVARCHAR(20) NOT NULL DEFAULT N'pending' CHECK (status IN (N'pending', N'approved', N'rejected')),
  reviewed_by UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  review_notes NVARCHAR(MAX) NULL,
  reviewed_at DATETIME2 NULL,
  grace_credit_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_grace_credits_category')
  ALTER TABLE employee_grace_credits ADD CONSTRAINT FK_grace_credits_category
    FOREIGN KEY (category_id) REFERENCES employee_credit_demerit_categories(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_debtor_sanctions_category')
  ALTER TABLE employee_debtor_sanctions ADD CONSTRAINT FK_debtor_sanctions_category
    FOREIGN KEY (category_id) REFERENCES employee_credit_demerit_categories(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_credit_applications_category')
  ALTER TABLE employee_credit_applications ADD CONSTRAINT FK_credit_applications_category
    FOREIGN KEY (category_id) REFERENCES employee_credit_demerit_categories(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_grace_credits_credit_application')
  ALTER TABLE employee_grace_credits ADD CONSTRAINT FK_grace_credits_credit_application
    FOREIGN KEY (credit_application_id) REFERENCES employee_credit_applications(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_credit_applications_grace_credit')
  ALTER TABLE employee_credit_applications ADD CONSTRAINT FK_credit_applications_grace_credit
    FOREIGN KEY (grace_credit_id) REFERENCES employee_grace_credits(id) ON DELETE NO ACTION;
GO
