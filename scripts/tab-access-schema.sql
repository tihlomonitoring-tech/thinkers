-- Unified tab access grants for Accounting, Management, and Contractor pages.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tab_access_grants')
CREATE TABLE tab_access_grants (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_key NVARCHAR(50) NOT NULL,
  tab_id NVARCHAR(100) NOT NULL,
  granted_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  granted_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_tab_access_grants UNIQUE (user_id, page_key, tab_id),
  CONSTRAINT CK_tag_page_key CHECK (page_key IN (N'accounting', N'management', N'contractor', N'tracking_management'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tag_user_page' AND object_id = OBJECT_ID('tab_access_grants'))
  CREATE INDEX IX_tag_user_page ON tab_access_grants(user_id, page_key);
GO
