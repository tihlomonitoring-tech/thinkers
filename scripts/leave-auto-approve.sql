-- Add auto-approve flag to dbo.leave_types so management can choose which
-- leave types are approved automatically by the system on submission.
-- Idempotent. Dynamic SQL avoids single-batch compile errors on new column names.
-- Run: node scripts/run-leave-auto-approve.js

IF OBJECT_ID(N'dbo.leave_types', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.leave_types', N'auto_approve') IS NULL
  EXEC(N'ALTER TABLE dbo.leave_types ADD auto_approve BIT NOT NULL CONSTRAINT DF_leave_types_auto_approve DEFAULT (0)');
GO
