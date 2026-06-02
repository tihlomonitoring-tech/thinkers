-- Link budget categories to chart of accounts (GL account type).
-- Run: npm run db:budget-category-account-type

IF COL_LENGTH('budget_categories', 'account_type_id') IS NULL
  ALTER TABLE budget_categories ADD account_type_id UNIQUEIDENTIFIER NULL;
GO
