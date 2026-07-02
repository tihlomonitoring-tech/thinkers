-- Track when truck exits destination geofence after arrival (2 km completion gate)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'fleet_trip') AND name = N'destination_geofence_exited_at')
  ALTER TABLE fleet_trip ADD destination_geofence_exited_at DATETIME2 NULL;

GO
