import { Router } from 'express';
import bcrypt from 'bcrypt';
import { query, getPool, sql } from '../db.js';
import { requireAuth, loadUser, requireTenantAdmin, requirePageAccess, requireSuperAdmin } from '../middleware/auth.js';
import { auditLog } from '../lib/audit.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import { newUserCreatedHtml, accountApprovedHtml } from '../lib/emailTemplates.js';
import { randomBytes } from 'crypto';
import { getSuperAdminEmails } from '../lib/emailRecipients.js';
import {
  SUBCONTRACTOR_ROBOT_PASSWORD,
  allocateSubcontractorEmails,
  subcontractorRobotRowStatus,
} from '../lib/subcontractorUserRobot.js';

const router = Router();
const SALT_ROUNDS = 10;

/** Page IDs that can be assigned as roles (main app pages). Must match client PAGE_ROLES. */
/** Allowed page_id values; DB CHECK CK_user_page_roles_page_id must match — run `npm run db:user-page-roles-check-sync` after adding a page here. */
export const PAGE_IDS = ['profile', 'operator_profile', 'management', 'operator_management', 'users', 'tenants', 'contractor', 'command_centre', 'onboarding_admin', 'access_management', 'rector', 'tasks', 'case_management', 'transport_operations', 'recruitment', 'letters', 'accounting_management', 'tracking_integration', 'fuel_supply_management', 'fuel_customer_orders', 'fuel_data', 'team_leader_admin', 'performance_evaluations', 'auditor', 'company_library', 'quick_sign', 'report_generation', 'office_admin', 'logistics_finance_management', 'policy_development', 'logistics_planning'];

async function getPageRolesForUsers(pool, userIds) {
  if (!userIds || userIds.length === 0) return {};
  const request = pool.request();
  const placeholders = userIds.map((_, i) => `@id${i}`).join(',');
  userIds.forEach((id, i) => { request.input(`id${i}`, id); });
  const result = await request.query(
    `SELECT user_id, page_id FROM user_page_roles WHERE user_id IN (${placeholders})`
  );
  const byUser = {};
  for (const row of result.recordset || []) {
    const uid = row.user_id ?? row.user_Id;
    if (!byUser[uid]) byUser[uid] = [];
    byUser[uid].push(row.page_id ?? row.page_Id);
  }
  return byUser;
}

async function getTenantIdsForUsers(pool, userIds) {
  if (!userIds || userIds.length === 0) return {};
  try {
    const request = pool.request();
    const placeholders = userIds.map((_, i) => `@id${i}`).join(',');
    userIds.forEach((id, i) => { request.input(`id${i}`, id); });
    const result = await request.query(
      `SELECT user_id, tenant_id FROM user_tenants WHERE user_id IN (${placeholders})`
    );
    const byUser = {};
    for (const row of result.recordset || []) {
      const uid = row.user_id ?? row.user_Id;
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(row.tenant_id ?? row.tenant_Id);
    }
    return byUser;
  } catch (_) {
    return {};
  }
}

async function getSubcontractorIdsForUsers(pool, userIds) {
  if (!userIds || userIds.length === 0) return {};
  try {
    const request = pool.request();
    const placeholders = userIds.map((_, i) => `@id${i}`).join(',');
    userIds.forEach((id, i) => { request.input(`id${i}`, id); });
    const result = await request.query(
      `SELECT user_id, subcontractor_id FROM user_subcontractors WHERE user_id IN (${placeholders})`
    );
    const byUser = {};
    for (const row of result.recordset || []) {
      const uid = row.user_id ?? row.user_Id;
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(row.subcontractor_id ?? row.subcontractor_Id);
    }
    return byUser;
  } catch (_) {
    return {};
  }
}

async function syncUserSubcontractors(userId, subcontractorIds, contractorIds) {
  await query(`DELETE FROM user_subcontractors WHERE user_id = @userId`, { userId });
  const subs = Array.isArray(subcontractorIds) ? [...new Set(subcontractorIds.filter(Boolean))] : [];
  if (subs.length === 0) return;
  const cids = Array.isArray(contractorIds) ? contractorIds.filter(Boolean) : [];
  if (cids.length === 0) return;
  const cPh = cids.map((_, i) => `@cid${i}`).join(',');
  for (const sid of subs) {
    const cp = { sid };
    cids.forEach((cid, i) => { cp[`cid${i}`] = cid; });
    const chk = await query(
      `SELECT 1 AS ok FROM contractor_subcontractors WHERE id = @sid AND contractor_id IN (${cPh})`,
      cp
    );
    if (chk.recordset?.length) {
      await query(
        `INSERT INTO user_subcontractors (user_id, subcontractor_id) VALUES (@userId, @subcontractorId)`,
        { userId, subcontractorId: sid }
      );
    }
  }
}

async function getContractorIdsForUsers(pool, userIds) {
  if (!userIds || userIds.length === 0) return {};
  try {
    const request = pool.request();
    const placeholders = userIds.map((_, i) => `@id${i}`).join(',');
    userIds.forEach((id, i) => { request.input(`id${i}`, id); });
    const result = await request.query(
      `SELECT user_id, contractor_id FROM user_contractors WHERE user_id IN (${placeholders})`
    );
    const byUser = {};
    for (const row of result.recordset || []) {
      const uid = row.user_id ?? row.user_Id;
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push(row.contractor_id ?? row.contractor_Id);
    }
    return byUser;
  } catch (_) {
    return {};
  }
}

router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('users'));

