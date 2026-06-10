-- External driver inspections (public portal) — extends truck_inspections
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'source')
  ALTER TABLE truck_inspections ADD source NVARCHAR(30) NOT NULL CONSTRAINT DF_ti_source DEFAULT N'internal';
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'driver_id')
  ALTER TABLE truck_inspections ADD driver_id UNIQUEIDENTIFIER NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'trailer_1_registration')
  ALTER TABLE truck_inspections ADD trailer_1_registration NVARCHAR(100) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'trailer_2_registration')
  ALTER TABLE truck_inspections ADD trailer_2_registration NVARCHAR(100) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'contractor_id')
  ALTER TABLE truck_inspections ADD contractor_id UNIQUEIDENTIFIER NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'inspection_datetime')
  ALTER TABLE truck_inspections ADD inspection_datetime DATETIME2 NULL;
GO
-- Allow external submissions without a logged-in user
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'created_by_user_id')
BEGIN
  ALTER TABLE truck_inspections ALTER COLUMN created_by_user_id UNIQUEIDENTIFIER NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ti_source_date' AND object_id = OBJECT_ID('truck_inspections'))
  CREATE INDEX IX_ti_source_date ON truck_inspections(tenant_id, source, inspection_date DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ti_contractor' AND object_id = OBJECT_ID('truck_inspections'))
  CREATE INDEX IX_ti_contractor ON truck_inspections(contractor_id);
GO
