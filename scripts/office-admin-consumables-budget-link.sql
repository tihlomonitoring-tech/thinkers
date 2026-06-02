-- Link Office Admin supplies to department budgets for expense journal posting.
-- Run: npm run db:office-admin-consumables-budget-link

IF COL_LENGTH('office_admin_consumables', 'budget_id') IS NULL
  ALTER TABLE office_admin_consumables ADD budget_id UNIQUEIDENTIFIER NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'budget_category_id') IS NULL
  ALTER TABLE office_admin_consumables ADD budget_category_id UNIQUEIDENTIFIER NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'budget_line_item_id') IS NULL
  ALTER TABLE office_admin_consumables ADD budget_line_item_id UNIQUEIDENTIFIER NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'last_expense_entry_id') IS NULL
  ALTER TABLE office_admin_consumables ADD last_expense_entry_id UNIQUEIDENTIFIER NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'last_posted_purchase_date') IS NULL
  ALTER TABLE office_admin_consumables ADD last_posted_purchase_date DATE NULL;
GO
IF COL_LENGTH('office_admin_consumables', 'last_posted_purchase_amount') IS NULL
  ALTER TABLE office_admin_consumables ADD last_posted_purchase_amount DECIMAL(18, 2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_office_admin_consumables_budget' AND object_id = OBJECT_ID('office_admin_consumables'))
  CREATE INDEX IX_office_admin_consumables_budget ON office_admin_consumables (budget_id);
GO
