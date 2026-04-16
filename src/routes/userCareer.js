/**
 * Personal career portfolio: goals, milestones, CV (own user only).
 */
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess } from '../middleware/auth.js';

const router = Router();
const uploadsBase = path.join(process.cwd(), 'uploads', 'user-career');

function getRow(row, key) {
  if (!row) return undefined;
  const k = Object.keys(row).find((x) => x && String(x).toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

const cvUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tenantId = String(req.user?.tenant_id || 'anon');
      const userId = String(req.user?.id || 'new');
      const dir = path.join(uploadsBase, tenantId, userId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = (file.originalname || 'cv.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
}).single('file');

router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('profile'));

router.get('/plan', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const r = await query(
      `SELECT goals_json, objectives_json, professional_summary, updated_at
       FROM user_personal_career_plan WHERE user_id = @userId AND tenant_id = @tenantId`,
      { userId, tenantId }
    );
    const row = r.recordset?.[0];
    res.json({
      goals_json: row ? getRow(row, 'goals_json') : '[]',
      objectives_json: row ? getRow(row, 'objectives_json') : '[]',
      professional_summary: row ? getRow(row, 'professional_summary') : '',
      updated_at: row ? getRow(row, 'updated_at') : null,
    });
  } catch (err) {
    const m = String(err?.message || '').toLowerCase();
    if (m.includes('invalid object') || m.includes('does not exist')) {
      return res.json({ goals_json: '[]', objectives_json: '[]', professional_summary: '', updated_at: null });
    }
    next(err);
  }
});

router.put('/plan', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const b = req.body || {};
    const g = typeof b.goals_json === 'string' ? b.goals_json : JSON.stringify(b.goals_json ?? []);
    const o = typeof b.objectives_json === 'string' ? b.objectives_json : JSON.stringify(b.objectives_json ?? []);
    const summary = b.professional_summary != null ? String(b.professional_summary) : null;
    const ex = await query(`SELECT 1 AS x FROM user_personal_career_plan WHERE user_id = @userId AND tenant_id = @tenantId`, {
      userId,
      tenantId,
    });
    if (ex.recordset?.length) {
      await query(
        `UPDATE user_personal_career_plan
         SET goals_json = @goals, objectives_json = @objectives, professional_summary = @summary, updated_at = SYSUTCDATETIME()
         WHERE user_id = @userId AND tenant_id = @tenantId`,
        { userId, tenantId, goals: g, objectives: o, summary }
      );
    } else {
      await query(
        `INSERT INTO user_personal_career_plan (user_id, tenant_id, goals_json, objectives_json, professional_summary)
         VALUES (@userId, @tenantId, @goals, @objectives, @summary)`,
        { userId, tenantId, goals: g, objectives: o, summary }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/milestones', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const r = await query(
      `SELECT id, title, description, milestone_date, status, display_order, created_at, updated_at
       FROM user_career_milestones WHERE user_id = @userId AND tenant_id = @tenantId
       ORDER BY display_order ASC, milestone_date DESC, created_at DESC`,
      { userId, tenantId }
    );
    res.json({ milestones: r.recordset || [] });
  } catch (err) {
    const m = String(err?.message || '').toLowerCase();
    if (m.includes('invalid object') || m.includes('does not exist')) return res.json({ milestones: [] });
    next(err);
  }
});

