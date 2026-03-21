-- Log for Command Centre fleet list republish bot (after Access Management first publication).
-- Run: node scripts/run-cc-fleet-republish-bot-log.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cc_fleet_republish_bot_log')
CREATE TABLE cc_fleet_republish_bot_log (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  created_by_user_id UNIQUEIDENTIFIER NULL,
  route_id UNIQUEIDENTIFIER NOT NULL,
  route_name NVARCHAR(255) NULL,
  list_type NVARCHAR(20) NOT NULL,
  format NVARCHAR(20) NOT NULL,
  recipient_emails NVARCHAR(MAX) NULL,
  companies_republished NVARCHAR(MAX) NULL,
  contractor_ids NVARCHAR(1000) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_fleet_republish_bot_tenant' AND object_id = OBJECT_ID('cc_fleet_republish_bot_log'))
  CREATE INDEX IX_cc_fleet_republish_bot_tenant ON cc_fleet_republish_bot_log(tenant_id, created_at DESC);
GO
