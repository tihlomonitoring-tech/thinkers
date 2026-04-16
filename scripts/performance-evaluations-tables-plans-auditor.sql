-- Patch: improvement plans + auditor reviews (run if you see "Invalid object name pe_evaluatee_improvement_plans" or "pe_auditor_reviews").
-- Requires: pe_submissions already exists. Safe to re-run (IF NOT EXISTS).
-- Run: npm run db:performance-evaluations-patch
-- Or: node scripts/run-performance-evaluations-patch.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'pe_evaluatee_improvement_plans')
CREATE TABLE pe_evaluatee_improvement_plans (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE NO ACTION,
  submission_id UNIQUEIDENTIFIER NOT NULL REFERENCES pe_submissions(id) ON DELETE CASCADE,
  evaluatee_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
  addressing_feedback NVARCHAR(MAX) NOT NULL,
  will_do_differently NVARCHAR(MAX) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UQ_pe_eval_plan_submission' AND object_id = OBJECT_ID('pe_evaluatee_improvement_plans'))
  CREATE UNIQUE INDEX UQ_pe_eval_plan_submission ON pe_evaluatee_improvement_plans(submission_id);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'pe_auditor_reviews')
CREATE TABLE pe_auditor_reviews (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE NO ACTION,
  submission_id UNIQUEIDENTIFIER NOT NULL REFERENCES pe_submissions(id) ON DELETE CASCADE,
  auditor_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
  fairness_rating TINYINT NULL,
  recommendations NVARCHAR(MAX) NULL,
  audit_report NVARCHAR(MAX) NULL,
  management_response NVARCHAR(MAX) NULL,
  management_submitted_at DATETIME2 NULL,
  auditor_followup_comment NVARCHAR(MAX) NULL,
  auditor_followup_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_pe_auditor_fairness CHECK (fairness_rating IS NULL OR (fairness_rating >= 1 AND fairness_rating <= 5))
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UQ_pe_auditor_submission' AND object_id = OBJECT_ID('pe_auditor_reviews'))
  CREATE UNIQUE INDEX UQ_pe_auditor_submission ON pe_auditor_reviews(submission_id);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_pe_auditor_reviews_tenant' AND object_id = OBJECT_ID('pe_auditor_reviews'))
  CREATE INDEX IX_pe_auditor_reviews_tenant ON pe_auditor_reviews(tenant_id, created_at DESC);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'pe_management_eval_workspace')
CREATE TABLE pe_management_eval_workspace (
  tenant_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  trends_notes NVARCHAR(MAX) NULL,
  improvement_plan NVARCHAR(MAX) NULL,
  progress_report_started BIT NOT NULL DEFAULT 0,
  updated_by UNIQUEIDENTIFIER NULL REFERENCES users(id),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
