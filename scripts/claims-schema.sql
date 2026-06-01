-- Claims and reimbursements system.

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'claims')
CREATE TABLE claims (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference_number NVARCHAR(30) NOT NULL,
  claim_date DATE NOT NULL,
  claim_type NVARCHAR(50) NOT NULL,
  category NVARCHAR(100) NULL,
  department_name NVARCHAR(255) NULL,
  description NVARCHAR(MAX) NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  currency NVARCHAR(10) NOT NULL DEFAULT N'ZAR',

  -- Travel / KM fields
  km_travelled DECIMAL(10,2) NULL,
  start_location NVARCHAR(500) NULL,
  end_location NVARCHAR(500) NULL,
  vehicle_registration NVARCHAR(100) NULL,
  rate_per_km DECIMAL(10,2) NULL,

  -- Service fields
  service_rendered NVARCHAR(500) NULL,
  hours_spent DECIMAL(8,2) NULL,
  hourly_rate DECIMAL(10,2) NULL,

  -- Overtime (SA BCEA)
  ot_period_end DATE NULL,
  ot_weekday_hours DECIMAL(8,2) NULL,
  ot_sunday_hours DECIMAL(8,2) NULL,
  ot_public_holiday_hours DECIMAL(8,2) NULL,

  -- Banking details
  bank_name NVARCHAR(255) NULL,
  account_holder NVARCHAR(255) NULL,
  account_number NVARCHAR(100) NULL,
  branch_code NVARCHAR(50) NULL,
  account_type NVARCHAR(50) NULL,

  -- Declaration
  declaration_accepted BIT NOT NULL DEFAULT 0,
  declaration_text NVARCHAR(MAX) NULL,

  -- Status & workflow
  [status] NVARCHAR(20) NOT NULL DEFAULT N'pending',
  reviewed_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  reviewed_at DATETIME2 NULL,
  review_notes NVARCHAR(MAX) NULL,
  rejection_reason NVARCHAR(500) NULL,

  -- Link to expense (auto-created on approval)
  expense_entry_id UNIQUEIDENTIFIER NULL,

  -- Metadata
  claimant_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),

  CONSTRAINT CK_claims_type CHECK (claim_type IN (N'fuel', N'travel', N'accommodation', N'meals', N'equipment', N'tools', N'training', N'communication', N'service', N'overtime', N'other')),
  CONSTRAINT CK_claims_status CHECK ([status] IN (N'draft', N'pending', N'approved', N'declined', N'paid', N'cancelled'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_claims_tenant_date' AND object_id = OBJECT_ID('claims'))
  CREATE INDEX IX_claims_tenant_date ON claims(tenant_id, claim_date DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_claims_claimant' AND object_id = OBJECT_ID('claims'))
  CREATE INDEX IX_claims_claimant ON claims(claimant_user_id, [status]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_claims_status' AND object_id = OBJECT_ID('claims'))
  CREATE INDEX IX_claims_status ON claims(tenant_id, [status]);
GO

-- Claim attachments (receipts, invoices)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'claim_attachments')
CREATE TABLE claim_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  claim_id UNIQUEIDENTIFIER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  file_name NVARCHAR(500) NOT NULL,
  file_path NVARCHAR(1000) NOT NULL,
  file_size INT NULL,
  mime_type NVARCHAR(100) NULL,
  uploaded_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- Auto-increment counter for claim references
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'claim_counter')
CREATE TABLE claim_counter (
  tenant_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_number INT NOT NULL DEFAULT 0
);
GO
