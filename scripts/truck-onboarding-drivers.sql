-- Extend truck onboarding for drivers (same template + progress tables).

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboardings')
  AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_onboardings') AND name = 'entity_type')
  ALTER TABLE truck_onboardings ADD entity_type NVARCHAR(20) NOT NULL
    CONSTRAINT DF_truck_onb_entity_type DEFAULT N'truck';
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboardings')
  AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_onboardings') AND name = 'driver_id')
  ALTER TABLE truck_onboardings ADD driver_id UNIQUEIDENTIFIER NULL;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onboardings_truck' AND object_id = OBJECT_ID('truck_onboardings'))
  DROP INDEX IX_truck_onboardings_truck ON truck_onboardings;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboardings')
  AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_onboardings') AND name = 'truck_id')
  ALTER TABLE truck_onboardings ALTER COLUMN truck_id UNIQUEIDENTIFIER NULL;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboardings')
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onboardings_truck' AND object_id = OBJECT_ID('truck_onboardings'))
  CREATE UNIQUE INDEX IX_truck_onboardings_truck ON truck_onboardings(tenant_id, truck_id) WHERE truck_id IS NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onboardings_truck' AND object_id = OBJECT_ID('truck_onboardings'))
  DROP INDEX IX_truck_onboardings_truck ON truck_onboardings;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboardings')
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onboardings_truck' AND object_id = OBJECT_ID('truck_onboardings'))
  CREATE UNIQUE INDEX IX_truck_onboardings_truck ON truck_onboardings(tenant_id, truck_id) WHERE truck_id IS NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboardings')
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_truck_onboardings_driver' AND object_id = OBJECT_ID('truck_onboardings'))
  CREATE UNIQUE INDEX IX_truck_onboardings_driver ON truck_onboardings(tenant_id, driver_id) WHERE driver_id IS NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'truck_onboardings')
  AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_truck_onb_entity')
  ALTER TABLE truck_onboardings ADD CONSTRAINT CK_truck_onb_entity CHECK (
    (entity_type = N'truck' AND truck_id IS NOT NULL AND driver_id IS NULL) OR
    (entity_type = N'driver' AND driver_id IS NOT NULL AND truck_id IS NULL)
  );
GO
