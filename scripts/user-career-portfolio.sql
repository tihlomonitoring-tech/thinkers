-- Personal career plan, milestones, CV uploads (per user, per tenant).
-- Run: node scripts/run-user-career-portfolio.js

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_personal_career_plan')
CREATE TABLE user_personal_career_plan (
  user_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  goals_json NVARCHAR(MAX) NULL,
  objectives_json NVARCHAR(MAX) NULL,
  professional_summary NVARCHAR(MAX) NULL,
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (user_id, tenant_id),
  CONSTRAINT FK_upcp_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT FK_upcp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_career_milestones')
CREATE TABLE user_career_milestones (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  user_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  title NVARCHAR(500) NOT NULL,
  description NVARCHAR(MAX) NULL,
  milestone_date DATE NULL,
  status NVARCHAR(40) NOT NULL DEFAULT N'planned',
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_ucm_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT FK_ucm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ucm_user_tenant' AND object_id = OBJECT_ID('user_career_milestones'))
  CREATE INDEX IX_ucm_user_tenant ON user_career_milestones(user_id, tenant_id, display_order);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_cv_uploads')
CREATE TABLE user_cv_uploads (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  user_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  file_name NVARCHAR(500) NOT NULL,
  file_path NVARCHAR(1000) NOT NULL,
  content_type NVARCHAR(200) NULL,
  uploaded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_ucv_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT FK_ucv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ucv_user_tenant' AND object_id = OBJECT_ID('user_cv_uploads'))
  CREATE INDEX IX_ucv_user_tenant ON user_cv_uploads(user_id, tenant_id, uploaded_at DESC);
GO
