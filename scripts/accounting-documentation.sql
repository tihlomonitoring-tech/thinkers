-- Accounting documentation workspace (contracts, agreements, letters, reports)
-- Run: node scripts/run-accounting-documentation.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_documentation')
CREATE TABLE accounting_documentation (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  title NVARCHAR(300) NOT NULL,
  document_type NVARCHAR(80) NOT NULL,
  status NVARCHAR(40) NOT NULL CONSTRAINT DF_ad_status DEFAULT N'draft',
  tags NVARCHAR(300) NULL,
  subject NVARCHAR(300) NULL,
  recipient_name NVARCHAR(200) NULL,
  recipient_email NVARCHAR(255) NULL,
  cc_emails NVARCHAR(1000) NULL,
  content_html NVARCHAR(MAX) NULL,
  metadata_json NVARCHAR(MAX) NULL,
  is_template BIT NOT NULL CONSTRAINT DF_ad_template DEFAULT 0,
  created_by NVARCHAR(255) NULL,
  updated_by NVARCHAR(255) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_ad_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_ad_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_ad_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ad_tenant_updated' AND object_id = OBJECT_ID('accounting_documentation'))
  CREATE INDEX IX_ad_tenant_updated ON accounting_documentation(tenant_id, updated_at DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ad_tenant_type_template' AND object_id = OBJECT_ID('accounting_documentation'))
  CREATE INDEX IX_ad_tenant_type_template ON accounting_documentation(tenant_id, document_type, is_template);
GO
