import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import {
  getContractorUserEmails,
  getRectorEmailsForAlertTypeAndRoutes,
  getCommandCentreAndAccessManagementEmails,
} from '../lib/emailRecipients.js';
import { vehicleComplianceAlertHtml, truckSuspendedToContractorHtml, truckSuspendedToRectorHtml } from '../lib/emailTemplates.js';
import {
  mapTruckRow,
  buildHaulierSummary,
  buildSummary,
} from '../lib/vehicleCompliance.js';
import { toYmdFromDbOrString } from '../lib/appTime.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess(['command_centre', 'access_management', 'rector']));

function getRow(row, ...keys) {
  if (!row || typeof row !== 'object') return null;
  for (const k of keys) {
    if (row[k] != null) return row[k];
    const found = Object.keys(row).find((x) => x.toLowerCase() === String(k).toLowerCase());
    if (found && row[found] != null) return row[found];
  }
  return null;
}

function canAction(req) {
  if (req.user?.role === 'super_admin') return true;
  const roles = req.user?.page_roles || [];
  return roles.includes('command_centre') || roles.includes('access_management');
}

async function getRectorRouteIds(req) {
  const userId = req.user?.id;
  const tenantId = req.user?.tenant_id;
  if (!userId || !tenantId) return [];
  const roles = req.user?.page_roles || [];
  if (!roles.includes('rector') || roles.includes('command_centre') || roles.includes('access_management')) return [];
  try {
    const r = await query(
      `SELECT f.route_id FROM access_route_factors f
       WHERE f.tenant_id = @tenantId AND f.user_id = @userId AND f.route_id IS NOT NULL`,
      { tenantId, userId }
    );
    return (r.recordset || []).map((row) => getRow(row, 'route_id')).filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchComplianceTrucks(req, { tenantId, contractorId, routeIds } = {}) {
  const tid = tenantId || req.user?.tenant_id;
  if (!tid) return [];

  let sql = `
    WITH LatestInsp AS (
      SELECT ti.*,
        ROW_NUMBER() OVER (
          PARTITION BY ti.truck_id
          ORDER BY COALESCE(ti.inspection_datetime, CAST(ti.inspection_date AS DATETIME2)) DESC, ti.created_at DESC
        ) AS rn
      FROM truck_inspections ti
      WHERE ti.tenant_id = @tenantId AND ti.truck_id IS NOT NULL
    ),
    BreakdownStats AS (
      SELECT truck_id,
        SUM(CASE WHEN reported_at >= DATEADD(day, -90, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS bd_90d,
        SUM(CASE WHEN reported_at >= DATEADD(day, -30, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS bd_30d,
        SUM(CASE WHEN reported_at >= DATEADD(day, -60, SYSUTCDATETIME()) AND reported_at < DATEADD(day, -30, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS bd_prev_30d
      FROM contractor_incidents
      WHERE tenant_id = @tenantId AND truck_id IS NOT NULL
      GROUP BY truck_id
    ),
    ActiveSusp AS (
      SELECT TRY_CAST(entity_id AS UNIQUEIDENTIFIER) AS truck_id
      FROM contractor_suspensions
      WHERE tenant_id = @tenantId AND entity_type = N'truck'
        AND [status] IN (N'suspended', N'under_appeal')
        AND (is_permanent = 1 OR suspension_ends_at IS NULL OR suspension_ends_at > SYSUTCDATETIME())
    )
    SELECT
      t.id AS truck_id,
      t.registration,
      t.make_model,
      t.fleet_no,
      t.sub_contractor,
      t.contractor_id,
      c.name AS contractor_name,
      t.tenant_id,
      tn.name AS tenant_name,
      li.inspection_date AS last_inspection_date,
      li.overall_result AS last_inspection_result,
      li.passed_items,
      li.failed_items,
      li.total_items,
      li.reference_number AS last_inspection_ref,
      li.source AS last_inspection_source,
      COALESCE(bs.bd_90d, 0) AS breakdown_count_90d,
      COALESCE(bs.bd_30d, 0) AS breakdown_count_30d,
      COALESCE(bs.bd_prev_30d, 0) AS breakdown_count_prev_30d,
      CASE WHEN s.truck_id IS NOT NULL THEN 1 ELSE 0 END AS is_suspended
    FROM contractor_trucks t
    INNER JOIN contractors c ON c.id = t.contractor_id AND c.tenant_id = t.tenant_id
    INNER JOIN tenants tn ON tn.id = t.tenant_id
    LEFT JOIN LatestInsp li ON li.truck_id = t.id AND li.rn = 1
    LEFT JOIN BreakdownStats bs ON bs.truck_id = t.id
    LEFT JOIN ActiveSusp s ON s.truck_id = t.id
    WHERE t.tenant_id = @tenantId
  `;
  const params = { tenantId: tid };

  if (contractorId) {
    sql += ` AND t.contractor_id = @contractorId`;
    params.contractorId = contractorId;
  }
  if (routeIds?.length) {
    const ph = routeIds.map((_, i) => `@r${i}`).join(',');
    sql += ` AND t.id IN (SELECT truck_id FROM contractor_route_trucks WHERE route_id IN (${ph}))`;
    routeIds.forEach((id, i) => { params[`r${i}`] = id; });
  }
  sql += ` ORDER BY c.name, t.registration`;

  const r = await query(sql, params);
  return (r.recordset || []).map(mapTruckRow);
}

async function suspendTruckById(truckId, reason) {
  const truckRow = await query(`SELECT tenant_id, registration, contractor_id FROM contractor_trucks WHERE id = @truckId`, { truckId });
  const truck = truckRow.recordset?.[0];
  if (!truck) return { error: 'Truck not found', status: 404 };
  const tenantId = getRow(truck, 'tenant_id');
  const existing = await query(
    `SELECT 1 FROM contractor_suspensions WHERE tenant_id = @tenantId AND entity_type = N'truck' AND entity_id = @entityId
     AND [status] IN (N'suspended', N'under_appeal')
     AND (is_permanent = 1 OR suspension_ends_at IS NULL OR suspension_ends_at > SYSUTCDATETIME())`,
    { tenantId, entityId: String(truckId) }
  );
  if (existing.recordset?.length) return { error: 'Truck is already suspended', status: 409 };

  await query(
    `INSERT INTO contractor_suspensions (tenant_id, entity_type, entity_id, reason, [status], is_permanent, suspension_ends_at)
     VALUES (@tenantId, N'truck', @entityId, @reason, N'suspended', 1, NULL)`,
    { tenantId, entityId: String(truckId), reason }
  );

  const truckRoutesResult = await query(`SELECT route_id FROM contractor_route_trucks WHERE truck_id = @truckId`, { truckId });
  const suspensionRouteIds = (truckRoutesResult.recordset || []).map((r) => getRow(r, 'route_id')).filter(Boolean);

  await query(
    `DELETE FROM contractor_route_trucks WHERE truck_id = @truckId
     AND route_id IN (SELECT id FROM contractor_routes WHERE tenant_id = @tenantId)`,
    { truckId, tenantId }
  );

  if (isEmailConfigured()) {
    try {
      const truckRegistration = getRow(truck, 'registration') || `Truck #${truckId}`;
      const truckContractorId = getRow(truck, 'contractor_id');
      const tenantRow = await query(`SELECT name FROM tenants WHERE id = @tenantId`, { tenantId });
      const tenantName = tenantRow.recordset?.[0]?.name || 'Unknown';
      const contractorEmails = truckContractorId
        ? await getContractorUserEmails(query, tenantId, truckContractorId)
        : [];
      const ccAm = await getCommandCentreAndAccessManagementEmails(query);
      const rectorSusp = suspensionRouteIds.length
        ? await getRectorEmailsForAlertTypeAndRoutes(query, 'suspension_alerts', suspensionRouteIds)
        : [];
      const rectorEmails = [...new Set([...ccAm, ...rectorSusp])];
      const appUrl = process.env.APP_URL || '';
      if (contractorEmails.length) {
        const html = truckSuspendedToContractorHtml({
          truckRegistration,
          tenantName,
          reason,
          isPermanent: true,
          suspensionEndsAt: null,
          appUrl,
        });
        await sendEmail({ to: contractorEmails, subject: `Truck suspended: ${truckRegistration}`, body: html, html: true });
      }
      if (rectorEmails.length) {
        const html = truckSuspendedToRectorHtml({ truckRegistration, tenantName, reason, isPermanent: true, suspensionEndsAt: null });
        await sendEmail({ to: rectorEmails, subject: `Truck suspended (for your awareness): ${truckRegistration} – ${tenantName}`, body: html, html: true });
      }
    } catch (e) {
      console.warn('[vehicleCompliance] suspend email failed:', e?.message || e);
    }
  }
  return { ok: true };
}

/** GET dashboard summary grouped by haulier */
router.get('/dashboard', async (req, res, next) => {
  try {
    const tenantId = req.query.tenantId || req.user?.tenant_id;
    const contractorId = req.query.contractorId || null;
    const routeIds = await getRectorRouteIds(req);
    const trucks = await fetchComplianceTrucks(req, { tenantId, contractorId, routeIds: routeIds.length ? routeIds : null });
    res.json({
      summary: buildSummary(trucks),
      hauliers: buildHaulierSummary(trucks),
      trucks,
    });
  } catch (err) {
    next(err);
  }
});

/** GET detailed truck compliance list */
router.get('/trucks', async (req, res, next) => {
  try {
    const tenantId = req.query.tenantId || req.user?.tenant_id;
    const contractorId = req.query.contractorId || null;
    const riskLevel = req.query.riskLevel || null;
    const routeIds = await getRectorRouteIds(req);
    let trucks = await fetchComplianceTrucks(req, { tenantId, contractorId, routeIds: routeIds.length ? routeIds : null });
    if (riskLevel && riskLevel !== 'all') trucks = trucks.filter((t) => t.risk_level === riskLevel);
    if (req.query.suspended === '1') trucks = trucks.filter((t) => t.is_suspended);
    if (req.query.overdue === '1') trucks = trucks.filter((t) => t.overdue);
    if (req.query.forceSuspend === '1') trucks = trucks.filter((t) => t.force_suspend && !t.is_suspended);
    res.json({ trucks, summary: buildSummary(trucks) });
  } catch (err) {
    next(err);
  }
});

/** POST notify haulier + CC rectors about compliance issue */
router.post('/notify', async (req, res, next) => {
  try {
    if (!canAction(req)) return res.status(403).json({ error: 'You cannot send compliance notifications.' });
    const truckId = req.body?.truck_id;
    const note = (req.body?.note || '').trim();
    if (!truckId) return res.status(400).json({ error: 'truck_id required' });
    if (!isEmailConfigured()) return res.status(503).json({ error: 'Email is not configured on this server.' });

    const trucks = await fetchComplianceTrucks(req, {});
    const truck = trucks.find((t) => String(t.truck_id) === String(truckId));
    if (!truck) return res.status(404).json({ error: 'Truck not found' });

    const tenantId = truck.tenant_id;
    const contractorEmails = truck.contractor_id
      ? await getContractorUserEmails(query, tenantId, truck.contractor_id)
      : [];
    const routeRes = await query(`SELECT route_id FROM contractor_route_trucks WHERE truck_id = @truckId`, { truckId });
    const routeIds = (routeRes.recordset || []).map((r) => getRow(r, 'route_id')).filter(Boolean);
    const rectorEmails = routeIds.length
      ? await getRectorEmailsForAlertTypeAndRoutes(query, 'incident_alerts', routeIds)
      : [];
    const ccEmails = await getCommandCentreAndAccessManagementEmails(query);
    const cc = [...new Set([...rectorEmails, ...ccEmails])].filter((e) => !contractorEmails.includes(e));

    if (!contractorEmails.length && !cc.length) {
      return res.status(400).json({ error: 'No email recipients found for this truck.' });
    }

    const reasons = (req.body?.reasons || truck.recommendations || []).map((r) => (typeof r === 'string' ? r : r.message)).filter(Boolean);
    const html = vehicleComplianceAlertHtml({
      truckRegistration: truck.registration,
      contractorName: truck.contractor_name,
      tenantName: truck.tenant_name,
      inspectionScore: truck.inspection_score,
      inspectionRating: truck.inspection_rating,
      lastInspectionDate: truck.last_inspection_date ? toYmdFromDbOrString(truck.last_inspection_date) : null,
      riskLevel: truck.risk_level,
      reasons,
      note,
      senderName: req.user?.full_name || req.user?.email || 'Access Management',
    });

    await sendEmail({
      to: contractorEmails.length ? contractorEmails : cc,
      cc: contractorEmails.length ? cc : undefined,
      subject: `Vehicle compliance notice: ${truck.registration} — action required`,
      body: html,
      html: true,
    });

    res.json({ ok: true, notified: contractorEmails.length, cc: cc.length });
  } catch (err) {
    next(err);
  }
});

/** POST suspend truck from vehicle compliance */
router.post('/suspend', async (req, res, next) => {
  try {
    if (!canAction(req)) return res.status(403).json({ error: 'You cannot suspend trucks.' });
    const truckId = req.body?.truck_id;
    if (!truckId) return res.status(400).json({ error: 'truck_id required' });
    const reason = (req.body?.reason || '').trim()
      || 'Suspended from Vehicle Compliance — inspection failure, low score, or worsening breakdown trend.';
    const result = await suspendTruckById(truckId, reason);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
