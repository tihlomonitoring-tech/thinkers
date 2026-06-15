-- GPS breadcrumb trail per fleet trip (for map "last N km travelled").
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'fleet_trip_position')
CREATE TABLE fleet_trip_position (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  trip_id UNIQUEIDENTIFIER NOT NULL,
  recorded_at DATETIME2 NOT NULL CONSTRAINT DF_ftp_recorded DEFAULT SYSUTCDATETIME(),
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  speed_kmh DECIMAL(8,2) NULL,
  heading_deg DECIMAL(6,2) NULL,
  -- NO ACTION on tenant: avoids multiple cascade paths (tenant -> fleet_trip -> this table)
  CONSTRAINT FK_ftp_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE NO ACTION,
  CONSTRAINT FK_ftp_trip FOREIGN KEY (trip_id) REFERENCES fleet_trip(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ftp_trip_time' AND object_id = OBJECT_ID('fleet_trip_position'))
  CREATE INDEX IX_ftp_trip_time ON fleet_trip_position(tenant_id, trip_id, recorded_at DESC);
GO
