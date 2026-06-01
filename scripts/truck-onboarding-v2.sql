-- Multiple maps, dual ticks per action, attachments per task.
-- Run via: npm run db:truck-onboarding

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboarding_tasks')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_onboarding_tasks') AND name = 'contractor_completed')
    ALTER TABLE truck_onboarding_tasks ADD contractor_completed BIT NOT NULL
      CONSTRAINT DF_truck_onb_task_contractor_done DEFAULT 0;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_onboarding_tasks') AND name = 'admin_completed')
    ALTER TABLE truck_onboarding_tasks ADD admin_completed BIT NOT NULL
      CONSTRAINT DF_truck_onb_task_admin_done DEFAULT 0;
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboarding_tasks')
  AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_onboarding_tasks') AND name = 'is_completed')
BEGIN
  UPDATE truck_onboarding_tasks SET contractor_completed = 1, admin_completed = 1
    WHERE is_completed = 1 AND assignee = N'both';
  UPDATE truck_onboarding_tasks SET contractor_completed = 1
    WHERE is_completed = 1 AND assignee = N'contractor';
  UPDATE truck_onboarding_tasks SET admin_completed = 1
    WHERE is_completed = 1 AND assignee = N'admin';
END
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboarding_attachments')
  AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_onboarding_attachments') AND name = 'task_id')
  ALTER TABLE truck_onboarding_attachments ADD task_id UNIQUEIDENTIFIER NULL;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onboardings_truck' AND object_id = OBJECT_ID('truck_onboardings'))
  DROP INDEX IX_truck_onboardings_truck ON truck_onboardings;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onb_truck_tpl' AND object_id = OBJECT_ID('truck_onboardings'))
  DROP INDEX IX_truck_onb_truck_tpl ON truck_onboardings;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onboardings_driver' AND object_id = OBJECT_ID('truck_onboardings'))
  DROP INDEX IX_truck_onboardings_driver ON truck_onboardings;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onb_driver_tpl' AND object_id = OBJECT_ID('truck_onboardings'))
  DROP INDEX IX_truck_onb_driver_tpl ON truck_onboardings;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboardings')
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onb_truck_tpl' AND object_id = OBJECT_ID('truck_onboardings'))
  CREATE UNIQUE INDEX IX_truck_onb_truck_tpl ON truck_onboardings(tenant_id, truck_id, template_id)
    WHERE truck_id IS NOT NULL AND template_id IS NOT NULL AND status <> N'cancelled';
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboardings')
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onb_driver_tpl' AND object_id = OBJECT_ID('truck_onboardings'))
  CREATE UNIQUE INDEX IX_truck_onb_driver_tpl ON truck_onboardings(tenant_id, driver_id, template_id)
    WHERE driver_id IS NOT NULL AND template_id IS NOT NULL AND status <> N'cancelled';
GO
