-- Workshop management: job cards, line items (parts & labour), progress log, attachments
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'workshop_job_cards')
CREATE TABLE workshop_job_cards (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  maintenance_schedule_id UNIQUEIDENTIFIER NULL,
  truck_id UNIQUEIDENTIFIER NULL,
  fleet_registration NVARCHAR(100) NULL,
  trailer_registration NVARCHAR(100) NULL,
  maintenance_subject NVARCHAR(50) NOT NULL DEFAULT N'truck',
  job_card_number NVARCHAR(50) NULL,
  [status] NVARCHAR(30) NOT NULL DEFAULT N'open',
  provider_type NVARCHAR(20) NOT NULL DEFAULT N'internal',
  provider_company_name NVARCHAR(255) NULL,
  provider_contact_name NVARCHAR(255) NULL,
  provider_contact_phone NVARCHAR(100) NULL,
  provider_contact_email NVARCHAR(255) NULL,
  internal_user_id UNIQUEIDENTIFIER NULL,
  odometer_reading DECIMAL(12,1) NULL,
  description NVARCHAR(MAX) NULL,
  final_resolution NVARCHAR(MAX) NULL,
  next_maintenance_date DATE NULL,
  started_at DATETIME2 NULL,
  completed_at DATETIME2 NULL,
  linked_inspection_id UNIQUEIDENTIFIER NULL,
  created_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'workshop_job_card_items')
CREATE TABLE workshop_job_card_items (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  job_card_id UNIQUEIDENTIFIER NOT NULL REFERENCES workshop_job_cards(id) ON DELETE CASCADE,
  item_type NVARCHAR(30) NOT NULL DEFAULT N'part',
  description NVARCHAR(500) NOT NULL,
  part_number NVARCHAR(100) NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NULL,
  total_price AS (quantity * ISNULL(unit_price, 0)) PERSISTED,
  notes NVARCHAR(MAX) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'workshop_job_card_progress')
CREATE TABLE workshop_job_card_progress (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  job_card_id UNIQUEIDENTIFIER NOT NULL REFERENCES workshop_job_cards(id) ON DELETE CASCADE,
  entry_type NVARCHAR(30) NOT NULL DEFAULT N'note',
  note NVARCHAR(MAX) NOT NULL,
  recorded_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  recorded_by_name NVARCHAR(255) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'workshop_job_card_attachments')
CREATE TABLE workshop_job_card_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  job_card_id UNIQUEIDENTIFIER NOT NULL REFERENCES workshop_job_cards(id) ON DELETE CASCADE,
  item_id UNIQUEIDENTIFIER NULL REFERENCES workshop_job_card_items(id) ON DELETE NO ACTION,
  file_name NVARCHAR(255) NOT NULL,
  file_path NVARCHAR(500) NOT NULL,
  file_size INT NULL,
  mime_type NVARCHAR(100) NULL,
  uploaded_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wjc_tenant_status' AND object_id = OBJECT_ID('workshop_job_cards'))
  CREATE INDEX IX_wjc_tenant_status ON workshop_job_cards(tenant_id, [status]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wjc_schedule' AND object_id = OBJECT_ID('workshop_job_cards'))
  CREATE INDEX IX_wjc_schedule ON workshop_job_cards(maintenance_schedule_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wjci_card' AND object_id = OBJECT_ID('workshop_job_card_items'))
  CREATE INDEX IX_wjci_card ON workshop_job_card_items(job_card_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wjcp_card' AND object_id = OBJECT_ID('workshop_job_card_progress'))
  CREATE INDEX IX_wjcp_card ON workshop_job_card_progress(job_card_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wjca_card' AND object_id = OBJECT_ID('workshop_job_card_attachments'))
  CREATE INDEX IX_wjca_card ON workshop_job_card_attachments(job_card_id);
GO
