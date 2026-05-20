-- Employee onboarding / onboardment plans, phases, attachments, journal entries.
-- Run: npm run db:employee-onboardment

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_onboarding_plans')
CREATE TABLE employee_onboarding_plans (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  user_id UNIQUEIDENTIFIER NOT NULL,
  title NVARCHAR(300) NOT NULL,
  plan_notes NVARCHAR(MAX) NULL,
  status NVARCHAR(30) NOT NULL DEFAULT N'active',
  current_phase_id UNIQUEIDENTIFIER NULL,
  start_date DATE NULL,
  created_by_user_id UNIQUEIDENTIFIER NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_onboarding_plan_status CHECK (status IN (N'active', N'completed', N'cancelled')),
  CONSTRAINT FK_onboarding_plan_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE NO ACTION,
  CONSTRAINT FK_onboarding_plan_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT FK_onboarding_plan_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_plans_tenant_user' AND object_id = OBJECT_ID('employee_onboarding_plans'))
  CREATE INDEX IX_onboarding_plans_tenant_user ON employee_onboarding_plans(tenant_id, user_id, created_at DESC);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_onboarding_phases')
CREATE TABLE employee_onboarding_phases (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  plan_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  title NVARCHAR(300) NOT NULL,
  description NVARCHAR(MAX) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  phase_status NVARCHAR(30) NOT NULL DEFAULT N'pending',
  completed_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_onboarding_phase_status CHECK (phase_status IN (N'pending', N'in_progress', N'completed', N'locked')),
  CONSTRAINT FK_onboarding_phase_plan FOREIGN KEY (plan_id) REFERENCES employee_onboarding_plans(id) ON DELETE CASCADE,
  CONSTRAINT FK_onboarding_phase_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_phases_plan' AND object_id = OBJECT_ID('employee_onboarding_phases'))
  CREATE INDEX IX_onboarding_phases_plan ON employee_onboarding_phases(plan_id, sort_order);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_onboarding_phase_attachments')
CREATE TABLE employee_onboarding_phase_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  phase_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  original_name NVARCHAR(500) NOT NULL,
  stored_path NVARCHAR(1000) NOT NULL,
  mime_type NVARCHAR(120) NULL,
  uploaded_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_onboarding_att_phase FOREIGN KEY (phase_id) REFERENCES employee_onboarding_phases(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_onboarding_journal_entries')
CREATE TABLE employee_onboarding_journal_entries (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  plan_id UNIQUEIDENTIFIER NOT NULL,
  phase_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  user_id UNIQUEIDENTIFIER NOT NULL,
  entry_status NVARCHAR(20) NOT NULL DEFAULT N'draft',
  body NVARCHAR(MAX) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  published_at DATETIME2 NULL,
  CONSTRAINT CK_onboarding_journal_status CHECK (entry_status IN (N'draft', N'published')),
  CONSTRAINT FK_onboarding_journal_plan FOREIGN KEY (plan_id) REFERENCES employee_onboarding_plans(id) ON DELETE CASCADE,
  CONSTRAINT FK_onboarding_journal_phase FOREIGN KEY (phase_id) REFERENCES employee_onboarding_phases(id) ON DELETE NO ACTION,
  CONSTRAINT FK_onboarding_journal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_journal_phase' AND object_id = OBJECT_ID('employee_onboarding_journal_entries'))
  CREATE INDEX IX_onboarding_journal_phase ON employee_onboarding_journal_entries(phase_id, created_at DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_onboarding_journal_plan' AND object_id = OBJECT_ID('employee_onboarding_journal_entries'))
  CREATE INDEX IX_onboarding_journal_plan ON employee_onboarding_journal_entries(plan_id, user_id, created_at DESC);
GO
