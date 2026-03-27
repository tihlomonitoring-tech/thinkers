-- Add 'tracking_integration' to allowed page_id in user_page_roles.
-- Run: node scripts/run-add-tracking-integration-page-role.js

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_user_page_roles_page_id' AND parent_object_id = OBJECT_ID('user_page_roles'))
  ALTER TABLE user_page_roles DROP CONSTRAINT CK_user_page_roles_page_id;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_user_page_roles_page_id' AND parent_object_id = OBJECT_ID('user_page_roles'))
  ALTER TABLE user_page_roles ADD CONSTRAINT CK_user_page_roles_page_id CHECK (page_id IN (
    N'profile', N'management', N'users', N'tenants', N'contractor', N'command_centre', N'access_management', N'rector', N'tasks', N'transport_operations', N'recruitment', N'letters', N'accounting_management', N'tracking_integration'
  ));
GO
