-- Add group_by column to pilot_list_distribution.
-- Stores the optional grouping strategy applied to distribution attachments
-- (e.g. 'sub_contractor' to inject sub-contractor banner rows in Excel).
-- Run: npm run db:pilot-distribution-group-by

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('pilot_list_distribution') AND name = 'group_by')
  ALTER TABLE pilot_list_distribution ADD group_by NVARCHAR(40) NULL;
GO
