-- Rebuild CK_user_page_roles_page_id to match app PAGE_IDS (see src/routes/users.js export PAGE_IDS).
-- Run when inserts fail: "conflicted with CHECK constraint CK_user_page_roles_page_id".
-- Safe to re-run: drops then recreates the check.

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_user_page_roles_page_id'
    AND parent_object_id = OBJECT_ID(N'dbo.user_page_roles')
)
  ALTER TABLE dbo.user_page_roles DROP CONSTRAINT CK_user_page_roles_page_id;
GO

ALTER TABLE dbo.user_page_roles ADD CONSTRAINT CK_user_page_roles_page_id CHECK (page_id IN (
  N'profile',
  N'management',
  N'users',
  N'tenants',
  N'contractor',
  N'command_centre',
  N'access_management',
  N'rector',
  N'tasks',
  N'case_management',
  N'transport_operations',
  N'recruitment',
  N'letters',
  N'accounting_management',
  N'tracking_integration',
  N'fuel_supply_management',
  N'fuel_customer_orders',
  N'team_leader_admin',
  N'performance_evaluations',
  N'auditor',
  N'company_library',
  N'fuel_data'
));
