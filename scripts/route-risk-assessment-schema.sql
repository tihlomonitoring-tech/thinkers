-- Route addresses, distance, and risk assessment on contractor_routes
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'contractor_routes')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_routes') AND name = 'loading_address')
    ALTER TABLE contractor_routes ADD loading_address NVARCHAR(500) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_routes') AND name = 'destination_address')
    ALTER TABLE contractor_routes ADD destination_address NVARCHAR(500) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_routes') AND name = 'distance_km')
    ALTER TABLE contractor_routes ADD distance_km DECIMAL(10,2) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_routes') AND name = 'risk_assessment_json')
    ALTER TABLE contractor_routes ADD risk_assessment_json NVARCHAR(MAX) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_routes') AND name = 'risk_assessment_score')
    ALTER TABLE contractor_routes ADD risk_assessment_score DECIMAL(5,2) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_routes') AND name = 'risk_assessment_level')
    ALTER TABLE contractor_routes ADD risk_assessment_level NVARCHAR(20) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_routes') AND name = 'risk_assessed_at')
    ALTER TABLE contractor_routes ADD risk_assessed_at DATETIME2 NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_routes') AND name = 'risk_assessed_by_user_id')
    ALTER TABLE contractor_routes ADD risk_assessed_by_user_id UNIQUEIDENTIFIER NULL;
END
GO
