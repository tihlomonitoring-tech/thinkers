-- Rector "Accepted trucks" verification feature.
-- A rector accepts/inducts specific trucks onto a route. The contractor may only
-- enroll a truck on that route if it matches the rector's accepted list according
-- to the route's verification configuration. Contractors can request acceptance,
-- which the rector reviews under the "Acceptance requests" tab.
-- Idempotent. Run: node scripts/run-rector-accepted-trucks.js

-- 1) Trucks a rector has accepted/inducted on a specific route.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'rector_accepted_trucks')
CREATE TABLE rector_accepted_trucks (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id),
  route_id UNIQUEIDENTIFIER NOT NULL REFERENCES contractor_routes(id) ON DELETE CASCADE,
  truck_id UNIQUEIDENTIFIER NULL,
  fleet_no NVARCHAR(50) NULL,
  registration NVARCHAR(50) NOT NULL,
  trailer_1_reg_no NVARCHAR(50) NULL,
  trailer_2_reg_no NVARCHAR(50) NULL,
  source NVARCHAR(20) NOT NULL CONSTRAINT DF_rat_source DEFAULT N'manual', -- manual|import|request
  accepted_by_user_id UNIQUEIDENTIFIER NULL,
  accepted_at DATETIME2 NOT NULL CONSTRAINT DF_rat_accepted_at DEFAULT SYSUTCDATETIME(),
  created_at DATETIME2 NOT NULL CONSTRAINT DF_rat_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_rector_accepted_trucks_route_reg UNIQUE (route_id, registration)
);
GO

-- 2) Per-route verification configuration + contractor email toggle.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'rector_route_settings')
CREATE TABLE rector_route_settings (
  route_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES contractor_routes(id) ON DELETE CASCADE,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  verify_registration BIT NOT NULL CONSTRAINT DF_rrs_verify_reg DEFAULT (1),
  verify_trailer_1 BIT NOT NULL CONSTRAINT DF_rrs_verify_t1 DEFAULT (0),
  verify_trailer_2 BIT NOT NULL CONSTRAINT DF_rrs_verify_t2 DEFAULT (0),
  verify_fleet_no BIT NOT NULL CONSTRAINT DF_rrs_verify_fleet DEFAULT (0),
  enforce_acceptance BIT NOT NULL CONSTRAINT DF_rrs_enforce DEFAULT (1),
  notify_email_enabled BIT NOT NULL CONSTRAINT DF_rrs_notify DEFAULT (1),
  updated_by_user_id UNIQUEIDENTIFIER NULL,
  updated_at DATETIME2 NOT NULL CONSTRAINT DF_rrs_updated_at DEFAULT SYSUTCDATETIME()
);
GO

-- 3) Contractor requests for the rector to accept a truck onto a route.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'rector_acceptance_requests')
CREATE TABLE rector_acceptance_requests (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id),
  route_id UNIQUEIDENTIFIER NOT NULL REFERENCES contractor_routes(id) ON DELETE CASCADE,
  truck_id UNIQUEIDENTIFIER NOT NULL,
  registration NVARCHAR(50) NULL,
  fleet_no NVARCHAR(50) NULL,
  trailer_1_reg_no NVARCHAR(50) NULL,
  trailer_2_reg_no NVARCHAR(50) NULL,
  [status] NVARCHAR(20) NOT NULL CONSTRAINT DF_rar_status DEFAULT N'pending', -- pending|accepted|rejected
  note NVARCHAR(MAX) NULL,
  review_note NVARCHAR(MAX) NULL,
  requested_by_user_id UNIQUEIDENTIFIER NULL,
  requested_at DATETIME2 NOT NULL CONSTRAINT DF_rar_requested_at DEFAULT SYSUTCDATETIME(),
  reviewed_by_user_id UNIQUEIDENTIFIER NULL,
  reviewed_at DATETIME2 NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_rector_acceptance_requests_route_status')
  CREATE INDEX IX_rector_acceptance_requests_route_status
    ON rector_acceptance_requests (route_id, [status]);
GO
