-- Truck / contractor onboarding (template map + per-truck progress).
-- Run: npm run db:truck-onboarding

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboarding_templates')
CREATE TABLE truck_onboarding_templates (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  name NVARCHAR(300) NOT NULL DEFAULT N'Truck onboarding',
  description NVARCHAR(MAX) NULL,
  is_active BIT NOT NULL DEFAULT 1,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onb_tpl_tenant' AND object_id = OBJECT_ID('truck_onboarding_templates'))
  CREATE INDEX IX_truck_onb_tpl_tenant ON truck_onboarding_templates(tenant_id, is_active);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboarding_template_stages')
CREATE TABLE truck_onboarding_template_stages (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  template_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  title NVARCHAR(300) NOT NULL,
  description NVARCHAR(MAX) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_truck_onb_tpl_stage_tpl FOREIGN KEY (template_id) REFERENCES truck_onboarding_templates(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onb_tpl_stage' AND object_id = OBJECT_ID('truck_onboarding_template_stages'))
  CREATE INDEX IX_truck_onb_tpl_stage ON truck_onboarding_template_stages(template_id, sort_order);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboarding_template_tasks')
CREATE TABLE truck_onboarding_template_tasks (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  stage_id UNIQUEIDENTIFIER NOT NULL,
  template_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  title NVARCHAR(500) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  assignee NVARCHAR(20) NOT NULL DEFAULT N'admin',
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_truck_onb_tpl_task_assignee CHECK (assignee IN (N'admin', N'contractor', N'both')),
  CONSTRAINT FK_truck_onb_tpl_task_stage FOREIGN KEY (stage_id) REFERENCES truck_onboarding_template_stages(id) ON DELETE CASCADE,
  CONSTRAINT FK_truck_onb_tpl_task_tpl FOREIGN KEY (template_id) REFERENCES truck_onboarding_templates(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboardings')
CREATE TABLE truck_onboardings (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  truck_id UNIQUEIDENTIFIER NOT NULL,
  contractor_id UNIQUEIDENTIFIER NULL,
  template_id UNIQUEIDENTIFIER NULL,
  status NVARCHAR(30) NOT NULL DEFAULT N'in_progress',
  current_stage_id UNIQUEIDENTIFIER NULL,
  progress_report_draft NVARCHAR(MAX) NULL,
  started_by_user_id UNIQUEIDENTIFIER NULL,
  completed_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_truck_onb_status CHECK (status IN (N'not_started', N'in_progress', N'completed', N'cancelled')),
  CONSTRAINT FK_truck_onb_tpl FOREIGN KEY (template_id) REFERENCES truck_onboarding_templates(id) ON DELETE SET NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onboardings_truck' AND object_id = OBJECT_ID('truck_onboardings'))
  CREATE UNIQUE INDEX IX_truck_onboardings_truck ON truck_onboardings(tenant_id, truck_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboarding_stages')
CREATE TABLE truck_onboarding_stages (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  onboarding_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  title NVARCHAR(300) NOT NULL,
  description NVARCHAR(MAX) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  stage_status NVARCHAR(30) NOT NULL DEFAULT N'locked',
  completed_at DATETIME2 NULL,
  completed_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_truck_onb_stage_status CHECK (stage_status IN (N'locked', N'in_progress', N'completed')),
  CONSTRAINT FK_truck_onb_stage_ob FOREIGN KEY (onboarding_id) REFERENCES truck_onboardings(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onb_stages_ob' AND object_id = OBJECT_ID('truck_onboarding_stages'))
  CREATE INDEX IX_truck_onb_stages_ob ON truck_onboarding_stages(onboarding_id, sort_order);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboarding_tasks')
CREATE TABLE truck_onboarding_tasks (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  onboarding_id UNIQUEIDENTIFIER NOT NULL,
  stage_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  title NVARCHAR(500) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  assignee NVARCHAR(20) NOT NULL DEFAULT N'admin',
  is_completed BIT NOT NULL DEFAULT 0,
  completed_at DATETIME2 NULL,
  completed_by_user_id UNIQUEIDENTIFIER NULL,
  admin_note NVARCHAR(MAX) NULL,
  contractor_note NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_truck_onb_task_assignee CHECK (assignee IN (N'admin', N'contractor', N'both')),
  CONSTRAINT FK_truck_onb_task_stage FOREIGN KEY (stage_id) REFERENCES truck_onboarding_stages(id) ON DELETE CASCADE,
  CONSTRAINT FK_truck_onb_task_ob FOREIGN KEY (onboarding_id) REFERENCES truck_onboardings(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboarding_attachments')
CREATE TABLE truck_onboarding_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  onboarding_id UNIQUEIDENTIFIER NOT NULL,
  stage_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  original_name NVARCHAR(500) NOT NULL,
  stored_path NVARCHAR(1000) NOT NULL,
  mime_type NVARCHAR(120) NULL,
  uploaded_by_user_id UNIQUEIDENTIFIER NULL,
  uploader_role NVARCHAR(20) NOT NULL DEFAULT N'admin',
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_truck_onb_att_role CHECK (uploader_role IN (N'admin', N'contractor')),
  CONSTRAINT FK_truck_onb_att_ob FOREIGN KEY (onboarding_id) REFERENCES truck_onboardings(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboarding_messages')
CREATE TABLE truck_onboarding_messages (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  onboarding_id UNIQUEIDENTIFIER NOT NULL,
  stage_id UNIQUEIDENTIFIER NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  body NVARCHAR(MAX) NOT NULL,
  author_user_id UNIQUEIDENTIFIER NOT NULL,
  author_role NVARCHAR(20) NOT NULL DEFAULT N'admin',
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_truck_onb_msg_role CHECK (author_role IN (N'admin', N'contractor')),
  CONSTRAINT FK_truck_onb_msg_ob FOREIGN KEY (onboarding_id) REFERENCES truck_onboardings(id) ON DELETE CASCADE
);
GO
