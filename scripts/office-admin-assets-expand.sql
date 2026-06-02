-- Office Admin assets: lifecycle, insurance, attachments
-- Run: npm run db:office-admin-assets-expand

IF COL_LENGTH('office_admin_assets', 'manufacturer') IS NULL
  ALTER TABLE office_admin_assets ADD manufacturer NVARCHAR(255) NULL;
GO
IF COL_LENGTH('office_admin_assets', 'model') IS NULL
  ALTER TABLE office_admin_assets ADD model NVARCHAR(255) NULL;
GO
IF COL_LENGTH('office_admin_assets', 'supplier_name') IS NULL
  ALTER TABLE office_admin_assets ADD supplier_name NVARCHAR(255) NULL;
GO
IF COL_LENGTH('office_admin_assets', 'commissioned_date') IS NULL
  ALTER TABLE office_admin_assets ADD commissioned_date DATE NULL;
GO
IF COL_LENGTH('office_admin_assets', 'warranty_expiry_date') IS NULL
  ALTER TABLE office_admin_assets ADD warranty_expiry_date DATE NULL;
GO
IF COL_LENGTH('office_admin_assets', 'expected_life_years') IS NULL
  ALTER TABLE office_admin_assets ADD expected_life_years DECIMAL(6, 2) NULL;
GO
IF COL_LENGTH('office_admin_assets', 'useful_life_end_date') IS NULL
  ALTER TABLE office_admin_assets ADD useful_life_end_date DATE NULL;
GO
IF COL_LENGTH('office_admin_assets', 'disposal_date') IS NULL
  ALTER TABLE office_admin_assets ADD disposal_date DATE NULL;
GO
IF COL_LENGTH('office_admin_assets', 'condition_status') IS NULL
  ALTER TABLE office_admin_assets ADD condition_status NVARCHAR(50) NULL;
GO
IF COL_LENGTH('office_admin_assets', 'residual_value') IS NULL
  ALTER TABLE office_admin_assets ADD residual_value DECIMAL(18, 2) NULL;
GO
IF COL_LENGTH('office_admin_assets', 'insurance_provider') IS NULL
  ALTER TABLE office_admin_assets ADD insurance_provider NVARCHAR(255) NULL;
GO
IF COL_LENGTH('office_admin_assets', 'insurance_policy_number') IS NULL
  ALTER TABLE office_admin_assets ADD insurance_policy_number NVARCHAR(128) NULL;
GO
IF COL_LENGTH('office_admin_assets', 'insurance_cover_type') IS NULL
  ALTER TABLE office_admin_assets ADD insurance_cover_type NVARCHAR(100) NULL;
GO
IF COL_LENGTH('office_admin_assets', 'insurance_start_date') IS NULL
  ALTER TABLE office_admin_assets ADD insurance_start_date DATE NULL;
GO
IF COL_LENGTH('office_admin_assets', 'insurance_expiry_date') IS NULL
  ALTER TABLE office_admin_assets ADD insurance_expiry_date DATE NULL;
GO
IF COL_LENGTH('office_admin_assets', 'insurance_premium_annual') IS NULL
  ALTER TABLE office_admin_assets ADD insurance_premium_annual DECIMAL(18, 2) NULL;
GO
IF COL_LENGTH('office_admin_assets', 'insurance_contact') IS NULL
  ALTER TABLE office_admin_assets ADD insurance_contact NVARCHAR(255) NULL;
GO
IF COL_LENGTH('office_admin_assets', 'insurance_notes') IS NULL
  ALTER TABLE office_admin_assets ADD insurance_notes NVARCHAR(MAX) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'office_admin_asset_attachments')
CREATE TABLE office_admin_asset_attachments (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id UNIQUEIDENTIFIER NOT NULL,
  original_name NVARCHAR(500) NOT NULL,
  stored_path NVARCHAR(1000) NOT NULL,
  mime_type NVARCHAR(120) NULL,
  file_kind NVARCHAR(40) NOT NULL DEFAULT N'document',
  caption NVARCHAR(500) NULL,
  uploaded_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_oa_asset_attach_asset FOREIGN KEY (asset_id) REFERENCES office_admin_assets(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_oa_asset_attach_asset' AND object_id = OBJECT_ID(N'office_admin_asset_attachments'))
CREATE INDEX IX_oa_asset_attach_asset ON office_admin_asset_attachments (asset_id, created_at DESC);
GO
