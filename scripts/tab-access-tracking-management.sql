-- Allow tracking_management in tab_access_grants.page_key (Tracking management tabs).
IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_tag_page_key' AND parent_object_id = OBJECT_ID(N'dbo.tab_access_grants')
)
  ALTER TABLE dbo.tab_access_grants DROP CONSTRAINT CK_tag_page_key;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_tag_page_key' AND parent_object_id = OBJECT_ID(N'dbo.tab_access_grants')
)
  ALTER TABLE dbo.tab_access_grants ADD CONSTRAINT CK_tag_page_key CHECK (page_key IN (
    N'accounting', N'management', N'contractor', N'tracking_management'
  ));
GO
