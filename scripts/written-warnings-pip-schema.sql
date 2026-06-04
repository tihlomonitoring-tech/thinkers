-- Written warnings (policy-linked), signatures, PIP objectives & weekly reports.
-- Run: npm run db:written-warnings-pip

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'written_warning_ref_counter')
CREATE TABLE written_warning_ref_counter (
  tenant_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_number INT NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'written_warning_types')
CREATE TABLE written_warning_types (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code NVARCHAR(50) NOT NULL,
  title NVARCHAR(200) NOT NULL,
  body_template NVARCHAR(MAX) NULL,
  sort_order INT NOT NULL DEFAULT 100,
  is_active BIT NOT NULL DEFAULT 1,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_written_warning_types_tenant_code UNIQUE (tenant_id, code)
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'written_warnings')
CREATE TABLE written_warnings (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  warning_type_id UNIQUEIDENTIFIER NULL REFERENCES written_warning_types(id) ON DELETE NO ACTION,
  company_policy_id UNIQUEIDENTIFIER NOT NULL,
  reference_number NVARCHAR(50) NOT NULL,
  title NVARCHAR(300) NOT NULL,
  incident_summary NVARCHAR(MAX) NULL,
  corrective_action NVARCHAR(MAX) NULL,
  status NVARCHAR(20) NOT NULL DEFAULT N'draft',
  published_at DATETIME2 NULL,
  published_by UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  pip_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_written_warnings_status CHECK (status IN (N'draft', N'published', N'signed', N'void'))
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'written_warning_signatures')
CREATE TABLE written_warning_signatures (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  written_warning_id UNIQUEIDENTIFIER NOT NULL REFERENCES written_warnings(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  signature_data NVARCHAR(MAX) NOT NULL,
  signer_name NVARCHAR(200) NOT NULL,
  signed_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_written_warning_signatures_warning UNIQUE (written_warning_id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('performance_improvement_plans') AND name = 'written_warning_id')
  ALTER TABLE performance_improvement_plans ADD written_warning_id UNIQUEIDENTIFIER NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('performance_improvement_plans') AND name = 'approaches')
  ALTER TABLE performance_improvement_plans ADD approaches NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('performance_improvement_plans') AND name = 'interventions')
  ALTER TABLE performance_improvement_plans ADD interventions NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('performance_improvement_plans') AND name = 'employee_signed_at')
  ALTER TABLE performance_improvement_plans ADD employee_signed_at DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('performance_improvement_plans') AND name = 'management_signed_at')
  ALTER TABLE performance_improvement_plans ADD management_signed_at DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('performance_improvement_plans') AND name = 'management_signed_by')
  ALTER TABLE performance_improvement_plans ADD management_signed_by UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('performance_improvement_plans') AND name = 'closed_at')
  ALTER TABLE performance_improvement_plans ADD closed_at DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('performance_improvement_plans') AND name = 'closed_by')
  ALTER TABLE performance_improvement_plans ADD closed_by UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('performance_improvement_plans') AND name = 'management_signature_data')
  ALTER TABLE performance_improvement_plans ADD management_signature_data NVARCHAR(MAX) NULL;
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'pip_weekly_objectives')
CREATE TABLE pip_weekly_objectives (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  pip_id UNIQUEIDENTIFIER NOT NULL REFERENCES performance_improvement_plans(id) ON DELETE CASCADE,
  week_number INT NOT NULL,
  week_start_date DATE NULL,
  title NVARCHAR(300) NOT NULL,
  description NVARCHAR(MAX) NULL,
  target_outcome NVARCHAR(MAX) NULL,
  status NVARCHAR(30) NOT NULL DEFAULT N'pending',
  sort_order INT NOT NULL DEFAULT 0,
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_pip_objective_status CHECK (status IN (N'pending', N'in_progress', N'achieved', N'not_achieved'))
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'pip_weekly_reports')
CREATE TABLE pip_weekly_reports (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  pip_id UNIQUEIDENTIFIER NOT NULL REFERENCES performance_improvement_plans(id) ON DELETE CASCADE,
  objective_id UNIQUEIDENTIFIER NULL REFERENCES pip_weekly_objectives(id) ON DELETE NO ACTION,
  week_number INT NOT NULL,
  employee_response NVARCHAR(MAX) NULL,
  progress_summary NVARCHAR(MAX) NULL,
  manager_notes NVARCHAR(MAX) NULL,
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_written_warnings_user' AND object_id = OBJECT_ID('written_warnings'))
  CREATE INDEX IX_written_warnings_user ON written_warnings(user_id, status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_written_warnings_tenant' AND object_id = OBJECT_ID('written_warnings'))
  CREATE INDEX IX_written_warnings_tenant ON written_warnings(tenant_id, created_at DESC);
GO
