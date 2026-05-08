-- Command Centre settings: store a per-tenant Command Centre logo
-- which can override the default tenant logo on shift report PDFs.
-- Run: npm run db:cc-logo-settings

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('tenants') AND name = 'cc_logo_url')
  ALTER TABLE tenants ADD cc_logo_url NVARCHAR(400) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('tenants') AND name = 'cc_logo_updated_at')
  ALTER TABLE tenants ADD cc_logo_updated_at DATETIME2 NULL;
GO
