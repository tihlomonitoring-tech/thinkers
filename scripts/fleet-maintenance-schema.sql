-- Fleet maintenance scheduling and history. Run: npm run db:fleet-maintenance
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'fleet_maintenance_schedules')
CREATE TABLE fleet_maintenance_schedules (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  truck_id UNIQUEIDENTIFIER NULL,
  fleet_registration NVARCHAR(100) NULL,
  trailer_registration NVARCHAR(100) NULL,
  schedule_type NVARCHAR(50) NOT NULL DEFAULT N'preventive',
  maintenance_subject NVARCHAR(50) NOT NULL DEFAULT N'truck',
  linked_truck_id UNIQUEIDENTIFIER NULL,
  description NVARCHAR(MAX) NULL,
  driver_name NVARCHAR(255) NULL,
  driver_id UNIQUEIDENTIFIER NULL,
  responsible_mechanic NVARCHAR(255) NULL,
  responsible_company NVARCHAR(255) NULL,
  action_date DATE NULL,
  scope_of_work NVARCHAR(MAX) NULL,
  due_date DATE NOT NULL,
  odometer_reading DECIMAL(12,1) NULL,
  estimated_cost DECIMAL(12,2) NULL,
  actual_cost DECIMAL(12,2) NULL,
  priority NVARCHAR(20) NOT NULL DEFAULT N'medium',
  [status] NVARCHAR(50) NOT NULL DEFAULT N'scheduled',
  completed_at DATETIME2 NULL,
  completed_by_user_id UNIQUEIDENTIFIER NULL,
  completion_notes NVARCHAR(MAX) NULL,
  linked_inspection_id UNIQUEIDENTIFIER NULL,
  created_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fms_tenant_status' AND object_id = OBJECT_ID('fleet_maintenance_schedules'))
  CREATE INDEX IX_fms_tenant_status ON fleet_maintenance_schedules(tenant_id, [status]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fms_due_date' AND object_id = OBJECT_ID('fleet_maintenance_schedules'))
  CREATE INDEX IX_fms_due_date ON fleet_maintenance_schedules(due_date);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fms_truck' AND object_id = OBJECT_ID('fleet_maintenance_schedules'))
  CREATE INDEX IX_fms_truck ON fleet_maintenance_schedules(truck_id);
GO
