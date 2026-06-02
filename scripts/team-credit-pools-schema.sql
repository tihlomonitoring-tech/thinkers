-- Team point pools (management → team) and team leader issuance wallets.
-- Run: npm run db:team-credit-pools

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'team_point_pools')
CREATE TABLE team_point_pools (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  team_key NVARCHAR(200) NOT NULL,
  grace_points_balance INT NOT NULL DEFAULT 0,
  sanction_points_balance INT NOT NULL DEFAULT 0,
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_team_point_pools UNIQUE (tenant_id, team_key)
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'team_leader_credit_wallets')
CREATE TABLE team_leader_credit_wallets (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  leader_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  available_credits INT NOT NULL DEFAULT 0,
  last_weekly_grant_week NVARCHAR(12) NULL,
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_team_leader_wallet UNIQUE (tenant_id, leader_user_id)
);
GO

IF COL_LENGTH('employee_grace_credits', 'team_key') IS NULL
  ALTER TABLE employee_grace_credits ADD team_key NVARCHAR(200) NULL;
GO

IF COL_LENGTH('employee_debtor_sanctions', 'team_key') IS NULL
  ALTER TABLE employee_debtor_sanctions ADD team_key NVARCHAR(200) NULL;
GO

IF COL_LENGTH('employee_credit_applications', 'assigned_leader_id') IS NULL
  ALTER TABLE employee_credit_applications ADD assigned_leader_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_credit_applications_assigned_leader')
  ALTER TABLE employee_credit_applications ADD CONSTRAINT FK_credit_applications_assigned_leader
    FOREIGN KEY (assigned_leader_id) REFERENCES users(id) ON DELETE NO ACTION;
GO
