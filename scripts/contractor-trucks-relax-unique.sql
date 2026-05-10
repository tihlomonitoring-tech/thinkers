-- Relax truck registration uniqueness on contractor_trucks.
-- Was: one registration per tenant (blocked the same truck from being added under
--      two different contractors, even when route enrolments make them distinct).
-- Now: one registration per (tenant + contractor). Same truck reg can repeat
--      across different contractors; route enrolments still scope by route.
-- Run: npm run db:contractor-trucks-relax-unique

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ct_trucks_tenant_reg' AND object_id = OBJECT_ID('contractor_trucks'))
  DROP INDEX UQ_ct_trucks_tenant_reg ON contractor_trucks;
GO

-- Ensure the persisted normalized column exists (may have been added by earlier migration).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_trucks') AND name = 'registration_norm')
  ALTER TABLE contractor_trucks ADD registration_norm AS LOWER(LTRIM(RTRIM(registration))) PERSISTED;
GO

-- Per-contractor uniqueness (a contractor can't list the same truck twice).
-- Filtered on the base column `registration` (SQL Server forbids filtering on computed columns).
-- Rows without a contractor_id or with a blank registration are NOT constrained.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ct_trucks_tenant_contractor_reg' AND object_id = OBJECT_ID('contractor_trucks'))
  CREATE UNIQUE INDEX UQ_ct_trucks_tenant_contractor_reg
    ON contractor_trucks(tenant_id, contractor_id, registration_norm)
    WHERE contractor_id IS NOT NULL AND registration IS NOT NULL AND registration <> N'';
GO
