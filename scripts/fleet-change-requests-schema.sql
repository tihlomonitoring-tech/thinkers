-- Pending fleet entity edits (truck/driver) requiring contractor and/or Command Centre approval.
-- Run: node scripts/run-fleet-change-requests-schema.js

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'contractor_fleet_change_requests')
CREATE TABLE contractor_fleet_change_requests (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  entity_type NVARCHAR(20) NOT NULL,
  entity_id UNIQUEIDENTIFIER NOT NULL,
  submitted_by_user_id UNIQUEIDENTIFIER NULL,
  submitter_role NVARCHAR(30) NOT NULL,
  comment_text NVARCHAR(MAX) NULL,
  proposed_json NVARCHAR(MAX) NOT NULL,
  previous_json NVARCHAR(MAX) NULL,
  registration_changed BIT NOT NULL DEFAULT 0,
  had_facility_access BIT NOT NULL DEFAULT 0,
  contractor_status NVARCHAR(30) NOT NULL DEFAULT N'not_required',
  cc_status NVARCHAR(20) NOT NULL DEFAULT N'pending',
  contractor_reviewed_by_user_id UNIQUEIDENTIFIER NULL,
  contractor_reviewed_at DATETIME2 NULL,
  contractor_decline_reason NVARCHAR(MAX) NULL,
  cc_reviewed_by_user_id UNIQUEIDENTIFIER NULL,
  cc_reviewed_at DATETIME2 NULL,
  cc_decline_reason NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_fleet_change_entity_type CHECK (entity_type IN (N'truck', N'driver')),
  CONSTRAINT CK_fleet_change_submitter CHECK (submitter_role IN (N'subcontractor', N'contractor')),
  CONSTRAINT CK_fleet_change_cc_status CHECK (cc_status IN (N'pending', N'approved', N'declined')),
  CONSTRAINT CK_fleet_change_contractor_status CHECK (
    contractor_status IN (N'pending_contractor', N'approved_contractor', N'declined_contractor', N'not_required')
  )
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fleet_change_tenant_cc' AND object_id = OBJECT_ID('contractor_fleet_change_requests'))
  CREATE INDEX IX_fleet_change_tenant_cc ON contractor_fleet_change_requests(tenant_id, cc_status, contractor_status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fleet_change_entity' AND object_id = OBJECT_ID('contractor_fleet_change_requests'))
  CREATE INDEX IX_fleet_change_entity ON contractor_fleet_change_requests(entity_type, entity_id, created_at DESC);
GO
