IF EXISTS (SELECT * FROM sys.tables WHERE name = 'contractor_messages')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_messages') AND name = 'contractor_id')
    ALTER TABLE contractor_messages ADD contractor_id UNIQUEIDENTIFIER NULL REFERENCES contractors(id) ON DELETE NO ACTION;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_messages') AND name = 'sender_scope')
    ALTER TABLE contractor_messages ADD sender_scope NVARCHAR(40) NULL;

  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_messages') AND name = 'sender_scope')
  BEGIN
    EXEC sp_executesql N'
      UPDATE contractor_messages
      SET sender_scope = ISNULL(sender_scope, ''contractor'')
      WHERE sender_scope IS NULL;
    ';
  END
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'contractor_message_attachments')
CREATE TABLE contractor_message_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  message_id UNIQUEIDENTIFIER NOT NULL REFERENCES contractor_messages(id) ON DELETE CASCADE,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE NO ACTION,
  file_name NVARCHAR(260) NOT NULL,
  stored_path NVARCHAR(600) NOT NULL,
  file_size_bytes BIGINT NULL,
  mime_type NVARCHAR(160) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ct_message_attachments_message' AND object_id = OBJECT_ID('contractor_message_attachments'))
  CREATE INDEX IX_ct_message_attachments_message ON contractor_message_attachments(message_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ct_message_attachments_tenant' AND object_id = OBJECT_ID('contractor_message_attachments'))
  CREATE INDEX IX_ct_message_attachments_tenant ON contractor_message_attachments(tenant_id);
GO
