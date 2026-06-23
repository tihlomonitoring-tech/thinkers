import { query } from '../db.js';

/** Map income/expense journal entry types to department budget transaction types. */
export function entryTypeToBudgetTransactionType(entryType) {
  const t = String(entryType || 'expense').toLowerCase();
  if (t === 'income') return 'income';
  if (t === 'adjustment') return 'adjustment';
  if (t === 'refund') return 'adjustment';
  return 'expense';
}

export function expenseEntryTotalAmount(entry) {
  return Number(entry?.amount || 0) + Number(entry?.tax_amount || 0);
}

/**
 * Create or update the budget_transactions row for an expense journal entry.
 * Removes the link when budget_id is cleared.
 */
export async function syncBudgetTransactionForExpenseEntry(entry, userId) {
  if (!entry?.id) return null;

  const totalAmount = expenseEntryTotalAmount(entry);
  const txType = entryTypeToBudgetTransactionType(entry.entry_type);

  const existing = await query(
    `SELECT TOP 1 id, budget_id FROM budget_transactions
     WHERE expense_entry_id = @entryId
        OR (expense_entry_id IS NULL AND reference = @ref AND @ref IS NOT NULL)`,
    { entryId: entry.id, ref: entry.entry_number || null }
  );
  const row = existing.recordset?.[0];

  if (!entry.budget_id) {
    if (row?.id) {
      await query(`DELETE FROM budget_transactions WHERE id = @id`, { id: row.id });
    }
    return null;
  }

  const params = {
    budgetId: entry.budget_id,
    catId: entry.budget_category_id || null,
    lineId: entry.budget_line_item_id || null,
    date: entry.entry_date,
    amount: totalAmount,
    type: txType,
    ref: entry.entry_number || null,
    desc: entry.description || null,
    userId: userId || entry.recorded_by_user_id,
    entryId: entry.id,
  };

  if (row?.id) {
    await query(
      `UPDATE budget_transactions SET
         budget_id = @budgetId,
         category_id = @catId,
         line_item_id = @lineId,
         transaction_date = @date,
         amount = @amount,
         transaction_type = @type,
         reference = @ref,
         description = @desc,
         expense_entry_id = @entryId
       WHERE id = @id`,
      { ...params, id: row.id }
    );
    return row.id;
  }

  const ins = await query(
    `INSERT INTO budget_transactions (
       budget_id, category_id, line_item_id, transaction_date, amount,
       transaction_type, reference, description, recorded_by_user_id, expense_entry_id
     ) OUTPUT INSERTED.id
     VALUES (@budgetId, @catId, @lineId, @date, @amount, @type, @ref, @desc, @userId, @entryId)`,
    params
  );
  return ins.recordset?.[0]?.id || null;
}

export async function removeBudgetTransactionsForExpenseEntry(entryId) {
  if (!entryId) return;
  await query(`DELETE FROM budget_transactions WHERE expense_entry_id = @entryId`, { entryId });
}
