-- Add per-tenant sequential reference numbers to shift reports
-- (regular + single-operations) and back-fill existing rows.
-- Run: npm run db:cc-shift-report-ref-numbers

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('command_centre_shift_reports') AND name = 'ref_number')
  ALTER TABLE command_centre_shift_reports ADD ref_number INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('command_centre_single_ops_shift_reports') AND name = 'ref_number')
  ALTER TABLE command_centre_single_ops_shift_reports ADD ref_number INT NULL;
GO

-- Back-fill ref_number for standard shift reports (per-tenant sequence by created_at).
;WITH numbered AS (
  SELECT r.id,
         ROW_NUMBER() OVER (PARTITION BY u.tenant_id ORDER BY r.created_at, r.id) AS rn
  FROM command_centre_shift_reports r
  JOIN users u ON u.id = r.created_by_user_id
  WHERE r.ref_number IS NULL
)
UPDATE r
SET r.ref_number = n.rn
FROM command_centre_shift_reports r
JOIN numbered n ON n.id = r.id;
GO

-- Back-fill ref_number for single-operations shift reports.
;WITH numbered AS (
  SELECT r.id,
         ROW_NUMBER() OVER (PARTITION BY u.tenant_id ORDER BY r.created_at, r.id) AS rn
  FROM command_centre_single_ops_shift_reports r
  JOIN users u ON u.id = r.created_by_user_id
  WHERE r.ref_number IS NULL
)
UPDATE r
SET r.ref_number = n.rn
FROM command_centre_single_ops_shift_reports r
JOIN numbered n ON n.id = r.id;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_sr_ref_number' AND object_id = OBJECT_ID('command_centre_shift_reports'))
  CREATE INDEX IX_cc_sr_ref_number ON command_centre_shift_reports(ref_number);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_so_sr_ref_number' AND object_id = OBJECT_ID('command_centre_single_ops_shift_reports'))
  CREATE INDEX IX_cc_so_sr_ref_number ON command_centre_single_ops_shift_reports(ref_number);
GO
