import { query } from '../db.js';

/**
 * Atomically allocate the next shift report reference number for a tenant + kind.
 * Uses cc_shift_report_ref_counter (MERGE) to avoid MAX+1 race duplicates.
 */
export async function nextShiftReportRefNumber(tenantId, kind = 'shift') {
  if (!tenantId) return 1;
  const reportKind = kind === 'single_ops' ? 'single_ops' : 'shift';
  const r = await query(
    `MERGE cc_shift_report_ref_counter AS t
     USING (SELECT @tenantId AS tenant_id, @reportKind AS report_kind) AS s
       ON t.tenant_id = s.tenant_id AND t.report_kind = s.report_kind
     WHEN MATCHED THEN UPDATE SET last_number = t.last_number + 1
     WHEN NOT MATCHED THEN INSERT (tenant_id, report_kind, last_number) VALUES (s.tenant_id, s.report_kind, 1)
     OUTPUT INSERTED.last_number;`,
    { tenantId, reportKind }
  );
  const next = Number(r.recordset?.[0]?.last_number || 1);
  return Number.isFinite(next) && next > 0 ? next : 1;
}
