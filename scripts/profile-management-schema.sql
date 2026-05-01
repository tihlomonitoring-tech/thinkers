-- Profile & Management: work schedules, leave, documents, warnings, rewards, queries, evaluations, PIP. Run with: node scripts/run-profile-management-schema.js

-- Work schedules: each schedule belongs to ONE employee (user_id). Private to that user; management can create/edit for any employee.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'work_schedules')
CREATE TABLE work_schedules (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  title NVARCHAR(200) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  created_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'work_schedule_entries')
CREATE TABLE work_schedule_entries (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  work_schedule_id UNIQUEIDENTIFIER NOT NULL REFERENCES work_schedules(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  shift_type NVARCHAR(20) NOT NULL,
  notes NVARCHAR(500) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_shift_type CHECK (shift_type IN (N'day', N'night'))
);
GO

-- Leave
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'leave_applications')
CREATE TABLE leave_applications (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  leave_type NVARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_requested INT NOT NULL,
  reason NVARCHAR(MAX) NULL,
  status NVARCHAR(20) NOT NULL DEFAULT N'pending',
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  reviewed_by UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  reviewed_at DATETIME2 NULL,
  review_notes NVARCHAR(MAX) NULL,
  CONSTRAINT CK_leave_status CHECK (status IN (N'pending', N'approved', N'rejected'))
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'leave_attachments')
CREATE TABLE leave_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  leave_application_id UNIQUEIDENTIFIER NOT NULL REFERENCES leave_applications(id) ON DELETE CASCADE,
  file_name NVARCHAR(500) NOT NULL,
  file_path NVARCHAR(1000) NOT NULL,
  uploaded_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'leave_balance')
CREATE TABLE leave_balance (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE NO ACTION,
  [year] INT NOT NULL,
  leave_type NVARCHAR(100) NOT NULL,
  total_days INT NOT NULL DEFAULT 0,
  used_days INT NOT NULL DEFAULT 0,
  CONSTRAINT UQ_leave_balance_user_year_type UNIQUE (user_id, [year], leave_type)
);
GO

-- Leave types (tenant-defined; users pick when applying)
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

-- Employee documents
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

-- Disciplinary & rewards
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'disciplinary_warnings')
CREATE TABLE disciplinary_warnings (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  issued_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  warning_type NVARCHAR(100) NOT NULL,
  description NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'rewards')
CREATE TABLE rewards (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  issued_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  reward_type NVARCHAR(100) NOT NULL,
  description NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- Queries (grievances)
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

-- Evaluations
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

-- Performance improvement plans
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

-- PIP progress updates
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

-- Schedule events (company/tenant events shown on work schedule)
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

-- Shift swap requests: peer approval then management approval; on final approve, entry dates/shifts are swapped.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'shift_swap_requests')
CREATE TABLE shift_swap_requests (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requester_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  counterparty_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  requester_entry_id UNIQUEIDENTIFIER NOT NULL REFERENCES work_schedule_entries(id) ON DELETE NO ACTION,
  counterparty_entry_id UNIQUEIDENTIFIER NOT NULL REFERENCES work_schedule_entries(id) ON DELETE NO ACTION,
  message NVARCHAR(500) NULL,
  status NVARCHAR(30) NOT NULL DEFAULT N'pending_peer',
  peer_reviewed_at DATETIME2 NULL,
  peer_review_notes NVARCHAR(500) NULL,
  management_reviewed_at DATETIME2 NULL,
  management_review_notes NVARCHAR(500) NULL,
  management_reviewed_by UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_shift_swap_status CHECK (status IN (N'pending_peer', N'peer_declined', N'pending_management', N'management_approved', N'management_declined', N'cancelled'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_shift_swap_requests_tenant_status' AND object_id = OBJECT_ID('shift_swap_requests'))
  CREATE INDEX IX_shift_swap_requests_tenant_status ON shift_swap_requests(tenant_id, status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_shift_swap_requests_requester' AND object_id = OBJECT_ID('shift_swap_requests'))
  CREATE INDEX IX_shift_swap_requests_requester ON shift_swap_requests(requester_user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_shift_swap_requests_counterparty' AND object_id = OBJECT_ID('shift_swap_requests'))
  CREATE INDEX IX_shift_swap_requests_counterparty ON shift_swap_requests(counterparty_user_id);
GO

-- Ensure work_schedules has user_id (for DBs where table existed before per-employee change)
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'work_schedules')
   AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('work_schedules') AND name = 'user_id')
BEGIN
  ALTER TABLE work_schedules ADD user_id UNIQUEIDENTIFIER NULL;
  UPDATE work_schedules SET user_id = created_by WHERE user_id IS NULL;
  ALTER TABLE work_schedules ALTER COLUMN user_id UNIQUEIDENTIFIER NOT NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_work_schedules_user')
    ALTER TABLE work_schedules ADD CONSTRAINT FK_work_schedules_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION;
END
GO

-- Indexes
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_work_schedules_tenant' AND object_id = OBJECT_ID('work_schedules'))
  CREATE INDEX IX_work_schedules_tenant ON work_schedules(tenant_id);
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('work_schedules') AND name = 'user_id')
  AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_work_schedules_user' AND object_id = OBJECT_ID('work_schedules'))
  CREATE INDEX IX_work_schedules_user ON work_schedules(user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_work_schedule_entries_schedule' AND object_id = OBJECT_ID('work_schedule_entries'))
  CREATE INDEX IX_work_schedule_entries_schedule ON work_schedule_entries(work_schedule_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_leave_applications_tenant' AND object_id = OBJECT_ID('leave_applications'))
  CREATE INDEX IX_leave_applications_tenant ON leave_applications(tenant_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_leave_applications_user' AND object_id = OBJECT_ID('leave_applications'))
  CREATE INDEX IX_leave_applications_user ON leave_applications(user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_profile_documents_user' AND object_id = OBJECT_ID('profile_documents'))
  CREATE INDEX IX_profile_documents_user ON profile_documents(user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_queries_tenant' AND object_id = OBJECT_ID('queries'))
  CREATE INDEX IX_queries_tenant ON queries(tenant_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_evaluations_user' AND object_id = OBJECT_ID('evaluations'))
  CREATE INDEX IX_evaluations_user ON evaluations(user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pip_user' AND object_id = OBJECT_ID('performance_improvement_plans'))
  CREATE INDEX IX_pip_user ON performance_improvement_plans(user_id);
GO
