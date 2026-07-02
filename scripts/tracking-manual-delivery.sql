-- Manual delivery import: record provenance and economics mode
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'record_source')
  ALTER TABLE tracking_delivery_record ADD record_source NVARCHAR(20) NOT NULL
    CONSTRAINT DF_tdr_record_source DEFAULT N'workflow';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'economics_mode')
  ALTER TABLE tracking_delivery_record ADD economics_mode NVARCHAR(20) NOT NULL
    CONSTRAINT DF_tdr_economics_mode DEFAULT N'system';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'created_by_user_id')
  ALTER TABLE tracking_delivery_record ADD created_by_user_id UNIQUEIDENTIFIER NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'trip_linked')
  ALTER TABLE tracking_delivery_record ADD trip_linked BIT NULL;

GO
