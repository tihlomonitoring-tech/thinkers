import { query } from '../db.js';
import { toYmdFromDbOrString } from './appTime.js';

function normalizeEntryDate(v) {
  if (v == null || v === '') return null;
  const ymd = toYmdFromDbOrString(v);
  return ymd || null;
}

export async function nextExpenseEntryNumber(tenantId) {
  const r = await query(
    `MERGE expense_entry_counter AS t USING (SELECT @tid AS tenant_id) AS s ON t.tenant_id = s.tenant_id
     WHEN MATCHED THEN UPDATE SET last_number = t.last_number + 1
     WHEN NOT MATCHED THEN INSERT (tenant_id, last_number) VALUES (s.tenant_id, 1)
     OUTPUT INSERTED.last_number;`,
    { tid: tenantId }
  );
  const n = r.recordset?.[0]?.last_number || 1;
  return `EXP-${String(n).padStart(5, '0')}`;
}

/** Create an expense journal entry and optional budget transaction. */
export async function createExpenseJournalEntry({
  tenantId,
  userId,
  entryDate,
  description,
  amount,
  departmentName = null,
  budgetId = null,
  budgetCategoryId = null,
  budgetLineItemId = null,
  vendorSupplier = null,
  referenceNumber = null,
  notes = null,
  status = 'draft',
}) {
  const normalizedDate = normalizeEntryDate(entryDate);
  if (!normalizedDate) throw new Error('Invalid entry date');
  const entryNumber = await nextExpenseEntryNumber(tenantId);
  const r = await query(
    `INSERT INTO expense_entries (
       tenant_id, entry_number, entry_date, department_name, budget_id, budget_category_id, budget_line_item_id,
       is_budgeted, entry_type, description, amount, tax_amount, currency, reference_number, vendor_supplier,
       [status], notes, recorded_by_user_id
     ) OUTPUT INSERTED.*
     VALUES (
       @tenantId, @entryNum, @date, @dept, @budgetId, @budgetCatId, @budgetLineId,
       @isBudgeted, N'expense', @desc, @amount, 0, N'ZAR', @refNum, @vendor,
       @status, @notes, @recordedBy
     )`,
    {
      tenantId,
      entryNum: entryNumber,
      date: normalizedDate,
      dept: departmentName,
      budgetId: budgetId || null,
      budgetCatId: budgetCategoryId || null,
      budgetLineId: budgetLineItemId || null,
      isBudgeted: budgetId ? 1 : 0,
      desc: description,
      amount: Number(amount) || 0,
      refNum: referenceNumber || null,
      vendor: vendorSupplier || null,
      status,
      notes: notes || null,
      recordedBy: userId,
    }
  );
  const entry = r.recordset?.[0] || null;
  if (budgetId && entry) {
    await query(
      `INSERT INTO budget_transactions (budget_id, category_id, line_item_id, transaction_date, amount, transaction_type, reference, description, recorded_by_user_id)
       VALUES (@budgetId, @catId, @lineId, @date, @amount, N'expense', @ref, @desc, @userId)`,
      {
        budgetId,
        catId: budgetCategoryId || null,
        lineId: budgetLineItemId || null,
        date: normalizedDate,
        amount: Number(amount) || 0,
        ref: entryNumber,
        desc: description,
        userId,
      }
    );
  }
  return entry;
}
