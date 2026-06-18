import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import {
  listEnrolledTrackerTrucks,
  getTruckTrackerDetail,
  getTruckComplianceFullDetail,
  createTrackerComplianceCheck,
  listTrackerComplianceHistory,
  listGracePeriods,
  listTrackerSuspensions,
  notifyContractorForCheck,
  grantGracePeriod,
  loadCheck,
} from '../lib/vehicleTrackerCompliance.js';

const router = Router();
router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess(['access_management', 'command_centre']));

function tenantId(req) {
  return req.query.tenantId || req.user?.tenant_id || null;
}

/** GET enrolled trucks with tracker compliance status */
router.get('/trucks', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const result = await listEnrolledTrackerTrucks(query, {
      tenantId: tid,
      contractorId: req.query.contractorId || req.query.contractor_id || null,
      subContractor: req.query.subContractor || req.query.sub_contractor || null,
      search: String(req.query.search || req.query.q || '').trim() || null,
      complianceStatus: req.query.complianceStatus || req.query.status || null,
      enrolledOnly: req.query.enrolledOnly !== '0',
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

/** GET truck detail incl. tracker login */
router.get('/trucks/:truckId', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    if (req.query.detail === '1' || req.query.full === '1') {
      const detail = await getTruckComplianceFullDetail(query, { tenantId: tid, truckId: req.params.truckId });
      if (!detail) return res.status(404).json({ error: 'Truck not found' });
      return res.json(detail);
    }
    const truck = await getTruckTrackerDetail(query, { tenantId: tid, truckId: req.params.truckId });
    if (!truck) return res.status(404).json({ error: 'Truck not found' });
    res.json({ truck });
  } catch (e) {
    next(e);
  }
});

/** POST submit tracker compliance check */
router.post('/checks', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const truckId = req.body?.truck_id || req.body?.truckId;
    if (!truckId) return res.status(400).json({ error: 'truck_id required' });
    const driverId = req.body?.driver_id || req.body?.driverId || null;
    const result = await createTrackerComplianceCheck(query, {
      tenantId: tid,
      userId: req.user?.id,
      truckId,
      driverId,
      body: req.body || {},
    });
    const check = await loadCheck(query, { tenantId: tid, checkId: result.id });
    res.status(201).json({ check, ...result });
  } catch (e) {
    next(e);
  }
});

/** GET compliance check history */
router.get('/history', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const checks = await listTrackerComplianceHistory(query, {
      tenantId: tid,
      contractorId: req.query.contractorId || null,
      subContractor: req.query.subContractor || null,
      search: String(req.query.search || '').trim() || null,
      dateFrom: req.query.dateFrom || req.query.date_from || null,
      dateTo: req.query.dateTo || req.query.date_to || null,
      limit: req.query.limit,
    });
    res.json({ checks });
  } catch (e) {
    next(e);
  }
});

/** GET tracker-related suspensions (trucks & drivers) */
router.get('/suspensions', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const suspensions = await listTrackerSuspensions(query, {
      tenantId: tid,
      contractorId: req.query.contractorId || null,
      search: String(req.query.search || '').trim() || null,
      entityType: req.query.entityType || req.query.entity_type || null,
    });
    res.json({ suspensions });
  } catch (e) {
    next(e);
  }
});

/** GET grace periods */
router.get('/grace-periods', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const activeOnly = req.query.active === '1' || req.query.activeOnly === '1';
    const gracePeriods = await listGracePeriods(query, { tenantId: tid, activeOnly });
    res.json({ gracePeriods });
  } catch (e) {
    next(e);
  }
});

/** POST notify contractor for failed check */
router.post('/checks/:checkId/notify', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const result = await notifyContractorForCheck(query, {
      tenantId: tid,
      checkId: req.params.checkId,
      extraEmails: req.body?.emails || req.body?.extra_emails || [],
      customMessage: req.body?.message || '',
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

/** POST grant grace period on failed check */
router.post('/checks/:checkId/grace-period', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const result = await grantGracePeriod(query, {
      tenantId: tid,
      userId: req.user?.id,
      checkId: req.params.checkId,
      reason: req.body?.reason || '',
      expiresAt: req.body?.expires_at || req.body?.expiresAt,
    });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    const check = await loadCheck(query, { tenantId: tid, checkId: req.params.checkId });
    res.json({ ok: true, check });
  } catch (e) {
    next(e);
  }
});

/** GET contractors for filters */
router.get('/filters/contractors', async (req, res, next) => {
  try {
    const tid = tenantId(req);
    if (!tid) return res.status(403).json({ error: 'Tenant required' });
    const r = await query(
      `SELECT DISTINCT c.id, c.name
       FROM contractors c
       INNER JOIN contractor_trucks t ON t.contractor_id = c.id AND t.tenant_id = c.tenant_id
       INNER JOIN contractor_route_trucks rt ON rt.truck_id = t.id
       WHERE c.tenant_id = @tenantId
       ORDER BY c.name`,
      { tenantId: tid }
    );
    res.json({ contractors: r.recordset || [] });
  } catch (e) {
    next(e);
  }
});

export default router;
