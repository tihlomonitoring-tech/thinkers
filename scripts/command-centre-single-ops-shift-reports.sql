-- Single operations shift reports (Command Centre). Separate from command_centre_shift_reports for future dashboards.
-- Run: npm run db:command-centre-single-ops-shift-reports

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'command_centre_single_ops_shift_reports')
CREATE TABLE command_centre_single_ops_shift_reports (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  created_by_user_id UNIQUEIDENTIFIER NOT NULL,
  routes_json NVARCHAR(MAX) NULL,
  report_date DATE NULL,
  shift_date DATE NULL,
  shift_start NVARCHAR(20) NULL,
  shift_end NVARCHAR(20) NULL,
  controller1_name NVARCHAR(255) NULL,
  controller1_email NVARCHAR(255) NULL,
  controller2_name NVARCHAR(255) NULL,
  controller2_email NVARCHAR(255) NULL,
  total_trucks_scheduled NVARCHAR(50) NULL,
  balance_brought_down NVARCHAR(50) NULL,
  total_loads_dispatched NVARCHAR(50) NULL,
  total_pending_deliveries NVARCHAR(50) NULL,
  total_loads_delivered NVARCHAR(50) NULL,
  overall_performance NVARCHAR(MAX) NULL,
  key_highlights NVARCHAR(MAX) NULL,
  truck_updates NVARCHAR(MAX) NULL,
  incidents NVARCHAR(MAX) NULL,
  non_compliance_calls NVARCHAR(MAX) NULL,
  investigations NVARCHAR(MAX) NULL,
  communication_log NVARCHAR(MAX) NULL,
  outstanding_issues NVARCHAR(MAX) NULL,
  handover_key_info NVARCHAR(MAX) NULL,
  declaration NVARCHAR(MAX) NULL,
  shift_conclusion_time NVARCHAR(20) NULL,
  [status] NVARCHAR(50) NOT NULL DEFAULT N'draft',
  submitted_at DATETIME2 NULL,
  submitted_to_user_id UNIQUEIDENTIFIER NULL,
  approved_by_user_id UNIQUEIDENTIFIER NULL,
  approved_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_cc_sosr_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT FK_cc_sosr_submitted_to FOREIGN KEY (submitted_to_user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT FK_cc_sosr_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'command_centre_single_ops_truck_deliveries')
CREATE TABLE command_centre_single_ops_truck_deliveries (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  report_id UNIQUEIDENTIFIER NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  truck_registration NVARCHAR(64) NULL,
  driver_name NVARCHAR(255) NULL,
  completed_deliveries NVARCHAR(32) NULL,
  remarks NVARCHAR(MAX) NULL,
  CONSTRAINT FK_cc_sotd_report FOREIGN KEY (report_id) REFERENCES command_centre_single_ops_shift_reports(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'command_centre_single_ops_route_load_totals')
CREATE TABLE command_centre_single_ops_route_load_totals (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  report_id UNIQUEIDENTIFIER NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  route_name NVARCHAR(255) NULL,
  total_loads_delivered NVARCHAR(64) NULL,
  CONSTRAINT FK_cc_sorlt_report FOREIGN KEY (report_id) REFERENCES command_centre_single_ops_shift_reports(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'command_centre_single_ops_shift_report_comments')
CREATE TABLE command_centre_single_ops_shift_report_comments (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  report_id UNIQUEIDENTIFIER NOT NULL,
  user_id UNIQUEIDENTIFIER NOT NULL,
  comment_text NVARCHAR(MAX) NOT NULL,
  addressed BIT NOT NULL DEFAULT 0,
  addressed_at DATETIME2 NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_cc_sosrc_report FOREIGN KEY (report_id) REFERENCES command_centre_single_ops_shift_reports(id) ON DELETE CASCADE,
  CONSTRAINT FK_cc_sosrc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'command_centre_single_ops_controller_evaluations')
CREATE TABLE command_centre_single_ops_controller_evaluations (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  tenant_id UNIQUEIDENTIFIER NULL,
  report_id UNIQUEIDENTIFIER NOT NULL,
  evaluator_user_id UNIQUEIDENTIFIER NOT NULL,
  answers NVARCHAR(MAX) NOT NULL,
  overall_comment NVARCHAR(MAX) NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_cc_sosce_report FOREIGN KEY (report_id) REFERENCES command_centre_single_ops_shift_reports(id) ON DELETE CASCADE,
  CONSTRAINT FK_cc_sosce_evaluator FOREIGN KEY (evaluator_user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'command_centre_single_ops_override_requests')
CREATE TABLE command_centre_single_ops_override_requests (
  id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  report_id UNIQUEIDENTIFIER NOT NULL,
  requested_by_user_id UNIQUEIDENTIFIER NOT NULL,
  code NVARCHAR(20) NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  used_at DATETIME2 NULL,
  CONSTRAINT FK_cc_sosor_report FOREIGN KEY (report_id) REFERENCES command_centre_single_ops_shift_reports(id) ON DELETE CASCADE,
  CONSTRAINT FK_cc_sosor_user FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_sosr_created_by' AND object_id = OBJECT_ID('command_centre_single_ops_shift_reports'))
  CREATE INDEX IX_cc_sosr_created_by ON command_centre_single_ops_shift_reports(created_by_user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_sosr_submitted_to' AND object_id = OBJECT_ID('command_centre_single_ops_shift_reports'))
  CREATE INDEX IX_cc_sosr_submitted_to ON command_centre_single_ops_shift_reports(submitted_to_user_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_sosr_status' AND object_id = OBJECT_ID('command_centre_single_ops_shift_reports'))
  CREATE INDEX IX_cc_sosr_status ON command_centre_single_ops_shift_reports([status]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_sosrc_report' AND object_id = OBJECT_ID('command_centre_single_ops_shift_report_comments'))
  CREATE INDEX IX_cc_sosrc_report ON command_centre_single_ops_shift_report_comments(report_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_sotd_report' AND object_id = OBJECT_ID('command_centre_single_ops_truck_deliveries'))
  CREATE INDEX IX_cc_sotd_report ON command_centre_single_ops_truck_deliveries(report_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_sorlt_report' AND object_id = OBJECT_ID('command_centre_single_ops_route_load_totals'))
  CREATE INDEX IX_cc_sorlt_report ON command_centre_single_ops_route_load_totals(report_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_sosce_report' AND object_id = OBJECT_ID('command_centre_single_ops_controller_evaluations'))
  CREATE INDEX IX_cc_sosce_report ON command_centre_single_ops_controller_evaluations(report_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cc_sosor_report' AND object_id = OBJECT_ID('command_centre_single_ops_override_requests'))
  CREATE INDEX IX_cc_sosor_report ON command_centre_single_ops_override_requests(report_id);
GO
