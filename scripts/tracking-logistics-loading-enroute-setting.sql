-- Require manual loading slip before enroute (1) vs auto-enroute on loading geofence exit (0).
IF COL_LENGTH('tracking_tenant_settings', 'require_loading_slip_before_enroute') IS NULL
  ALTER TABLE tracking_tenant_settings
    ADD require_loading_slip_before_enroute BIT NOT NULL
    CONSTRAINT DF_tracking_tenant_settings_require_loading_slip DEFAULT 1;
