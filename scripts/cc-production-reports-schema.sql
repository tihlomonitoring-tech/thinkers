-- AI production reports (Command Centre Report Generation tab)
-- Run: npm run db:cc-production-reports

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cc_production_reports')
CREATE TABLE cc_production_reports (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NULL,
  created_by_user_id UNIQUEIDENTIFIER NOT NULL,
  title NVARCHAR(500) NOT NULL,
  route_id UNIQUEIDENTIFIER NULL,
  route_name NVARCHAR(255) NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  prepared_by NVARCHAR(255) NULL,
  submitted_date DATE NULL,
  status NVARCHAR(50) NOT NULL DEFAULT N'draft',
  content_json NVARCHAR(MAX) NULL,
  data_bundle_json NVARCHAR(MAX) NULL,
  ai_model NVARCHAR(100) NULL,
  generated_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_cc_pr_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cc_production_report_attachments')
CREATE TABLE cc_production_report_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  report_id UNIQUEIDENTIFIER NOT NULL,
  slot_key NVARCHAR(100) NOT NULL,
  label NVARCHAR(255) NULL,
  file_name NVARCHAR(500) NOT NULL,
  stored_path NVARCHAR(1000) NOT NULL,
  mime_type NVARCHAR(100) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_cc_pra_report FOREIGN KEY (report_id) REFERENCES cc_production_reports(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_production_reports_tenant_created' AND object_id = OBJECT_ID('cc_production_reports'))
CREATE INDEX IX_cc_production_reports_tenant_created ON cc_production_reports (tenant_id, created_at DESC);
GO
