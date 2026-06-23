-- Link budget transactions to expense journal entries for accurate sync/reallocation.
-- Run: npm run db:budget-transaction-expense-link

IF COL_LENGTH('budget_transactions', 'expense_entry_id') IS NULL
  ALTER TABLE budget_transactions ADD expense_entry_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_bt_expense_entry'
)
  ALTER TABLE budget_transactions
    ADD CONSTRAINT FK_bt_expense_entry
    FOREIGN KEY (expense_entry_id) REFERENCES expense_entries(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bt_expense_entry' AND object_id = OBJECT_ID('budget_transactions'))
  CREATE INDEX IX_bt_expense_entry ON budget_transactions(expense_entry_id)
    WHERE expense_entry_id IS NOT NULL;
GO
