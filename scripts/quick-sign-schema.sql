-- Quick Sign: document sharing for external/internal signature with OTP + location audit.
-- Run: npm run db:quick-sign

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'quick_sign_requests')
CREATE TABLE quick_sign_requests (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  title NVARCHAR(500) NOT NULL,
  notes NVARCHAR(MAX) NULL,
  status NVARCHAR(30) NOT NULL DEFAULT N'draft',
  recipient_email NVARCHAR(320) NOT NULL,
  recipient_name NVARCHAR(300) NULL,
  recipient_type NVARCHAR(20) NOT NULL DEFAULT N'external',
  document_original_name NVARCHAR(500) NOT NULL,
  document_original_path NVARCHAR(1000) NOT NULL,
  document_mime NVARCHAR(120) NULL,
  document_signed_path NVARCHAR(1000) NULL,
  access_token NVARCHAR(64) NOT NULL,
  otp_hash NVARCHAR(200) NULL,
  otp_expires_at DATETIME2 NULL,
  link_expires_at DATETIME2 NULL,
  signer_session_token NVARCHAR(64) NULL,
  signer_session_expires_at DATETIME2 NULL,
  otp_verified_at DATETIME2 NULL,
  first_accessed_at DATETIME2 NULL,
  last_accessed_at DATETIME2 NULL,
  signed_at DATETIME2 NULL,
  signer_id_number NVARCHAR(50) NULL,
  signer_latitude FLOAT NULL,
  signer_longitude FLOAT NULL,
  signer_location_accuracy FLOAT NULL,
  signer_location_captured_at DATETIME2 NULL,
  signature_image_path NVARCHAR(1000) NULL,
  created_by_user_id UNIQUEIDENTIFIER NOT NULL,
  sent_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_quick_sign_status CHECK (status IN (
    N'draft', N'sent', N'accessed', N'signed', N'cancelled', N'expired'
  )),
  CONSTRAINT CK_quick_sign_recipient_type CHECK (recipient_type IN (N'internal', N'external')),
  CONSTRAINT FK_quick_sign_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE NO ACTION,
  CONSTRAINT FK_quick_sign_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_quick_sign_requests_tenant' AND object_id = OBJECT_ID('quick_sign_requests'))
  CREATE INDEX IX_quick_sign_requests_tenant ON quick_sign_requests(tenant_id, created_at DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_quick_sign_access_token' AND object_id = OBJECT_ID('quick_sign_requests'))
  CREATE UNIQUE INDEX UQ_quick_sign_access_token ON quick_sign_requests(access_token);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'quick_sign_events')
CREATE TABLE quick_sign_events (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  request_id UNIQUEIDENTIFIER NOT NULL,
  event_type NVARCHAR(60) NOT NULL,
  ip_address NVARCHAR(64) NULL,
  user_agent NVARCHAR(500) NULL,
  metadata_json NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_quick_sign_events_request FOREIGN KEY (request_id) REFERENCES quick_sign_requests(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_quick_sign_events_request' AND object_id = OBJECT_ID('quick_sign_events'))
  CREATE INDEX IX_quick_sign_events_request ON quick_sign_events(request_id, created_at DESC);
GO
