-- Subcontractor users, contractor-first truck approval, FK to subcontractor directory.
-- Run: npm run db:subcontractor-fleet-workflow

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'user_subcontractors')
CREATE TABLE user_subcontractors (
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subcontractor_id UNIQUEIDENTIFIER NOT NULL REFERENCES contractor_subcontractors(id) ON DELETE NO ACTION,
  PRIMARY KEY (user_id, subcontractor_id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_user_subcontractors_sub' AND object_id = OBJECT_ID('user_subcontractors'))
  CREATE INDEX IX_user_subcontractors_sub ON user_subcontractors(subcontractor_id);
GO

IF EXISTS (SELECT * FROM sys.tables WHERE name = 'contractor_trucks')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_trucks') AND name = 'subcontractor_id')
    ALTER TABLE contractor_trucks ADD subcontractor_id UNIQUEIDENTIFIER NULL REFERENCES contractor_subcontractors(id) ON DELETE NO ACTION;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_trucks') AND name = 'contractor_approval_status')
    ALTER TABLE contractor_trucks ADD contractor_approval_status NVARCHAR(40) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_trucks') AND name = 'contractor_reviewed_at')
    ALTER TABLE contractor_trucks ADD contractor_reviewed_at DATETIME2 NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_trucks') AND name = 'contractor_reviewed_by_user_id')
    ALTER TABLE contractor_trucks ADD contractor_reviewed_by_user_id UNIQUEIDENTIFIER NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_trucks') AND name = 'contractor_decline_reason')
    ALTER TABLE contractor_trucks ADD contractor_decline_reason NVARCHAR(MAX) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_trucks') AND name = 'added_by_user_id')
    ALTER TABLE contractor_trucks ADD added_by_user_id UNIQUEIDENTIFIER NULL;
END
GO

-- Legacy rows: treat NULL approval status as approved by contractor (visible on Fleet tab).
UPDATE contractor_trucks
SET contractor_approval_status = N'approved_contractor'
WHERE contractor_approval_status IS NULL;
GO

IF EXISTS (SELECT * FROM sys.tables WHERE name = 'contractor_drivers')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_drivers') AND name = 'subcontractor_id')
    ALTER TABLE contractor_drivers ADD subcontractor_id UNIQUEIDENTIFIER NULL REFERENCES contractor_subcontractors(id) ON DELETE NO ACTION;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_drivers') AND name = 'contractor_approval_status')
    ALTER TABLE contractor_drivers ADD contractor_approval_status NVARCHAR(40) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_drivers') AND name = 'contractor_reviewed_at')
    ALTER TABLE contractor_drivers ADD contractor_reviewed_at DATETIME2 NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_drivers') AND name = 'contractor_reviewed_by_user_id')
    ALTER TABLE contractor_drivers ADD contractor_reviewed_by_user_id UNIQUEIDENTIFIER NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_drivers') AND name = 'contractor_decline_reason')
    ALTER TABLE contractor_drivers ADD contractor_decline_reason NVARCHAR(MAX) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_drivers') AND name = 'added_by_user_id')
    ALTER TABLE contractor_drivers ADD added_by_user_id UNIQUEIDENTIFIER NULL;
END
GO

UPDATE contractor_drivers
SET contractor_approval_status = N'approved_contractor'
WHERE contractor_approval_status IS NULL;
GO

-- Link legacy trucks to subcontractor directory by company name.
UPDATE t
SET t.subcontractor_id = s.id
FROM contractor_trucks t
INNER JOIN contractor_subcontractors s
  ON s.tenant_id = t.tenant_id
  AND LTRIM(RTRIM(s.company_name)) = LTRIM(RTRIM(t.sub_contractor))
  AND LTRIM(RTRIM(t.sub_contractor)) <> ''
WHERE t.subcontractor_id IS NULL;
GO

-- Link legacy drivers via linked truck subcontractor.
UPDATE d
SET d.subcontractor_id = t.subcontractor_id
FROM contractor_drivers d
INNER JOIN contractor_trucks t ON t.id = d.linked_truck_id AND t.tenant_id = d.tenant_id
WHERE d.subcontractor_id IS NULL AND t.subcontractor_id IS NOT NULL;
GO
