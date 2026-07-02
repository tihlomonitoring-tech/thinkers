-- Route mismatch detection when truck visits unscheduled loading geofence
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fleet_trip') AND name = N'route_mismatch_route_id')
  ALTER TABLE fleet_trip ADD route_mismatch_route_id UNIQUEIDENTIFIER NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fleet_trip') AND name = N'route_mismatch_status')
  ALTER TABLE fleet_trip ADD route_mismatch_status NVARCHAR(20) NULL;

GO
