-- Task categories: sales, departmental, thinkers_afrika. Run: npm run db:tasks-category

IF COL_LENGTH(N'dbo.tasks', N'category') IS NULL
BEGIN
  ALTER TABLE dbo.tasks ADD category NVARCHAR(40) NULL;
END
GO

IF COL_LENGTH(N'dbo.tasks', N'category') IS NOT NULL
BEGIN
  UPDATE dbo.tasks SET category = N'departmental' WHERE category IS NULL;
END
GO

IF EXISTS (
  SELECT 1
  FROM sys.columns c
  INNER JOIN sys.tables t ON t.object_id = c.object_id
  WHERE t.object_id = OBJECT_ID(N'dbo.tasks')
    AND c.name = N'category'
    AND c.is_nullable = 1
)
BEGIN
  ALTER TABLE dbo.tasks ALTER COLUMN category NVARCHAR(40) NOT NULL;
END
GO

IF COL_LENGTH(N'dbo.tasks', N'category') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.tasks') AND name = N'CK_tasks_category')
BEGIN
  ALTER TABLE dbo.tasks ADD CONSTRAINT CK_tasks_category CHECK (category IN (N'sales', N'departmental', N'thinkers_afrika'));
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_tasks_category' AND object_id = OBJECT_ID(N'dbo.tasks'))
BEGIN
  CREATE INDEX IX_tasks_category ON dbo.tasks(tenant_id, category);
END
