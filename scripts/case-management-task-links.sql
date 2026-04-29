-- Links between case management cases and tasks (many-to-many). Run: npm run db:case-management-task-links

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'case_management_task_links')
CREATE TABLE case_management_task_links (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE NO ACTION,
  case_id UNIQUEIDENTIFIER NOT NULL REFERENCES case_management_cases(id) ON DELETE CASCADE,
  task_id UNIQUEIDENTIFIER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  link_note NVARCHAR(500) NULL,
  linked_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_case_management_task_links_case_task UNIQUE (case_id, task_id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_case_mgmt_task_links_case' AND object_id = OBJECT_ID('case_management_task_links'))
  CREATE INDEX IX_case_mgmt_task_links_case ON case_management_task_links(case_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_case_mgmt_task_links_task' AND object_id = OBJECT_ID('case_management_task_links'))
  CREATE INDEX IX_case_mgmt_task_links_task ON case_management_task_links(task_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_case_mgmt_task_links_tenant' AND object_id = OBJECT_ID('case_management_task_links'))
  CREATE INDEX IX_case_mgmt_task_links_tenant ON case_management_task_links(tenant_id);
GO
