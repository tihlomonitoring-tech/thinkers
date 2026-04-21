-- Task progress legend (visual stage). Run: npm run db:task-progress-legend
-- Batches are separated by GO on its own line (SQL Server compiles each step after the column exists).

IF COL_LENGTH(N'dbo.tasks', N'progress_legend') IS NULL
BEGIN
  ALTER TABLE dbo.tasks ADD progress_legend NVARCHAR(40) NULL;
END
GO

IF COL_LENGTH(N'dbo.tasks', N'progress_legend') IS NOT NULL
BEGIN
  UPDATE dbo.tasks SET progress_legend = N'not_started' WHERE progress_legend IS NULL;
END
GO

IF EXISTS (
  SELECT 1
  FROM sys.columns c
  INNER JOIN sys.tables t ON t.object_id = c.object_id
  WHERE t.object_id = OBJECT_ID(N'dbo.tasks')
    AND c.name = N'progress_legend'
    AND c.is_nullable = 1
)
BEGIN
  ALTER TABLE dbo.tasks ALTER COLUMN progress_legend NVARCHAR(40) NOT NULL;
END
GO

IF COL_LENGTH(N'dbo.tasks', N'progress_legend') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.tasks') AND name = N'DF_tasks_progress_legend')
BEGIN
  ALTER TABLE dbo.tasks ADD CONSTRAINT DF_tasks_progress_legend DEFAULT N'not_started' FOR progress_legend;
END
GO

IF COL_LENGTH(N'dbo.tasks', N'progress_legend') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.tasks') AND name = N'CK_tasks_progress_legend')
BEGIN
  ALTER TABLE dbo.tasks ADD CONSTRAINT CK_tasks_progress_legend CHECK (progress_legend IN (
    N'not_started', N'early', N'active', N'on_hold', N'proposal', N'near_complete', N'finalised'
  ));
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_tasks_progress_legend' AND object_id = OBJECT_ID(N'dbo.tasks'))
BEGIN
  CREATE INDEX IX_tasks_progress_legend ON dbo.tasks(tenant_id, progress_legend);
END
