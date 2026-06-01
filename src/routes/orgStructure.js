/**
 * Organisational structure — departments, positions, reporting lines, escalations.
 */
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, loadUser);

const uploadsDir = path.join(process.cwd(), 'uploads', 'org-structure');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsDir),
    filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

function tid(req) {
  return req.user?.tenant_id || null;
}

function mapDepartment(r) {
  return {
    id: getRow(r, 'id'),
    tenant_id: getRow(r, 'tenant_id'),
    parent_department_id: getRow(r, 'parent_department_id'),
    name: getRow(r, 'name'),
    code: getRow(r, 'code'),
    description: getRow(r, 'description'),
    sort_order: getRow(r, 'sort_order') ?? 0,
  };
}

function mapPosition(r) {
  return {
    id: getRow(r, 'id'),
    tenant_id: getRow(r, 'tenant_id'),
    department_id: getRow(r, 'department_id'),
    title: getRow(r, 'title'),
    description: getRow(r, 'description'),
    responsibilities: getRow(r, 'responsibilities'),
    grade_level: getRow(r, 'grade_level'),
    sort_order: getRow(r, 'sort_order') ?? 0,
    is_active: getRow(r, 'is_active') !== false && getRow(r, 'is_active') !== 0,
    department_name: getRow(r, 'department_name'),
  };
}

function mapAssignment(r) {
  const uid = getRow(r, 'user_id');
  return {
    id: getRow(r, 'id'),
    tenant_id: getRow(r, 'tenant_id'),
    user_id: uid,
    position_id: getRow(r, 'position_id'),
    manager_user_id: getRow(r, 'manager_user_id'),
    escalation_user_id: getRow(r, 'escalation_user_id'),
    effective_from: getRow(r, 'effective_from'),
    effective_to: getRow(r, 'effective_to'),
    is_primary: getRow(r, 'is_primary') !== false && getRow(r, 'is_primary') !== 0,
    notes: getRow(r, 'notes'),
    sort_order: getRow(r, 'sort_order') ?? 0,
    is_active: true,
    display_name: getRow(r, 'full_name') || getRow(r, 'email') || (uid ? 'Employee' : 'Vacant'),
    email: getRow(r, 'email'),
    position_title: getRow(r, 'position_title'),
    position_description: getRow(r, 'position_description'),
    position_responsibilities: getRow(r, 'position_responsibilities'),
    grade_level: getRow(r, 'grade_level'),
    department_name: getRow(r, 'department_name'),
    manager_name: getRow(r, 'manager_name'),
    escalation_name: getRow(r, 'escalation_name'),
  };
}

async function loadBundle(tenantId) {
  const [deptR, posR, asgR, usersR] = await Promise.all([
    query(
      `SELECT * FROM org_departments WHERE tenant_id = @t ORDER BY sort_order, name`,
      { t: tenantId }
    ),
    query(
      `SELECT p.*, d.name AS department_name
       FROM org_positions p
       LEFT JOIN org_departments d ON d.id = p.department_id
       WHERE p.tenant_id = @t AND p.is_active = 1
       ORDER BY p.sort_order, p.title`,
      { t: tenantId }
    ),
    query(
      `SELECT a.*, u.full_name, u.email,
              p.title AS position_title, p.description AS position_description,
              p.responsibilities AS position_responsibilities, p.grade_level,
              d.name AS department_name,
              m.full_name AS manager_name, e.full_name AS escalation_name
       FROM org_assignments a
       INNER JOIN org_positions p ON p.id = a.position_id
       LEFT JOIN org_departments d ON d.id = p.department_id
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN users m ON m.id = a.manager_user_id
       LEFT JOIN users e ON e.id = a.escalation_user_id
       WHERE a.tenant_id = @t
         AND (a.effective_to IS NULL OR a.effective_to >= CAST(SYSUTCDATETIME() AS DATE))
       ORDER BY a.sort_order, u.full_name`,
      { t: tenantId }
    ),
    query(
      `SELECT u.id, u.full_name, u.email, u.status
       FROM users u
       WHERE u.tenant_id = @t AND u.email IS NOT NULL
       ORDER BY u.full_name`,
      { t: tenantId }
    ),
  ]);

  const assignedUserIds = new Set(
    (asgR.recordset || []).filter((r) => getRow(r, 'user_id')).map((r) => String(getRow(r, 'user_id')))
  );

  return {
    departments: (deptR.recordset || []).map(mapDepartment),
    positions: (posR.recordset || []).map(mapPosition),
    assignments: (asgR.recordset || []).map(mapAssignment),
    tenant_users: (usersR.recordset || []).map((u) => ({
      id: getRow(u, 'id'),
      full_name: getRow(u, 'full_name'),
      email: getRow(u, 'email'),
      status: getRow(u, 'status'),
      on_structure: assignedUserIds.has(String(getRow(u, 'id'))),
    })),
  };
}

