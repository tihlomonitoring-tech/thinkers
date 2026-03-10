-- Track when Command Centre manually notifies a rector about a breakdown (so we can show "rector was notified" and hide the prompt).
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'contractor_incidents')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('contractor_incidents') AND name = 'rector_manual_notified_at')
    ALTER TABLE contractor_incidents ADD rector_manual_notified_at DATETIME2 NULL;
END
GO
