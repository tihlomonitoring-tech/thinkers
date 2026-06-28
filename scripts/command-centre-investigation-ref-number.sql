-- Auto-generated reference number (e.g. INV-0427) for Command Centre investigation reports.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = N'ref_number' AND Object_ID = Object_ID(N'command_centre_investigation_reports'))
  ALTER TABLE command_centre_investigation_reports ADD ref_number NVARCHAR(50) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_inv_ref' AND object_id = OBJECT_ID('command_centre_investigation_reports'))
  CREATE INDEX IX_cc_inv_ref ON command_centre_investigation_reports(ref_number);
GO