/** GET contractors for given tenant IDs (for User Management). Supports tenant_ids=id1,id2 or tenant_id=id. */
router.get('/contractors-for-tenants', async (req, res, next) => {
  try {
    let tenantIds = [];
    const rawMulti = req.query?.tenant_ids;
    const rawSingle = req.query?.tenant_id;
    if (rawMulti != null) {
      tenantIds = (typeof rawMulti === 'string' ? rawMulti.split(',') : Array.isArray(rawMulti) ? rawMulti : [])
        .map((id) => (id != null ? String(id).trim().replace(/^\{|\}$/g, '') : ''))
        .filter(Boolean);
    }
    if (tenantIds.length === 0 && rawSingle != null) {
      const one = String(rawSingle).trim().replace(/^\{|\}$/g, '');
      if (one) tenantIds = [one];
    }
    if (tenantIds.length === 0) return res.json({ contractors: [] });
    const allowed = req.user?.role === 'super_admin'
      ? tenantIds
      : tenantIds.filter((tid) => canAccessTenant(req, tid));
    if (allowed.length === 0) return res.json({ contractors: [] });

    const pool = await getPool();
    const request = pool.request();
    allowed.forEach((id, i) => { request.input(`t${i}`, sql.UniqueIdentifier, id); });
    const placeholders = allowed.map((_, i) => `@t${i}`).join(',');
    const result = await request.query(
      `SELECT id, tenant_id, name FROM contractors WHERE tenant_id IN (${placeholders}) ORDER BY name`
    );
    const rows = result.recordset || [];
    res.json({ contractors: rows });
  } catch (err) {
    if (err.message && (err.message.includes('Invalid object name') || err.message.includes("contractors"))) {
      return res.status(200).json({ contractors: [], _error: 'Contractors table may not exist. Run the multi-contractor schema (e.g. npm run db:contractors-multi).' });
    }
    next(err);
  }
});

/** GET sub-contractor companies for given contractor IDs (must exist under those contractors). */
router.get('/subcontractors-for-contractors', async (req, res, next) => {
  try {
    const raw = req.query?.contractor_ids;
    const contractorIds = (typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : [])
      .map((id) => (id != null ? String(id).trim().replace(/^\{|\}$/g, '') : ''))
      .filter(Boolean);
    if (contractorIds.length === 0) return res.json({ subcontractors: [] });

    const pool = await getPool();
    const request = pool.request();
    contractorIds.forEach((id, i) => { request.input(`c${i}`, sql.UniqueIdentifier, id); });
    const placeholders = contractorIds.map((_, i) => `@c${i}`).join(',');
    const result = await request.query(
      `SELECT s.id, s.tenant_id, s.contractor_id, s.company_name, c.name AS contractor_name
       FROM contractor_subcontractors s
       LEFT JOIN contractors c ON c.id = s.contractor_id
       WHERE s.contractor_id IN (${placeholders})
       ORDER BY c.name, s.company_name`
    );
    res.json({ subcontractors: result.recordset || [] });
  } catch (err) {
    if (err.message?.includes('Invalid object name')) return res.json({ subcontractors: [] });
    next(err);
  }
});

/** POST create a contractor (company) under a tenant. For User Management: create contractor companies here. */
router.post('/contractors', requireTenantAdmin, async (req, res, next) => {
  try {
    const { tenant_id, name } = req.body || {};
    const tenantId = tenant_id != null ? String(tenant_id).trim().replace(/^\{|\}$/g, '') : '';
    const nameTrim = name != null ? String(name).trim() : '';
    if (!tenantId || !nameTrim) return res.status(400).json({ error: 'tenant_id and name are required' });
    if (!canAccessTenant(req, tenantId)) return res.status(403).json({ error: 'You cannot create contractors for this tenant' });
    const result = await query(
      `INSERT INTO contractors (tenant_id, name) OUTPUT INSERTED.id, INSERTED.tenant_id, INSERTED.name, INSERTED.created_at VALUES (@tenantId, @name)`,
      { tenantId, name: nameTrim }
    );
    const row = result.recordset?.[0];
    res.status(201).json({ contractor: row });
  } catch (err) {
    next(err);
  }
});

function canAccessTenant(req, tenantId) {
  if (req.user.role === 'super_admin') return true;
  const tid = tenantId != null ? String(tenantId).replace(/^\{|\}$/g, '') : '';
  const userTid = req.user.tenant_id != null ? String(req.user.tenant_id).replace(/^\{|\}$/g, '') : null;
  const userTids = Array.isArray(req.user.tenant_ids)
    ? req.user.tenant_ids.map((t) => (t != null ? String(t).replace(/^\{|\}$/g, '') : ''))
    : [];
  const hasTenant = tid && (tid === userTid || userTids.includes(tid));
  if (!hasTenant) return false;
  const isEnterprise = String(req.user?.tenant_plan).toLowerCase() === 'enterprise';
  if (req.user.role === 'tenant_admin' || isEnterprise) return true;
  return false;
}

function parseUuidList(raw) {
  return (typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : [])
    .map((id) => (id != null ? String(id).trim().replace(/^\{|\}$/g, '') : ''))
    .filter(Boolean);
}

