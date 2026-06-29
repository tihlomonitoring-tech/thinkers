-- Single Ops shift report: Auto completed delivery support.
-- Adds a per-truck route column and a report-level "auto completed delivery" flag.
-- Run: npm run db:cc-single-ops-auto-completed-delivery

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'command_centre_single_ops_truck_deliveries') AND name = N'route_name')
  ALTER TABLE command_centre_single_ops_truck_deliveries ADD route_name NVARCHAR(255) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'command_centre_single_ops_shift_reports') AND name = N'auto_completed_delivery')
  ALTER TABLE command_centre_single_ops_shift_reports ADD auto_completed_delivery BIT NOT NULL DEFAULT 0;
GO
