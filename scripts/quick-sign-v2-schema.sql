-- Quick Sign v2: multi-signer, on-document placements, working PDF copy.
-- Run: npm run db:quick-sign-v2

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('quick_sign_requests') AND name = 'document_working_path')
  ALTER TABLE quick_sign_requests ADD document_working_path NVARCHAR(1000) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('quick_sign_requests') AND name = 'page_count')
  ALTER TABLE quick_sign_requests ADD page_count INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('quick_sign_requests') AND name = 'signing_mode')
  ALTER TABLE quick_sign_requests ADD signing_mode NVARCHAR(20) NOT NULL DEFAULT N'legacy';
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('quick_sign_requests') AND name = 'allow_sender_sign')
  ALTER TABLE quick_sign_requests ADD allow_sender_sign BIT NOT NULL DEFAULT 0;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_quick_sign_status' AND parent_object_id = OBJECT_ID('quick_sign_requests'))
  ALTER TABLE quick_sign_requests DROP CONSTRAINT CK_quick_sign_status;
GO

ALTER TABLE quick_sign_requests ADD CONSTRAINT CK_quick_sign_status CHECK (status IN (
  N'draft', N'sent', N'accessed', N'in_progress', N'signed', N'completed', N'cancelled', N'expired'
));
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'quick_sign_recipients')
CREATE TABLE quick_sign_recipients (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  request_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  email NVARCHAR(320) NOT NULL,
  full_name NVARCHAR(300) NULL,
  recipient_type NVARCHAR(20) NOT NULL DEFAULT N'external',
  sign_order INT NOT NULL DEFAULT 0,
  access_token NVARCHAR(64) NOT NULL,
  otp_hash NVARCHAR(200) NULL,
  otp_expires_at DATETIME2 NULL,
  signer_session_token NVARCHAR(64) NULL,
  signer_session_expires_at DATETIME2 NULL,
  status NVARCHAR(30) NOT NULL DEFAULT N'pending',
  signed_at DATETIME2 NULL,
  signer_id_number NVARCHAR(50) NULL,
  signer_latitude FLOAT NULL,
  signer_longitude FLOAT NULL,
  signer_location_accuracy FLOAT NULL,
  signer_location_captured_at DATETIME2 NULL,
  is_sender BIT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_quick_sign_recipient_status CHECK (status IN (N'pending', N'sent', N'accessed', N'signed')),
  CONSTRAINT FK_qs_recipient_request FOREIGN KEY (request_id) REFERENCES quick_sign_requests(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_quick_sign_recipient_token' AND object_id = OBJECT_ID('quick_sign_recipients'))
  CREATE UNIQUE INDEX UQ_quick_sign_recipient_token ON quick_sign_recipients(access_token);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_quick_sign_recipients_request' AND object_id = OBJECT_ID('quick_sign_recipients'))
  CREATE INDEX IX_quick_sign_recipients_request ON quick_sign_recipients(request_id, sign_order);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'quick_sign_placements')
CREATE TABLE quick_sign_placements (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  request_id UNIQUEIDENTIFIER NOT NULL,
  recipient_id UNIQUEIDENTIFIER NOT NULL,
  placement_type NVARCHAR(20) NOT NULL,
  page_index INT NOT NULL DEFAULT 0,
  x_pct FLOAT NOT NULL,
  y_pct FLOAT NOT NULL,
  width_pct FLOAT NOT NULL,
  height_pct FLOAT NOT NULL,
  image_path NVARCHAR(1000) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_quick_sign_placement_type CHECK (placement_type IN (N'signature', N'initial')),
  CONSTRAINT FK_qs_placement_request FOREIGN KEY (request_id) REFERENCES quick_sign_requests(id) ON DELETE CASCADE,
  CONSTRAINT FK_qs_placement_recipient FOREIGN KEY (recipient_id) REFERENCES quick_sign_recipients(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_quick_sign_placements_request' AND object_id = OBJECT_ID('quick_sign_placements'))
  CREATE INDEX IX_quick_sign_placements_request ON quick_sign_placements(request_id, page_index);
GO
