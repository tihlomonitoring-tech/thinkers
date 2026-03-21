-- Tag list-distribution emails from Command Centre fleet republish bot.
-- Run: node scripts/run-access-distribution-history-fleet-bot.js

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_distribution_history') AND name = 'is_fleet_republish_bot')
  ALTER TABLE access_distribution_history ADD is_fleet_republish_bot BIT NOT NULL CONSTRAINT DF_adh_fleet_bot DEFAULT 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_distribution_history') AND name = 'fleet_republish_batch_id')
  ALTER TABLE access_distribution_history ADD fleet_republish_batch_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_distribution_history') AND name = 'bot_route_name')
  ALTER TABLE access_distribution_history ADD bot_route_name NVARCHAR(255) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('access_distribution_history') AND name = 'bot_companies')
  ALTER TABLE access_distribution_history ADD bot_companies NVARCHAR(MAX) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_access_distribution_history_fleet_bot' AND object_id = OBJECT_ID('access_distribution_history'))
  CREATE INDEX IX_access_distribution_history_fleet_bot ON access_distribution_history(tenant_id, is_fleet_republish_bot, fleet_republish_batch_id);
GO
