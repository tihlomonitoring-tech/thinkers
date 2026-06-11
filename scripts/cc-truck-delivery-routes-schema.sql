-- Per-route breakdown on single-ops truck deliveries (finance ledger; not on shift PDF).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'command_centre_single_ops_truck_delivery_routes')
CREATE TABLE command_centre_single_ops_truck_delivery_routes (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  delivery_id UNIQUEIDENTIFIER NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  route_id UNIQUEIDENTIFIER NULL,
  route_name NVARCHAR(255) NULL,
  completed_deliveries INT NULL,
  tons_loaded DECIMAL(14, 4) NULL,
  CONSTRAINT FK_cc_sotdr_delivery FOREIGN KEY (delivery_id)
    REFERENCES command_centre_single_ops_truck_deliveries(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_cc_sotdr_delivery' AND object_id = OBJECT_ID(N'command_centre_single_ops_truck_delivery_routes'))
CREATE INDEX IX_cc_sotdr_delivery ON command_centre_single_ops_truck_delivery_routes(delivery_id);
GO
