-- Persistent "Blocked" state for vehicle tracker compliance.
-- A non-compliant check sets status = 'blocked' (non-expiring); it is cleared only
-- by a later passing re-inspection that carries a motivation. Audit fields below
-- retain the timestamps and the motivation comment.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'vehicle_tracker_compliance_checks') AND name = N'blocked_at')
BEGIN
  ALTER TABLE vehicle_tracker_compliance_checks ADD blocked_at DATETIME2 NULL;
END
GO

-- Motivation captured on the passing re-inspection that clears a prior block.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'vehicle_tracker_compliance_checks') AND name = N'motivation')
BEGIN
  ALTER TABLE vehicle_tracker_compliance_checks ADD motivation NVARCHAR(2000) NULL;
END
GO

-- JSON of routes the truck was unenrolled from when blocked (used to restore on clearance).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'vehicle_tracker_compliance_checks') AND name = N'blocked_routes_removed_json')
BEGIN
  ALTER TABLE vehicle_tracker_compliance_checks ADD blocked_routes_removed_json NVARCHAR(MAX) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'vehicle_tracker_compliance_checks') AND name = N'blocked_driver_routes_removed_json')
BEGIN
  ALTER TABLE vehicle_tracker_compliance_checks ADD blocked_driver_routes_removed_json NVARCHAR(MAX) NULL;
END
GO

-- Backfill: any pre-existing non-compliant, non-grace, non-suspended check is treated as blocked.
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'vehicle_tracker_compliance_checks') AND name = N'blocked_at')
BEGIN
  UPDATE vehicle_tracker_compliance_checks
    SET [status] = N'blocked', blocked_at = ISNULL(blocked_at, checked_at)
    WHERE is_compliant = 0 AND [status] IN (N'failed');
END
GO
