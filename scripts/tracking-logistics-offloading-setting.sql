-- Require manual offloading slip at destination (1) vs auto-complete on geofence exit (0).
IF COL_LENGTH('tracking_tenant_settings', 'require_offloading_slip_at_destination') IS NULL
  ALTER TABLE tracking_tenant_settings
    ADD require_offloading_slip_at_destination BIT NOT NULL
    CONSTRAINT DF_tracking_tenant_settings_require_offloading_slip DEFAULT 1;
