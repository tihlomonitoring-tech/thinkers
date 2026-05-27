-- Fleet facility access checklists per contractor / sub-contractor scope (Command Centre bottleneck tracking).
-- Run: npm run db:fleet-facility-checklist

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cc_fleet_facility_checklists')
CREATE TABLE cc_fleet_facility_checklists (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contractor_id UNIQUEIDENTIFIER NOT NULL,
  subcontractor_scope_key NVARCHAR(100) NOT NULL,
  subcontractor_id UNIQUEIDENTIFIER NULL,
  consent_letter_checked BIT NOT NULL DEFAULT 0,
  credentials_checked BIT NOT NULL DEFAULT 0,
  tracking_provider_checked BIT NOT NULL DEFAULT 0,
  updated_by_user_id UNIQUEIDENTIFIER NULL,
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_cc_fleet_facility_checklist_scope UNIQUE (tenant_id, contractor_id, subcontractor_scope_key)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_cc_ffc_contractor' AND parent_object_id = OBJECT_ID('cc_fleet_facility_checklists'))
  ALTER TABLE cc_fleet_facility_checklists ADD CONSTRAINT FK_cc_ffc_contractor FOREIGN KEY (contractor_id) REFERENCES contractors(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_cc_ffc_updated_by' AND parent_object_id = OBJECT_ID('cc_fleet_facility_checklists'))
  ALTER TABLE cc_fleet_facility_checklists ADD CONSTRAINT FK_cc_ffc_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_ffc_tenant' AND object_id = OBJECT_ID('cc_fleet_facility_checklists'))
  CREATE INDEX IX_cc_ffc_tenant ON cc_fleet_facility_checklists(tenant_id);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cc_fleet_facility_checklist_attachments')
CREATE TABLE cc_fleet_facility_checklist_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  checklist_id UNIQUEIDENTIFIER NOT NULL REFERENCES cc_fleet_facility_checklists(id) ON DELETE CASCADE,
  item_type NVARCHAR(30) NOT NULL,
  file_name NVARCHAR(500) NOT NULL,
  stored_path NVARCHAR(1000) NOT NULL,
  mime_type NVARCHAR(200) NULL,
  file_size BIGINT NULL,
  uploaded_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_cc_ffc_att_type CHECK (item_type IN (N'consent_letter', N'credentials', N'general'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_cc_ffc_att_user' AND parent_object_id = OBJECT_ID('cc_fleet_facility_checklist_attachments'))
  ALTER TABLE cc_fleet_facility_checklist_attachments ADD CONSTRAINT FK_cc_ffc_att_user FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_ffc_att_checklist' AND object_id = OBJECT_ID('cc_fleet_facility_checklist_attachments'))
  CREATE INDEX IX_cc_ffc_att_checklist ON cc_fleet_facility_checklist_attachments(checklist_id, item_type);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cc_fleet_facility_checklist_comments')
CREATE TABLE cc_fleet_facility_checklist_comments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  checklist_id UNIQUEIDENTIFIER NOT NULL REFERENCES cc_fleet_facility_checklists(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  body NVARCHAR(MAX) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_ffc_comments_checklist' AND object_id = OBJECT_ID('cc_fleet_facility_checklist_comments'))
  CREATE INDEX IX_cc_ffc_comments_checklist ON cc_fleet_facility_checklist_comments(checklist_id, created_at ASC);
GO
