-- Workshop job card attachment categories (inspection copy, resolution proof, general)
-- Run: npm run db:workshop-attachment-types

IF COL_LENGTH('workshop_job_card_attachments', 'attachment_type') IS NULL
  ALTER TABLE workshop_job_card_attachments ADD attachment_type NVARCHAR(40) NOT NULL CONSTRAINT DF_wjca_type DEFAULT N'general';
GO

UPDATE workshop_job_card_attachments SET attachment_type = N'general' WHERE attachment_type IS NULL OR LTRIM(RTRIM(attachment_type)) = N'';
GO
