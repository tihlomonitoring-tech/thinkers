-- Letter composition: drafted corporate letters (warning, reward, employment
-- contract, supply contract, SLA, letter of intent, promotion, contractor
-- termination, transfer, generic) with user-built custom sections, signatures,
-- selectable PDF templates, policy references, and Quick Sign export.
-- Run with: node scripts/run-letters-schema.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'letters')
CREATE TABLE letters (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  reference_number NVARCHAR(64) NOT NULL,
  letter_type NVARCHAR(50) NOT NULL DEFAULT N'generic',
  title NVARCHAR(500) NOT NULL,
  status NVARCHAR(20) NOT NULL DEFAULT N'draft',
  template_key NVARCHAR(50) NOT NULL DEFAULT N'executive',
  accent_color NVARCHAR(20) NULL,
  recipient_name NVARCHAR(255) NULL,
  recipient_title NVARCHAR(255) NULL,
  recipient_company NVARCHAR(255) NULL,
  recipient_address NVARCHAR(MAX) NULL,
  recipient_email NVARCHAR(255) NULL,
  letter_date DATE NULL,
  reference_line NVARCHAR(500) NULL,
  intro_body NVARCHAR(MAX) NULL,
  closing_text NVARCHAR(MAX) NULL,
  signatory_name NVARCHAR(255) NULL,
  signatory_title NVARCHAR(255) NULL,
  signature_data_url NVARCHAR(MAX) NULL,
  policy_refs NVARCHAR(MAX) NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  updated_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_letters_status CHECK (status IN (N'draft', N'final', N'archived'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_letters_tenant_type' AND object_id = OBJECT_ID('letters'))
  CREATE INDEX IX_letters_tenant_type ON letters(tenant_id, letter_type, status);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'letter_sections')
CREATE TABLE letter_sections (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  letter_id UNIQUEIDENTIFIER NOT NULL,
  heading NVARCHAR(500) NULL,
  body NVARCHAR(MAX) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT FK_letter_sections_letter FOREIGN KEY (letter_id) REFERENCES letters(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_letter_sections_letter' AND object_id = OBJECT_ID('letter_sections'))
  CREATE INDEX IX_letter_sections_letter ON letter_sections(letter_id, sort_order);
GO

-- Per-tenant atomic counter for reference numbers (LET-YYYY-0001).
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'letter_ref_counter')
CREATE TABLE letter_ref_counter (
  tenant_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
);
GO

-- Reusable starter templates. tenant_id NULL = global system template (seeded).
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'letter_templates')
CREATE TABLE letter_templates (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NULL,
  letter_type NVARCHAR(50) NOT NULL,
  template_name NVARCHAR(255) NOT NULL,
  description NVARCHAR(1000) NULL,
  intro_body NVARCHAR(MAX) NULL,
  sections_json NVARCHAR(MAX) NULL,
  closing_text NVARCHAR(MAX) NULL,
  is_system BIT NOT NULL DEFAULT 0,
  seed_key NVARCHAR(200) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_letter_templates_seed_key' AND object_id = OBJECT_ID('letter_templates'))
  CREATE UNIQUE INDEX UX_letter_templates_seed_key ON letter_templates(seed_key) WHERE seed_key IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_letter_templates_type' AND object_id = OBJECT_ID('letter_templates'))
  CREATE INDEX IX_letter_templates_type ON letter_templates(letter_type, sort_order);
GO

-- Quick Sign provenance: mark documents exported from Letter composition so the
-- new "Exported PDFs" tab can list them.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = N'source' AND Object_ID = Object_ID(N'quick_sign_requests'))
  ALTER TABLE quick_sign_requests ADD source NVARCHAR(30) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = N'source_letter_id' AND Object_ID = Object_ID(N'quick_sign_requests'))
  ALTER TABLE quick_sign_requests ADD source_letter_id UNIQUEIDENTIFIER NULL;
GO
