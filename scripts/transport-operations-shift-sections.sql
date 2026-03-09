-- Transport Operations: shift report sections (truck updates, communication log, shift summary, incidents, non_compliance_calls).
-- Run: node scripts/run-transport-operations-shift-sections.js

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('to_shift_reports') AND name = 'truck_updates')
  ALTER TABLE to_shift_reports ADD truck_updates NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('to_shift_reports') AND name = 'communication_log')
  ALTER TABLE to_shift_reports ADD communication_log NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('to_shift_reports') AND name = 'shift_summary')
  ALTER TABLE to_shift_reports ADD shift_summary NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('to_shift_reports') AND name = 'incidents')
  ALTER TABLE to_shift_reports ADD incidents NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('to_shift_reports') AND name = 'non_compliance_calls')
  ALTER TABLE to_shift_reports ADD non_compliance_calls NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('to_shift_reports') AND name = 'investigations')
  ALTER TABLE to_shift_reports ADD investigations NVARCHAR(MAX) NULL;
GO
