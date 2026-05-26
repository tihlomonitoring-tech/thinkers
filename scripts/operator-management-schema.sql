-- Operator management: time-based work schedules, productivity scores, wages & salary.
-- Run: npm run db:operator-management

-- 1) Operator work schedules (hours/time-based, NOT shift-based)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'operator_work_schedules')
CREATE TABLE operator_work_schedules (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  work_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  scheduled_hours AS DATEDIFF(MINUTE, start_time, end_time) / 60.0 PERSISTED,
  break_minutes INT NOT NULL DEFAULT 0,
  schedule_type NVARCHAR(30) NOT NULL DEFAULT N'regular',
  notes NVARCHAR(MAX) NULL,
  created_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_ows_type CHECK (schedule_type IN (N'regular', N'overtime', N'public_holiday', N'weekend', N'standby'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ows_tenant_user_date' AND object_id = OBJECT_ID('operator_work_schedules'))
  CREATE INDEX IX_ows_tenant_user_date ON operator_work_schedules(tenant_id, user_id, work_date DESC);
GO

-- 2) Operator actual clock records (what was actually worked)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'operator_clock_records')
CREATE TABLE operator_clock_records (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  schedule_id UNIQUEIDENTIFIER NULL,
  work_date DATE NOT NULL,
  clock_in DATETIME2 NOT NULL,
  clock_out DATETIME2 NULL,
  actual_hours AS CASE WHEN clock_out IS NOT NULL THEN DATEDIFF(MINUTE, clock_in, clock_out) / 60.0 ELSE NULL END PERSISTED,
  break_minutes INT NOT NULL DEFAULT 0,
  [status] NVARCHAR(20) NOT NULL DEFAULT N'active',
  notes NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_ocr_status CHECK ([status] IN (N'active', N'completed', N'cancelled'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ocr_tenant_user_date' AND object_id = OBJECT_ID('operator_clock_records'))
  CREATE INDEX IX_ocr_tenant_user_date ON operator_clock_records(tenant_id, user_id, work_date DESC);
GO

-- 3) Operator delivery log (links deliveries to productivity)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'operator_delivery_log')
CREATE TABLE operator_delivery_log (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  delivery_date DATE NOT NULL,
  delivery_time DATETIME2 NOT NULL,
  origin NVARCHAR(255) NULL,
  destination NVARCHAR(255) NULL,
  load_description NVARCHAR(500) NULL,
  weight_kg DECIMAL(12,2) NULL,
  truck_registration NVARCHAR(100) NULL,
  trip_reference NVARCHAR(100) NULL,
  [status] NVARCHAR(30) NOT NULL DEFAULT N'completed',
  on_time BIT NOT NULL DEFAULT 1,
  expected_delivery_time DATETIME2 NULL,
  notes NVARCHAR(MAX) NULL,
  recorded_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_odl_status CHECK ([status] IN (N'completed', N'in_transit', N'delayed', N'cancelled'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_odl_tenant_user_date' AND object_id = OBJECT_ID('operator_delivery_log'))
  CREATE INDEX IX_odl_tenant_user_date ON operator_delivery_log(tenant_id, user_id, delivery_date DESC);
GO

-- 4) Operator productivity scores (computed and stored periodically)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'operator_productivity_scores')
CREATE TABLE operator_productivity_scores (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_deliveries INT NOT NULL DEFAULT 0,
  on_time_deliveries INT NOT NULL DEFAULT 0,
  late_deliveries INT NOT NULL DEFAULT 0,
  cancelled_deliveries INT NOT NULL DEFAULT 0,
  scheduled_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  actual_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  attendance_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  delivery_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  punctuality_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  overall_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  computed_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_ops_user_period UNIQUE (user_id, period_start, period_end)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ops_tenant_period' AND object_id = OBJECT_ID('operator_productivity_scores'))
  CREATE INDEX IX_ops_tenant_period ON operator_productivity_scores(tenant_id, period_start, period_end);
GO

-- 5) Wages & salary records
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'operator_wage_config')
CREATE TABLE operator_wage_config (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  pay_type NVARCHAR(20) NOT NULL DEFAULT N'hourly',
  base_rate DECIMAL(12,2) NOT NULL DEFAULT 0,
  overtime_rate DECIMAL(12,2) NULL,
  weekend_rate DECIMAL(12,2) NULL,
  holiday_rate DECIMAL(12,2) NULL,
  currency NVARCHAR(10) NOT NULL DEFAULT N'ZAR',
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  notes NVARCHAR(MAX) NULL,
  created_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_owc_paytype CHECK (pay_type IN (N'hourly', N'daily', N'weekly', N'monthly'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_owc_tenant_user' AND object_id = OBJECT_ID('operator_wage_config'))
  CREATE INDEX IX_owc_tenant_user ON operator_wage_config(tenant_id, user_id);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'operator_pay_records')
CREATE TABLE operator_pay_records (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  regular_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  overtime_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  weekend_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  holiday_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
  base_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  overtime_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  weekend_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  holiday_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
  deduction_notes NVARCHAR(MAX) NULL,
  bonuses DECIMAL(12,2) NOT NULL DEFAULT 0,
  bonus_notes NVARCHAR(MAX) NULL,
  gross_amount AS (base_amount + overtime_amount + weekend_amount + holiday_amount + bonuses) PERSISTED,
  net_amount AS (base_amount + overtime_amount + weekend_amount + holiday_amount + bonuses - deductions) PERSISTED,
  [status] NVARCHAR(20) NOT NULL DEFAULT N'draft',
  approved_by_user_id UNIQUEIDENTIFIER NULL REFERENCES users(id) ON DELETE NO ACTION,
  approved_at DATETIME2 NULL,
  paid_at DATETIME2 NULL,
  notes NVARCHAR(MAX) NULL,
  created_by_user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_opr_status CHECK ([status] IN (N'draft', N'pending', N'approved', N'paid', N'cancelled'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_opr_tenant_user_period' AND object_id = OBJECT_ID('operator_pay_records'))
  CREATE INDEX IX_opr_tenant_user_period ON operator_pay_records(tenant_id, user_id, pay_period_start DESC);
GO
