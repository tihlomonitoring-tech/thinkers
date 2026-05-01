-- Create only profile_documents, queries, evaluations, evaluation_comments, performance_improvement_plans if missing.
-- Run with: node scripts/run-create-missing-profile-tables.js
-- Use this if you get "Invalid object name" for these tables (e.g. profile-management schema was run before they were added).

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'profile_documents')
CREATE TABLE profile_documents (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  file_name NVARCHAR(500) NOT NULL,
  file_path NVARCHAR(1000) NOT NULL,
  category NVARCHAR(100) NULL,
  uploaded_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'queries')
CREATE TABLE queries (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  subject NVARCHAR(500) NOT NULL,
  body NVARCHAR(MAX) NULL,
  status NVARCHAR(20) NOT NULL DEFAULT N'open',
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  responded_at DATETIME2 NULL,
  response_text NVARCHAR(MAX) NULL,
  responded_by UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  CONSTRAINT CK_query_status CHECK (status IN (N'open', N'closed'))
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'evaluations')
CREATE TABLE evaluations (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  evaluator_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  period NVARCHAR(50) NOT NULL,
  rating NVARCHAR(50) NULL,
  notes NVARCHAR(MAX) NULL,
  file_path NVARCHAR(1000) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'evaluation_comments')
CREATE TABLE evaluation_comments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  evaluation_id UNIQUEIDENTIFIER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  body NVARCHAR(MAX) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'performance_improvement_plans')
CREATE TABLE performance_improvement_plans (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  title NVARCHAR(300) NOT NULL,
  goals NVARCHAR(MAX) NULL,
  status NVARCHAR(50) NOT NULL DEFAULT N'active',
  start_date DATE NULL,
  end_date DATE NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_profile_documents_user' AND object_id = OBJECT_ID('profile_documents'))
  CREATE INDEX IX_profile_documents_user ON profile_documents(user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_queries_tenant' AND object_id = OBJECT_ID('queries'))
  CREATE INDEX IX_queries_tenant ON queries(tenant_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_evaluations_user' AND object_id = OBJECT_ID('evaluations'))
  CREATE INDEX IX_evaluations_user ON evaluations(user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pip_user' AND object_id = OBJECT_ID('performance_improvement_plans'))
  CREATE INDEX IX_pip_user ON performance_improvement_plans(user_id);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'leave_types')
CREATE TABLE leave_types (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name NVARCHAR(100) NOT NULL,
  default_days_per_year INT NULL,
  sector NVARCHAR(20) NULL,
  description NVARCHAR(500) NULL,
  sort_order INT NOT NULL CONSTRAINT DF_leave_types_sort_order DEFAULT (100),
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_leave_types_tenant_name UNIQUE (tenant_id, name),
  CONSTRAINT CK_leave_types_sector CHECK (sector IS NULL OR sector IN (N'public', N'private', N'both'))
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'pip_progress_updates')
CREATE TABLE pip_progress_updates (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  pip_id UNIQUEIDENTIFIER NOT NULL REFERENCES performance_improvement_plans(id) ON DELETE CASCADE,
  progress_date DATE NOT NULL,
  notes NVARCHAR(MAX) NULL,
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'schedule_events')
CREATE TABLE schedule_events (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title NVARCHAR(300) NOT NULL,
  event_date DATE NOT NULL,
  description NVARCHAR(MAX) NULL,
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
