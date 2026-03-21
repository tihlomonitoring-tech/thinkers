-- Scheduled list distribution (Access Management → Pilot distribution)
-- Run: node scripts/run-pilot-list-distribution.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'pilot_list_distribution')
CREATE TABLE pilot_list_distribution (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  name NVARCHAR(200) NULL,
  route_id NVARCHAR(64) NOT NULL,
  contractor_ids NVARCHAR(MAX) NOT NULL,
  recipient_emails NVARCHAR(MAX) NOT NULL,
  cc_emails NVARCHAR(MAX) NULL,
  list_type NVARCHAR(20) NOT NULL,
  attach_format NVARCHAR(20) NOT NULL,
  fleet_columns_json NVARCHAR(MAX) NULL,
  driver_columns_json NVARCHAR(MAX) NULL,
  frequency NVARCHAR(20) NOT NULL,
  time_hhmm CHAR(5) NOT NULL CONSTRAINT DF_pilot_time DEFAULT '09:00',
  weekday TINYINT NULL,
  is_active BIT NOT NULL CONSTRAINT DF_pilot_active DEFAULT 1,
  last_run_at DATETIME2 NULL,
  last_run_status NVARCHAR(80) NULL,
  last_run_detail NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_pilot_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_pilot_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_pilot_freq CHECK (frequency IN (N'hourly', N'daily', N'weekly')),
  CONSTRAINT CK_pilot_list CHECK (list_type IN (N'fleet', N'driver', N'both')),
  CONSTRAINT CK_pilot_fmt CHECK (attach_format IN (N'excel', N'pdf', N'csv')),
  CONSTRAINT FK_pilot_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pilot_list_dist_tenant' AND object_id = OBJECT_ID('pilot_list_distribution'))
  CREATE INDEX IX_pilot_list_dist_tenant ON pilot_list_distribution(tenant_id, is_active);
GO
