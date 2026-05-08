-- Fleet & driver compliance expansion: contractor/route on inspection,
-- per-inspection communication logs and non-compliance entries, grace periods.
-- Run: npm run db:cc-compliance-expand

-- 1) Extra columns on cc_compliance_inspections
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('cc_compliance_inspections') AND name = 'contractor_id')
  ALTER TABLE cc_compliance_inspections ADD contractor_id UNIQUEIDENTIFIER NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('cc_compliance_inspections') AND name = 'contractor_name_snapshot')
  ALTER TABLE cc_compliance_inspections ADD contractor_name_snapshot NVARCHAR(300) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('cc_compliance_inspections') AND name = 'route_id')
  ALTER TABLE cc_compliance_inspections ADD route_id UNIQUEIDENTIFIER NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('cc_compliance_inspections') AND name = 'route_name')
  ALTER TABLE cc_compliance_inspections ADD route_name NVARCHAR(300) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('cc_compliance_inspections') AND name = 'grace_period_granted_at')
  ALTER TABLE cc_compliance_inspections ADD grace_period_granted_at DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('cc_compliance_inspections') AND name = 'grace_period_days')
  ALTER TABLE cc_compliance_inspections ADD grace_period_days INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('cc_compliance_inspections') AND name = 'grace_period_expires_at')
  ALTER TABLE cc_compliance_inspections ADD grace_period_expires_at DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('cc_compliance_inspections') AND name = 'grace_period_reason')
  ALTER TABLE cc_compliance_inspections ADD grace_period_reason NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('cc_compliance_inspections') AND name = 'grace_period_resolved_at')
  ALTER TABLE cc_compliance_inspections ADD grace_period_resolved_at DATETIME2 NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('cc_compliance_inspections') AND name = 'shift_started_at')
  ALTER TABLE cc_compliance_inspections ADD shift_started_at DATETIME2 NULL;
GO

-- 2) Compliance communication logs (per inspection)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'cc_compliance_comm_logs')
CREATE TABLE cc_compliance_comm_logs (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  inspection_id UNIQUEIDENTIFIER NOT NULL,
  controller_user_id UNIQUEIDENTIFIER NULL,
  controller_name NVARCHAR(300) NULL,
  shift_started_at DATETIME2 NULL,
  log_time NVARCHAR(20) NULL,
  recipient NVARCHAR(300) NULL,
  subject NVARCHAR(500) NULL,
  method NVARCHAR(80) NULL,
  action_required NVARCHAR(MAX) NULL,
  notes NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_cc_comm_log_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_cc_comm_log_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_cc_comm_log_inspection FOREIGN KEY (inspection_id) REFERENCES cc_compliance_inspections(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_comm_log_inspection' AND object_id = OBJECT_ID('cc_compliance_comm_logs'))
  CREATE INDEX IX_cc_comm_log_inspection ON cc_compliance_comm_logs(inspection_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_comm_log_tenant_time' AND object_id = OBJECT_ID('cc_compliance_comm_logs'))
  CREATE INDEX IX_cc_comm_log_tenant_time ON cc_compliance_comm_logs(tenant_id, created_at);
GO

-- 3) Non-compliance entries (per inspection)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'cc_compliance_non_compliance')
CREATE TABLE cc_compliance_non_compliance (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  inspection_id UNIQUEIDENTIFIER NOT NULL,
  controller_user_id UNIQUEIDENTIFIER NULL,
  controller_name NVARCHAR(300) NULL,
  shift_started_at DATETIME2 NULL,
  driver_name NVARCHAR(300) NULL,
  truck_reg NVARCHAR(120) NULL,
  rule_violated NVARCHAR(300) NULL,
  time_of_call NVARCHAR(20) NULL,
  summary NVARCHAR(MAX) NULL,
  driver_response NVARCHAR(MAX) NULL,
  severity NVARCHAR(40) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_cc_noncomp_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_cc_noncomp_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_cc_noncomp_inspection FOREIGN KEY (inspection_id) REFERENCES cc_compliance_inspections(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_noncomp_inspection' AND object_id = OBJECT_ID('cc_compliance_non_compliance'))
  CREATE INDEX IX_cc_noncomp_inspection ON cc_compliance_non_compliance(inspection_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_noncomp_tenant_time' AND object_id = OBJECT_ID('cc_compliance_non_compliance'))
  CREATE INDEX IX_cc_noncomp_tenant_time ON cc_compliance_non_compliance(tenant_id, created_at);
GO
