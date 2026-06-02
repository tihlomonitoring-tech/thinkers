-- Office Admin: asset categories + optional link from assets
-- Run: npm run db:office-admin-asset-categories

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'office_admin_asset_categories')
CREATE TABLE office_admin_asset_categories (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name NVARCHAR(100) NOT NULL,
  code_prefix NVARCHAR(10) NOT NULL,
  description NVARCHAR(500) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_oa_asset_cat_tenant_name' AND object_id = OBJECT_ID(N'office_admin_asset_categories'))
CREATE UNIQUE INDEX UX_oa_asset_cat_tenant_name ON office_admin_asset_categories (tenant_id, name);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_oa_asset_cat_tenant_prefix' AND object_id = OBJECT_ID(N'office_admin_asset_categories'))
CREATE UNIQUE INDEX UX_oa_asset_cat_tenant_prefix ON office_admin_asset_categories (tenant_id, code_prefix);
GO

IF COL_LENGTH('office_admin_assets', 'category_id') IS NULL
  ALTER TABLE office_admin_assets ADD category_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_office_admin_assets_category'
)
BEGIN
  ALTER TABLE office_admin_assets
    ADD CONSTRAINT FK_office_admin_assets_category
    FOREIGN KEY (category_id) REFERENCES office_admin_asset_categories(id) ON DELETE NO ACTION;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_office_admin_assets_tenant_code' AND object_id = OBJECT_ID(N'office_admin_assets'))
CREATE UNIQUE INDEX UX_office_admin_assets_tenant_code ON office_admin_assets (tenant_id, asset_code);
GO
