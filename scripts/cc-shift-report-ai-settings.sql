-- Shift report AI assistant tenant toggle
-- Run: npm run db:cc-shift-report-ai

IF COL_LENGTH('tenants', 'shift_report_ai_enabled') IS NULL
  ALTER TABLE tenants ADD shift_report_ai_enabled BIT NOT NULL CONSTRAINT DF_tenants_shift_report_ai_enabled DEFAULT 1;