/** GET preview subcontractor portal users to auto-create (robot). */
router.get('/subcontractor-robot/preview', requireTenantAdmin, async (req, res, next) => {
  try {
    const tenantId = String(req.query?.tenant_id || req.user.tenant_id || '').trim().replace(/^\{|\}$/g, '');
    const contractorIds = parseUuidList(req.query?.contractor_ids);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id is required' });
    if (!canAccessTenant(req, tenantId)) return res.status(403).json({ error: 'Forbidden' });
    if (contractorIds.length === 0) return res.json({ password: SUBCONTRACTOR_ROBOT_PASSWORD, rows: [] });

    const cPh = contractorIds.map((_, i) => `@c${i}`).join(',');
    const cParams = { tenantId };
    contractorIds.forEach((id, i) => { cParams[`c${i}`] = id; });
    const subResult = await query(
      `SELECT s.id, s.tenant_id, s.contractor_id, s.company_name, c.name AS contractor_name
       FROM contractor_subcontractors s
       LEFT JOIN contractors c ON c.id = s.contractor_id
       WHERE s.contractor_id IN (${cPh}) AND s.tenant_id = @tenantId
       ORDER BY c.name, s.company_name`,
      cParams
    );
    const subs = (subResult.recordset || []).map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      contractor_id: r.contractor_id,
      company_name: r.company_name,
      contractor_name: r.contractor_name,
    }));

    if (subs.length === 0) {
      return res.json({ password: SUBCONTRACTOR_ROBOT_PASSWORD, rows: [] });
    }

    const emailResult = await query(
      `SELECT LOWER(LTRIM(RTRIM(email))) AS email FROM users WHERE tenant_id = @tenantId AND email IS NOT NULL`,
      { tenantId }
    );
    const existingEmails = new Set(
      (emailResult.recordset || []).map((r) => (r.email || '').toLowerCase()).filter(Boolean)
    );

    const subIds = subs.map((s) => s.id);
    const subPh = subIds.map((_, i) => `@s${i}`).join(',');
    const portalParams = {};
    subIds.forEach((id, i) => { portalParams[`s${i}`] = id; });
    const portalResult = subIds.length
      ? await query(
        `SELECT us.subcontractor_id, u.email, u.full_name
         FROM user_subcontractors us
         INNER JOIN users u ON u.id = us.user_id
         WHERE us.subcontractor_id IN (${subPh})`,
        portalParams
      )
      : { recordset: [] };
    const portalUserBySubId = new Map();
    for (const row of portalResult.recordset || []) {
      const sid = String(row.subcontractor_id ?? row.subcontractor_Id ?? '');
      portalUserBySubId.set(sid, {
        email: row.email,
        full_name: row.full_name,
      });
    }

    const withEmails = allocateSubcontractorEmails(subs, existingEmails);
    const rows = withEmails.map((sub) => {
      const st = subcontractorRobotRowStatus(sub, portalUserBySubId);
      return {
        subcontractor_id: sub.id,
        contractor_id: sub.contractor_id,
        contractor_name: sub.contractor_name,
        company_name: sub.company_name,
        proposed_email: sub.proposed_email,
        proposed_full_name: sub.proposed_full_name,
        status: st.status,
        message: st.message,
        selectable: st.selectable,
        existing_user_email: st.existing_user_email || null,
      };
    });

    res.json({
      password: SUBCONTRACTOR_ROBOT_PASSWORD,
      rows,
      summary: {
        total: rows.length,
        ready: rows.filter((r) => r.status === 'ready').length,
        has_portal_user: rows.filter((r) => r.status === 'has_portal_user').length,
      },
    });
  } catch (err) {
    if (err.message?.includes('Invalid object name')) {
      return res.json({ password: SUBCONTRACTOR_ROBOT_PASSWORD, rows: [], summary: { total: 0, ready: 0, has_portal_user: 0 } });
    }
    next(err);
  }
});

/** POST bulk-create subcontractor portal users (robot). */
router.post('/subcontractor-robot/bulk-create', requireTenantAdmin, async (req, res, next) => {
  try {
    const { tenant_id, items } = req.body || {};
    const tenantId = String(tenant_id || req.user.tenant_id || '').trim().replace(/^\{|\}$/g, '');
    if (!tenantId) return res.status(400).json({ error: 'tenant_id is required' });
    if (!canAccessTenant(req, tenantId)) return res.status(403).json({ error: 'Forbidden' });
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return res.status(400).json({ error: 'items array required (subcontractor_id per row)' });

    const password = SUBCONTRACTOR_ROBOT_PASSWORD;
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const created = [];
    const skipped = [];
    const failed = [];

    for (const item of list) {
      const subcontractorId = item?.subcontractor_id != null ? String(item.subcontractor_id).trim() : '';
      if (!subcontractorId) {
        failed.push({ subcontractor_id: null, error: 'Missing subcontractor_id' });
        continue;
      }

      const subRow = await query(
        `SELECT s.id, s.company_name, s.contractor_id, s.tenant_id, c.name AS contractor_name
         FROM contractor_subcontractors s
         LEFT JOIN contractors c ON c.id = s.contractor_id
         WHERE s.id = @subcontractorId AND s.tenant_id = @tenantId`,
        { subcontractorId, tenantId }
      );
      const sub = subRow.recordset?.[0];
      if (!sub) {
        failed.push({ subcontractor_id: subcontractorId, error: 'Sub-contractor not found for tenant' });
        continue;
      }

      const contractorId = sub.contractor_id ?? sub.contractor_Id;
      const existingPortal = await query(
        `SELECT u.email FROM user_subcontractors us
         INNER JOIN users u ON u.id = us.user_id
         WHERE us.subcontractor_id = @subcontractorId`,
        { subcontractorId }
      );
      if (existingPortal.recordset?.[0]) {
        skipped.push({
          subcontractor_id: subcontractorId,
          company_name: sub.company_name,
          reason: 'Portal user already exists',
          email: existingPortal.recordset[0].email,
        });
        continue;
      }

      const companyName = sub.company_name || sub.company_Name || 'Sub-contractor';
      const emailRaw = item?.email != null ? String(item.email).trim().toLowerCase() : '';
      const email = emailRaw || allocateSubcontractorEmails([{ company_name: companyName }], new Set())[0]?.proposed_email;
      if (!email || !email.includes('@')) {
        failed.push({ subcontractor_id: subcontractorId, error: 'Could not generate email' });
        continue;
      }

      const fullName = (item?.full_name != null ? String(item.full_name).trim() : '') || companyName;

      try {
        const ins = await query(
          `INSERT INTO users (tenant_id, email, password_hash, full_name, role, status)
           OUTPUT INSERTED.id, INSERTED.email, INSERTED.full_name
           VALUES (@tenantId, @email, @passwordHash, @fullName, N'user', N'active')`,
          { tenantId, email, passwordHash, fullName }
        );
        const user = ins.recordset?.[0];
        if (!user?.id) {
          failed.push({ subcontractor_id: subcontractorId, error: 'Insert failed' });
          continue;
        }

        await query(`INSERT INTO user_tenants (user_id, tenant_id) VALUES (@userId, @tenantId)`, {
          userId: user.id,
          tenantId,
        });
        await query(`INSERT INTO user_page_roles (user_id, page_id) VALUES (@userId, N'contractor')`, {
          userId: user.id,
        });
        if (contractorId) {
          await query(
            `INSERT INTO user_contractors (user_id, contractor_id) VALUES (@userId, @contractorId)`,
            { userId: user.id, contractorId }
          );
        }
        await syncUserSubcontractors(user.id, [subcontractorId], contractorId ? [contractorId] : []);

        await auditLog({
          tenantId,
          userId: req.user.id,
          action: 'user.create',
          entityType: 'user',
          entityId: user.id,
          details: { email: user.email, source: 'subcontractor_robot', subcontractor_id: subcontractorId },
          ip: req.ip,
        });

        created.push({
          subcontractor_id: subcontractorId,
          company_name: companyName,
          contractor_name: sub.contractor_name,
          user_id: user.id,
          email: user.email,
          full_name: user.full_name,
        });
      } catch (e) {
        if (e.number === 2627) {
          skipped.push({ subcontractor_id: subcontractorId, company_name: companyName, reason: 'Email already exists', email });
        } else {
          failed.push({ subcontractor_id: subcontractorId, error: e.message || 'Create failed' });
        }
      }
    }

    res.status(201).json({
      password,
      created: created.length,
      skipped: skipped.length,
      failed: failed.length,
      users: created,
      skipped_items: skipped,
      failed_items: failed,
    });
  } catch (err) {
    next(err);
  }
});

