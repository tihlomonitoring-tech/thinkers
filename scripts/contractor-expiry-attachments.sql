-- Contractor expiry document attachments (licence, roadworthy, permit scans)
-- Run: npm run db:contractor-expiry-attachments

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'contractor_expiry_attachments')
CREATE TABLE contractor_expiry_attachments (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expiry_id UNIQUEIDENTIFIER NOT NULL REFERENCES contractor_expiries(id) ON DELETE NO ACTION,
  file_name NVARCHAR(500) NOT NULL,
  stored_rel_path NVARCHAR(1000) NOT NULL,
  mime_type NVARCHAR(200) NULL,
  file_size INT NULL,
  uploaded_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_contractor_expiry_att_expiry' AND object_id = OBJECT_ID('contractor_expiry_attachments'))
  CREATE INDEX IX_contractor_expiry_att_expiry ON contractor_expiry_attachments(expiry_id);
GO
