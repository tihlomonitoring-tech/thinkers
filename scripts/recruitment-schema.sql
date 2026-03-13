-- Recruitment module: vacancies, CV library, screening, interview, panel, results, appointments.
-- Run: node scripts/run-recruitment-schema.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'recruitment_vacancies')
CREATE TABLE recruitment_vacancies (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  title NVARCHAR(500) NOT NULL,
  role_title NVARCHAR(500) NULL,
  description NVARCHAR(MAX) NULL,
  requirements NVARCHAR(MAX) NULL,
  status NVARCHAR(50) NOT NULL DEFAULT N'draft',
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  created_by_user_id UNIQUEIDENTIFIER NULL
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'recruitment_cv_folders')
CREATE TABLE recruitment_cv_folders (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  name NVARCHAR(500) NOT NULL,
  parent_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'recruitment_cvs')
CREATE TABLE recruitment_cvs (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  folder_id UNIQUEIDENTIFIER NULL,
  file_name NVARCHAR(500) NOT NULL,
  file_path NVARCHAR(2000) NULL,
  applicant_name NVARCHAR(500) NULL,
  applicant_email NVARCHAR(500) NULL,
  uploaded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  created_by_user_id UNIQUEIDENTIFIER NULL
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'recruitment_applicants')
CREATE TABLE recruitment_applicants (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  vacancy_id UNIQUEIDENTIFIER NOT NULL,
  cv_id UNIQUEIDENTIFIER NULL,
  name NVARCHAR(500) NOT NULL,
  email NVARCHAR(500) NOT NULL,
  phone NVARCHAR(100) NULL,
  screening_grade NVARCHAR(50) NULL,
  screening_comments NVARCHAR(MAX) NULL,
  screening_call_notes NVARCHAR(MAX) NULL,
  screening_applicant_response NVARCHAR(MAX) NULL,
  screening_verdict NVARCHAR(50) NOT NULL DEFAULT N'pending',
  interview_invite_sent_at DATETIME2 NULL,
  interview_date DATETIME2 NULL,
  interview_location NVARCHAR(1000) NULL,
  interview_notes NVARCHAR(MAX) NULL,
  regret_sent_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'recruitment_interview_questions')
CREATE TABLE recruitment_interview_questions (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  vacancy_id UNIQUEIDENTIFIER NULL,
  question_text NVARCHAR(MAX) NOT NULL,
  possible_answers_json NVARCHAR(MAX) NULL,
  max_score INT NOT NULL DEFAULT 10,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'recruitment_panel_sessions')
CREATE TABLE recruitment_panel_sessions (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  applicant_id UNIQUEIDENTIFIER NOT NULL,
  vacancy_id UNIQUEIDENTIFIER NOT NULL,
  conducted_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  created_by_user_id UNIQUEIDENTIFIER NULL,
  total_score DECIMAL(10,2) NULL,
  overall_comments NVARCHAR(MAX) NULL
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'recruitment_panel_scores')
CREATE TABLE recruitment_panel_scores (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  session_id UNIQUEIDENTIFIER NOT NULL,
  question_id UNIQUEIDENTIFIER NOT NULL,
  score DECIMAL(10,2) NULL,
  comments NVARCHAR(MAX) NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'recruitment_appointments')
CREATE TABLE recruitment_appointments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  applicant_id UNIQUEIDENTIFIER NOT NULL,
  vacancy_id UNIQUEIDENTIFIER NOT NULL,
  congratulations_sent_at DATETIME2 NULL,
  regret_sent_at DATETIME2 NULL,
  status NVARCHAR(50) NOT NULL DEFAULT N'pending',
  response_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- Indexes
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_recruitment_applicants_vacancy' AND object_id = OBJECT_ID('recruitment_applicants'))
  CREATE INDEX IX_recruitment_applicants_vacancy ON recruitment_applicants(vacancy_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_recruitment_applicants_verdict' AND object_id = OBJECT_ID('recruitment_applicants'))
  CREATE INDEX IX_recruitment_applicants_verdict ON recruitment_applicants(screening_verdict);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_recruitment_cvs_folder' AND object_id = OBJECT_ID('recruitment_cvs'))
  CREATE INDEX IX_recruitment_cvs_folder ON recruitment_cvs(folder_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_recruitment_interview_questions_vacancy' AND object_id = OBJECT_ID('recruitment_interview_questions'))
  CREATE INDEX IX_recruitment_interview_questions_vacancy ON recruitment_interview_questions(vacancy_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_recruitment_panel_sessions_applicant' AND object_id = OBJECT_ID('recruitment_panel_sessions'))
  CREATE INDEX IX_recruitment_panel_sessions_applicant ON recruitment_panel_sessions(applicant_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_recruitment_appointments_applicant' AND object_id = OBJECT_ID('recruitment_appointments'))
  CREATE INDEX IX_recruitment_appointments_applicant ON recruitment_appointments(applicant_id);
GO
