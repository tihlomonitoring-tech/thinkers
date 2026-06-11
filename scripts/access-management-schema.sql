-- Access management: route capacity/max tons/expiration + route factors (contacts/stakeholders).
-- Run: node scripts/run-access-management-schema.js

-- Extend contractor_routes for Route management (capacity, min/max tons legacy, expiration)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_routes') AND name = 'capacity')
  ALTER TABLE contractor_routes ADD capacity INT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_routes') AND name = 'max_tons')
  ALTER TABLE contractor_routes ADD max_tons DECIMAL(12,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_routes') AND name = 'min_tons')
  ALTER TABLE contractor_routes ADD min_tons DECIMAL(12,2) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_routes') AND name = 'route_expiration')
  ALTER TABLE contractor_routes ADD route_expiration DATE NULL;
GO

-- Route factors: contacts/stakeholders (e.g. ractors) with contact details. FK to route with NO ACTION to avoid cascade paths.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'access_route_factors')
CREATE TABLE access_route_factors (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  route_id UNIQUEIDENTIFIER NULL,
  name NVARCHAR(255) NOT NULL,
  company NVARCHAR(255) NULL,
  email NVARCHAR(255) NULL,
  phone NVARCHAR(100) NULL,
  role_or_type NVARCHAR(100) NULL,
  notes NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_access_route_factors_route' AND parent_object_id = OBJECT_ID('access_route_factors'))
  ALTER TABLE access_route_factors ADD CONSTRAINT FK_access_route_factors_route FOREIGN KEY (route_id) REFERENCES contractor_routes(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_access_route_factors_tenant' AND object_id = OBJECT_ID('access_route_factors'))
  CREATE INDEX IX_access_route_factors_tenant ON access_route_factors(tenant_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_access_route_factors_route' AND object_id = OBJECT_ID('access_route_factors'))
  CREATE INDEX IX_access_route_factors_route ON access_route_factors(route_id);
GO
