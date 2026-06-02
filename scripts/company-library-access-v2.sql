-- Company library: uploader approve/deny access, document lock
-- Run: npm run db:company-library-access-v2

IF COL_LENGTH('company_library_documents', 'is_access_locked') IS NULL
  ALTER TABLE company_library_documents ADD is_access_locked BIT NOT NULL CONSTRAINT DF_cl_docs_locked DEFAULT 1;
GO

IF COL_LENGTH('company_library_access_requests', 'requester_note') IS NULL
  ALTER TABLE company_library_access_requests ADD requester_note NVARCHAR(500) NULL;
GO
IF COL_LENGTH('company_library_access_requests', 'responded_by') IS NULL
  ALTER TABLE company_library_access_requests ADD responded_by UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION;
GO
IF COL_LENGTH('company_library_access_requests', 'responded_at') IS NULL
  ALTER TABLE company_library_access_requests ADD responded_at DATETIME2 NULL;
GO

UPDATE company_library_documents SET is_access_locked = 1 WHERE is_pin_protected = 1;
GO
UPDATE company_library_documents SET is_access_locked = 0 WHERE is_pin_protected = 0;
GO
