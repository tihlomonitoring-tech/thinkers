-- Organisational structure: departments, positions, assignments, attachments.
-- Run: npm run db:org-structure
-- SQL Server: avoid multiple CASCADE paths from tenants (use NO ACTION on cross-table FKs).

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'org_departments')
CREATE TABLE org_departments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_department_id UNIQUEIDENTIFIER NULL,
  name NVARCHAR(200) NOT NULL,
  code NVARCHAR(50) NULL,
  description NVARCHAR(MAX) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'org_departments')
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_org_departments_parent')
    ALTER TABLE org_departments ADD CONSTRAINT FK_org_departments_parent
      FOREIGN KEY (parent_department_id) REFERENCES org_departments(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_org_departments_tenant' AND object_id = OBJECT_ID('org_departments'))
  CREATE INDEX IX_org_departments_tenant ON org_departments(tenant_id, sort_order);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'org_positions')
CREATE TABLE org_positions (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id UNIQUEIDENTIFIER NULL,
  title NVARCHAR(300) NOT NULL,
  description NVARCHAR(MAX) NULL,
  responsibilities NVARCHAR(MAX) NULL,
  grade_level NVARCHAR(80) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BIT NOT NULL DEFAULT 1,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'org_positions')
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_org_positions_department')
    ALTER TABLE org_positions ADD CONSTRAINT FK_org_positions_department
      FOREIGN KEY (department_id) REFERENCES org_departments(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_org_positions_tenant' AND object_id = OBJECT_ID('org_positions'))
  CREATE INDEX IX_org_positions_tenant ON org_positions(tenant_id, is_active, sort_order);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'org_assignments')
CREATE TABLE org_assignments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE NO ACTION,
  user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  position_id UNIQUEIDENTIFIER NOT NULL REFERENCES org_positions(id) ON DELETE CASCADE,
  manager_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  escalation_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  effective_from DATE NULL,
  effective_to DATE NULL,
  is_primary BIT NOT NULL DEFAULT 1,
  notes NVARCHAR(MAX) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'org_assignments')
  AND COL_LENGTH('org_assignments', 'sort_order') IS NULL
  ALTER TABLE org_assignments ADD sort_order INT NOT NULL CONSTRAINT DF_org_assignments_sort_order DEFAULT (0);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_org_assignments_tenant_user' AND object_id = OBJECT_ID('org_assignments'))
  CREATE INDEX IX_org_assignments_tenant_user ON org_assignments(tenant_id, user_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_org_assignments_position' AND object_id = OBJECT_ID('org_assignments'))
  CREATE INDEX IX_org_assignments_position ON org_assignments(position_id);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'org_position_attachments')
CREATE TABLE org_position_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE NO ACTION,
  position_id UNIQUEIDENTIFIER NOT NULL REFERENCES org_positions(id) ON DELETE CASCADE,
  file_name NVARCHAR(500) NOT NULL,
  file_path NVARCHAR(1000) NOT NULL,
  mime_type NVARCHAR(120) NULL,
  uploaded_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
