import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import {
  getOrCreateDailyPlan,
  getDailyPlanWithRoutes,
  getPublishedPlan,
  buildSystemAdvise,
  applyAdviseToPlan,
  savePlanRoutes,
  acceptAndPublishPlan,
  getPlanManagementOverview,
} from '../lib/logisticsPlanner.js';

const router = Router();
router.use(requireAuth, loadUser);
router.use(requirePageAccess('logistics_planning'));

function tenantId(req) {
  return req.user?.tenant_id || null;
}

router.get('/plan', async (req, res, next) => {
  try {
    const tenantIdVal = tenantId(req);
    if (!tenantIdVal) return res.status(400).json({ error: 'No tenant' });
    const data = await getDailyPlanWithRoutes(query, tenantIdVal, req.query.date);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/plan/published', async (req, res, next) => {
  try {
    const tenantIdVal = tenantId(req);
    if (!tenantIdVal) return res.status(400).json({ error: 'No tenant' });
    const plan = await getPublishedPlan(query, tenantIdVal, req.query.date);
    res.json({ plan });
  } catch (err) {
    next(err);
  }
});

router.post('/plan', async (req, res, next) => {
  try {
    const tenantIdVal = tenantId(req);
    if (!tenantIdVal) return res.status(400).json({ error: 'No tenant' });
    const b = req.body || {};
    const plan = await getOrCreateDailyPlan(query, tenantIdVal, b.plan_date, {
      userId: req.user?.id,
      source: 'manual',
    });
    if (b.title) {
      await query(
        `UPDATE logistics_daily_plan SET title = @title, execution_notes = @notes, updated_at = SYSUTCDATETIME()
         WHERE id = @id AND tenant_id = @tenantId`,
        {
          tenantId: tenantIdVal,
          id: plan.id,
          title: String(b.title).trim(),
          notes: b.execution_notes != null ? String(b.execution_notes).trim() : null,
        }
      );
    }
    if (Array.isArray(b.routes)) {
      await savePlanRoutes(query, tenantIdVal, plan.id, b.routes);
    }
    const full = await getDailyPlanWithRoutes(query, tenantIdVal, plan.plan_date);
    res.json(full);
  } catch (err) {
    next(err);
  }
});

router.get('/advise', async (req, res, next) => {
  try {
    const tenantIdVal = tenantId(req);
    if (!tenantIdVal) return res.status(400).json({ error: 'No tenant' });
    const advise = await buildSystemAdvise(query, tenantIdVal, req.query.date);
    res.json(advise);
  } catch (err) {
    next(err);
  }
});

router.post('/advise/apply', async (req, res, next) => {
  try {
    const tenantIdVal = tenantId(req);
    if (!tenantIdVal) return res.status(400).json({ error: 'No tenant' });
    const data = await applyAdviseToPlan(query, tenantIdVal, req.body?.plan_date, req.user?.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/plan/:id/accept', async (req, res, next) => {
  try {
    const tenantIdVal = tenantId(req);
    if (!tenantIdVal) return res.status(400).json({ error: 'No tenant' });
    const result = await acceptAndPublishPlan(query, tenantIdVal, req.params.id, req.user?.id, {
      execution_notes: req.body?.execution_notes,
      publishedByName: req.user?.full_name || req.user?.email,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/overview', async (req, res, next) => {
  try {
    const tenantIdVal = tenantId(req);
    if (!tenantIdVal) return res.status(400).json({ error: 'No tenant' });
    const overview = await getPlanManagementOverview(query, tenantIdVal, {
      from: req.query.from,
      to: req.query.to,
      route_id: req.query.route_id,
    });
    res.json(overview);
  } catch (err) {
    next(err);
  }
});

export default router;
