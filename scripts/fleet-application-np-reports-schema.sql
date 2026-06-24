-- Saved NP Tracker vehicle check reports for fleet applications (PDF + JSON).
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cc_fleet_application_np_reports')
CREATE TABLE cc_fleet_application_np_reports (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  fleet_application_id UNIQUEIDENTIFIER NOT NULL,
  registration NVARCHAR(50) NOT NULL,
  verification_json NVARCHAR(MAX) NOT NULL,
  pdf_stored_path NVARCHAR(1000) NULL,
  checked_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  checked_by_user_id UNIQUEIDENTIFIER NULL,
  CONSTRAINT UQ_cc_fleet_np_app UNIQUE (fleet_application_id),
  CONSTRAINT FK_cc_fleet_np_app FOREIGN KEY (fleet_application_id) REFERENCES cc_fleet_applications(id) ON DELETE CASCADE,
  CONSTRAINT FK_cc_fleet_np_checked_by FOREIGN KEY (checked_by_user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_fleet_np_app_checked' AND object_id = OBJECT_ID('cc_fleet_application_np_reports'))
  CREATE INDEX IX_cc_fleet_np_app_checked ON cc_fleet_application_np_reports(fleet_application_id, checked_at DESC);
GO
