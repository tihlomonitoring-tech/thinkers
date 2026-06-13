import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, loadUser, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, loadUser);

const VALID_PAGES = ['accounting', 'management', 'contractor', 'tracking_management'];

const PAGE_TABS = {
  accounting: [
    'company-settings', 'customer-book', 'supplier-book', 'items-library',
    'quotations', 'invoices', 'purchase-orders', 'account-types', 'general-ledger', 'statements', 'financial-reports', 'library',
    'department-budget', 'expense-management',
  ],
  management: [
    'schedules', 'team_goals', 'team_leader_audit', 'employee_productivity_score',
    'shift_activity', 'shift-swaps', 'schedule-events', 'leave', 'documents',
    'employee-details', 'compose_onboardment', 'warnings-rewards', 'queries',
    'evaluations', 'perf_eval_period', 'perf_eval_trends', 'perf_eval_questions',
    'auditor_results', 'pip', 'growth', 'company_library_policy', 'claims', 'org_structure',
  ],
  contractor: [
    'dashboard', 'trucks', 'fleet', 'fleet-access-summary', 'subcontractor-fleets',
    'drivers', 'driver-register', 'import-all', 'enrollment', 'onboarding',
    'contractor-details', 'subcontract-details', 'library',
    'fleet-maintenance', 'workshop', 'truck-inspection', 'external-inspections',
    'incidents', 'expiries', 'suspensions', 'messages',
  ],
  tracking_management: ['geofence', 'integration', 'activity', 'monitor', 'deliveries'],
};

/** Pages where zero grants means no tabs (must grant explicitly). */
const STRICT_EMPTY_GRANTS = new Set(['tracking_management']);

router.get('/my-tabs/:pageKey', async (req, res, next) => {
  try {
    const { pageKey } = req.params;
    if (!VALID_PAGES.includes(pageKey)) return res.status(400).json({ error: 'Invalid page key' });
    if (req.user.role === 'super_admin') {
      return res.json({ tabs: PAGE_TABS[pageKey] });
    }
    const result = await query(
      `SELECT tab_id FROM tab_access_grants WHERE user_id = @userId AND page_key = @pageKey`,
      { userId: req.user.id, pageKey }
    );
    const canonical = PAGE_TABS[pageKey];
    let tabs = (result.recordset || []).map((r) => r.tab_id).filter((id) => canonical.includes(id));
    if (tabs.length === 0) {
      if (!STRICT_EMPTY_GRANTS.has(pageKey)) tabs = [...canonical];
    } else {
      // Users with explicit grants still receive newly added tabs (e.g. general-ledger)
      tabs = [...new Set([...tabs, ...canonical])];
      if (pageKey === 'contractor') tabs = [...new Set([...tabs, 'onboarding'])];
    }
    res.json({ tabs });
  } catch (err) { next(err); }
});

router.get('/permissions/:pageKey', requireSuperAdmin, async (req, res, next) => {
  try {
    const { pageKey } = req.params;
    if (!VALID_PAGES.includes(pageKey)) return res.status(400).json({ error: 'Invalid page key' });
    const result = await query(
      `SELECT g.user_id, g.tab_id, g.granted_at, u.full_name, u.email
       FROM tab_access_grants g
       JOIN users u ON u.id = g.user_id
       WHERE g.page_key = @pageKey
       ORDER BY u.full_name, g.tab_id`,
      { pageKey }
    );
    const byUser = {};
    for (const row of result.recordset || []) {
      if (!byUser[row.user_id]) byUser[row.user_id] = { user_id: row.user_id, full_name: row.full_name, email: row.email, tabs: [] };
      byUser[row.user_id].tabs.push(row.tab_id);
    }
    res.json({ permissions: Object.values(byUser), allTabIds: PAGE_TABS[pageKey] });
  } catch (err) { next(err); }
});

router.post('/permissions/:pageKey', requireSuperAdmin, async (req, res, next) => {
  try {
    const { pageKey } = req.params;
    const { user_id, tab_id } = req.body || {};
    if (!VALID_PAGES.includes(pageKey)) return res.status(400).json({ error: 'Invalid page key' });
    if (!user_id || !tab_id || !PAGE_TABS[pageKey].includes(tab_id)) {
      return res.status(400).json({ error: 'user_id and valid tab_id required' });
    }
    await query(
      `IF NOT EXISTS (SELECT 1 FROM tab_access_grants WHERE user_id = @userId AND page_key = @pageKey AND tab_id = @tabId)
       INSERT INTO tab_access_grants (user_id, page_key, tab_id, granted_by_user_id) VALUES (@userId, @pageKey, @tabId, @grantedBy)`,
      { userId: user_id, pageKey, tabId: tab_id, grantedBy: req.user.id }
    );
    res.status(201).json({ granted: true });
  } catch (err) { next(err); }
});

router.delete('/permissions/:pageKey', requireSuperAdmin, async (req, res, next) => {
  try {
    const { pageKey } = req.params;
    const { user_id, tab_id } = req.query;
    if (!VALID_PAGES.includes(pageKey)) return res.status(400).json({ error: 'Invalid page key' });
    if (!user_id || !tab_id) return res.status(400).json({ error: 'user_id and tab_id query params required' });
    const result = await query(
      `DELETE FROM tab_access_grants WHERE user_id = @userId AND page_key = @pageKey AND tab_id = @tabId`,
      { userId: user_id, pageKey, tabId: tab_id }
    );
    res.json({ revoked: (result.rowsAffected?.[0] ?? 0) > 0 });
  } catch (err) { next(err); }
});

router.post('/permissions/:pageKey/bulk', requireSuperAdmin, async (req, res, next) => {
  try {
    const { pageKey } = req.params;
    const { user_id, tab_ids } = req.body || {};
    if (!VALID_PAGES.includes(pageKey)) return res.status(400).json({ error: 'Invalid page key' });
    if (!user_id || !Array.isArray(tab_ids)) return res.status(400).json({ error: 'user_id and tab_ids[] required' });

    await query(`DELETE FROM tab_access_grants WHERE user_id = @userId AND page_key = @pageKey`, { userId: user_id, pageKey });

    for (const tabId of tab_ids) {
      if (!PAGE_TABS[pageKey].includes(tabId)) continue;
      await query(
        `INSERT INTO tab_access_grants (user_id, page_key, tab_id, granted_by_user_id) VALUES (@userId, @pageKey, @tabId, @grantedBy)`,
        { userId: user_id, pageKey, tabId, grantedBy: req.user.id }
      );
    }
    res.json({ ok: true, count: tab_ids.length });
  } catch (err) { next(err); }
});

export default router;
