-- Per-route list distribution settings (fleet/driver columns, includes, grouping).
-- Run: npm run db:route-distribution-settings

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'access_route_distribution_settings')
CREATE TABLE access_route_distribution_settings (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  route_id UNIQUEIDENTIFIER NOT NULL,
  include_fleet BIT NOT NULL DEFAULT 1,
  include_drivers BIT NOT NULL DEFAULT 1,
  fleet_columns NVARCHAR(MAX) NULL,
  driver_columns NVARCHAR(MAX) NULL,
  group_by_sub_contractor BIT NOT NULL DEFAULT 0,
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_ards_route UNIQUE (tenant_id, route_id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ards_route' AND parent_object_id = OBJECT_ID('access_route_distribution_settings'))
  ALTER TABLE access_route_distribution_settings ADD CONSTRAINT FK_ards_route
    FOREIGN KEY (route_id) REFERENCES contractor_routes(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ards_tenant_route' AND object_id = OBJECT_ID('access_route_distribution_settings'))
  CREATE INDEX IX_ards_tenant_route ON access_route_distribution_settings(tenant_id, route_id);
GO
