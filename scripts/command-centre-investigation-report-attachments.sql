-- Image attachments for Command Centre investigation reports.
-- Files live on disk under uploads/investigation-reports/<reportId>/; only metadata here.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'command_centre_investigation_report_attachments')
CREATE TABLE command_centre_investigation_report_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  report_id UNIQUEIDENTIFIER NOT NULL,
  file_name NVARCHAR(500) NOT NULL,
  stored_path NVARCHAR(1000) NOT NULL,
  mime_type NVARCHAR(200) NULL,
  file_size BIGINT NULL,
  caption NVARCHAR(500) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  uploaded_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_cc_inv_att_user' AND parent_object_id = OBJECT_ID('command_centre_investigation_report_attachments'))
  ALTER TABLE command_centre_investigation_report_attachments ADD CONSTRAINT FK_cc_inv_att_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_inv_att_report' AND object_id = OBJECT_ID('command_centre_investigation_report_attachments'))
  CREATE INDEX IX_cc_inv_att_report ON command_centre_investigation_report_attachments(report_id, sort_order);
GO

-- Clean up the abandoned shift-report attachments table (feature was moved to investigation reports).
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'command_centre_shift_report_attachments')
  DROP TABLE command_centre_shift_report_attachments;
GO
