-- Audit trail for fleet & driver applications (approve, decline, comments, resubmissions).
-- Run: npm run db:fleet-application-history

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cc_fleet_application_history')
CREATE TABLE cc_fleet_application_history (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  fleet_application_id UNIQUEIDENTIFIER NOT NULL,
  [action] NVARCHAR(40) NOT NULL,
  from_status NVARCHAR(20) NULL,
  to_status NVARCHAR(20) NULL,
  details NVARCHAR(MAX) NULL,
  performed_by_user_id UNIQUEIDENTIFIER NULL,
  performed_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_cc_fleet_app_hist_app FOREIGN KEY (fleet_application_id) REFERENCES cc_fleet_applications(id) ON DELETE CASCADE,
  CONSTRAINT FK_cc_fleet_app_hist_user FOREIGN KEY (performed_by_user_id) REFERENCES users(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_fleet_app_hist_app_at' AND object_id = OBJECT_ID('cc_fleet_application_history'))
  CREATE INDEX IX_cc_fleet_app_hist_app_at ON cc_fleet_application_history(fleet_application_id, performed_at ASC);
GO
