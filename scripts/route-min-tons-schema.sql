-- Route minimal tons (Access management) — default 36 t, editable per route.
-- Run: npm run db:route-min-tons

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_routes') AND name = 'min_tons')
  ALTER TABLE contractor_routes ADD min_tons DECIMAL(12,2) NULL;
GO

UPDATE contractor_routes
SET min_tons = COALESCE(min_tons, max_tons, 36)
WHERE min_tons IS NULL;
GO
