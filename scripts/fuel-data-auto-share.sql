-- Fuel Data Auto Share — schedules for emailing month-to-date transaction sheets (PDF + Excel).
-- Run: npm run db:fuel-data-auto-share

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'fuel_data_auto_share_schedules')
CREATE TABLE fuel_data_auto_share_schedules (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  name NVARCHAR(200) NOT NULL,
  recipient_emails NVARCHAR(MAX) NOT NULL,
  cc_emails NVARCHAR(MAX) NULL,
  supplier_id UNIQUEIDENTIFIER NULL,
  customer_id UNIQUEIDENTIFIER NULL,
  status_filter NVARCHAR(40) NOT NULL CONSTRAINT DF_fdas_status DEFAULT N'verified',
  columns_json NVARCHAR(MAX) NULL,
  attach_pdf BIT NOT NULL CONSTRAINT DF_fdas_attach_pdf DEFAULT 1,
  attach_excel BIT NOT NULL CONSTRAINT DF_fdas_attach_excel DEFAULT 1,
  every_n_days INT NOT NULL CONSTRAINT DF_fdas_every_n DEFAULT 2,
  time_hhmm CHAR(5) NOT NULL CONSTRAINT DF_fdas_time DEFAULT '08:00',
  start_date DATE NULL,
  is_active BIT NOT NULL CONSTRAINT DF_fdas_active DEFAULT 1,
  subject NVARCHAR(300) NULL,
  intro_message NVARCHAR(MAX) NULL,
  last_run_at DATETIME2 NULL,
  last_run_status NVARCHAR(80) NULL,
  last_run_detail NVARCHAR(MAX) NULL,
  next_run_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_fdas_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_fdas_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_fdas_every_n CHECK (every_n_days BETWEEN 1 AND 30),
  CONSTRAINT CK_fdas_status CHECK (status_filter IN (N'verified', N'pending', N'all')),
  CONSTRAINT FK_fdas_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fdas_tenant' AND object_id = OBJECT_ID('fuel_data_auto_share_schedules'))
  CREATE INDEX IX_fdas_tenant ON fuel_data_auto_share_schedules(tenant_id, is_active);
GO
