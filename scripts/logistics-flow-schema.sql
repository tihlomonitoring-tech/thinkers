-- Logistics flow: shift workspace, accepted update snapshots, delivery confirmations.
-- Run: npm run db:logistics-flow

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'logistics_flow_shifts')
CREATE TABLE logistics_flow_shifts (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  route_id UNIQUEIDENTIFIER NULL,
  route_label NVARCHAR(500) NULL,
  shift_date DATE NULL,
  status NVARCHAR(20) NOT NULL DEFAULT N'active',
  started_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  completed_at DATETIME2 NULL,
  summary_json NVARCHAR(MAX) NULL,
  confirmations_json NVARCHAR(MAX) NULL,
  portal NVARCHAR(40) NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_logistics_flow_shift_status CHECK (status IN (N'active', N'completed')),
  CONSTRAINT FK_logistics_flow_shift_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_logistics_flow_shifts_tenant_status' AND object_id = OBJECT_ID('logistics_flow_shifts'))
  CREATE INDEX IX_logistics_flow_shifts_tenant_status ON logistics_flow_shifts(tenant_id, status, started_at DESC);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'logistics_flow_updates')
CREATE TABLE logistics_flow_updates (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  shift_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  column_index INT NOT NULL,
  label NVARCHAR(120) NOT NULL,
  pasted_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  raw_text NVARCHAR(MAX) NULL,
  meta_json NVARCHAR(MAX) NULL,
  rows_json NVARCHAR(MAX) NOT NULL,
  created_by_user_id UNIQUEIDENTIFIER NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_logistics_flow_update_shift FOREIGN KEY (shift_id) REFERENCES logistics_flow_shifts(id) ON DELETE CASCADE,
  CONSTRAINT FK_logistics_flow_update_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_logistics_flow_updates_shift' AND object_id = OBJECT_ID('logistics_flow_updates'))
  CREATE INDEX IX_logistics_flow_updates_shift ON logistics_flow_updates(shift_id, column_index);
GO
