IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'logistics_daily_plan')
CREATE TABLE logistics_daily_plan (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  plan_date DATE NOT NULL,
  status NVARCHAR(20) NOT NULL CONSTRAINT DF_ldp_status DEFAULT N'draft',
  source NVARCHAR(20) NOT NULL CONSTRAINT DF_ldp_source DEFAULT N'manual',
  title NVARCHAR(200) NULL,
  execution_notes NVARCHAR(MAX) NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  accepted_at DATETIME2 NULL,
  published_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_ldp_tenant_date UNIQUE (tenant_id, plan_date)
);

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'logistics_plan_route')
CREATE TABLE logistics_plan_route (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  plan_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  contractor_route_id UNIQUEIDENTIFIER NOT NULL,
  priority_rank INT NOT NULL CONSTRAINT DF_lpr_rank DEFAULT 1,
  is_plan_b BIT NOT NULL CONSTRAINT DF_lpr_plan_b DEFAULT 0,
  plan_b_route_id UNIQUEIDENTIFIER NULL,
  expected_loads INT NULL,
  expected_tons DECIMAL(12,3) NULL,
  expected_revenue DECIMAL(14,2) NULL,
  expected_margin DECIMAL(14,2) NULL,
  risk_level NVARCHAR(20) NULL,
  risk_mitigation NVARCHAR(MAX) NULL,
  execution_reason NVARCHAR(MAX) NULL,
  system_score DECIMAL(8,2) NULL,
  system_advice NVARCHAR(MAX) NULL,
  enabled BIT NOT NULL CONSTRAINT DF_lpr_enabled DEFAULT 1,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_lpr_plan' AND object_id = OBJECT_ID('logistics_plan_route'))
  CREATE INDEX IX_lpr_plan ON logistics_plan_route(plan_id, priority_rank);

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'logistics_schedule_deviation')
CREATE TABLE logistics_schedule_deviation (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  plan_id UNIQUEIDENTIFIER NULL,
  trip_id UNIQUEIDENTIFIER NULL,
  truck_registration NVARCHAR(40) NOT NULL,
  planned_route_id UNIQUEIDENTIFIER NULL,
  actual_route_id UNIQUEIDENTIFIER NOT NULL,
  justification NVARCHAR(MAX) NOT NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_lsd_tenant_created' AND object_id = OBJECT_ID('logistics_schedule_deviation'))
  CREATE INDEX IX_lsd_tenant_created ON logistics_schedule_deviation(tenant_id, created_at DESC);
