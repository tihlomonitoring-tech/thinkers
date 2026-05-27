-- Fix shift report reference numbers: tenant_id, atomic counter, de-dupe, unique per tenant.
-- Run: npm run db:cc-shift-report-ref-counter

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('command_centre_shift_reports') AND name = 'ref_number')
  ALTER TABLE command_centre_shift_reports ADD ref_number INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('command_centre_single_ops_shift_reports') AND name = 'ref_number')
  ALTER TABLE command_centre_single_ops_shift_reports ADD ref_number INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('command_centre_shift_reports') AND name = 'tenant_id')
  ALTER TABLE command_centre_shift_reports ADD tenant_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('command_centre_single_ops_shift_reports') AND name = 'tenant_id')
  ALTER TABLE command_centre_single_ops_shift_reports ADD tenant_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cc_shift_report_ref_counter')
CREATE TABLE cc_shift_report_ref_counter (
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  report_kind NVARCHAR(20) NOT NULL,
  last_number INT NOT NULL DEFAULT 0,
  CONSTRAINT PK_cc_shift_report_ref_counter PRIMARY KEY (tenant_id, report_kind),
  CONSTRAINT CK_cc_shift_report_ref_counter_kind CHECK (report_kind IN (N'shift', N'single_ops'))
);
GO

-- Back-fill tenant_id from report creator.
UPDATE r
SET r.tenant_id = u.tenant_id
FROM command_centre_shift_reports r
JOIN users u ON u.id = r.created_by_user_id
WHERE r.tenant_id IS NULL AND u.tenant_id IS NOT NULL;
GO

UPDATE r
SET r.tenant_id = u.tenant_id
FROM command_centre_single_ops_shift_reports r
JOIN users u ON u.id = r.created_by_user_id
WHERE r.tenant_id IS NULL AND u.tenant_id IS NOT NULL;
GO

-- Re-sequence standard shift reports per tenant (fixes duplicates).
;WITH numbered AS (
  SELECT r.id,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(r.tenant_id, u.tenant_id)
           ORDER BY r.created_at, r.id
         ) AS rn
  FROM command_centre_shift_reports r
  JOIN users u ON u.id = r.created_by_user_id
  WHERE COALESCE(r.tenant_id, u.tenant_id) IS NOT NULL
)
UPDATE r
SET r.ref_number = n.rn,
    r.tenant_id = COALESCE(r.tenant_id, u.tenant_id)
FROM command_centre_shift_reports r
JOIN users u ON u.id = r.created_by_user_id
JOIN numbered n ON n.id = r.id;
GO

-- Re-sequence single-operations shift reports per tenant.
;WITH numbered AS (
  SELECT r.id,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(r.tenant_id, u.tenant_id)
           ORDER BY r.created_at, r.id
         ) AS rn
  FROM command_centre_single_ops_shift_reports r
  JOIN users u ON u.id = r.created_by_user_id
  WHERE COALESCE(r.tenant_id, u.tenant_id) IS NOT NULL
)
UPDATE r
SET r.ref_number = n.rn,
    r.tenant_id = COALESCE(r.tenant_id, u.tenant_id)
FROM command_centre_single_ops_shift_reports r
JOIN users u ON u.id = r.created_by_user_id
JOIN numbered n ON n.id = r.id;
GO

-- Sync counters from current max ref per tenant.
MERGE cc_shift_report_ref_counter AS t
USING (
  SELECT r.tenant_id, N'shift' AS report_kind, MAX(r.ref_number) AS max_ref
  FROM command_centre_shift_reports r
  WHERE r.tenant_id IS NOT NULL AND r.ref_number IS NOT NULL
  GROUP BY r.tenant_id
) AS s ON t.tenant_id = s.tenant_id AND t.report_kind = s.report_kind
WHEN MATCHED THEN UPDATE SET last_number = s.max_ref
WHEN NOT MATCHED THEN INSERT (tenant_id, report_kind, last_number) VALUES (s.tenant_id, s.report_kind, s.max_ref);
GO

MERGE cc_shift_report_ref_counter AS t
USING (
  SELECT r.tenant_id, N'single_ops' AS report_kind, MAX(r.ref_number) AS max_ref
  FROM command_centre_single_ops_shift_reports r
  WHERE r.tenant_id IS NOT NULL AND r.ref_number IS NOT NULL
  GROUP BY r.tenant_id
) AS s ON t.tenant_id = s.tenant_id AND t.report_kind = s.report_kind
WHEN MATCHED THEN UPDATE SET last_number = s.max_ref
WHEN NOT MATCHED THEN INSERT (tenant_id, report_kind, last_number) VALUES (s.tenant_id, s.report_kind, s.max_ref);
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_cc_sr_tenant_ref' AND object_id = OBJECT_ID('command_centre_shift_reports'))
  DROP INDEX UX_cc_sr_tenant_ref ON command_centre_shift_reports;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_cc_sr_tenant_ref' AND object_id = OBJECT_ID('command_centre_shift_reports'))
  CREATE UNIQUE INDEX UX_cc_sr_tenant_ref ON command_centre_shift_reports(tenant_id, ref_number)
  WHERE tenant_id IS NOT NULL AND ref_number IS NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_cc_sosr_tenant_ref' AND object_id = OBJECT_ID('command_centre_single_ops_shift_reports'))
  DROP INDEX UX_cc_sosr_tenant_ref ON command_centre_single_ops_shift_reports;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_cc_sosr_tenant_ref' AND object_id = OBJECT_ID('command_centre_single_ops_shift_reports'))
  CREATE UNIQUE INDEX UX_cc_sosr_tenant_ref ON command_centre_single_ops_shift_reports(tenant_id, ref_number)
  WHERE tenant_id IS NOT NULL AND ref_number IS NOT NULL;
GO