function tablesMissing(err) {
  const m = String(err?.message || '').toLowerCase();
  return m.includes('org_departments') || m.includes('org_positions') || m.includes('invalid object');
}

/** Profile + management read */
router.get(
  '/bundle',
  requirePageAccess(['profile', 'management']),
  async (req, res, next) => {
    try {
      const t = tid(req);
      if (!t) return res.status(400).json({ error: 'No tenant context' });
      const bundle = await loadBundle(t);
      res.json(bundle);
    } catch (err) {
      if (tablesMissing(err)) {
        return res.status(503).json({ error: 'Run npm run db:org-structure on the server' });
      }
      next(err);
    }
  }
);

router.get(
  '/person/:userId',
  requirePageAccess(['profile', 'management']),
  async (req, res, next) => {
    try {
      const t = tid(req);
      const bundle = await loadBundle(t);
      const person = bundle.assignments.find((a) => String(a.user_id) === String(req.params.userId));
      if (!person) return res.status(404).json({ error: 'Person not on organisational structure' });
      const attachments = await query(
        `SELECT * FROM org_position_attachments WHERE position_id = @pid ORDER BY created_at DESC`,
        { pid: person.position_id }
      );
      res.json({ person, attachments: attachments.recordset || [], bundle });
    } catch (err) {
      if (tablesMissing(err)) return res.status(503).json({ error: 'Schema not installed' });
      next(err);
    }
  }
);

router.get(
  '/positions/:id/attachments/:attId/download',
  requirePageAccess(['profile', 'management']),
  async (req, res, next) => {
    try {
      const t = tid(req);
      const r = await query(
        `SELECT a.* FROM org_position_attachments a
         INNER JOIN org_positions p ON p.id = a.position_id
         WHERE a.id = @id AND p.tenant_id = @t`,
        { id: req.params.attId, t }
      );
      const row = r.recordset?.[0];
      if (!row) return res.status(404).json({ error: 'Not found' });
      const fp = getRow(row, 'file_path');
      if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'File missing' });
      res.download(fp, getRow(row, 'file_name'));
    } catch (err) {
      next(err);
    }
  }
);

// ─── Management write ─────────────────────────────────────────────

router.post('/departments', requirePageAccess('management'), async (req, res, next) => {
  try {
    const t = tid(req);
    const b = req.body || {};
    if (!b.name?.trim()) return res.status(400).json({ error: 'Department name required' });
    const r = await query(
      `INSERT INTO org_departments (tenant_id, parent_department_id, name, code, description, sort_order)
       OUTPUT INSERTED.*
       VALUES (@t, @parent, @name, @code, @desc, @sort)`,
      {
        t,
        parent: b.parent_department_id || null,
        name: b.name.trim(),
        code: b.code || null,
        desc: b.description || null,
        sort: Number(b.sort_order) || 0,
      }
    );
    res.status(201).json({ department: mapDepartment(r.recordset[0]) });
  } catch (err) {
    next(err);
  }
});

