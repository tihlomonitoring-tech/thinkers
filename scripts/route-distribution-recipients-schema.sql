-- Default list-distribution email recipients per route (Access Management).
-- Run: npm run db:route-distribution-recipients

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'access_route_distribution_recipients')
CREATE TABLE access_route_distribution_recipients (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  route_id UNIQUEIDENTIFIER NOT NULL,
  user_id UNIQUEIDENTIFIER NULL,
  recipient_email NVARCHAR(255) NOT NULL,
  recipient_name NVARCHAR(255) NULL,
  is_cc BIT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ardr_route' AND parent_object_id = OBJECT_ID('access_route_distribution_recipients'))
  ALTER TABLE access_route_distribution_recipients ADD CONSTRAINT FK_ardr_route
    FOREIGN KEY (route_id) REFERENCES contractor_routes(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ardr_user' AND parent_object_id = OBJECT_ID('access_route_distribution_recipients'))
  ALTER TABLE access_route_distribution_recipients ADD CONSTRAINT FK_ardr_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ardr_route' AND object_id = OBJECT_ID('access_route_distribution_recipients'))
  CREATE INDEX IX_ardr_route ON access_route_distribution_recipients(tenant_id, route_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ardr_route_email_cc' AND object_id = OBJECT_ID('access_route_distribution_recipients'))
  CREATE UNIQUE INDEX UQ_ardr_route_email_cc ON access_route_distribution_recipients(tenant_id, route_id, recipient_email, is_cc);
GO
