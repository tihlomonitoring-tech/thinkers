-- Login GPS + IP audit; shift clock anchor + management auth codes. Run: npm run db:login-location
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_login_activity')
CREATE TABLE user_login_activity (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  -- NO ACTION avoids SQL Server "multiple cascade paths" (users ↔ tenants ↔ this table).
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE NO ACTION,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  ip_address NVARCHAR(80) NULL,
  latitude DECIMAL(12,8) NOT NULL,
  longitude DECIMAL(12,8) NOT NULL,
  accuracy_meters DECIMAL(12,4) NULL,
  user_agent NVARCHAR(1000) NULL,
  source NVARCHAR(40) NOT NULL DEFAULT N'login',
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_login_activity')
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_user_login_activity_user_created' AND object_id = OBJECT_ID('user_login_activity'))
    CREATE INDEX IX_user_login_activity_user_created ON user_login_activity(user_id, created_at DESC);
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'shift_clock_sessions')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('shift_clock_sessions') AND name = 'anchor_latitude')
    ALTER TABLE shift_clock_sessions ADD anchor_latitude DECIMAL(12,8) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('shift_clock_sessions') AND name = 'anchor_longitude')
    ALTER TABLE shift_clock_sessions ADD anchor_longitude DECIMAL(12,8) NULL;
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('shift_clock_sessions') AND name = 'anchor_accuracy_m')
    ALTER TABLE shift_clock_sessions ADD anchor_accuracy_m DECIMAL(12,4) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'shift_location_auth_requests')
CREATE TABLE shift_location_auth_requests (
  id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
  tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id) ON DELETE NO ACTION,
  user_id UNIQUEIDENTIFIER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
  session_id UNIQUEIDENTIFIER NOT NULL REFERENCES shift_clock_sessions(id) ON DELETE CASCADE,
  action_type NVARCHAR(32) NOT NULL,
  motivation NVARCHAR(2000) NOT NULL,
  code_hash NVARCHAR(128) NOT NULL,
  expires_at DATETIME2 NOT NULL,
  used_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_shift_loc_auth_action CHECK (action_type IN (N'break_start', N'break_end', N'clock_out'))
);
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'shift_location_auth_requests')
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_shift_loc_auth_session' AND object_id = OBJECT_ID('shift_location_auth_requests'))
    CREATE INDEX IX_shift_loc_auth_session ON shift_location_auth_requests(session_id, action_type, used_at);
GO