router.post('/milestones', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const b = req.body || {};
    const title = (b.title && String(b.title).trim()) || '';
    if (!title) return res.status(400).json({ error: 'title required' });
    const ins = await query(
      `INSERT INTO user_career_milestones (user_id, tenant_id, title, description, milestone_date, status, display_order)
       OUTPUT INSERTED.*
       VALUES (@userId, @tenantId, @title, @description, @milestoneDate, @status, @displayOrder)`,
      {
        userId,
        tenantId,
        title,
        description: b.description != null ? String(b.description) : null,
        milestoneDate: b.milestone_date || null,
        status: ['planned', 'in_progress', 'done', 'deferred'].includes(String(b.status || '').toLowerCase())
          ? String(b.status).toLowerCase()
          : 'planned',
        displayOrder: Number.isFinite(Number(b.display_order)) ? Number(b.display_order) : 0,
      }
    );
    res.status(201).json({ milestone: ins.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/milestones/:id', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { id } = req.params;
    const chk = await query(
      `SELECT id FROM user_career_milestones WHERE id = @id AND user_id = @userId AND tenant_id = @tenantId`,
      { id, userId, tenantId }
    );
    if (!chk.recordset?.length) return res.status(404).json({ error: 'Not found' });
    const b = req.body || {};
    const sets = [];
    const params = { id, userId, tenantId };
    if (b.title != null) {
      sets.push('title = @title');
      params.title = String(b.title);
    }
    if (b.description !== undefined) {
      sets.push('description = @description');
      params.description = b.description == null ? null : String(b.description);
    }
    if (b.milestone_date !== undefined) {
      sets.push('milestone_date = @milestoneDate');
      params.milestoneDate = b.milestone_date || null;
    }
    if (b.status != null) {
      sets.push('status = @status');
      params.status = String(b.status).toLowerCase();
    }
    if (b.display_order != null) {
      sets.push('display_order = @displayOrder');
      params.displayOrder = Number(b.display_order);
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields' });
    sets.push('updated_at = SYSUTCDATETIME()');
    await query(
      `UPDATE user_career_milestones SET ${sets.join(', ')} WHERE id = @id AND user_id = @userId AND tenant_id = @tenantId`,
      params
    );
    const out = await query(`SELECT * FROM user_career_milestones WHERE id = @id`, { id });
    res.json({ milestone: out.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/milestones/:id', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { id } = req.params;
    await query(`DELETE FROM user_career_milestones WHERE id = @id AND user_id = @userId AND tenant_id = @tenantId`, {
      id,
      userId,
      tenantId,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/cv', async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const r = await query(
      `SELECT TOP 12 id, file_name, content_type, uploaded_at FROM user_cv_uploads
       WHERE user_id = @userId AND tenant_id = @tenantId ORDER BY uploaded_at DESC`,
      { userId, tenantId }
    );
    res.json({ uploads: r.recordset || [] });
  } catch (err) {
    const m = String(err?.message || '').toLowerCase();
    if (m.includes('invalid object') || m.includes('does not exist')) return res.json({ uploads: [] });
    next(err);
  }
});

router.post('/cv', cvUpload, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    if (!tenantId) return res.status(400).json({ error: 'No tenant context' });
    const rel = path.relative(path.join(process.cwd(), 'uploads'), req.file.path).replace(/\\/g, '/');
    const ins = await query(
      `INSERT INTO user_cv_uploads (user_id, tenant_id, file_name, file_path, content_type)
       OUTPUT INSERTED.id, INSERTED.file_name, INSERTED.uploaded_at
       VALUES (@userId, @tenantId, @fileName, @filePath, @contentType)`,
      {
        userId,
        tenantId,
        fileName: req.file.originalname || req.file.filename,
        filePath: rel,
        contentType: req.file.mimetype || null,
      }
    );
    const row = ins.recordset?.[0];
    res.status(201).json({
      upload: { id: getRow(row, 'id'), file_name: getRow(row, 'file_name'), uploaded_at: getRow(row, 'uploaded_at') },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/cv/:id/download', async (req, res, next) => {
  try {
    const { id } = req.params;
    const r = await query(
      `SELECT file_path, file_name, user_id, tenant_id FROM user_cv_uploads WHERE id = @id`,
      { id }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (String(getRow(row, 'user_id')) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    if (String(getRow(row, 'tenant_id')) !== String(req.user.tenant_id)) return res.status(403).json({ error: 'Forbidden' });
    const fullPath = path.join(process.cwd(), 'uploads', getRow(row, 'file_path'));
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });
    res.download(fullPath, getRow(row, 'file_name') || 'cv');
  } catch (err) {
    next(err);
  }
});

router.delete('/cv/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const r = await query(
      `SELECT id, file_path FROM user_cv_uploads WHERE id = @id AND user_id = @userId AND tenant_id = @tenantId`,
      { id, userId, tenantId }
    );
    const row = r.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const fp = path.join(process.cwd(), 'uploads', getRow(row, 'file_path'));
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (_) {}
    await query(`DELETE FROM user_cv_uploads WHERE id = @id`, { id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