/** List users with filters; super_admin sees all, tenant_admin sees own tenant */
router.get('/', async (req, res, next) => {
  try {
    const { tenant_id, role, status, search, sort = 'created_at', order = 'desc', page = 1, limit = 50 } = req.query;
    const tenantId = tenant_id || req.user.tenant_id;
    if (!canAccessTenant(req, tenantId) && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(100, Math.max(1, parseInt(limit, 10)));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const validSort = ['created_at', 'full_name', 'email', 'last_login_at', 'role', 'status'].includes(sort) ? sort : 'created_at';
    const validOrder = order === 'asc' ? 'ASC' : 'DESC';

    let where = 'WHERE 1=1';
    const params = { offset, limitNum };
    let fromJoin = 'FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id';

    if (req.user.role !== 'super_admin') {
      fromJoin += ' INNER JOIN user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = @tenantId';
      where += ' AND ut.tenant_id = @tenantId';
      params.tenantId = req.user.tenant_id;
    } else if (tenantId) {
      fromJoin += ' INNER JOIN user_tenants ut ON ut.user_id = u.id AND ut.tenant_id = @tenantId';
      where += ' AND ut.tenant_id = @tenantId';
      params.tenantId = tenantId;
    }
    if (req.user.role === 'super_admin' && !tenantId) {
      fromJoin = 'FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id';
    }

    if (role) { where += ' AND u.role = @role'; params.role = role; }
    if (status) { where += ' AND u.status = @status'; params.status = status; }
    if (search && search.trim()) {
      where += ' AND (u.email LIKE @search OR u.full_name LIKE @search)';
      params.search = '%' + search.trim() + '%';
    }

    const countResult = await query(
      `SELECT COUNT(DISTINCT u.id) AS total ${fromJoin} ${where}`,
      params
    );
    const total = countResult.recordset[0].total;

    const result = await query(
      `SELECT DISTINCT u.id, u.tenant_id, u.email, u.full_name, u.role, u.status, u.id_number, u.avatar_url, u.last_login_at, u.login_count, u.created_at, t.name AS tenant_name, t.[plan] AS tenant_plan
       ${fromJoin}
       ${where}
       ORDER BY u.${validSort} ${validOrder}
       OFFSET @offset ROWS FETCH NEXT @limitNum ROWS ONLY`,
      { ...params, offset, limitNum }
    );
    const list = result.recordset || [];
    const pool = await getPool();
    const pageRolesByUser = await getPageRolesForUsers(pool, list.map((u) => u.id));
    const tenantIdsByUser = await getTenantIdsForUsers(pool, list.map((u) => u.id));
    const contractorIdsByUser = await getContractorIdsForUsers(pool, list.map((u) => u.id));
    const subcontractorIdsByUser = await getSubcontractorIdsForUsers(pool, list.map((u) => u.id));
    const usersWithRoles = list.map((u) => {
      const fromTable = tenantIdsByUser[u.id];
      const tenant_ids = (Array.isArray(fromTable) && fromTable.length > 0)
        ? fromTable
        : (u.tenant_id != null ? [u.tenant_id] : []);
      const subcontractor_ids = subcontractorIdsByUser[u.id] || [];
      return {
        ...u,
        page_roles: pageRolesByUser[u.id] || [],
        tenant_ids,
        contractor_ids: contractorIdsByUser[u.id] || [],
        subcontractor_ids,
        is_subcontractor_user: subcontractor_ids.length > 0,
      };
    });

    res.json({
      users: usersWithRoles,
      pagination: { page: Math.floor(offset / limitNum) + 1, limit: limitNum, total },
    });
  } catch (err) {
    next(err);
  }
});

/** List sign-up requests (query: status = pending | approved | rejected). */
router.get('/sign-up-requests', async (req, res, next) => {
  try {
    const { status = 'pending' } = req.query;
    const validStatus = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
    const result = await query(
      `SELECT id, email, full_name, id_number, cellphone, [status], reviewed_at, created_at
       FROM sign_up_requests
       WHERE [status] = @status
       ORDER BY created_at DESC`,
      { status: validStatus }
    );
    res.json({ requests: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** Get one sign-up request. */
router.get('/sign-up-requests/:id', async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = pool.request();
    r.input('id', sql.UniqueIdentifier, req.params.id);
    const result = await r.query(
      `SELECT id, email, full_name, id_number, cellphone, [status], reviewed_by_user_id, reviewed_at, rejection_reason, created_at
       FROM sign_up_requests WHERE id = @id`
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Sign-up request not found' });
    res.json({ request: row });
  } catch (err) {
    next(err);
  }
});

/** Approve sign-up request: create user with role, tenants, page_roles; send login-details email. */
router.post('/sign-up-requests/:id/approve', requireTenantAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const pool = await getPool();
    let r = pool.request();
    r.input('id', sql.UniqueIdentifier, id);
    const fetchResult = await r.query(
      `SELECT id, email, full_name, id_number, cellphone FROM sign_up_requests WHERE id = @id AND [status] = N'pending'`
    );
    const request = fetchResult.recordset?.[0];
    if (!request) return res.status(404).json({ error: 'Sign-up request not found or already processed' });

    const { role, tenant_ids: bodyTenantIds, page_roles } = req.body || {};
    let tenantIds = Array.isArray(bodyTenantIds) ? bodyTenantIds.filter(Boolean) : [];
    if (req.user.role !== 'super_admin') {
      tenantIds = tenantIds.length ? tenantIds.filter((tid) => canAccessTenant(req, tid)) : [req.user.tenant_id];
      if (tenantIds.length === 0) tenantIds = [req.user.tenant_id];
    }
    if (tenantIds.length === 0) return res.status(400).json({ error: 'At least one tenant is required' });
    const primaryTenantId = tenantIds[0];
    if (!canAccessTenant(req, primaryTenantId)) return res.status(403).json({ error: 'Forbidden' });

    const safeRole = role === 'tenant_admin' || role === 'user' ? role : 'user';
    const finalRole = req.user.role === 'super_admin' ? (role || 'user') : safeRole;
    const tempPassword = randomBytes(12).toString('base64').replace(/[/+=]/g, '').slice(0, 16);
    const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);
    const emailLower = (request.email || '').trim().toLowerCase();
    const fullName = (request.full_name || '').trim();
    const idNumberVal = request.id_number != null && String(request.id_number).trim() ? String(request.id_number).trim() : null;
    const cellphoneVal = request.cellphone != null && String(request.cellphone).trim() ? String(request.cellphone).trim() : null;

    const insertResult = await query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role, status, id_number, cellphone)
       OUTPUT INSERTED.id, INSERTED.tenant_id, INSERTED.email, INSERTED.full_name, INSERTED.role, INSERTED.status
       VALUES (@tenantId, @email, @passwordHash, @fullName, @role, 'active', @id_number, @cellphone)`,
      {
        tenantId: primaryTenantId,
        email: emailLower,
        passwordHash,
        fullName,
        role: finalRole,
        id_number: idNumberVal,
        cellphone: cellphoneVal,
      }
    );
    const user = insertResult.recordset[0];
    for (const tid of tenantIds) {
      await query(`INSERT INTO user_tenants (user_id, tenant_id) VALUES (@userId, @tenantId)`, { userId: user.id, tenantId: tid });
    }
    const pageIds = Array.isArray(page_roles) ? page_roles.filter((p) => PAGE_IDS.includes(p)) : [];
    for (const pageId of pageIds) {
      await query(`INSERT INTO user_page_roles (user_id, page_id) VALUES (@userId, @pageId)`, { userId: user.id, pageId });
    }
    r = pool.request();
    r.input('id', sql.UniqueIdentifier, id);
    r.input('userId', sql.UniqueIdentifier, req.user.id);
    await r.query(
      `UPDATE sign_up_requests SET [status] = N'approved', reviewed_by_user_id = @userId, reviewed_at = SYSUTCDATETIME() WHERE id = @id`
    );
    await auditLog({
      tenantId: user.tenant_id,
      userId: req.user.id,
      action: 'sign_up.approve',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email, request_id: id },
      ip: req.ip,
    });

    const appUrl = (process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
    const loginUrl = `${appUrl}/login`;
    if (isEmailConfigured()) {
      const html = accountApprovedHtml({ loginUrl, email: user.email, temporaryPassword: tempPassword, appUrl });
      try {
        await sendEmail({
          to: user.email,
          subject: 'Your account has been approved – Thinkers',
          body: html,
          html: true,
        });
      } catch (emailErr) {
        console.error('[users] Approve sign-up: failed to send email to', user.email, emailErr?.message || emailErr);
      }
    }
    const pageRolesByUser = await getPageRolesForUsers(pool, [user.id]);
    const tenantIdsByUser = await getTenantIdsForUsers(pool, [user.id]);
    res.status(201).json({
      user: {
        ...user,
        page_roles: pageRolesByUser[user.id] || pageIds,
        tenant_ids: tenantIdsByUser[user.id] || tenantIds,
      },
    });
  } catch (err) {
    if (err.number === 2627) return res.status(409).json({ error: 'Email already exists' });
    next(err);
  }
});

/** Reject sign-up request. */
router.post('/sign-up-requests/:id/reject', requireTenantAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const pool = await getPool();
    let r = pool.request();
    r.input('id', sql.UniqueIdentifier, id);
    const result = await r.query(
      `SELECT id FROM sign_up_requests WHERE id = @id AND [status] = N'pending'`
    );
    if (!result.recordset?.length) return res.status(404).json({ error: 'Sign-up request not found or already processed' });
    r = pool.request();
    r.input('id', sql.UniqueIdentifier, id);
    r.input('userId', sql.UniqueIdentifier, req.user.id);
    r.input('reason', sql.NVarChar, reason != null ? String(reason).trim() : null);
    await r.query(
      `UPDATE sign_up_requests SET [status] = N'rejected', reviewed_by_user_id = @userId, reviewed_at = SYSUTCDATETIME(), rejection_reason = @reason WHERE id = @id`
    );
    await auditLog({
      userId: req.user.id,
      action: 'sign_up.reject',
      entityType: 'sign_up_request',
      entityId: id,
      details: { reason },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Super admin: accounts locked after too many failed sign-in attempts. */
router.get('/block-requests', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.full_name, u.role, u.login_failed_attempts, u.login_locked_at, u.tenant_id, t.name AS tenant_name
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.login_locked_at IS NOT NULL
       ORDER BY u.login_locked_at DESC`
    );
    res.json({ blocked: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** Super admin: clear sign-in lock and failed-attempt counter. */
router.post('/block-requests/:id/unlock', requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const upd = await query(
      `UPDATE users SET login_failed_attempts = 0, login_locked_at = NULL, updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.id, INSERTED.email
       WHERE id = @id AND login_locked_at IS NOT NULL`,
      { id }
    );
    if (!upd.recordset?.length) return res.status(404).json({ error: 'User not found or not locked' });
    await auditLog({
      userId: req.user.id,
      action: 'user.login_unlock',
      entityType: 'user',
      entityId: id,
      ip: req.ip,
    });
    res.json({ ok: true, user: upd.recordset[0] });
  } catch (err) {
    next(err);
  }
});

/** Bulk-delete login activity rows (GPS + IP audit). Tenant admins: own tenant only. */
router.post('/login-activity/bulk-delete', requireTenantAdmin, async (req, res, next) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    const slice = ids.slice(0, 500);
    const placeholders = slice.map((_, i) => `@id${i}`).join(',');
    const params = {};
    slice.forEach((id, i) => {
      params[`id${i}`] = id;
    });
    if (req.user.role !== 'super_admin') {
      params.tid = req.user.tenant_id;
      await query(`DELETE FROM user_login_activity WHERE id IN (${placeholders}) AND tenant_id = @tid`, params);
    } else {
      await query(`DELETE FROM user_login_activity WHERE id IN (${placeholders})`, params);
    }
    await auditLog({
      tenantId: req.user.tenant_id,
      userId: req.user.id,
      action: 'user.login_activity_bulk_delete',
      entityType: 'user',
      entityId: req.user.id,
      details: { count: slice.length },
      ip: req.ip,
    });
    res.json({ ok: true, deleted: slice.length });
  } catch (err) {
    next(err);
  }
});

/** Sign-in locations + IP for a user (User management → Login activity). */
router.get('/:id/login-activity', async (req, res, next) => {
  try {
    const result = await query(`SELECT u.id, u.tenant_id FROM users u WHERE u.id = @id`, { id: req.params.id });
    const user = result.recordset?.[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const pool = await getPool();
    const tidMap = await getTenantIdsForUsers(pool, [user.id]);
    const targetTenantIds = tidMap[user.id] || (user.tenant_id ? [user.tenant_id] : []);
    const canAccess = canAccessTenant(req, user.tenant_id) || targetTenantIds.includes(req.user.tenant_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const r = await query(
      `SELECT id, ip_address, latitude, longitude, accuracy_meters, user_agent, source, created_at
       FROM user_login_activity
       WHERE user_id = @userId
       ORDER BY created_at DESC
       OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`,
      { userId: req.params.id, off: offset, lim: limit }
    );
    res.json({ rows: r.recordset || [], limit, offset });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('invalid object name') && msg.includes('user_login_activity')) {
      return res.status(503).json({ error: 'Login activity storage is not installed. Run: npm run db:login-location' });
    }
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.tenant_id, u.email, u.full_name, u.role, u.status, u.id_number, u.cellphone, u.avatar_url, u.last_login_at, u.login_count, u.metadata, u.created_at, u.updated_at, t.name AS tenant_name
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = @id`,
      { id: req.params.id }
    );
    const user = result.recordset[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const pool = await getPool();
    const tenantIdsByUser = await getTenantIdsForUsers(pool, [user.id]);
    const tenant_ids = tenantIdsByUser[user.id] || (user.tenant_id ? [user.tenant_id] : []);
    const canAccess = canAccessTenant(req, user.tenant_id) || tenant_ids.includes(req.user.tenant_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });
    const pageRolesByUser = await getPageRolesForUsers(pool, [user.id]);
    const contractorIdsByUser = await getContractorIdsForUsers(pool, [user.id]);
    const subcontractorIdsByUser = await getSubcontractorIdsForUsers(pool, [user.id]);
    const contractor_ids = contractorIdsByUser[user.id] || [];
    const subcontractor_ids = subcontractorIdsByUser[user.id] || [];
    res.json({
      user: {
        ...user,
        page_roles: pageRolesByUser[user.id] || [],
        tenant_ids,
        contractor_ids,
        subcontractor_ids,
        is_subcontractor_user: subcontractor_ids.length > 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Activity for a user (audit log entries) */
router.get('/:id/activity', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.tenant_id FROM users u WHERE u.id = @id`,
      { id: req.params.id }
    );
    const user = result.recordset[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const pool = await getPool();
    const tidMap = await getTenantIdsForUsers(pool, [user.id]);
    const targetTenantIds = tidMap[user.id] || (user.tenant_id ? [user.tenant_id] : []);
    const canAccess = canAccessTenant(req, user.tenant_id) || targetTenantIds.includes(req.user.tenant_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });

    const logResult = await query(
      `SELECT TOP 50 action, entity_type, entity_id, details, created_at FROM audit_log WHERE user_id = @userId ORDER BY created_at DESC`,
      { userId: req.params.id }
    );
    res.json({ activity: logResult.recordset });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireTenantAdmin, async (req, res, next) => {
  try {
    const { email, password, full_name, role, page_roles, tenant_ids: bodyTenantIds, id_number, cellphone, contractor_ids: bodyContractorIds, subcontractor_ids: bodySubcontractorIds } = req.body || {};
    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Email, password, and full_name required' });
    }
    let tenantIds = Array.isArray(bodyTenantIds) ? bodyTenantIds.filter(Boolean) : [];
    if (req.user.role !== 'super_admin') {
      tenantIds = tenantIds.length ? tenantIds.filter((tid) => canAccessTenant(req, tid)) : [req.user.tenant_id];
      if (tenantIds.length === 0) tenantIds = [req.user.tenant_id];
    }
    if (tenantIds.length === 0) return res.status(400).json({ error: 'At least one tenant is required' });
    const primaryTenantId = tenantIds[0];
    if (!canAccessTenant(req, primaryTenantId)) return res.status(403).json({ error: 'Forbidden' });

    const pool = await getPool();
    const safeRole = role === 'tenant_admin' || role === 'user' ? role : 'user';
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const idNumberVal = id_number != null && String(id_number).trim() ? String(id_number).trim() : null;
    const cellphoneVal = cellphone != null && String(cellphone).trim() ? String(cellphone).trim() : null;
    const result = await query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role, status, id_number, cellphone)
       OUTPUT INSERTED.id, INSERTED.tenant_id, INSERTED.email, INSERTED.full_name, INSERTED.role, INSERTED.status, INSERTED.id_number, INSERTED.created_at
       VALUES (@tenantId, @email, @passwordHash, @fullName, @role, 'active', @id_number, @cellphone)`,
      {
        tenantId: primaryTenantId,
        email: email.trim().toLowerCase(),
        passwordHash,
        fullName: full_name.trim(),
        role: req.user.role === 'super_admin' ? (role || 'user') : safeRole,
        id_number: idNumberVal,
        cellphone: cellphoneVal,
      }
    );
    const user = result.recordset[0];
    for (const tid of tenantIds) {
      await query(`INSERT INTO user_tenants (user_id, tenant_id) VALUES (@userId, @tenantId)`, { userId: user.id, tenantId: tid });
    }
    const pageIds = Array.isArray(page_roles) ? page_roles.filter((p) => PAGE_IDS.includes(p)) : [];
    for (const pageId of pageIds) {
      await query(`INSERT INTO user_page_roles (user_id, page_id) VALUES (@userId, @pageId)`, { userId: user.id, pageId });
    }
    const contractorIds = Array.isArray(bodyContractorIds) ? bodyContractorIds.filter(Boolean) : [];
    if (contractorIds.length > 0 && tenantIds.length > 0) {
      const tPlaceholders = tenantIds.map((_, i) => `@tid${i}`).join(',');
      for (const cid of contractorIds) {
        const cParams = { cid };
        tenantIds.forEach((tid, i) => { cParams[`tid${i}`] = tid; });
        const cCheck = await query(`SELECT 1 FROM contractors WHERE id = @cid AND tenant_id IN (${tPlaceholders})`, cParams);
        if (cCheck.recordset?.length) {
          await query(`INSERT INTO user_contractors (user_id, contractor_id) VALUES (@userId, @contractorId)`, { userId: user.id, contractorId: cid });
        }
      }
    }
    try {
      const cMap = await getContractorIdsForUsers(pool, [user.id]);
      await syncUserSubcontractors(user.id, bodySubcontractorIds, cMap[user.id] || []);
    } catch (_) {}
    await auditLog({
      tenantId: user.tenant_id,
      userId: req.user.id,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email },
      ip: req.ip,
    });
    if (isEmailConfigured()) {
      const superAdminEmails = await getSuperAdminEmails(query);
      let tenantName = null;
      if (primaryTenantId) {
        const tn = await query(`SELECT name FROM tenants WHERE id = @id`, { id: primaryTenantId });
        tenantName = tn.recordset?.[0]?.name ?? null;
      }
      const appUrl = process.env.FRONTEND_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
      const html = newUserCreatedHtml({
        createdByName: req.user.full_name || req.user.email || null,
        userEmail: user.email,
        userFullName: user.full_name,
        userRole: user.role,
        tenantName,
        appUrl,
      });
      const subject = `New user created: ${user.email}`;
      for (const to of superAdminEmails) {
        sendEmail({ to, subject, body: html, html: true }).catch((e) => console.error('[users] New user email error:', e?.message));
      }
    }
    const contractorIdsByUser = await getContractorIdsForUsers(pool, [user.id]);
    const subcontractorIdsByUser = await getSubcontractorIdsForUsers(pool, [user.id]);
    const subcontractor_ids = subcontractorIdsByUser[user.id] || [];
    res.status(201).json({
      user: {
        ...user,
        page_roles: pageIds,
        tenant_ids: tenantIds,
        contractor_ids: contractorIdsByUser[user.id] || [],
        subcontractor_ids,
        is_subcontractor_user: subcontractor_ids.length > 0,
      },
    });
  } catch (err) {
    if (err.number === 2627) return res.status(409).json({ error: 'Email already exists in this tenant' });
    next(err);
  }
});

router.patch('/:id', requireTenantAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(`SELECT id, tenant_id, role FROM users WHERE id = @id`, { id });
    const existing = result.recordset[0];
    if (!existing) return res.status(404).json({ error: 'User not found' });
    const pool = await getPool();
    const existingTenantIds = await getTenantIdsForUsers(pool, [existing.id]);
    const existingList = existingTenantIds[existing.id] || (existing.tenant_id ? [existing.tenant_id] : []);
    const canAccess = canAccessTenant(req, existing.tenant_id) || existingList.includes(req.user.tenant_id);
    if (!canAccess) return res.status(403).json({ error: 'Forbidden' });

    const { full_name, email: bodyEmail, role, status, password, page_roles, tenant_ids: bodyTenantIds, id_number, cellphone, contractor_ids: bodyContractorIds, subcontractor_ids: bodySubcontractorIds } = req.body || {};
    const updates = [];
    const params = { id };

    if (full_name !== undefined) { updates.push('full_name = @full_name'); params.full_name = full_name.trim(); }
    if (bodyEmail !== undefined) {
      const emailStr = (bodyEmail && String(bodyEmail).trim()) || '';
      if (!emailStr || !emailStr.includes('@')) return res.status(400).json({ error: 'Valid email is required' });
      const emailLower = emailStr.toLowerCase();
      const dup = await query(
        `SELECT 1 FROM users WHERE tenant_id = (SELECT tenant_id FROM users WHERE id = @id) AND email = @email AND id != @id`,
        { id, email: emailLower }
      );
      if (dup.recordset?.length) return res.status(409).json({ error: 'Email already exists in this tenant' });
      updates.push('email = @email'); params.email = emailLower;
    }
    if (id_number !== undefined) { updates.push('id_number = @id_number'); params.id_number = id_number != null && String(id_number).trim() ? String(id_number).trim() : null; }
    if (cellphone !== undefined) { updates.push('cellphone = @cellphone'); params.cellphone = cellphone != null && String(cellphone).trim() ? String(cellphone).trim() : null; }
    if (status !== undefined) { updates.push('status = @status'); params.status = status; }
    if (role !== undefined) {
      if (req.user.role !== 'super_admin' && (role === 'super_admin' || (existing.role === 'tenant_admin' && role !== 'tenant_admin'))) {
        return res.status(403).json({ error: 'Cannot change this role' });
      }
      updates.push('role = @role'); params.role = role;
    }
    if (password !== undefined && password.length >= 8) {
      updates.push('password_hash = @passwordHash'); params.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      updates.push('login_failed_attempts = 0');
      updates.push('login_locked_at = NULL');
    }
    if (page_roles !== undefined) {
      await query(`DELETE FROM user_page_roles WHERE user_id = @id`, { id });
      const pageIds = Array.isArray(page_roles) ? page_roles.filter((p) => PAGE_IDS.includes(p)) : [];
      for (const pageId of pageIds) {
        await query(`INSERT INTO user_page_roles (user_id, page_id) VALUES (@userId, @pageId)`, { userId: id, pageId });
      }
    }
    if (bodyTenantIds !== undefined) {
      let newTenantIds = Array.isArray(bodyTenantIds) ? bodyTenantIds.filter(Boolean) : [];
      if (req.user.role !== 'super_admin') {
        newTenantIds = newTenantIds.filter((tid) => canAccessTenant(req, tid));
        if (newTenantIds.length === 0) newTenantIds = existingList.slice();
      }
      await query(`DELETE FROM user_tenants WHERE user_id = @id`, { id });
      for (const tid of newTenantIds) {
        await query(`INSERT INTO user_tenants (user_id, tenant_id) VALUES (@userId, @tenantId)`, { userId: id, tenantId: tid });
      }
      if (newTenantIds.length > 0) {
        updates.push('tenant_id = @primaryTenantId');
        params.primaryTenantId = newTenantIds[0];
      }
    }
    let effectiveContractorIds = null;
    if (bodyContractorIds !== undefined) {
      await query(`DELETE FROM user_contractors WHERE user_id = @id`, { id });
      const newContractorIds = Array.isArray(bodyContractorIds) ? bodyContractorIds.filter(Boolean) : [];
      effectiveContractorIds = newContractorIds;
      const userTenantIds = bodyTenantIds !== undefined ? (Array.isArray(bodyTenantIds) ? bodyTenantIds.filter(Boolean) : existingList) : existingList;
      if (newContractorIds.length > 0 && userTenantIds.length > 0) {
        const tPh = userTenantIds.map((_, i) => `@tid${i}`).join(',');
        for (const cid of newContractorIds) {
          const cp = { cid };
          userTenantIds.forEach((tid, i) => { cp[`tid${i}`] = tid; });
          const cCheck = await query(`SELECT 1 FROM contractors WHERE id = @cid AND tenant_id IN (${tPh})`, cp);
          if (cCheck.recordset?.length) {
            await query(`INSERT INTO user_contractors (user_id, contractor_id) VALUES (@userId, @contractorId)`, { userId: id, contractorId: cid });
          }
        }
      }
    }
    if (bodySubcontractorIds !== undefined) {
      let cids = effectiveContractorIds;
      if (cids === null) {
        const cMap = await getContractorIdsForUsers(pool, [id]);
        cids = cMap[id] || [];
      }
      try {
        await syncUserSubcontractors(id, bodySubcontractorIds, cids);
      } catch (_) {}
    }
    if (updates.length === 0 && page_roles === undefined && bodyTenantIds === undefined && bodyContractorIds === undefined && bodySubcontractorIds === undefined) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    if (updates.length > 0) {
      updates.push('updated_at = SYSUTCDATETIME()');
      await query(`UPDATE users SET ${updates.join(', ')} WHERE id = @id`, params);
    }
    const getResult = await query(
      `SELECT id, tenant_id, email, full_name, role, status, id_number, cellphone, last_login_at, created_at FROM users WHERE id = @id`,
      { id }
    );
    const updatedUser = getResult.recordset[0];
    const pageRolesByUser = await getPageRolesForUsers(pool, [id]);
    await auditLog({
      tenantId: existing.tenant_id,
      userId: req.user.id,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      details: { full_name, role, status: status !== undefined, page_roles: page_roles !== undefined },
      ip: req.ip,
    });
    const tenantIdsByUser = await getTenantIdsForUsers(pool, [id]);
    const contractorIdsByUser = await getContractorIdsForUsers(pool, [id]);
    const subcontractorIdsByUser = await getSubcontractorIdsForUsers(pool, [id]);
    const tenant_ids = tenantIdsByUser[id] || (updatedUser.tenant_id ? [updatedUser.tenant_id] : []);
    const subcontractor_ids = subcontractorIdsByUser[id] || [];
    res.json({
      user: {
        ...updatedUser,
        page_roles: pageRolesByUser[id] || [],
        tenant_ids,
        contractor_ids: contractorIdsByUser[id] || [],
        subcontractor_ids,
        is_subcontractor_user: subcontractor_ids.length > 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** Bulk update status or role */
router.post('/bulk', requireTenantAdmin, async (req, res, next) => {
  try {
    const { ids, status, role } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    if (status === undefined && role === undefined) return res.status(400).json({ error: 'status or role required' });

    const updates = [];
    const params = {};
    if (status !== undefined) { updates.push('status = @status'); params.status = status; }
    if (role !== undefined) { updates.push('role = @role'); params.role = role; }
    const placeholders = ids.map((_, i) => `@id${i}`).join(',');
    ids.forEach((id, i) => { params[`id${i}`] = id; });
    const setClause = updates.join(', ') + ', updated_at = SYSUTCDATETIME()';

    if (req.user.role !== 'super_admin') {
      params.tenantId = req.user.tenant_id;
      const r = await query(
        `UPDATE users SET ${setClause} WHERE id IN (${placeholders}) AND tenant_id = @tenantId; SELECT @@ROWCOUNT AS affected`,
        params
      );
      const affected = r.recordset[0]?.affected ?? 0;
      await auditLog({
        tenantId: req.user.tenant_id,
        userId: req.user.id,
        action: 'user.bulk',
        entityType: 'user',
        details: { ids, status, role, affected },
        ip: req.ip,
      });
      return res.json({ updated: affected });
    }
    const r = await query(
      `UPDATE users SET ${setClause} WHERE id IN (${placeholders}); SELECT @@ROWCOUNT AS affected`,
      params
    );
    const affected = r.recordset[0]?.affected ?? 0;
    await auditLog({
      userId: req.user.id,
      action: 'user.bulk',
      entityType: 'user',
      details: { ids, status, role, affected },
      ip: req.ip,
    });
    res.json({ updated: affected });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireTenantAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(`SELECT id, tenant_id FROM users WHERE id = @id`, { id });
    const user = result.recordset[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!canAccessTenant(req, user.tenant_id)) return res.status(403).json({ error: 'Forbidden' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });

    await query(`DELETE FROM users WHERE id = @id`, { id });
    await auditLog({
      tenantId: user.tenant_id,
      userId: req.user.id,
      action: 'user.delete',
      entityType: 'user',
      entityId: id,
      ip: req.ip,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
