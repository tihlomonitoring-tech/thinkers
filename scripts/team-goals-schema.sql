-- Department strategy, shift/team objectives, team leader questionnaires, management ratings.
-- Run: node scripts/run-team-goals-schema.js

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'tenant_department_strategy')
CREATE TABLE tenant_department_strategy (
  tenant_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  vision NVARCHAR(MAX) NULL,
  mission NVARCHAR(MAX) NULL,
  goals_json NVARCHAR(MAX) NULL,
  objectives_json NVARCHAR(MAX) NULL,
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_by UNIQUEIDENTIFIER NULL REFERENCES users(id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'shift_team_objectives')
CREATE TABLE shift_team_objectives (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope NVARCHAR(20) NOT NULL,
  title NVARCHAR(500) NOT NULL,
  description NVARCHAR(MAX) NULL,
  metric_name NVARCHAR(200) NULL,
  target_value DECIMAL(18,4) NULL,
  current_value DECIMAL(18,4) NULL,
  unit NVARCHAR(50) NULL,
  status NVARCHAR(30) NOT NULL DEFAULT N'active',
  work_date DATE NULL,
  shift_type NVARCHAR(20) NULL,
  team_name NVARCHAR(200) NULL,
  leader_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id),
  member_user_ids NVARCHAR(MAX) NULL,
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_shift_team_objectives_tenant' AND object_id = OBJECT_ID('shift_team_objectives'))
  CREATE INDEX IX_shift_team_objectives_tenant ON shift_team_objectives(tenant_id, status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'team_leader_assignments')
CREATE TABLE team_leader_assignments (
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NO ACTION on user_id: SQL Server disallows CASCADE here (multiple cascade paths from tenants via tenant_id vs users).
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  appointed_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  appointed_by UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  PRIMARY KEY (tenant_id, user_id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'team_leader_questionnaires')
CREATE TABLE team_leader_questionnaires (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  leader_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
  work_date DATE NOT NULL,
  team_morale NVARCHAR(20) NOT NULL,
  delivery_on_track NVARCHAR(10) NOT NULL,
  top_blocker NVARCHAR(MAX) NULL,
  team_went_well NVARCHAR(MAX) NULL,
  individual_checks_json NVARCHAR(MAX) NULL,
  team_summary NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_tlq_leader_date' AND object_id = OBJECT_ID('team_leader_questionnaires'))
  CREATE UNIQUE INDEX UQ_tlq_leader_date ON team_leader_questionnaires(leader_user_id, work_date);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'management_team_ratings')
CREATE TABLE management_team_ratings (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  manager_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
  member_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
  work_date DATE NOT NULL,
  period NVARCHAR(20) NOT NULL,
  rating TINYINT NOT NULL,
  narrative NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_mtr_rating CHECK (rating >= 1 AND rating <= 5)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_mtr_tenant_member_date' AND object_id = OBJECT_ID('management_team_ratings'))
  CREATE INDEX IX_mtr_tenant_member_date ON management_team_ratings(tenant_id, member_user_id, work_date);
GO
