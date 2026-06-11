-- Rebuild CK_user_page_roles_page_id to match app PAGE_IDS.
-- Prefer: npm run db:user-page-roles-check-sync
-- (The Node runner builds the IN list from src/routes/users.js so it stays in sync.)

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_user_page_roles_page_id'
    AND parent_object_id = OBJECT_ID(N'dbo.user_page_roles')
)
  ALTER TABLE dbo.user_page_roles DROP CONSTRAINT CK_user_page_roles_page_id;
GO

-- Run npm run db:user-page-roles-check-sync to add the constraint with the current PAGE_IDS list.
