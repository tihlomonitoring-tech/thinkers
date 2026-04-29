-- Case management schema

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'case_management_cases')
CREATE TABLE case_management_cases (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_number NVARCHAR(50) NOT NULL,
  title NVARCHAR(500) NOT NULL,
  [description] NVARCHAR(MAX) NULL,
  category NVARCHAR(40) NOT NULL DEFAULT N'departmental',
  [status] NVARCHAR(40) NOT NULL DEFAULT N'open',
  opened_source NVARCHAR(20) NOT NULL DEFAULT N'internal',
  opened_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  external_name NVARCHAR(200) NULL,
  external_email NVARCHAR(320) NULL,
  lead_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  final_remarks NVARCHAR(MAX) NULL,
  finalised_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  finalised_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_case_management_case_number UNIQUE (case_number),
  CONSTRAINT CK_case_management_category CHECK (category IN (N'departmental', N'external')),
  CONSTRAINT CK_case_management_status CHECK ([status] IN (N'open', N'pending_internal', N'in_progress', N'completed', N'closed')),
  CONSTRAINT CK_case_management_opened_source CHECK (opened_source IN (N'internal', N'external'))
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'case_management_stages')
CREATE TABLE case_management_stages (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  case_id UNIQUEIDENTIFIER NOT NULL REFERENCES case_management_cases(id) ON DELETE CASCADE,
  stage_order INT NOT NULL,
  title NVARCHAR(300) NOT NULL,
  instructions NVARCHAR(MAX) NULL,
  assigned_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  [status] NVARCHAR(30) NOT NULL DEFAULT N'pending',
  completed_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  completed_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_case_stage_status CHECK ([status] IN (N'pending', N'in_progress', N'completed'))
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'case_management_stage_updates')
CREATE TABLE case_management_stage_updates (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  case_id UNIQUEIDENTIFIER NOT NULL REFERENCES case_management_cases(id) ON DELETE CASCADE,
  stage_id UNIQUEIDENTIFIER NOT NULL REFERENCES case_management_stages(id) ON DELETE NO ACTION,
  actor_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  actor_type NVARCHAR(20) NOT NULL DEFAULT N'internal',
  actor_name NVARCHAR(200) NULL,
  [status] NVARCHAR(30) NOT NULL DEFAULT N'in_progress',
  comment NVARCHAR(MAX) NULL,
  notify_external BIT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_case_update_actor_type CHECK (actor_type IN (N'internal', N'external')),
  CONSTRAINT CK_case_update_status CHECK ([status] IN (N'pending', N'in_progress', N'completed'))
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'case_management_stage_update_attachments')
CREATE TABLE case_management_stage_update_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  case_id UNIQUEIDENTIFIER NOT NULL REFERENCES case_management_cases(id) ON DELETE CASCADE,
  update_id UNIQUEIDENTIFIER NOT NULL REFERENCES case_management_stage_updates(id) ON DELETE NO ACTION,
  file_name NVARCHAR(500) NOT NULL,
  file_path NVARCHAR(1000) NOT NULL,
  uploaded_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'case_management_alerts')
CREATE TABLE case_management_alerts (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id UNIQUEIDENTIFIER NULL REFERENCES case_management_cases(id) ON DELETE NO ACTION,
  target_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  target_external_email NVARCHAR(320) NULL,
  alert_type NVARCHAR(60) NOT NULL,
  title NVARCHAR(300) NOT NULL,
  message NVARCHAR(MAX) NULL,
  is_read BIT NOT NULL DEFAULT 0,
  read_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_case_management_cases_tenant_created' AND object_id = OBJECT_ID('case_management_cases'))
  CREATE INDEX IX_case_management_cases_tenant_created ON case_management_cases(tenant_id, created_at DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_case_management_stages_case' AND object_id = OBJECT_ID('case_management_stages'))
  CREATE INDEX IX_case_management_stages_case ON case_management_stages(case_id, stage_order);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_case_management_updates_case' AND object_id = OBJECT_ID('case_management_stage_updates'))
  CREATE INDEX IX_case_management_updates_case ON case_management_stage_updates(case_id, created_at DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_case_management_alerts_tenant' AND object_id = OBJECT_ID('case_management_alerts'))
  CREATE INDEX IX_case_management_alerts_tenant ON case_management_alerts(tenant_id, created_at DESC);
GO
