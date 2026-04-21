-- Tasks module: tasks, assignments, attachments. Run with: node scripts/run-tasks-schema.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tasks')
CREATE TABLE tasks (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title NVARCHAR(500) NOT NULL,
  [description] NVARCHAR(MAX) NULL,
  key_actions NVARCHAR(MAX) NULL,
  start_date DATE NULL,
  due_date DATE NULL,
  progress INT NOT NULL DEFAULT 0,
  [status] NVARCHAR(50) NOT NULL DEFAULT N'not_started',
  category NVARCHAR(40) NOT NULL DEFAULT N'departmental',
  progress_legend NVARCHAR(40) NOT NULL DEFAULT N'not_started',
  task_leader_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  task_reviewer_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  completed_at DATETIME2 NULL,
  completed_by UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_tasks_progress CHECK (progress >= 0 AND progress <= 100),
  CONSTRAINT CK_tasks_status CHECK ([status] IN (N'not_started', N'in_progress', N'completed', N'cancelled')),
  CONSTRAINT CK_tasks_category CHECK (category IN (N'sales', N'departmental', N'thinkers_afrika')),
  CONSTRAINT CK_tasks_progress_legend CHECK (progress_legend IN (N'not_started', N'early', N'active', N'on_hold', N'proposal', N'near_complete', N'finalised'))
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'task_assignments')
CREATE TABLE task_assignments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  task_id UNIQUEIDENTIFIER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  assigned_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  assigned_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  transferred_from_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT UQ_task_assignments_task_user UNIQUE (task_id, user_id)
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'task_attachments')
CREATE TABLE task_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  task_id UNIQUEIDENTIFIER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_name NVARCHAR(500) NOT NULL,
  file_path NVARCHAR(1000) NOT NULL,
  uploaded_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_tenant_id' AND object_id = OBJECT_ID('tasks'))
  CREATE INDEX IX_tasks_tenant_id ON tasks(tenant_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_created_by' AND object_id = OBJECT_ID('tasks'))
  CREATE INDEX IX_tasks_created_by ON tasks(created_by);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_status' AND object_id = OBJECT_ID('tasks'))
  CREATE INDEX IX_tasks_status ON tasks([status]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tasks_due_date' AND object_id = OBJECT_ID('tasks'))
  CREATE INDEX IX_tasks_due_date ON tasks(due_date);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_task_assignments_task_id' AND object_id = OBJECT_ID('task_assignments'))
  CREATE INDEX IX_task_assignments_task_id ON task_assignments(task_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_task_assignments_user_id' AND object_id = OBJECT_ID('task_assignments'))
  CREATE INDEX IX_task_assignments_user_id ON task_assignments(user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_task_attachments_task_id' AND object_id = OBJECT_ID('task_attachments'))
  CREATE INDEX IX_task_attachments_task_id ON task_attachments(task_id);
GO
