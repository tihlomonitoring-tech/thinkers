-- Add task visibility scope + migrate legacy Mbuyelo tasks to Thinkers Afrika.

IF COL_LENGTH(N'dbo.tasks', N'visibility_scope') IS NULL
BEGIN
  ALTER TABLE dbo.tasks ADD visibility_scope NVARCHAR(40) NULL;
END
GO

IF COL_LENGTH(N'dbo.tasks', N'visibility_scope') IS NOT NULL
BEGIN
  UPDATE dbo.tasks SET visibility_scope = N'tenant' WHERE visibility_scope IS NULL OR LTRIM(RTRIM(visibility_scope)) = N'';
END
GO

IF EXISTS (
  SELECT 1
  FROM sys.columns c
  WHERE c.object_id = OBJECT_ID(N'dbo.tasks')
    AND c.name = N'visibility_scope'
    AND c.is_nullable = 1
)
BEGIN
  ALTER TABLE dbo.tasks ALTER COLUMN visibility_scope NVARCHAR(40) NOT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID(N'dbo.tasks')
    AND name = N'CK_tasks_visibility_scope'
)
BEGIN
  ALTER TABLE dbo.tasks
    ADD CONSTRAINT CK_tasks_visibility_scope
    CHECK (visibility_scope IN (N'tenant', N'private_assignees'));
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_tasks_tenant_visibility' AND object_id = OBJECT_ID(N'dbo.tasks'))
BEGIN
  CREATE INDEX IX_tasks_tenant_visibility ON dbo.tasks(tenant_id, visibility_scope);
END
GO

DECLARE @ThinkersTenant UNIQUEIDENTIFIER = (
  SELECT TOP 1 id
  FROM tenants
  WHERE LOWER(LTRIM(RTRIM(name))) IN (N'thinkers afrika', N'thinkers_afrika', N'thinkersafrika', N'thinkers africa', N'thinkers_africa', N'thinkersafrica')
  ORDER BY created_at ASC
);

DECLARE @MbuyeloTenant UNIQUEIDENTIFIER = (
  SELECT TOP 1 id
  FROM tenants
  WHERE LOWER(LTRIM(RTRIM(name))) = N'mbuyelo energy'
  ORDER BY created_at ASC
);

IF @ThinkersTenant IS NOT NULL AND @MbuyeloTenant IS NOT NULL AND @ThinkersTenant <> @MbuyeloTenant
BEGIN
  -- Move all currently existing Mbuyelo tasks to Thinkers Afrika.
  UPDATE dbo.tasks
  SET tenant_id = @ThinkersTenant
  WHERE tenant_id = @MbuyeloTenant;
END
GO
