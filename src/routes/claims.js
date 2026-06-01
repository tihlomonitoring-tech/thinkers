import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { query } from '../db.js';
import { requireAuth, loadUser } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import { getManagementEmailsForTenantAndTab } from '../lib/emailRecipients.js';
import { calculateSaOvertimeClaim, formatOvertimeBreakdownText } from '../lib/saOvertimeClaim.js';

const router = Router();
router.use(requireAuth, loadUser);

function tid(req) { return req.user?.tenant_id || null; }

const uploadsDir = path.join(process.cwd(), 'uploads', 'claim-attachments');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ storage: multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`),
}), limits: { fileSize: 10 * 1024 * 1024 } });

const CLAIM_TYPES = ['fuel', 'travel', 'accommodation', 'meals', 'equipment', 'tools', 'training', 'communication', 'service', 'overtime', 'other'];

const CLAIM_TYPE_LABELS = {
  fuel: 'Fuel',
  travel: 'Travel expense',
  accommodation: 'Accommodation',
  meals: 'Meals',
  equipment: 'Equipment',
  tools: 'Tools',
  training: 'Training',
  communication: 'Communication',
  service: 'Service rendered',
  overtime: 'Overtime',
  other: 'Other',
};

function resolveOvertimeAmount(b) {
  const calc = calculateSaOvertimeClaim({
    ordinaryHourlyRate: b.hourly_rate,
    weekdayHours: b.ot_weekday_hours,
    sundayHours: b.ot_sunday_hours,
    publicHolidayHours: b.ot_public_holiday_hours,
  });
  if (calc.total <= 0) {
    return { error: calc.warnings[0] || 'Invalid overtime hours or hourly rate' };
  }
  return { amount: calc.total, calc };
}

async function nextClaimRef(tenantId) {
  const r = await query(
    `MERGE claim_counter AS t USING (SELECT @tid AS tenant_id) AS s ON t.tenant_id = s.tenant_id
     WHEN MATCHED THEN UPDATE SET last_number = t.last_number + 1
     WHEN NOT MATCHED THEN INSERT (tenant_id, last_number) VALUES (s.tenant_id, 1)
     OUTPUT INSERTED.last_number;`,
    { tid: tenantId }
  );
  const n = r.recordset?.[0]?.last_number || 1;
  return `CLM-${String(n).padStart(5, '0')}`;
}

function fmtZar(v) {
  const n = Number(v);
  if (isNaN(n)) return 'R 0.00';
  return 'R ' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function claimEmailHtml({ title, claimRef, claimant, claimType, amount, description, department, appUrl, extra, actionHtml }) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f5f7;">
<div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
<div style="background:#1e40af;padding:24px 32px;"><h1 style="color:#fff;font-size:18px;margin:0;">${title}</h1></div>
<div style="padding:24px 32px;">
<table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151;">
<tr><td style="padding:6px 0;font-weight:600;width:140px;vertical-align:top;">Reference</td><td style="padding:6px 0;font-weight:700;color:#1e40af;">${claimRef}</td></tr>
<tr><td style="padding:6px 0;font-weight:600;vertical-align:top;">Claimant</td><td style="padding:6px 0;">${claimant}</td></tr>
<tr><td style="padding:6px 0;font-weight:600;vertical-align:top;">Type</td><td style="padding:6px 0;">${claimType}</td></tr>
<tr><td style="padding:6px 0;font-weight:600;vertical-align:top;">Amount</td><td style="padding:6px 0;font-weight:700;">${fmtZar(amount)}</td></tr>
${department ? `<tr><td style="padding:6px 0;font-weight:600;vertical-align:top;">Department</td><td style="padding:6px 0;">${department}</td></tr>` : ''}
<tr><td style="padding:6px 0;font-weight:600;vertical-align:top;">Description</td><td style="padding:6px 0;">${description || '—'}</td></tr>
${extra || ''}
</table>
${actionHtml || ''}
</div>
<div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
This is an automated notification from Thinkers App.${appUrl ? ` <a href="${appUrl}" style="color:#1e40af;">Open app</a>` : ''}
</div></div></body></html>`;
}

function userHasManagement(req) {
  if (req.user?.role === 'super_admin') return true;
  return (req.user?.page_roles || []).some((r) => String(r).toLowerCase() === 'management');
}