router.patch('/departments/:id', requirePageAccess('management'), async (req, res, next) => {
  try {
    const t = tid(req);
    const b = req.body || {};
    await query(
      `UPDATE org_departments SET
        parent_department_id = @parent, name = COALESCE(@name, name), code = @code,
        description = @desc, sort_order = COALESCE(@sort, sort_order), updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @t`,
      {
        id: req.params.id,
        t,
        parent: b.parent_department_id !== undefined ? b.parent_department_id || null : undefined,
        name: b.name?.trim(),
        code: b.code !== undefined ? b.code : undefined,
        desc: b.description !== undefined ? b.description : undefined,
        sort: b.sort_order !== undefined ? Number(b.sort_order) : undefined,
      }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/departments/:id', requirePageAccess('management'), async (req, res, next) => {
  try {
    const t = tid(req);
    const id = req.params.id;
    const exists = await query(`SELECT id FROM org_departments WHERE id = @id AND tenant_id = @t`, { id, t });
    if (!exists.recordset?.length) return res.status(404).json({ error: 'Department not found' });

    // FK_org_positions_department is NO ACTION — unlink positions before delete.
    const posUnlink = await query(
      `UPDATE org_positions SET department_id = NULL, updated_at = SYSUTCDATETIME()
       WHERE department_id = @id AND tenant_id = @t`,
      { id, t }
    );
    const childUnlink = await query(
      `UPDATE org_departments SET parent_department_id = NULL, updated_at = SYSUTCDATETIME()
       WHERE parent_department_id = @id AND tenant_id = @t`,
      { id, t }
    );

    await query(`DELETE FROM org_departments WHERE id = @id AND tenant_id = @t`, { id, t });
    res.json({
      ok: true,
      positions_unlinked: posUnlink.rowsAffected?.[0] ?? 0,
      child_departments_unlinked: childUnlink.rowsAffected?.[0] ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/positions', requirePageAccess('management'), async (req, res, next) => {
  try {
    const t = tid(req);
    const b = req.body || {};
    if (!b.title?.trim()) return res.status(400).json({ error: 'Position title required' });
    const r = await query(
      `INSERT INTO org_positions (tenant_id, department_id, title, description, responsibilities, grade_level, sort_order)
       OUTPUT INSERTED.*
       VALUES (@t, @dept, @title, @desc, @resp, @grade, @sort)`,
      {
        t,
        dept: b.department_id || null,
        title: b.title.trim(),
        desc: b.description || null,
        resp: b.responsibilities || null,
        grade: b.grade_level || null,
        sort: Number(b.sort_order) || 0,
      }
    );
    res.status(201).json({ position: mapPosition(r.recordset[0]) });
  } catch (err) {
    next(err);
  }
});

router.patch('/positions/:id', requirePageAccess('management'), async (req, res, next) => {
  try {
    const t = tid(req);
    const b = req.body || {};
    await query(
      `UPDATE org_positions SET
        department_id = @dept, title = COALESCE(@title, title), description = @desc,
        responsibilities = @resp, grade_level = @grade, sort_order = COALESCE(@sort, sort_order),
        is_active = COALESCE(@active, is_active), updated_at = SYSUTCDATETIME()
       WHERE id = @id AND tenant_id = @t`,
      {
        id: req.params.id,
        t,
        dept: b.department_id !== undefined ? b.department_id || null : undefined,
        title: b.title?.trim(),
        desc: b.description !== undefined ? b.description : undefined,
        resp: b.responsibilities !== undefined ? b.responsibilities : undefined,
        grade: b.grade_level !== undefined ? b.grade_level : undefined,
        sort: b.sort_order !== undefined ? Number(b.sort_order) : undefined,
        active: b.is_active !== undefined ? (b.is_active ? 1 : 0) : undefined,
      }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/positions/:id', requirePageAccess('management'), async (req, res, next) => {
  try {
    const t = tid(req);
    const asg = await query(
      `SELECT COUNT(*) AS c FROM org_assignments WHERE position_id = @id AND tenant_id = @t`,
      { id: req.params.id, t }
    );
    const count = asg.recordset?.[0]?.c ?? asg.recordset?.[0]?.C ?? 0;
    if (Number(count) > 0) {
      return res.status(400).json({ error: 'Remove all people assigned to this position first' });
    }
    await query(`DELETE FROM org_position_attachments WHERE position_id = @id AND tenant_id = @t`, {
      id: req.params.id,
      t,
    });
    const r = await query(`DELETE FROM org_positions WHERE id = @id AND tenant_id = @t`, { id: req.params.id, t });
    if ((r.rowsAffected?.[0] ?? 0) === 0) return res.status(404).json({ error: 'Position not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/positions/:positionId/attachments/:attId', requirePageAccess('management'), async (req, res, next) => {
  try {
    const t = tid(req);
    const r = await query(
      `SELECT a.* FROM org_position_attachments a
       INNER JOIN org_positions p ON p.id = a.position_id
       WHERE a.id = @attId AND a.position_id = @pid AND p.tenant_id = @t`,
      { attId: req.params.attId, pid: req.params.positionId, t }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Attachment not found' });
    const fp = getRow(row, 'file_path');
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    await query(`DELETE FROM org_position_attachments WHERE id = @attId`, { attId: req.params.attId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/positions/:id/attachments', requirePageAccess('management'), upload.array('files', 8), async (req, res, next) => {
  try {
    const t = tid(req);
    const pos = await query(`SELECT id FROM org_positions WHERE id = @id AND tenant_id = @t`, {
      id: req.params.id,
      t,
    });
    if (!pos.recordset?.length) return res.status(404).json({ error: 'Position not found' });
    const out = [];
    for (const f of req.files || []) {
      const ins = await query(
        `INSERT INTO org_position_attachments (tenant_id, position_id, file_name, file_path, mime_type, uploaded_by)
         OUTPUT INSERTED.*
         VALUES (@t, @pid, @fn, @fp, @mime, @by)`,
        {
          t,
          pid: req.params.id,
          fn: f.originalname,
          fp: f.path,
          mime: f.mimetype,
          by: req.user.id,
        }
      );
      out.push(ins.recordset[0]);
    }
    res.status(201).json({ attachments: out });
  } catch (err) {
    next(err);
  }
});

router.post('/assignments', requirePageAccess('management'), async (req, res, next) => {
  try {
    const t = tid(req);
    const b = req.body || {};
    if (!b.position_id) return res.status(400).json({ error: 'position_id required' });
    const r = await query(
      `INSERT INTO org_assignments (tenant_id, user_id, position_id, manager_user_id, escalation_user_id, effective_from, effective_to, is_primary, notes)
       OUTPUT INSERTED.*
       VALUES (@t, @user, @pos, @mgr, @esc, @from, @to, @primary, @notes)`,
      {
        t,
        user: b.user_id || null,
        pos: b.position_id,
        mgr: b.manager_user_id || null,
        esc: b.escalation_user_id || null,
        from: b.effective_from || null,
        to: b.effective_to || null,
        primary: b.is_primary !== false ? 1 : 0,
        notes: b.notes || null,
      }
    );
    res.status(201).json({ assignment: mapAssignment(r.recordset[0]) });
  } catch (err) {
    next(err);
  }
});

router.patch('/assignments/:id', requirePageAccess('management'), async (req, res, next) => {
  try {
    const t = tid(req);
    const b = req.body || {};
    const sets = ['updated_at = SYSUTCDATETIME()'];
    const params = { id: req.params.id, t };
    if (b.user_id !== undefined) {
      sets.push('user_id = @user');
      params.user = b.user_id || null;
    }
    if (b.position_id !== undefined) {
      sets.push('position_id = @pos');
      params.pos = b.position_id;
    }
    if (b.manager_user_id !== undefined) {
      sets.push('manager_user_id = @mgr');
      params.mgr = b.manager_user_id || null;
    }
    if (b.escalation_user_id !== undefined) {
      sets.push('escalation_user_id = @esc');
      params.esc = b.escalation_user_id || null;
    }
    if (b.effective_from !== undefined) {
      sets.push('effective_from = @from');
      params.from = b.effective_from || null;
    }
    if (b.effective_to !== undefined) {
      sets.push('effective_to = @to');
      params.to = b.effective_to || null;
    }
    if (b.is_primary !== undefined) {
      sets.push('is_primary = @primary');
      params.primary = b.is_primary ? 1 : 0;
    }
    if (b.notes !== undefined) {
      sets.push('notes = @notes');
      params.notes = b.notes;
    }
    if (sets.length === 1) return res.json({ ok: true });
    await query(`UPDATE org_assignments SET ${sets.join(', ')} WHERE id = @id AND tenant_id = @t`, params);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/assignments/:id', requirePageAccess('management'), async (req, res, next) => {
  try {
    const t = tid(req);
    await query(`DELETE FROM org_assignments WHERE id = @id AND tenant_id = @t`, { id: req.params.id, t });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
