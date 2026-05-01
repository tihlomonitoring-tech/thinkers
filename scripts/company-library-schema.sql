-- Company Library: folders, documents, access requests, download grants, audit, tenant policy.
-- Run: node scripts/run-company-library-schema.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'company_library_policy')
CREATE TABLE company_library_policy (
  tenant_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  access_restricted BIT NOT NULL DEFAULT 0,
  access_timezone NVARCHAR(64) NOT NULL DEFAULT N'Africa/Johannesburg',
  access_weekdays NVARCHAR(32) NULL,
  access_start_minutes INT NULL,
  access_end_minutes INT NULL,
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_by UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'company_library_folders')
CREATE TABLE company_library_folders (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_folder_id UNIQUEIDENTIFIER NULL REFERENCES company_library_folders(id) ON DELETE NO ACTION,
  name NVARCHAR(255) NOT NULL,
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'company_library_documents')
CREATE TABLE company_library_documents (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  folder_id UNIQUEIDENTIFIER NULL REFERENCES company_library_folders(id) ON DELETE NO ACTION,
  display_title NVARCHAR(500) NOT NULL,
  file_name NVARCHAR(500) NOT NULL,
  stored_rel_path NVARCHAR(1000) NOT NULL,
  mime_type NVARCHAR(200) NULL,
  size_bytes BIGINT NULL,
  uploaded_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  ai_summary NVARCHAR(MAX) NULL,
  ai_status NVARCHAR(40) NULL,
  is_pin_protected BIT NOT NULL DEFAULT 0,
  pin_hash NVARCHAR(200) NULL,
  expires_at DATE NULL,
  expiry_reminder_lead_days INT NOT NULL DEFAULT 14,
  reminder_user_ids NVARCHAR(MAX) NULL,
  last_expiry_reminder_sent_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'company_library_access_requests')
CREATE TABLE company_library_access_requests (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UNIQUEIDENTIFIER NOT NULL REFERENCES company_library_documents(id) ON DELETE NO ACTION,
  requester_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  status NVARCHAR(24) NOT NULL DEFAULT N'pending',
  uploader_code_hash NVARCHAR(200) NULL,
  code_issued_at DATETIME2 NULL,
  fulfilled_at DATETIME2 NULL,
  denied_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_company_library_access_req_status CHECK (status IN (N'pending', N'fulfilled', N'denied', N'cancelled'))
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_company_library_access_req_doc_requester_pending')
  CREATE INDEX IX_company_library_access_req_doc_requester_pending
  ON company_library_access_requests(document_id, requester_user_id, status);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'company_library_download_grants')
CREATE TABLE company_library_download_grants (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UNIQUEIDENTIFIER NOT NULL REFERENCES company_library_documents(id) ON DELETE NO ACTION,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  token_hash NVARCHAR(200) NOT NULL,
  expires_at DATETIME2 NOT NULL,
  used_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_company_library_download_grants_token')
  CREATE INDEX IX_company_library_download_grants_token ON company_library_download_grants(token_hash);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'company_library_audit')
CREATE TABLE company_library_audit (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  document_id UNIQUEIDENTIFIER NULL REFERENCES company_library_documents(id) ON DELETE NO ACTION,
  action NVARCHAR(64) NOT NULL,
  detail NVARCHAR(MAX) NULL,
  ip_address NVARCHAR(64) NULL,
  user_agent NVARCHAR(512) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_company_library_audit_tenant_created')
  CREATE INDEX IX_company_library_audit_tenant_created ON company_library_audit(tenant_id, created_at DESC);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'company_library_delete_otp')
CREATE TABLE company_library_delete_otp (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  document_id UNIQUEIDENTIFIER NOT NULL REFERENCES company_library_documents(id) ON DELETE NO ACTION,
  code_hash NVARCHAR(200) NOT NULL,
  expires_at DATETIME2 NOT NULL,
  consumed_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_company_library_delete_otp_lookup')
  CREATE INDEX IX_company_library_delete_otp_lookup
  ON company_library_delete_otp(tenant_id, user_id, document_id);
GO