/** Send at most one email per claim + event + recipient (requires claim_email_log table). */
async function sendClaimEmailOnce({ claimId, eventType, to, subject, html }) {
  if (!to || !isEmailConfigured() || !claimId) return false;
  const email = String(to).trim().toLowerCase();
  if (!email) return false;
  try {
    const dup = await query(
      `SELECT 1 FROM claim_email_log WHERE claim_id = @cid AND event_type = @ev AND LOWER(recipient_email) = @to`,
      { cid: claimId, ev: eventType, to: email }
    );
    if (dup.recordset?.length) return false;
  } catch (e) {
    const m = String(e?.message || '').toLowerCase();
    if (!m.includes('claim_email_log')) throw e;
  }
  await sendEmail({ to, subject, body: html, html: true });
  try {
    await query(
      `INSERT INTO claim_email_log (claim_id, event_type, recipient_email) VALUES (@cid, @ev, @to)`,
      { cid: claimId, ev: eventType, to: email }
    );
  } catch (e) {
    console.error('[claims] email log insert:', e?.message);
  }
  return true;
}

async function notifyClaimDeleted(claim, deletedByName) {
  if (!isEmailConfigured() || !claim?.id) return;
  const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
  const ref = claim.reference_number;
  const claimantName = claim.claimant_name || claim.full_name || 'Claimant';
  const claimType = CLAIM_TYPE_LABELS[claim.claim_type] || claim.claim_type;
  const deletedBy = deletedByName || 'User';

  const claimantHtml = claimEmailHtml({
    title: 'Claim deleted',
    claimRef: ref,
    claimant: claimantName,
    claimType,
    amount: claim.amount,
    description: claim.description,
    department: claim.department_name,
    appUrl: `${appUrl}/profile`,
    actionHtml: `<div style="margin-top:16px;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;"><p style="margin:0;color:#991b1b;font-weight:600;">Claim <strong>${ref}</strong> has been deleted${deletedBy ? ` by ${deletedBy}` : ''}.</p></div>`,
  });

  if (claim.claimant_email) {
    await sendClaimEmailOnce({
      claimId: claim.id,
      eventType: 'deleted_claimant',
      to: claim.claimant_email,
      subject: `Claim deleted: ${ref}`,
      html: claimantHtml,
    });
  }

  try {
    const mgmtEmails = await getManagementEmailsForTenantAndTab(query, claim.tenant_id, 'claims');
    const mgmtHtml = claimEmailHtml({
      title: 'Claim deleted',
      claimRef: ref,
      claimant: claimantName,
      claimType,
      amount: claim.amount,
      description: claim.description,
      department: claim.department_name,
      appUrl: `${appUrl}/management`,
      actionHtml: `<p style="margin-top:16px;font-size:14px;color:#374151;">Claim <strong>${ref}</strong> was deleted by ${deletedBy}.</p>`,
    });
    for (const to of mgmtEmails) {
      await sendClaimEmailOnce({
        claimId: claim.id,
        eventType: 'deleted_mgmt',
        to,
        subject: `Claim deleted: ${ref} — ${claimantName}`,
        html: mgmtHtml,
      });
    }
  } catch (e) {
    console.error('[claims] delete mgmt notify:', e?.message);
  }
}

// ════════════════════════════════════════════════════════════════════
//  LIST CLAIMS (for claimant — my claims)
// ════════════════════════════════════════════════════════════════════

