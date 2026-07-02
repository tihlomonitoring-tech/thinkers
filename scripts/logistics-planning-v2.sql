-- Logistics Planning v2: settings, learning weights, tab access, slip-aware KPIs support

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'logistics_planner_settings')
CREATE TABLE logistics_planner_settings (
  tenant_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  notify_email_plan_published BIT NOT NULL CONSTRAINT DF_lps_notify DEFAULT 1,
  weight_margin DECIMAL(6,3) NOT NULL CONSTRAINT DF_lps_w_margin DEFAULT 1.000,
  weight_queue DECIMAL(6,3) NOT NULL CONSTRAINT DF_lps_w_queue DEFAULT 1.000,
  weight_travel DECIMAL(6,3) NOT NULL CONSTRAINT DF_lps_w_travel DEFAULT 1.000,
  weight_deviation DECIMAL(6,3) NOT NULL CONSTRAINT DF_lps_w_dev DEFAULT 1.000,
  weight_slip DECIMAL(6,3) NOT NULL CONSTRAINT DF_lps_w_slip DEFAULT 1.200,
  weight_targets DECIMAL(6,3) NOT NULL CONSTRAINT DF_lps_w_targets DEFAULT 1.000,
  learning_note NVARCHAR(500) NULL,
  learning_updated_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Allow logistics_planning in tab_access_grants.page_key
IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_tag_page_key' AND parent_object_id = OBJECT_ID(N'dbo.tab_access_grants')
)
  ALTER TABLE dbo.tab_access_grants DROP CONSTRAINT CK_tag_page_key;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_tag_page_key' AND parent_object_id = OBJECT_ID(N'dbo.tab_access_grants')
)
  ALTER TABLE dbo.tab_access_grants ADD CONSTRAINT CK_tag_page_key CHECK (page_key IN (
    N'accounting', N'management', N'contractor', N'tracking_management', N'letters', N'logistics_planning'
  ));
GO
