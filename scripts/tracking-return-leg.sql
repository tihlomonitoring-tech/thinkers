-- Return leg destination metadata for completed deliveries
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'return_destination_name')
  ALTER TABLE tracking_delivery_record ADD return_destination_name NVARCHAR(200) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'return_arrived')
  ALTER TABLE tracking_delivery_record ADD return_arrived BIT NULL;

GO
