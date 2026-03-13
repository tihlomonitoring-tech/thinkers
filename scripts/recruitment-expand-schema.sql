-- Recruitment expand: panel members, tab grants, question allowed askers.
-- Run: node scripts/run-recruitment-expand-schema.js

-- Add columns to interview questions for creator and who can ask
-- created_by_user_id: user who created the question; allowed_asker_user_ids: JSON array of user IDs who may ask it
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('recruitment_interview_questions') AND name = 'created_by_user_id')
  ALTER TABLE recruitment_interview_questions ADD created_by_user_id UNIQUEIDENTIFIER NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('recruitment_interview_questions') AND name = 'allowed_asker_user_ids')
  ALTER TABLE recruitment_interview_questions ADD allowed_asker_user_ids NVARCHAR(MAX) NULL;
GO

-- Panel members: users who are part of the recruitment panel (receive invite email when added)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'recruitment_panel_members')
CREATE TABLE recruitment_panel_members (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  user_id UNIQUEIDENTIFIER NOT NULL,
  invited_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  email_sent_at DATETIME2 NULL,
  invited_by_user_id UNIQUEIDENTIFIER NULL,
  CONSTRAINT UQ_recruitment_panel_members_user UNIQUE (user_id)
);
GO

-- Recruitment tab access: which users can access which tabs (dashboard, recruit-registration, etc.)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'recruitment_tab_grants')
CREATE TABLE recruitment_tab_grants (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  user_id UNIQUEIDENTIFIER NOT NULL,
  tab_id NVARCHAR(50) NOT NULL,
  granted_by_user_id UNIQUEIDENTIFIER NULL,
  granted_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_recruitment_tab_grants_user_tab UNIQUE (user_id, tab_id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_recruitment_tab_grants_user_id' AND object_id = OBJECT_ID('recruitment_tab_grants'))
  CREATE INDEX IX_recruitment_tab_grants_user_id ON recruitment_tab_grants(user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_recruitment_tab_grants_tab_id' AND object_id = OBJECT_ID('recruitment_tab_grants'))
  CREATE INDEX IX_recruitment_tab_grants_tab_id ON recruitment_tab_grants(tab_id);
GO
