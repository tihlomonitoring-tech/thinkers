-- Office Admin maintenance: expanded fields, attachments, tab grants migration
-- Run: npm run db:office-admin-maintenance-expand

IF COL_LENGTH('office_admin_maintenance_reports', 'location') IS NULL
  ALTER TABLE office_admin_maintenance_reports ADD location NVARCHAR(200) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_reports', 'fault_category') IS NULL
  ALTER TABLE office_admin_maintenance_reports ADD fault_category NVARCHAR(80) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_reports', 'reporter_contact') IS NULL
  ALTER TABLE office_admin_maintenance_reports ADD reporter_contact NVARCHAR(120) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_reports', 'preferred_visit_date') IS NULL
  ALTER TABLE office_admin_maintenance_reports ADD preferred_visit_date DATE NULL;
GO
IF COL_LENGTH('office_admin_maintenance_reports', 'safety_risk') IS NULL
  ALTER TABLE office_admin_maintenance_reports ADD safety_risk BIT NOT NULL CONSTRAINT DF_oa_maint_rep_safety DEFAULT 0;
GO
IF COL_LENGTH('office_admin_maintenance_reports', 'external_reference') IS NULL
  ALTER TABLE office_admin_maintenance_reports ADD external_reference NVARCHAR(120) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_reports', 'assigned_to') IS NULL
  ALTER TABLE office_admin_maintenance_reports ADD assigned_to NVARCHAR(255) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_reports', 'work_order_number') IS NULL
  ALTER TABLE office_admin_maintenance_reports ADD work_order_number NVARCHAR(80) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_reports', 'provider_type') IS NULL
  ALTER TABLE office_admin_maintenance_reports ADD provider_type NVARCHAR(30) NULL;
GO

IF COL_LENGTH('office_admin_maintenance_records', 'title') IS NULL
  ALTER TABLE office_admin_maintenance_records ADD title NVARCHAR(300) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_records', 'provider_type') IS NULL
  ALTER TABLE office_admin_maintenance_records ADD provider_type NVARCHAR(30) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_records', 'vendor_name') IS NULL
  ALTER TABLE office_admin_maintenance_records ADD vendor_name NVARCHAR(255) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_records', 'vendor_contact') IS NULL
  ALTER TABLE office_admin_maintenance_records ADD vendor_contact NVARCHAR(120) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_records', 'vendor_phone') IS NULL
  ALTER TABLE office_admin_maintenance_records ADD vendor_phone NVARCHAR(60) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_records', 'labor_hours') IS NULL
  ALTER TABLE office_admin_maintenance_records ADD labor_hours DECIMAL(8, 2) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_records', 'parts_used') IS NULL
  ALTER TABLE office_admin_maintenance_records ADD parts_used NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_records', 'invoice_reference') IS NULL
  ALTER TABLE office_admin_maintenance_records ADD invoice_reference NVARCHAR(120) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_records', 'work_order_number') IS NULL
  ALTER TABLE office_admin_maintenance_records ADD work_order_number NVARCHAR(80) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_records', 'asset_location_snapshot') IS NULL
  ALTER TABLE office_admin_maintenance_records ADD asset_location_snapshot NVARCHAR(200) NULL;
GO
IF COL_LENGTH('office_admin_maintenance_records', 'updated_at') IS NULL
  ALTER TABLE office_admin_maintenance_records ADD updated_at DATETIME2 NOT NULL CONSTRAINT DF_oa_maint_rec_upd DEFAULT SYSUTCDATETIME();
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'office_admin_maintenance_report_attachments')
CREATE TABLE office_admin_maintenance_report_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id UNIQUEIDENTIFIER NOT NULL REFERENCES office_admin_maintenance_reports(id) ON DELETE NO ACTION,
  original_name NVARCHAR(500) NOT NULL,
  stored_path NVARCHAR(1000) NOT NULL,
  mime_type NVARCHAR(120) NULL,
  file_kind NVARCHAR(20) NOT NULL DEFAULT N'document',
  caption NVARCHAR(500) NULL,
  uploaded_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'office_admin_maintenance_record_attachments')
CREATE TABLE office_admin_maintenance_record_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  record_id UNIQUEIDENTIFIER NOT NULL REFERENCES office_admin_maintenance_records(id) ON DELETE NO ACTION,
  original_name NVARCHAR(500) NOT NULL,
  stored_path NVARCHAR(1000) NOT NULL,
  mime_type NVARCHAR(120) NULL,
  file_kind NVARCHAR(20) NOT NULL DEFAULT N'document',
  caption NVARCHAR(500) NULL,
  uploaded_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- Migrate legacy single "maintenance" tab grant to the four maintenance tabs
DECLARE @new_tabs TABLE (tab_id NVARCHAR(80));
INSERT INTO @new_tabs VALUES
  (N'maintenance_reports'),
  (N'maintenance_history'),
  (N'maintenance_report_broken'),
  (N'maintenance_record');

INSERT INTO office_admin_grants (user_id, tab_id, granted_by_user_id)
SELECT g.user_id, t.tab_id, g.granted_by_user_id
FROM office_admin_grants g
CROSS JOIN @new_tabs t
WHERE g.tab_id = N'maintenance'
  AND NOT EXISTS (
    SELECT 1 FROM office_admin_grants x
    WHERE x.user_id = g.user_id AND x.tab_id = t.tab_id
  );
GO
