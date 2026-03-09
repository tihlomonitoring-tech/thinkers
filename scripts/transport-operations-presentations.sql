-- Transport Operations: recommendations for Operations Insights (insights + accountability).
-- Run: node scripts/run-transport-operations-presentations.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'to_operation_recommendations')
CREATE TABLE to_operation_recommendations (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  title NVARCHAR(500) NOT NULL,
  body NVARCHAR(MAX) NULL,
  priority NVARCHAR(50) NOT NULL DEFAULT N'advice',
  assigned_to_user_id UNIQUEIDENTIFIER NULL,
  status NVARCHAR(50) NOT NULL DEFAULT N'pending',
  applied_at DATETIME2 NULL,
  applied_by_user_id UNIQUEIDENTIFIER NULL,
  due_by DATE NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  source NVARCHAR(50) NOT NULL DEFAULT N'rule_based'
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_to_operation_recommendations_tenant' AND object_id = OBJECT_ID('to_operation_recommendations'))
  CREATE INDEX IX_to_operation_recommendations_tenant ON to_operation_recommendations(tenant_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_to_operation_recommendations_status' AND object_id = OBJECT_ID('to_operation_recommendations'))
  CREATE INDEX IX_to_operation_recommendations_status ON to_operation_recommendations(tenant_id, status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_to_operation_recommendations_assigned' AND object_id = OBJECT_ID('to_operation_recommendations'))
  CREATE INDEX IX_to_operation_recommendations_assigned ON to_operation_recommendations(assigned_to_user_id);
GO
