-- Task leader and reviewer (optional FKs to users). Run: npm run db:tasks-leader-reviewer

IF COL_LENGTH(N'dbo.tasks', N'task_leader_id') IS NULL
  ALTER TABLE dbo.tasks ADD task_leader_id UNIQUEIDENTIFIER NULL
    CONSTRAINT FK_tasks_task_leader FOREIGN KEY (task_leader_id) REFERENCES dbo.users(id) ON DELETE NO ACTION;

IF COL_LENGTH(N'dbo.tasks', N'task_reviewer_id') IS NULL
  ALTER TABLE dbo.tasks ADD task_reviewer_id UNIQUEIDENTIFIER NULL
    CONSTRAINT FK_tasks_task_reviewer FOREIGN KEY (task_reviewer_id) REFERENCES dbo.users(id) ON DELETE NO ACTION;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_tasks_task_leader_id' AND object_id = OBJECT_ID(N'dbo.tasks'))
  CREATE INDEX IX_tasks_task_leader_id ON dbo.tasks(tenant_id, task_leader_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_tasks_task_reviewer_id' AND object_id = OBJECT_ID(N'dbo.tasks'))
  CREATE INDEX IX_tasks_task_reviewer_id ON dbo.tasks(tenant_id, task_reviewer_id);
