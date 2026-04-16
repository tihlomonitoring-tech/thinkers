-- Performance evaluations (360-style), evaluation periods, improvement plans, auditor reviews.
-- Run: npm run db:performance-evaluations-schema
-- If only pe_evaluatee_improvement_plans / pe_auditor_reviews are missing: npm run db:performance-evaluations-patch

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'pe_questions')
CREATE TABLE pe_questions (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  category NVARCHAR(80) NOT NULL,
  question_text NVARCHAR(MAX) NOT NULL,
  is_active BIT NOT NULL DEFAULT 1,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_pe_questions_tenant' AND object_id = OBJECT_ID('pe_questions'))
  CREATE INDEX IX_pe_questions_tenant ON pe_questions(tenant_id, sort_order, is_active);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'pe_submissions')
CREATE TABLE pe_submissions (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evaluator_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
  evaluatee_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id),
  relationship_type NVARCHAR(64) NOT NULL,
  submitted_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_pe_submissions_evaluator_recent' AND object_id = OBJECT_ID('pe_submissions'))
  CREATE INDEX IX_pe_submissions_evaluator_recent ON pe_submissions(tenant_id, evaluator_user_id, evaluatee_user_id, relationship_type, submitted_at DESC);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'pe_answers')
CREATE TABLE pe_answers (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  submission_id UNIQUEIDENTIFIER NOT NULL REFERENCES pe_submissions(id) ON DELETE CASCADE,
  question_id UNIQUEIDENTIFIER NOT NULL REFERENCES pe_questions(id),
  score TINYINT NOT NULL,
  comment NVARCHAR(MAX) NULL,
  CONSTRAINT CK_pe_answers_score CHECK (score >= 1 AND score <= 3)
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UQ_pe_answers_submission_question' AND object_id = OBJECT_ID('pe_answers'))
  CREATE UNIQUE INDEX UQ_pe_answers_submission_question ON pe_answers(submission_id, question_id);
GO

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

-- Evaluation periods (management opens/closes; each submission belongs to one period)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'pe_evaluation_periods')
CREATE TABLE pe_evaluation_periods (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title NVARCHAR(200) NULL,
  is_open BIT NOT NULL CONSTRAINT DF_pe_eval_period_is_open DEFAULT 0,
  opened_at DATETIME2 NOT NULL CONSTRAINT DF_pe_eval_period_opened DEFAULT SYSUTCDATETIME(),
  closed_at DATETIME2 NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id),
  created_at DATETIME2 NOT NULL CONSTRAINT DF_pe_eval_period_created DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UQ_pe_evaluation_period_one_open' AND object_id = OBJECT_ID('pe_evaluation_periods'))
  CREATE UNIQUE NONCLUSTERED INDEX UQ_pe_evaluation_period_one_open
    ON pe_evaluation_periods(tenant_id)
    WHERE is_open = 1;
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('pe_submissions') AND name = 'evaluation_period_id')
  ALTER TABLE pe_submissions ADD evaluation_period_id UNIQUEIDENTIFIER NULL;
GO

IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('pe_submissions') AND name = 'evaluation_period_id')
BEGIN
  IF EXISTS (SELECT 1 FROM pe_submissions WHERE evaluation_period_id IS NULL)
  BEGIN
    INSERT INTO pe_evaluation_periods (id, tenant_id, title, is_open, opened_at, closed_at)
    SELECT NEWID(), s.tenant_id, N'Migrated (pre-period)', 0, SYSUTCDATETIME(), SYSUTCDATETIME()
    FROM (SELECT DISTINCT tenant_id FROM pe_submissions WHERE evaluation_period_id IS NULL) s;

    ;WITH p AS (
      SELECT s.tenant_id, MAX(ep.id) AS period_id
      FROM pe_submissions s
      INNER JOIN pe_evaluation_periods ep ON ep.tenant_id = s.tenant_id AND ep.title = N'Migrated (pre-period)' AND ep.is_open = 0
      WHERE s.evaluation_period_id IS NULL
      GROUP BY s.tenant_id
    )
    UPDATE s SET s.evaluation_period_id = p.period_id
    FROM pe_submissions s
    INNER JOIN p ON p.tenant_id = s.tenant_id
    WHERE s.evaluation_period_id IS NULL;
  END
END
GO

IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_pe_submissions_evaluation_period')
  AND EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('pe_submissions') AND name = 'evaluation_period_id')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pe_submissions WHERE evaluation_period_id IS NULL)
  BEGIN
    ALTER TABLE pe_submissions ALTER COLUMN evaluation_period_id UNIQUEIDENTIFIER NOT NULL;
    ALTER TABLE pe_submissions ADD CONSTRAINT FK_pe_submissions_evaluation_period
      FOREIGN KEY (evaluation_period_id) REFERENCES pe_evaluation_periods(id);
  END
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_pe_submissions_period_eval_dup' AND object_id = OBJECT_ID('pe_submissions'))
  CREATE INDEX IX_pe_submissions_period_eval_dup
    ON pe_submissions(tenant_id, evaluation_period_id, evaluator_user_id, evaluatee_user_id, relationship_type);
GO
