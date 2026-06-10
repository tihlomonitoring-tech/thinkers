-- Inspector & supervisor signatures on truck inspections
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'inspector_signature_path')
  ALTER TABLE truck_inspections ADD inspector_signature_path NVARCHAR(500) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'inspector_signed_at')
  ALTER TABLE truck_inspections ADD inspector_signed_at DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'supervisor_signature_path')
  ALTER TABLE truck_inspections ADD supervisor_signature_path NVARCHAR(500) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'supervisor_signed_at')
  ALTER TABLE truck_inspections ADD supervisor_signed_at DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'supervisor_name')
  ALTER TABLE truck_inspections ADD supervisor_name NVARCHAR(255) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'supervisor_role')
  ALTER TABLE truck_inspections ADD supervisor_role NVARCHAR(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('truck_inspections') AND name = 'supervisor_user_id')
  ALTER TABLE truck_inspections ADD supervisor_user_id UNIQUEIDENTIFIER NULL;
GO
