-- Employee details (Profile) + attachments with virtual folder labels. Run: npm run db:employee-details

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_details')
CREATE TABLE employee_details (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  legal_first_names NVARCHAR(300) NULL,
  legal_surname NVARCHAR(300) NULL,
  id_document_number NVARCHAR(80) NULL,
  residential_address NVARCHAR(MAX) NULL,
  next_of_kin_name NVARCHAR(300) NULL,
  next_of_kin_relationship NVARCHAR(120) NULL,
  next_of_kin_phone NVARCHAR(120) NULL,
  next_of_kin_email NVARCHAR(256) NULL,
  medical_aid_provider NVARCHAR(300) NULL,
  medical_aid_member_no NVARCHAR(120) NULL,
  medical_aid_plan NVARCHAR(200) NULL,
  medical_aid_notes NVARCHAR(MAX) NULL,
  bank_name NVARCHAR(200) NULL,
  bank_account_holder NVARCHAR(300) NULL,
  bank_account_number NVARCHAR(80) NULL,
  bank_branch_code NVARCHAR(50) NULL,
  bank_account_type NVARCHAR(80) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_employee_details_tenant_user UNIQUE (tenant_id, user_id)
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_employee_details_user' AND object_id = OBJECT_ID(N'dbo.employee_details'))
CREATE INDEX IX_employee_details_user ON employee_details(user_id);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_detail_attachments')
CREATE TABLE employee_detail_attachments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  folder_name NVARCHAR(200) NOT NULL DEFAULT N'General',
  file_name NVARCHAR(500) NOT NULL,
  file_path NVARCHAR(1000) NOT NULL,
  uploaded_by UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_employee_detail_attachments_user' AND object_id = OBJECT_ID(N'dbo.employee_detail_attachments'))
CREATE INDEX IX_employee_detail_attachments_user ON employee_detail_attachments(tenant_id, user_id);
GO