router.get('/my-claims', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT c.*, u.full_name AS claimant_name, u.email AS claimant_email, ru.full_name AS reviewed_by_name
       FROM claims c
       LEFT JOIN users u ON u.id = c.claimant_user_id
       LEFT JOIN users ru ON ru.id = c.reviewed_by_user_id
       WHERE c.claimant_user_id = @userId
       ORDER BY c.created_at DESC`,
      { userId: req.user.id }
    );
    res.json({ claims: r.recordset || [] });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  LIST CLAIMS (for management — all tenant claims)
// ════════════════════════════════════════════════════════════════════

router.get('/all', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    let sql = `SELECT c.*, u.full_name AS claimant_name, u.email AS claimant_email, ru.full_name AS reviewed_by_name
               FROM claims c
               LEFT JOIN users u ON u.id = c.claimant_user_id
               LEFT JOIN users ru ON ru.id = c.reviewed_by_user_id
               WHERE c.tenant_id = @t`;
    const params = { t };
    if (req.query.status && req.query.status !== 'all') { sql += ` AND c.[status] = @status`; params.status = req.query.status; }
    if (req.query.claim_type) { sql += ` AND c.claim_type = @claimType`; params.claimType = req.query.claim_type; }
    if (req.query.user_id) { sql += ` AND c.claimant_user_id = @userId`; params.userId = req.query.user_id; }
    if (req.query.from) { sql += ` AND c.claim_date >= @from`; params.from = req.query.from; }
    if (req.query.to) { sql += ` AND c.claim_date <= @to`; params.to = req.query.to; }
    if (req.query.search) { sql += ` AND (c.description LIKE @q OR c.reference_number LIKE @q)`; params.q = `%${req.query.search}%`; }
    sql += ` ORDER BY c.created_at DESC`;
    const r = await query(sql, params);
    res.json({ claims: r.recordset || [] });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  SUMMARY
// ════════════════════════════════════════════════════════════════════

router.get('/stats/summary', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const r = await query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN [status] = N'pending' THEN 1 ELSE 0 END) AS pending_count,
              SUM(CASE WHEN [status] = N'approved' THEN 1 ELSE 0 END) AS approved_count,
              SUM(CASE WHEN [status] = N'declined' THEN 1 ELSE 0 END) AS declined_count,
              SUM(CASE WHEN [status] = N'pending' THEN amount ELSE 0 END) AS pending_amount,
              SUM(CASE WHEN [status] = N'approved' THEN amount ELSE 0 END) AS approved_amount
       FROM claims WHERE tenant_id = @t`,
      { t }
    );
    res.json({ summary: r.recordset?.[0] || {} });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  GET SINGLE CLAIM
// ════════════════════════════════════════════════════════════════════

