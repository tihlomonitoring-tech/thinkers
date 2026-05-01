-- Email-only library access: system PIN challenges + reusable attachment email sessions.
-- Run once: node scripts/run-company-library-email-flow-migration.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'company_library_pin_challenges')
CREATE TABLE company_library_pin_challenges (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UNIQUEIDENTIFIER NOT NULL REFERENCES company_library_documents(id) ON DELETE NO ACTION,
  requester_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  pin_hash NVARCHAR(200) NOT NULL,
  pin_sent_mode NVARCHAR(24) NOT NULL,
  expires_at DATETIME2 NOT NULL,
  verified_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_company_library_pin_challenges_mode CHECK (pin_sent_mode IN (N'uploader', N'super_admin'))
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_company_library_pin_challenges_lookup')
  CREATE INDEX IX_company_library_pin_challenges_lookup
  ON company_library_pin_challenges(document_id, requester_user_id, verified_at, expires_at);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'company_library_attachment_sessions')
CREATE TABLE company_library_attachment_sessions (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UNIQUEIDENTIFIER NOT NULL REFERENCES company_library_documents(id) ON DELETE NO ACTION,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  token_hash NVARCHAR(200) NOT NULL,
  expires_at DATETIME2 NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_company_library_attachment_sessions_lookup')
  CREATE INDEX IX_company_library_attachment_sessions_lookup
  ON company_library_attachment_sessions(document_id, user_id, token_hash);
GO

-- Legacy user-chosen document PINs are no longer used; secured docs rely on system PIN emails only.
UPDATE company_library_documents SET pin_hash = NULL WHERE pin_hash IS NOT NULL;
GO
