-- Enforce no duplicates on contractor page (run after resolving any existing duplicates).
-- Trucks: one registration per tenant (case-insensitive, trimmed).
-- Drivers: one id_number per tenant, one license_number per tenant (when provided).

-- contractor_trucks: unique (tenant_id, normalized registration)
-- Batch breaks below: required so indexes can reference persisted columns after ALTER TABLE.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_trucks') AND name = 'registration_norm')
  ALTER TABLE contractor_trucks ADD registration_norm AS LOWER(LTRIM(RTRIM(registration))) PERSISTED;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ct_trucks_tenant_reg' AND object_id = OBJECT_ID('contractor_trucks'))
  CREATE UNIQUE INDEX UQ_ct_trucks_tenant_reg ON contractor_trucks(tenant_id, registration_norm);
GO

-- contractor_drivers: unique id_number per tenant, case-insensitive (when not null)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_drivers') AND name = 'id_number_norm')
  ALTER TABLE contractor_drivers ADD id_number_norm AS LOWER(LTRIM(RTRIM(id_number))) PERSISTED;
GO
-- Unfiltered unique index (SQL Server disallows computed columns in filtered-index predicates).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ct_drivers_tenant_id_number' AND object_id = OBJECT_ID('contractor_drivers'))
  CREATE UNIQUE INDEX UQ_ct_drivers_tenant_id_number ON contractor_drivers(tenant_id, id_number_norm);
GO

-- contractor_drivers: unique license_number per tenant, case-insensitive (when not null)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_drivers') AND name = 'license_number_norm')
  ALTER TABLE contractor_drivers ADD license_number_norm AS LOWER(LTRIM(RTRIM(license_number))) PERSISTED;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ct_drivers_tenant_license' AND object_id = OBJECT_ID('contractor_drivers'))
  CREATE UNIQUE INDEX UQ_ct_drivers_tenant_license ON contractor_drivers(tenant_id, license_number_norm);