router.get('/:id', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT c.*, u.full_name AS claimant_name, u.email AS claimant_email, ru.full_name AS reviewed_by_name
       FROM claims c
       LEFT JOIN users u ON u.id = c.claimant_user_id
       LEFT JOIN users ru ON ru.id = c.reviewed_by_user_id
       WHERE c.id = @id`,
      { id: req.params.id }
    );
    const claim = r.recordset?.[0];
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    const att = await query(`SELECT * FROM claim_attachments WHERE claim_id = @id ORDER BY created_at`, { id: req.params.id });
    res.json({ claim, attachments: att.recordset || [] });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  CREATE CLAIM
// ════════════════════════════════════════════════════════════════════

router.post('/', async (req, res, next) => {
  try {
    const t = tid(req);
    if (!t) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    if (!b.claim_type || !b.description || !b.amount || !b.claim_date) {
      return res.status(400).json({ error: 'claim_type, description, amount, and claim_date are required' });
    }
    if (!CLAIM_TYPES.includes(b.claim_type)) return res.status(400).json({ error: 'Invalid claim type' });

    let amount = Number(b.amount);
    let category = b.category || null;
    if (b.claim_type === 'overtime') {
      if (!b.hourly_rate) return res.status(400).json({ error: 'Ordinary hourly rate is required for overtime claims' });
      const ot = resolveOvertimeAmount(b);
      if (ot.error) return res.status(400).json({ error: ot.error });
      amount = ot.amount;
      if (!category) category = formatOvertimeBreakdownText(ot.calc).slice(0, 500) || null;
    } else if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const ref = await nextClaimRef(t);
    const r = await query(
      `INSERT INTO claims (tenant_id, reference_number, claim_date, claim_type, category, department_name, description, amount, currency,
        km_travelled, start_location, end_location, vehicle_registration, rate_per_km,
        service_rendered, hours_spent, hourly_rate,
        ot_period_end, ot_weekday_hours, ot_sunday_hours, ot_public_holiday_hours,
        bank_name, account_holder, account_number, branch_code, account_type,
        declaration_accepted, declaration_text, [status], claimant_user_id)
       OUTPUT INSERTED.*
       VALUES (@t, @ref, @date, @type, @cat, @dept, @desc, @amount, @currency,
        @km, @startLoc, @endLoc, @vehicle, @rateKm,
        @service, @hours, @hourlyRate,
        @otEnd, @otWeekday, @otSunday, @otPh,
        @bankName, @accHolder, @accNum, @branchCode, @accType,
        @declAccepted, @declText, @status, @userId)`,
      {
        t, ref, date: b.claim_date, type: b.claim_type, cat: category,
        dept: b.department_name || null, desc: b.description, amount,
        currency: b.currency || 'ZAR',
        km: b.km_travelled ? Number(b.km_travelled) : null,
        startLoc: b.start_location || null, endLoc: b.end_location || null,
        vehicle: b.vehicle_registration || null, rateKm: b.rate_per_km ? Number(b.rate_per_km) : null,
        service: b.service_rendered || null, hours: b.hours_spent ? Number(b.hours_spent) : null,
        hourlyRate: b.hourly_rate ? Number(b.hourly_rate) : null,
        otEnd: b.ot_period_end || b.claim_date || null,
        otWeekday: b.ot_weekday_hours != null && b.ot_weekday_hours !== '' ? Number(b.ot_weekday_hours) : null,
        otSunday: b.ot_sunday_hours != null && b.ot_sunday_hours !== '' ? Number(b.ot_sunday_hours) : null,
        otPh: b.ot_public_holiday_hours != null && b.ot_public_holiday_hours !== '' ? Number(b.ot_public_holiday_hours) : null,
        bankName: b.bank_name || null, accHolder: b.account_holder || null,
        accNum: b.account_number || null, branchCode: b.branch_code || null,
        accType: b.account_type || null,
        declAccepted: b.declaration_accepted ? 1 : 0, declText: b.declaration_text || null,
        status: 'pending', userId: req.user.id,
      }
    );
    const claim = r.recordset?.[0];

    if (claim?.id && isEmailConfigured()) {
      const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
      const claimantName = req.user.full_name || req.user.email || 'User';
      const claimantEmail = req.user.email;
      const claimId = claim.id;

      if (claimantEmail) {
        const html = claimEmailHtml({
          title: 'Claim submitted — your copy',
          claimRef: ref, claimant: claimantName, claimType: CLAIM_TYPE_LABELS[b.claim_type] || b.claim_type,
          amount, description: b.description, department: b.department_name,
          appUrl: `${appUrl}/profile`,
          extra: b.km_travelled ? `<tr><td style="padding:6px 0;font-weight:600;">KM Travelled</td><td style="padding:6px 0;">${b.km_travelled} km</td></tr>` : '',
          actionHtml: `<p style="margin-top:16px;font-size:14px;color:#374151;">Your claim <strong>${ref}</strong> has been submitted and is pending review by management.</p>`,
        });
        sendClaimEmailOnce({
          claimId, eventType: 'submitted_claimant', to: claimantEmail, subject: `Claim submitted: ${ref}`, html,
        }).catch((e) => console.error('[claims] Claimant email error:', e?.message));
      }

      try {
        const mgmtEmails = await getManagementEmailsForTenantAndTab(query, t, 'claims');
        if (mgmtEmails.length > 0) {
          const html = claimEmailHtml({
            title: 'New claim requires review',
            claimRef: ref, claimant: claimantName, claimType: CLAIM_TYPE_LABELS[b.claim_type] || b.claim_type,
            amount, description: b.description, department: b.department_name,
            appUrl: `${appUrl}/management`,
            extra:
              (b.claim_type === 'overtime' && category
                ? `<tr><td style="padding:6px 0;font-weight:600;vertical-align:top;">Overtime</td><td style="padding:6px 0;white-space:pre-line;">${category.replace(/</g, '&lt;')}</td></tr>`
                : '') +
              (b.km_travelled ? `<tr><td style="padding:6px 0;font-weight:600;">KM Travelled</td><td style="padding:6px 0;">${b.km_travelled} km</td></tr>` : ''),
            actionHtml: `<div style="margin-top:20px;"><a href="${appUrl}/management" style="display:inline-block;padding:10px 24px;background:#1e40af;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Review claim ${ref}</a></div>`,
          });
          for (const to of mgmtEmails) {
            sendClaimEmailOnce({
              claimId, eventType: 'submitted_mgmt', to, subject: `Claim for review: ${ref} — ${claimantName}`, html,
            }).catch((e) => console.error('[claims] Management email error:', e?.message));
          }
        }
      } catch (e) { console.error('[claims] Management notification error:', e?.message); }
    }

    res.status(201).json({ claim });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  UPDATE CLAIM (edit by claimant, only if draft/pending)
// ════════════════════════════════════════════════════════════════════

