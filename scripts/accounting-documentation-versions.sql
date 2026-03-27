-- Accounting documentation version history
-- Run: node scripts/run-accounting-documentation-versions.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'accounting_documentation_versions')
CREATE TABLE accounting_documentation_versions (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  documentation_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  version_no INT NOT NULL,
  title NVARCHAR(300) NULL,
  document_type NVARCHAR(80) NULL,
  content_html NVARCHAR(MAX) NULL,
  metadata_json NVARCHAR(MAX) NULL,
  changed_by NVARCHAR(255) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_adv_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_adv_document FOREIGN KEY (documentation_id) REFERENCES accounting_documentation(id) ON DELETE CASCADE,
  -- NO ACTION avoids SQL Server multiple cascade paths (tenant -> documentation -> versions)
  CONSTRAINT FK_adv_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_adv_doc_version' AND object_id = OBJECT_ID('accounting_documentation_versions'))
  CREATE INDEX IX_adv_doc_version ON accounting_documentation_versions(documentation_id, version_no DESC);
GO
