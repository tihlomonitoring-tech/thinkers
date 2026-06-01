-- Overtime claim type (SA BCEA) + breakdown columns. Run: npm run db:claims-overtime

IF COL_LENGTH('claims', 'ot_period_end') IS NULL
  ALTER TABLE claims ADD ot_period_end DATE NULL;
GO

IF COL_LENGTH('claims', 'ot_weekday_hours') IS NULL
  ALTER TABLE claims ADD ot_weekday_hours DECIMAL(8,2) NULL;
GO

IF COL_LENGTH('claims', 'ot_sunday_hours') IS NULL
  ALTER TABLE claims ADD ot_sunday_hours DECIMAL(8,2) NULL;
GO

IF COL_LENGTH('claims', 'ot_public_holiday_hours') IS NULL
  ALTER TABLE claims ADD ot_public_holiday_hours DECIMAL(8,2) NULL;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_claims_type' AND parent_object_id = OBJECT_ID('claims'))
  ALTER TABLE claims DROP CONSTRAINT CK_claims_type;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'claims')
  ALTER TABLE claims ADD CONSTRAINT CK_claims_type CHECK (claim_type IN (
    N'fuel', N'travel', N'accommodation', N'meals', N'equipment', N'tools', N'training',
    N'communication', N'service', N'overtime', N'other'
  ));
GO
