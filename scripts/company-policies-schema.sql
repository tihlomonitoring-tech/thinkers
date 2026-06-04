-- Company policies: draft, publish, employee acknowledgement.
-- Run: npm run db:company-policies

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'company_policy_ref_counter')
CREATE TABLE company_policy_ref_counter (
  tenant_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'company_policies')
CREATE TABLE company_policies (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  reference_number NVARCHAR(64) NOT NULL,
  title NVARCHAR(500) NOT NULL,
  act_or_section NVARCHAR(500) NOT NULL,
  summary NVARCHAR(2000) NULL,
  policy_type NVARCHAR(32) NOT NULL DEFAULT N'policy',
  classification NVARCHAR(32) NOT NULL DEFAULT N'internal',
  department_name NVARCHAR(200) NULL,
  status NVARCHAR(20) NOT NULL DEFAULT N'draft',
  version INT NOT NULL DEFAULT 0,
  effective_date DATE NULL,
  requires_acknowledgement BIT NOT NULL DEFAULT 1,
  published_at DATETIME2 NULL,
  published_by_user_id UNIQUEIDENTIFIER NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  updated_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_company_policies_status CHECK (status IN (N'draft', N'published', N'archived'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_company_policies_ref' AND object_id = OBJECT_ID(N'company_policies'))
  CREATE UNIQUE INDEX UQ_company_policies_ref ON company_policies (tenant_id, reference_number);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_company_policies_tenant_status' AND object_id = OBJECT_ID(N'company_policies'))
  CREATE INDEX IX_company_policies_tenant_status ON company_policies (tenant_id, status, updated_at DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'company_policy_sections')
CREATE TABLE company_policy_sections (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  policy_id UNIQUEIDENTIFIER NOT NULL,
  section_number NVARCHAR(32) NOT NULL,
  title NVARCHAR(500) NOT NULL,
  body NVARCHAR(MAX) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT FK_company_policy_sections_policy FOREIGN KEY (policy_id) REFERENCES company_policies(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_company_policy_sections_policy' AND object_id = OBJECT_ID(N'company_policy_sections'))
  CREATE INDEX IX_company_policy_sections_policy ON company_policy_sections (policy_id, sort_order);
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'company_policy_acknowledgements')
CREATE TABLE company_policy_acknowledgements (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  policy_id UNIQUEIDENTIFIER NOT NULL,
  user_id UNIQUEIDENTIFIER NOT NULL,
  policy_version INT NOT NULL,
  signer_name NVARCHAR(200) NOT NULL,
  signature_data NVARCHAR(MAX) NOT NULL,
  signed_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_company_policy_ack_policy FOREIGN KEY (policy_id) REFERENCES company_policies(id) ON DELETE CASCADE,
  CONSTRAINT UQ_company_policy_ack_user_version UNIQUE (policy_id, user_id, policy_version)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_company_policy_ack_user' AND object_id = OBJECT_ID(N'company_policy_acknowledgements'))
  CREATE INDEX IX_company_policy_ack_user ON company_policy_acknowledgements (tenant_id, user_id, signed_at DESC);
GO
