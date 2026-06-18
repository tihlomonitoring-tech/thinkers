IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'vehicle_tracker_compliance_checks')
BEGIN
  CREATE TABLE vehicle_tracker_compliance_checks (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    tenant_id UNIQUEIDENTIFIER NOT NULL,
    truck_id UNIQUEIDENTIFIER NOT NULL,
    driver_id UNIQUEIDENTIFIER NULL,
    checked_by_user_id UNIQUEIDENTIFIER NOT NULL,
    checked_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    is_compliant BIT NOT NULL DEFAULT 0,
    has_camera BIT NOT NULL DEFAULT 0,
    load_camera_working BIT NOT NULL DEFAULT 0,
    cab_camera_working BIT NOT NULL DEFAULT 0,
    road_camera_working BIT NOT NULL DEFAULT 0,
    tracking_updating BIT NOT NULL DEFAULT 0,
    driver_section_used BIT NOT NULL DEFAULT 0,
    driver_wearing_ppe BIT NULL,
    driver_overspeeding_24h BIT NULL,
    driver_license_valid BIT NULL,
    fail_reasons_json NVARCHAR(MAX) NULL,
    notified_at DATETIME2 NULL,
    notified_emails_json NVARCHAR(MAX) NULL,
    grace_period_reason NVARCHAR(2000) NULL,
    grace_period_expires_at DATETIME2 NULL,
    grace_period_granted_at DATETIME2 NULL,
    grace_period_granted_by UNIQUEIDENTIFIER NULL,
    truck_suspension_id UNIQUEIDENTIFIER NULL,
    driver_suspension_id UNIQUEIDENTIFIER NULL,
    routes_removed_json NVARCHAR(MAX) NULL,
    driver_routes_removed_json NVARCHAR(MAX) NULL,
    [status] NVARCHAR(32) NOT NULL DEFAULT N'passed',
    notes NVARCHAR(2000) NULL,
    compliance_expires_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_vtcc_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT FK_vtcc_truck FOREIGN KEY (truck_id) REFERENCES contractor_trucks(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT FK_vtcc_checked_by FOREIGN KEY (checked_by_user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE INDEX IX_vtcc_tenant_truck ON vehicle_tracker_compliance_checks(tenant_id, truck_id, checked_at DESC);
  CREATE INDEX IX_vtcc_status_grace ON vehicle_tracker_compliance_checks(tenant_id, [status], grace_period_expires_at);
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'vehicle_tracker_compliance_checks') AND name = N'compliance_expires_at')
BEGIN
  ALTER TABLE vehicle_tracker_compliance_checks ADD compliance_expires_at DATETIME2 NULL;
END
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'vehicle_tracker_compliance_checks') AND name = N'compliance_expires_at')
BEGIN
  UPDATE vehicle_tracker_compliance_checks
    SET compliance_expires_at = DATEADD(hour, 48, checked_at)
    WHERE compliance_expires_at IS NULL AND is_compliant = 1;
END
GO
