-- Email notification toggles per tenant (Tracking Management → Manage tabs)
IF COL_LENGTH('tracking_tenant_settings', 'notify_email_deviation') IS NULL
  ALTER TABLE tracking_tenant_settings ADD notify_email_deviation BIT NOT NULL
    CONSTRAINT DF_tts_notify_email_deviation DEFAULT (1);
GO
IF COL_LENGTH('tracking_tenant_settings', 'notify_email_overspeed') IS NULL
  ALTER TABLE tracking_tenant_settings ADD notify_email_overspeed BIT NOT NULL
    CONSTRAINT DF_tts_notify_email_overspeed DEFAULT (1);
GO
IF COL_LENGTH('tracking_tenant_settings', 'notify_email_parking') IS NULL
  ALTER TABLE tracking_tenant_settings ADD notify_email_parking BIT NOT NULL
    CONSTRAINT DF_tts_notify_email_parking DEFAULT (1);
GO
IF COL_LENGTH('tracking_tenant_settings', 'notify_email_loading') IS NULL
  ALTER TABLE tracking_tenant_settings ADD notify_email_loading BIT NOT NULL
    CONSTRAINT DF_tts_notify_email_loading DEFAULT (1);
GO
IF COL_LENGTH('tracking_tenant_settings', 'notify_email_offloading') IS NULL
  ALTER TABLE tracking_tenant_settings ADD notify_email_offloading BIT NOT NULL
    CONSTRAINT DF_tts_notify_email_offloading DEFAULT (1);
GO
-- Track when a trip first became stationary (parking / idle alerts)
IF COL_LENGTH('fleet_trip', 'stationary_since_at') IS NULL
  ALTER TABLE fleet_trip ADD stationary_since_at DATETIME2 NULL;
GO
