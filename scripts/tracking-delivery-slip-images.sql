-- Store scanned/uploaded slip images on delivery records (relative to uploads/).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'loading_slip_image_path')
  ALTER TABLE tracking_delivery_record ADD loading_slip_image_path NVARCHAR(1024) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'tracking_delivery_record') AND name = N'offloading_slip_image_path')
  ALTER TABLE tracking_delivery_record ADD offloading_slip_image_path NVARCHAR(1024) NULL;
