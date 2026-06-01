-- One email per claim event (prevents duplicate notifications on retries / double-submit).
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'claim_email_log')
CREATE TABLE claim_email_log (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  claim_id UNIQUEIDENTIFIER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  event_type NVARCHAR(50) NOT NULL,
  recipient_email NVARCHAR(320) NOT NULL,
  sent_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_claim_email_log UNIQUE (claim_id, event_type, recipient_email)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_claim_email_log_claim' AND object_id = OBJECT_ID('claim_email_log'))
  CREATE INDEX IX_claim_email_log_claim ON claim_email_log(claim_id, event_type);
GO
