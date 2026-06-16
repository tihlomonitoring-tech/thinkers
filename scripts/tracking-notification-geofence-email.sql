-- Geofence / hazard zone email + alarm preference (separate from route deviation).
IF COL_LENGTH('tracking_tenant_settings', 'notify_email_geofence') IS NULL
  ALTER TABLE tracking_tenant_settings ADD notify_email_geofence BIT NOT NULL
    CONSTRAINT DF_tts_notify_email_geofence DEFAULT (1);
GO