router.patch('/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    const sets = []; const params = { id: req.params.id };
    const allowed = ['claim_date', 'claim_type', 'category', 'department_name', 'description', 'amount', 'currency',
      'km_travelled', 'start_location', 'end_location', 'vehicle_registration', 'rate_per_km',
      'service_rendered', 'hours_spent', 'hourly_rate',
      'bank_name', 'account_holder', 'account_number', 'branch_code', 'account_type',
      'declaration_accepted', 'declaration_text'];
    for (const k of allowed) {
      if (b[k] !== undefined) { params[k] = b[k]; sets.push(`[${k}] = @${k}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push(`updated_at = SYSUTCDATETIME()`);
    await query(`UPDATE claims SET ${sets.join(', ')} WHERE id = @id AND [status] IN (N'draft', N'pending')`, params);
    const r = await query(`SELECT * FROM claims WHERE id = @id`, { id: req.params.id });
    res.json({ claim: r.recordset?.[0] || null });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  REVIEW CLAIM (approve/decline by management)
// ════════════════════════════════════════════════════════════════════

router.post('/:id/review', async (req, res, next) => {
  try {
    const { action, review_notes, rejection_reason } = req.body || {};
    if (!['approve', 'decline'].includes(action)) return res.status(400).json({ error: 'action must be approve or decline' });

    const existing = await query(`SELECT * FROM claims WHERE id = @id`, { id: req.params.id });
    const claim = existing.recordset?.[0];
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    if (claim.status !== 'pending') return res.status(400).json({ error: 'Claim is not pending review' });

    const newStatus = action === 'approve' ? 'approved' : 'declined';
    await query(
      `UPDATE claims SET [status] = @status, reviewed_by_user_id = @reviewerId, reviewed_at = SYSUTCDATETIME(), review_notes = @notes, rejection_reason = @reason, updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id: req.params.id, status: newStatus, reviewerId: req.user.id, notes: review_notes || null, reason: rejection_reason || null }
    );

    if (action === 'approve') {
      try {
        const catResult = await query(
          `SELECT TOP 1 id FROM expense_categories WHERE tenant_id = @t AND LOWER(name) = N'claims' AND is_active = 1`,
          { t: claim.tenant_id }
        );
        let categoryId = catResult.recordset?.[0]?.id || null;
        if (!categoryId) {
          const newCat = await query(
            `INSERT INTO expense_categories (tenant_id, name, code, description, category_type, created_by_user_id) OUTPUT INSERTED.id VALUES (@t, N'Claims', N'CLM', N'Auto-created for approved claims', N'expense', @userId)`,
            { t: claim.tenant_id, userId: req.user.id }
          );
          categoryId = newCat.recordset?.[0]?.id || null;
        }

        const counterResult = await query(
          `MERGE expense_entry_counter AS t USING (SELECT @tid AS tenant_id) AS s ON t.tenant_id = s.tenant_id
           WHEN MATCHED THEN UPDATE SET last_number = t.last_number + 1
           WHEN NOT MATCHED THEN INSERT (tenant_id, last_number) VALUES (s.tenant_id, 1)
           OUTPUT INSERTED.last_number;`,
          { tid: claim.tenant_id }
        );
        const entryNum = `EXP-${String(counterResult.recordset?.[0]?.last_number || 1).padStart(5, '0')}`;

        const expResult = await query(
          `INSERT INTO expense_entries (tenant_id, entry_number, entry_date, category_id, department_name, is_budgeted, entry_type, description, amount, tax_amount, currency, payment_method, reference_number, vendor_supplier, [status], notes, recorded_by_user_id)
           OUTPUT INSERTED.id
           VALUES (@t, @entryNum, @date, @catId, @dept, 0, N'expense', @desc, @amount, 0, @currency, N'reimbursement', @ref, @vendor, N'approved', @notes, @userId)`,
          {
            t: claim.tenant_id, entryNum, date: claim.claim_date, catId: categoryId,
            dept: claim.department_name, desc: `Claim ${claim.reference_number}: ${claim.description}`,
            amount: claim.amount, currency: claim.currency || 'ZAR',
            ref: claim.reference_number, vendor: claim.account_holder || null,
            notes: `Auto-created from approved claim ${claim.reference_number}`, userId: req.user.id,
          }
        );
        const expenseId = expResult.recordset?.[0]?.id;
        if (expenseId) {
          await query(`UPDATE claims SET expense_entry_id = @expId WHERE id = @id`, { expId: expenseId, id: req.params.id });
        }
      } catch (e) { console.error('[claims] Auto-expense creation error:', e?.message); }
    }

    if (isEmailConfigured()) {
      try {
        const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
        const claimantResult = await query(`SELECT full_name, email FROM users WHERE id = @id`, { id: claim.claimant_user_id });
        const claimant = claimantResult.recordset?.[0];
        if (claimant?.email) {
          const eventType = action === 'approve' ? 'reviewed_approved' : 'reviewed_declined';
          const html = claimEmailHtml({
            title: action === 'approve' ? 'Claim approved' : 'Claim declined',
            claimRef: claim.reference_number, claimant: claimant.full_name || claimant.email,
            claimType: CLAIM_TYPE_LABELS[claim.claim_type] || claim.claim_type,
            amount: claim.amount, description: claim.description,
            department: claim.department_name, appUrl: `${appUrl}/profile`,
            actionHtml: action === 'approve'
              ? `<div style="margin-top:16px;padding:12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;"><p style="margin:0;color:#065f46;font-weight:600;">Your claim has been approved by ${req.user.full_name || 'management'}.</p>${review_notes ? `<p style="margin:8px 0 0;color:#065f46;font-size:13px;">Notes: ${review_notes}</p>` : ''}</div>`
              : `<div style="margin-top:16px;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;"><p style="margin:0;color:#991b1b;font-weight:600;">Your claim has been declined by ${req.user.full_name || 'management'}.</p>${rejection_reason ? `<p style="margin:8px 0 0;color:#991b1b;font-size:13px;">Reason: ${rejection_reason}</p>` : ''}</div>`,
          });
          sendClaimEmailOnce({
            claimId: claim.id,
            eventType,
            to: claimant.email,
            subject: `Claim ${action === 'approve' ? 'approved' : 'declined'}: ${claim.reference_number}`,
            html,
          }).catch((e) => console.error('[claims] Review email error:', e?.message));
        }
      } catch (e) { console.error('[claims] Review email error:', e?.message); }
    }

    const updated = await query(`SELECT * FROM claims WHERE id = @id`, { id: req.params.id });
    res.json({ claim: updated.recordset?.[0] || null });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  CANCEL CLAIM
// ════════════════════════════════════════════════════════════════════

router.post('/:id/cancel', async (req, res, next) => {
  try {
    await query(`UPDATE claims SET [status] = N'cancelled', updated_at = SYSUTCDATETIME() WHERE id = @id AND claimant_user_id = @userId AND [status] IN (N'draft', N'pending')`, { id: req.params.id, userId: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  DELETE CLAIM (permanent — sends deleted notification once per recipient)
// ════════════════════════════════════════════════════════════════════

router.delete('/:id', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT c.*, u.full_name AS claimant_name, u.email AS claimant_email
       FROM claims c
       LEFT JOIN users u ON u.id = c.claimant_user_id
       WHERE c.id = @id`,
      { id: req.params.id }
    );
    const claim = r.recordset?.[0];
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const isOwner = String(claim.claimant_user_id) === String(req.user.id);
    const isMgmt = userHasManagement(req);
    if (!isOwner && !isMgmt) return res.status(403).json({ error: 'You cannot delete this claim' });

    const ownerDeletable = ['draft', 'pending', 'cancelled', 'declined'];
    if (isOwner && !isMgmt && !ownerDeletable.includes(claim.status)) {
      return res.status(400).json({ error: 'Approved or paid claims cannot be deleted. Contact management.' });
    }
    if (isMgmt && claim.status === 'paid') {
      return res.status(400).json({ error: 'Paid claims cannot be deleted' });
    }
    if (isMgmt && String(claim.tenant_id) !== String(tid(req)) && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await notifyClaimDeleted(claim, req.user.full_name || req.user.email);
    await query(`DELETE FROM claims WHERE id = @id`, { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════
//  ATTACHMENTS
// ════════════════════════════════════════════════════════════════════

router.post('/:id/attachments', upload.array('files', 10), async (req, res, next) => {
  try {
    const results = [];
    for (const f of req.files || []) {
      const r = await query(
        `INSERT INTO claim_attachments (claim_id, file_name, file_path, file_size, mime_type, uploaded_by_user_id) OUTPUT INSERTED.* VALUES (@cid, @name, @path, @size, @mime, @uid)`,
        { cid: req.params.id, name: f.originalname, path: f.path, size: f.size, mime: f.mimetype, uid: req.user.id }
      );
      if (r.recordset?.[0]) results.push(r.recordset[0]);
    }
    res.status(201).json({ attachments: results });
  } catch (err) { next(err); }
});

router.delete('/attachments/:id', async (req, res, next) => {
  try {
    const r = await query(`SELECT file_path FROM claim_attachments WHERE id = @id`, { id: req.params.id });
    const fp = r.recordset?.[0]?.file_path;
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    await query(`DELETE FROM claim_attachments WHERE id = @id`, { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
