-- Transport Operations: reports and approvals (submitted_to, status, evaluation, approve).
-- Run: node scripts/run-transport-operations-approvals.js

-- Shift reports: who can approve, status, approved by/at
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('to_shift_reports') AND name = 'submitted_to_user_ids')
  ALTER TABLE to_shift_reports ADD submitted_to_user_ids NVARCHAR(MAX) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('to_shift_reports') AND name = 'status')
  ALTER TABLE to_shift_reports ADD status NVARCHAR(50) NOT NULL DEFAULT 'draft';
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('to_shift_reports') AND name = 'approved_by_user_id')
  ALTER TABLE to_shift_reports ADD approved_by_user_id UNIQUEIDENTIFIER NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('to_shift_reports') AND name = 'approved_at')
  ALTER TABLE to_shift_reports ADD approved_at DATETIME2 NULL;
GO

-- Evaluation before approval (one per report per evaluator; answers JSON)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'to_shift_report_evaluations')
CREATE TABLE to_shift_report_evaluations (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  shift_report_id UNIQUEIDENTIFIER NOT NULL,
  evaluator_user_id UNIQUEIDENTIFIER NOT NULL,
  answers NVARCHAR(MAX) NULL,
  overall_comment NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_to_shift_report_eval_report' AND object_id = OBJECT_ID('to_shift_report_evaluations'))
  CREATE INDEX IX_to_shift_report_eval_report ON to_shift_report_evaluations(shift_report_id);
GO
