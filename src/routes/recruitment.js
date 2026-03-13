import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { query } from '../db.js';
import { requireAuth, loadUser, requirePageAccess, requireSuperAdmin } from '../middleware/auth.js';
import { sendEmail, isEmailConfigured } from '../lib/emailService.js';
import {
  recruitmentPanelInviteHtml,
  recruitmentPanelInterviewReminderHtml,
  recruitmentInterviewInviteHtml,
  recruitmentScreeningRegretHtml,
  recruitmentCongratulationsHtml,
  recruitmentAppointmentRegretHtml,
} from '../lib/emailTemplates.js';

const router = Router();

/** Parse string to Date for SQL datetime columns (avoids "Conversion failed" from datetime-local/ISO strings). */
function parseDateTimeForSql(val) {
  if (val == null || (typeof val === 'string' && val.trim() === '')) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  const s = String(val).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Return YYYY-MM-DD for date filter params so SQL Server parses reliably. */
function dateStringForFilter(val) {
  if (val == null || (typeof val === 'string' && val.trim() === '')) return null;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Recruitment tab IDs (must match client TABS) */
export const RECRUITMENT_TAB_IDS = [
  'dashboard', 'recruit-registration', 'cv-library', 'screening', 'interview', 'panel', 'results', 'appointments', 'panel-members', 'access',
];
const uploadsDir = path.join(process.cwd(), 'uploads', 'recruitment', 'cvs');
const cvUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.pdf').replace(/[^a-zA-Z0-9.]/g, '');
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
}).single('file');

function getRow(row, ...keys) {
  if (!row) return undefined;
  for (const k of keys) if (row[k] !== undefined && row[k] !== null) return row[k];
  const lower = (keys[0] || '').toString().toLowerCase();
  const entry = Object.entries(row).find(([key]) => key && String(key).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

router.use(requireAuth);
router.use(loadUser);
router.use(requirePageAccess('recruitment'));

// --- My allowed tabs (for filtering visible tabs; super_admin = all, else from recruitment_tab_grants; empty = all) ---
router.get('/my-tabs', async (req, res, next) => {
  try {
    if (req.user?.role === 'super_admin') return res.json({ tabs: RECRUITMENT_TAB_IDS });
    const result = await query(`SELECT tab_id FROM recruitment_tab_grants WHERE user_id = @userId`, { userId: req.user.id });
    const tabs = (result.recordset || []).map((r) => getRow(r, 'tab_id')).filter((id) => RECRUITMENT_TAB_IDS.includes(id));
    res.json({ tabs: tabs.length > 0 ? tabs : RECRUITMENT_TAB_IDS });
  } catch (err) {
    next(err);
  }
});

// --- Tab permissions (super_admin only) ---
router.get('/tab-permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT g.user_id, g.tab_id, g.granted_at, u.full_name, u.email FROM recruitment_tab_grants g JOIN users u ON u.id = g.user_id ORDER BY u.full_name, g.tab_id`
    );
    const byUser = {};
    for (const row of result.recordset || []) {
      const uid = getRow(row, 'user_id');
      if (!byUser[uid]) byUser[uid] = { user_id: uid, full_name: getRow(row, 'full_name'), email: getRow(row, 'email'), tabs: [] };
      byUser[uid].tabs.push(getRow(row, 'tab_id'));
    }
    res.json({ permissions: Object.values(byUser), allTabIds: RECRUITMENT_TAB_IDS });
  } catch (err) {
    next(err);
  }
});
router.post('/tab-permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const { user_id, tab_id } = req.body || {};
    if (!user_id || !tab_id || !RECRUITMENT_TAB_IDS.includes(tab_id)) return res.status(400).json({ error: 'user_id and tab_id (valid) required' });
    await query(
      `IF NOT EXISTS (SELECT 1 FROM recruitment_tab_grants WHERE user_id = @userId AND tab_id = @tabId) INSERT INTO recruitment_tab_grants (user_id, tab_id, granted_by_user_id) VALUES (@userId, @tabId, @grantedBy)`,
      { userId: user_id, tabId: tab_id, grantedBy: req.user?.id || null }
    );
    res.status(201).json({ granted: true });
  } catch (err) {
    next(err);
  }
});
router.delete('/tab-permissions', requireSuperAdmin, async (req, res, next) => {
  try {
    const { user_id, tab_id } = req.query || {};
    if (!user_id || !tab_id) return res.status(400).json({ error: 'user_id and tab_id required' });
    const result = await query(`DELETE FROM recruitment_tab_grants WHERE user_id = @userId AND tab_id = @tabId`, { userId: user_id, tabId: tab_id });
    res.json({ revoked: (result.rowsAffected?.[0] ?? 0) > 0 });
  } catch (err) {
    next(err);
  }
});

// --- Panel members (super_admin only); when added, send invite email ---
router.get('/panel-members', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT m.id, m.user_id, m.invited_at, m.email_sent_at, u.full_name, u.email FROM recruitment_panel_members m JOIN users u ON u.id = m.user_id ORDER BY m.invited_at DESC`
    );
    res.json({ members: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});
router.post('/panel-members', requireSuperAdmin, async (req, res, next) => {
  try {
    const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    const id = randomUUID();
    await query(
      `IF NOT EXISTS (SELECT 1 FROM recruitment_panel_members WHERE user_id = @userId) INSERT INTO recruitment_panel_members (id, user_id, invited_by_user_id) VALUES (@id, @userId, @invitedBy)`,
      { id, userId: user_id, invitedBy: req.user?.id || null }
    );
    const row = await query(`SELECT m.id, m.user_id, m.invited_at, m.email_sent_at, u.full_name, u.email FROM recruitment_panel_members m JOIN users u ON u.id = m.user_id WHERE m.user_id = @userId`, { userId: user_id });
    const member = row.recordset?.[0];
    if (member && isEmailConfigured()) {
      const email = (member.email || '').trim();
      if (email) {
        const body = recruitmentPanelInviteHtml(member.full_name);
        await sendEmail({
          to: email,
          subject: 'You have been added to the Recruitment Panel',
          body,
          html: true,
        });
        await query(`UPDATE recruitment_panel_members SET email_sent_at = SYSUTCDATETIME() WHERE user_id = @userId`, { userId: user_id });
      }
    }
    res.status(201).json({ member: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});
router.delete('/panel-members/:userId', requireSuperAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    await query(`DELETE FROM recruitment_panel_members WHERE user_id = @userId`, { userId });
    res.json({ deleted: userId });
  } catch (err) {
    next(err);
  }
});

/** GET /panel-members/options — list panel members as { users: [{ id, full_name, email }] } for Interview tab (asker assignment). Auth only. */
router.get('/panel-members/options', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.full_name, u.email FROM recruitment_panel_members m JOIN users u ON u.id = m.user_id ORDER BY u.full_name, u.email`
    );
    const users = (result.recordset || []).map((r) => ({ id: r.id, full_name: r.full_name, email: r.email }));
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// --- Vacancies ---
router.get('/vacancies', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, title, role_title, description, requirements, status, created_at, updated_at FROM recruitment_vacancies ORDER BY updated_at DESC`
    );
    res.json({ vacancies: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/vacancies', async (req, res, next) => {
  try {
    const { title, role_title, description, requirements, status } = req.body || {};
    const id = randomUUID();
    await query(
      `INSERT INTO recruitment_vacancies (id, title, role_title, description, requirements, status, created_by_user_id)
       VALUES (@id, @title, @role_title, @description, @requirements, @status, @userId)`,
      {
        id,
        title: (title || '').toString().trim() || 'New vacancy',
        role_title: (role_title || '').toString().trim() || null,
        description: (description || '').toString().trim() || null,
        requirements: (requirements || '').toString().trim() || null,
        status: (status || 'draft').toString().trim(),
        userId: req.user?.id || null,
      }
    );
    const row = await query(`SELECT id, title, role_title, description, requirements, status, created_at, updated_at FROM recruitment_vacancies WHERE id = @id`, { id });
    res.status(201).json({ vacancy: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/vacancies/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT id, title, role_title, description, requirements, status, created_at, updated_at FROM recruitment_vacancies WHERE id = @id`,
      { id }
    );
    const vacancy = result.recordset?.[0];
    if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });
    res.json({ vacancy });
  } catch (err) {
    next(err);
  }
});

router.patch('/vacancies/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, role_title, description, requirements, status } = req.body || {};
    const updates = [];
    const params = { id };
    if (title !== undefined) { updates.push('title = @title'); params.title = (title || '').toString().trim() || 'Vacancy'; }
    if (role_title !== undefined) { updates.push('role_title = @role_title'); params.role_title = (role_title || '').toString().trim() || null; }
    if (description !== undefined) { updates.push('description = @description'); params.description = (description || '').toString().trim() || null; }
    if (requirements !== undefined) { updates.push('requirements = @requirements'); params.requirements = (requirements || '').toString().trim() || null; }
    if (status !== undefined) { updates.push('status = @status'); params.status = (status || 'draft').toString().trim(); }
    if (updates.length === 0) {
      const r = await query(`SELECT id, title, role_title, description, requirements, status, created_at, updated_at FROM recruitment_vacancies WHERE id = @id`, { id });
      return res.json({ vacancy: r.recordset?.[0] });
    }
    updates.push('updated_at = SYSUTCDATETIME()');
    await query(`UPDATE recruitment_vacancies SET ${updates.join(', ')} WHERE id = @id`, params);
    const row = await query(`SELECT id, title, role_title, description, requirements, status, created_at, updated_at FROM recruitment_vacancies WHERE id = @id`, { id });
    res.json({ vacancy: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/vacancies/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(`DELETE FROM recruitment_vacancies WHERE id = @id`, { id });
    if (result.rowsAffected?.[0] === 0) return res.status(404).json({ error: 'Vacancy not found' });
    res.json({ deleted: id });
  } catch (err) {
    next(err);
  }
});

// --- CV Folders ---
router.get('/folders', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, parent_id, created_at FROM recruitment_cv_folders ORDER BY name`
    );
    res.json({ folders: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/folders', async (req, res, next) => {
  try {
    const { name, parent_id } = req.body || {};
    const id = randomUUID();
    await query(
      `INSERT INTO recruitment_cv_folders (id, name, parent_id) VALUES (@id, @name, @parent_id)`,
      { id, name: (name || '').toString().trim() || 'New folder', parent_id: parent_id || null }
    );
    const row = await query(`SELECT id, name, parent_id, created_at FROM recruitment_cv_folders WHERE id = @id`, { id });
    res.status(201).json({ folder: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/folders/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, parent_id } = req.body || {};
    const params = { id };
    const updates = [];
    if (name !== undefined) { updates.push('name = @name'); params.name = (name || '').toString().trim(); }
    if (parent_id !== undefined) { updates.push('parent_id = @parent_id'); params.parent_id = parent_id || null; }
    if (updates.length === 0) {
      const r = await query(`SELECT id, name, parent_id, created_at FROM recruitment_cv_folders WHERE id = @id`, { id });
      return res.json({ folder: r.recordset?.[0] });
    }
    await query(`UPDATE recruitment_cv_folders SET ${updates.join(', ')} WHERE id = @id`, params);
    const row = await query(`SELECT id, name, parent_id, created_at FROM recruitment_cv_folders WHERE id = @id`, { id });
    res.json({ folder: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/folders/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    await query(`UPDATE recruitment_cvs SET folder_id = NULL WHERE folder_id = @id`, { id });
    await query(`DELETE FROM recruitment_cv_folders WHERE id = @id`, { id });
    res.json({ deleted: id });
  } catch (err) {
    next(err);
  }
});

// --- CVs ---
// linked_to_interview: CV has at least one applicant with interview_date or interview_invite_sent_at set
router.get('/cvs', async (req, res, next) => {
  try {
    const { folder_id, linked_to_interview } = req.query || {};
    const linkedFilter = linked_to_interview === 'true' || linked_to_interview === true
      ? 'yes'
      : linked_to_interview === 'false' || linked_to_interview === false
        ? 'no'
        : null;
    let sql = `
      SELECT c.id, c.folder_id, c.file_name, c.file_path, c.applicant_name, c.applicant_email, c.uploaded_at,
        CAST(CASE WHEN EXISTS (
          SELECT 1 FROM recruitment_applicants a
          WHERE a.cv_id = c.id AND (a.interview_date IS NOT NULL OR a.interview_invite_sent_at IS NOT NULL)
        ) THEN 1 ELSE 0 END AS BIT) AS linked_to_interview
      FROM recruitment_cvs c
      WHERE 1=1`;
    const params = {};
    if (folder_id !== undefined && folder_id !== '') {
      sql += ` AND c.folder_id = @folder_id`;
      params.folder_id = folder_id;
    }
    if (linkedFilter === 'yes') {
      sql += ` AND EXISTS (
        SELECT 1 FROM recruitment_applicants a
        WHERE a.cv_id = c.id AND (a.interview_date IS NOT NULL OR a.interview_invite_sent_at IS NOT NULL)
      )`;
    } else if (linkedFilter === 'no') {
      sql += ` AND NOT EXISTS (
        SELECT 1 FROM recruitment_applicants a
        WHERE a.cv_id = c.id AND (a.interview_date IS NOT NULL OR a.interview_invite_sent_at IS NOT NULL)
      )`;
    }
    sql += ` ORDER BY c.uploaded_at DESC`;
    const result = await query(sql, params);
    res.json({ cvs: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/cvs', cvUpload, async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File is required' });
    const { folder_id, applicant_name, applicant_email } = req.body || {};
    const id = randomUUID();
    const relativePath = path.relative(path.join(process.cwd(), 'uploads'), file.path);
    await query(
      `INSERT INTO recruitment_cvs (id, folder_id, file_name, file_path, applicant_name, applicant_email, created_by_user_id)
       VALUES (@id, @folder_id, @file_name, @file_path, @applicant_name, @applicant_email, @userId)`,
      {
        id,
        folder_id: folder_id || null,
        file_name: file.originalname || file.filename,
        file_path: relativePath,
        applicant_name: (applicant_name || '').toString().trim() || null,
        applicant_email: (applicant_email || '').toString().trim() || null,
        userId: req.user?.id || null,
      }
    );
    const row = await query(`SELECT id, folder_id, file_name, file_path, applicant_name, applicant_email, uploaded_at FROM recruitment_cvs WHERE id = @id`, { id });
    res.status(201).json({ cv: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/cvs/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(`SELECT id, folder_id, file_name, file_path, applicant_name, applicant_email, uploaded_at FROM recruitment_cvs WHERE id = @id`, { id });
    const cv = result.recordset?.[0];
    if (!cv) return res.status(404).json({ error: 'CV not found' });
    res.json({ cv });
  } catch (err) {
    next(err);
  }
});

router.get('/cvs/:id/download', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(`SELECT file_name, file_path FROM recruitment_cvs WHERE id = @id`, { id });
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'CV not found', code: 'CV_NOT_FOUND' });
    const relativePath = (row.file_path || '').replace(/^\//, '').replace(/\\/g, path.sep);
    if (!relativePath.trim()) return res.status(404).json({ error: 'CV file path is missing', code: 'FILE_NOT_ON_SERVER' });
    const fullPath = path.join(process.cwd(), 'uploads', relativePath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        error: 'File not found on server',
        code: 'FILE_NOT_ON_SERVER',
        hint: 'The CV record exists but the file is missing on this server. Ensure the uploads directory is persistent in production, or re-upload the CV.',
      });
    }
    res.download(fullPath, row.file_name || 'cv.pdf');
  } catch (err) {
    next(err);
  }
});

router.delete('/cvs/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(`SELECT file_path FROM recruitment_cvs WHERE id = @id`, { id });
    const row = result.recordset?.[0];
    if (row?.file_path) {
      const fullPath = path.join(process.cwd(), 'uploads', (row.file_path || '').replace(/^\//, ''));
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    await query(`DELETE FROM recruitment_cvs WHERE id = @id`, { id });
    res.json({ deleted: id });
  } catch (err) {
    next(err);
  }
});

/** POST /cvs/bulk-delete — delete multiple CVs by id. Body: { ids: string[] } */
router.post('/cvs/bulk-delete', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => id != null && String(id).trim()) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids array is required and must not be empty' });
    const deleted = [];
    const errors = [];
    for (const id of ids) {
      try {
        const result = await query(`SELECT file_path FROM recruitment_cvs WHERE id = @id`, { id });
        const row = result.recordset?.[0];
        if (row?.file_path) {
          const relativePath = (row.file_path || '').replace(/^\//, '').replace(/\\/g, path.sep);
          const fullPath = path.join(process.cwd(), 'uploads', relativePath);
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        }
        await query(`DELETE FROM recruitment_cvs WHERE id = @id`, { id });
        deleted.push(id);
      } catch (err) {
        errors.push({ id, message: err?.message || 'Failed to delete' });
      }
    }
    res.json({ deleted, errors: errors.length ? errors : undefined });
  } catch (err) {
    next(err);
  }
});

// --- Applicants (per vacancy, with screening) ---
// Stage flow: Screening → Interview → Appointment. Response includes appointment_status and has_panel_session for UI.
router.get('/applicants', async (req, res, next) => {
  try {
    const { vacancy_id, date_from, date_to } = req.query || {};
    let sql = `SELECT a.id, a.vacancy_id, a.cv_id, a.name, a.email, a.phone, a.screening_grade, a.screening_comments, a.screening_call_notes, a.screening_applicant_response, a.screening_verdict,
       a.interview_invite_sent_at, a.interview_date, a.interview_location, a.interview_notes, a.regret_sent_at, a.created_at, a.updated_at,
       v.title AS vacancy_title,
       o.id AS appointment_id, o.status AS appointment_status,
       CASE WHEN ps.applicant_id IS NOT NULL THEN 1 ELSE 0 END AS has_panel_session
       FROM recruitment_applicants a
       LEFT JOIN recruitment_vacancies v ON v.id = a.vacancy_id
       LEFT JOIN recruitment_appointments o ON o.applicant_id = a.id AND o.vacancy_id = a.vacancy_id
       LEFT JOIN (SELECT DISTINCT applicant_id FROM recruitment_panel_sessions) ps ON ps.applicant_id = a.id
       WHERE 1=1`;
    const params = {};
    if (vacancy_id) { sql += ` AND a.vacancy_id = @vacancy_id`; params.vacancy_id = vacancy_id; }
    const df = dateStringForFilter(date_from);
    const dt = dateStringForFilter(date_to);
    if (df) { sql += ` AND CAST(a.created_at AS DATE) >= CONVERT(DATE, @date_from, 23)`; params.date_from = df; }
    if (dt) { sql += ` AND CAST(a.created_at AS DATE) <= CONVERT(DATE, @date_to, 23)`; params.date_to = dt; }
    sql += ` ORDER BY a.created_at DESC`;
    const result = await query(sql, params);
    res.json({ applicants: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/applicants', async (req, res, next) => {
  try {
    const { vacancy_id, cv_id, name, email, phone } = req.body || {};
    if (!vacancy_id || !name || !email) return res.status(400).json({ error: 'vacancy_id, name and email are required' });
    const id = randomUUID();
    await query(
      `INSERT INTO recruitment_applicants (id, vacancy_id, cv_id, name, email, phone) VALUES (@id, @vacancy_id, @cv_id, @name, @email, @phone)`,
      {
        id,
        vacancy_id,
        cv_id: cv_id || null,
        name: (name || '').toString().trim(),
        email: (email || '').toString().trim(),
        phone: (phone || '').toString().trim() || null,
      }
    );
    const row = await query(`SELECT a.id, a.vacancy_id, a.cv_id, a.name, a.email, a.phone, a.screening_verdict, a.created_at, v.title AS vacancy_title FROM recruitment_applicants a LEFT JOIN recruitment_vacancies v ON v.id = a.vacancy_id WHERE a.id = @id`, { id });
    res.status(201).json({ applicant: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/applicants/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const updates = [];
    const params = { id };
    const cols = ['name', 'email', 'phone', 'cv_id', 'screening_grade', 'screening_comments', 'screening_call_notes', 'screening_applicant_response', 'screening_verdict', 'interview_date', 'interview_location', 'interview_notes'];
    cols.forEach((key) => {
      if (body[key] === undefined) return;
      const isRequired = key === 'name' || key === 'email';
      let val;
      if (key === 'cv_id') val = body[key] || null;
      else if (key === 'interview_date') val = parseDateTimeForSql(body[key]);
      else val = (body[key] || '').toString().trim() || null;
      if (isRequired && (val === null || val === '')) return; // do not clear required fields
      updates.push(`${key} = @${key}`);
      params[key] = val;
    });
    if (updates.length === 0) {
      const r = await query(`SELECT a.*, v.title AS vacancy_title FROM recruitment_applicants a LEFT JOIN recruitment_vacancies v ON v.id = a.vacancy_id WHERE a.id = @id`, { id });
      return res.json({ applicant: r.recordset?.[0] });
    }
    updates.push('updated_at = SYSUTCDATETIME()');
    await query(`UPDATE recruitment_applicants SET ${updates.join(', ')} WHERE id = @id`, params);
    const row = await query(`SELECT a.*, v.title AS vacancy_title FROM recruitment_applicants a LEFT JOIN recruitment_vacancies v ON v.id = a.vacancy_id WHERE a.id = @id`, { id });
    res.json({ applicant: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

/** POST send interview invite email. Body: { interview_date, interview_location, interview_notes } */
router.post('/applicants/:id/send-interview-invite', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { interview_date, interview_location, interview_notes } = req.body || {};
    const result = await query(
      `SELECT a.id, a.name, a.email, a.vacancy_id, v.title AS vacancy_title FROM recruitment_applicants a LEFT JOIN recruitment_vacancies v ON v.id = a.vacancy_id WHERE a.id = @id`,
      { id }
    );
    const applicant = result.recordset?.[0];
    if (!applicant) return res.status(404).json({ error: 'Applicant not found' });
    const email = (applicant.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Applicant has no email' });
    const interviewDateParsed = parseDateTimeForSql(interview_date);
    await query(
      `UPDATE recruitment_applicants SET interview_invite_sent_at = SYSUTCDATETIME(), interview_date = @interview_date, interview_location = @interview_location, interview_notes = @interview_notes, updated_at = SYSUTCDATETIME() WHERE id = @id`,
      { id, interview_date: interviewDateParsed, interview_location: (interview_location || '').toString().trim() || null, interview_notes: (interview_notes || '').toString().trim() || null }
    );
    if (isEmailConfigured()) {
      const subject = `Interview invitation – ${applicant.vacancy_title || 'Position'}`;
      const body = recruitmentInterviewInviteHtml({
        name: applicant.name,
        vacancyTitle: applicant.vacancy_title,
        interviewDate: interview_date,
        interviewLocation: interview_location,
        interviewNotes: interview_notes,
      });
      await sendEmail({ to: email, subject, body, html: true });
      // Notify panel members to show up for this applicant's interview
      const panelRows = await query(
        `SELECT u.email, u.full_name FROM recruitment_panel_members m JOIN users u ON u.id = m.user_id WHERE (u.email IS NOT NULL AND LTRIM(RTRIM(u.email)) != '')`
      );
      const panelList = panelRows.recordset || [];
      const panelSubject = `Panel reminder – Interview: ${applicant.name || 'Applicant'} (${applicant.vacancy_title || 'Position'})`;
      const panelBody = recruitmentPanelInterviewReminderHtml({
        applicantName: applicant.name,
        vacancyTitle: applicant.vacancy_title,
        interviewDate: interview_date,
        interviewLocation: interview_location,
        interviewNotes: interview_notes,
      });
      for (const p of panelList) {
        const to = (p.email || '').trim();
        if (to) await sendEmail({ to, subject: panelSubject, body: panelBody, html: true }).catch((err) => console.error('[recruitment] Panel reminder email failed for', to, err?.message));
      }
    }
    const row = await query(`SELECT a.*, v.title AS vacancy_title FROM recruitment_applicants a LEFT JOIN recruitment_vacancies v ON v.id = a.vacancy_id WHERE a.id = @id`, { id });
    res.json({ applicant: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

/** POST send screening regret email */
router.post('/applicants/:id/send-regret', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT a.id, a.name, a.email, a.vacancy_id, v.title AS vacancy_title FROM recruitment_applicants a LEFT JOIN recruitment_vacancies v ON v.id = a.vacancy_id WHERE a.id = @id`,
      { id }
    );
    const applicant = result.recordset?.[0];
    if (!applicant) return res.status(404).json({ error: 'Applicant not found' });
    const email = (applicant.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Applicant has no email' });
    await query(`UPDATE recruitment_applicants SET regret_sent_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
    if (isEmailConfigured()) {
      const subject = `Update on your application – ${applicant.vacancy_title || 'Position'}`;
      const body = recruitmentScreeningRegretHtml({ name: applicant.name, vacancyTitle: applicant.vacancy_title });
      await sendEmail({ to: email, subject, body, html: true });
    }
    const row = await query(`SELECT a.*, v.title AS vacancy_title FROM recruitment_applicants a LEFT JOIN recruitment_vacancies v ON v.id = a.vacancy_id WHERE a.id = @id`, { id });
    res.json({ applicant: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

// --- Interview questions ---
router.get('/interview-questions', async (req, res, next) => {
  try {
    const { vacancy_id } = req.query || {};
    let sql = `SELECT id, vacancy_id, question_text, possible_answers_json, max_score, sort_order, created_at, created_by_user_id, allowed_asker_user_ids FROM recruitment_interview_questions WHERE 1=1`;
    const params = {};
    if (vacancy_id !== undefined && vacancy_id !== '') { sql += ` AND (vacancy_id = @vacancy_id OR vacancy_id IS NULL)`; params.vacancy_id = vacancy_id; }
    sql += ` ORDER BY sort_order, created_at`;
    const result = await query(sql, params);
    const list = (result.recordset || []).map((r) => {
      const allowed = r.allowed_asker_user_ids ? (typeof r.allowed_asker_user_ids === 'string' ? (() => { try { return JSON.parse(r.allowed_asker_user_ids); } catch (_) { return []; } })() : r.allowed_asker_user_ids) : [];
      return { ...r, possible_answers: r.possible_answers_json ? (typeof r.possible_answers_json === 'string' ? JSON.parse(r.possible_answers_json) : r.possible_answers_json) : [], allowed_asker_user_ids: Array.isArray(allowed) ? allowed : [] };
    });
    res.json({ questions: list });
  } catch (err) {
    next(err);
  }
});

router.post('/interview-questions', async (req, res, next) => {
  try {
    const { vacancy_id, question_text, possible_answers, max_score, sort_order, created_by_user_id, allowed_asker_user_ids } = req.body || {};
    const id = randomUUID();
    const possible_answers_json = Array.isArray(possible_answers) ? JSON.stringify(possible_answers) : null;
    const allowedJson = Array.isArray(allowed_asker_user_ids) ? JSON.stringify(allowed_asker_user_ids) : null;
    const creatorId = created_by_user_id || req.user?.id || null;
    await query(
      `INSERT INTO recruitment_interview_questions (id, vacancy_id, question_text, possible_answers_json, max_score, sort_order, created_by_user_id, allowed_asker_user_ids) VALUES (@id, @vacancy_id, @question_text, @possible_answers_json, @max_score, @sort_order, @created_by_user_id, @allowed_asker_user_ids)`,
      { id, vacancy_id: vacancy_id || null, question_text: (question_text || '').toString().trim() || 'Question', possible_answers_json, max_score: max_score ?? 10, sort_order: sort_order ?? 0, created_by_user_id: creatorId, allowed_asker_user_ids: allowedJson }
    );
    const row = await query(`SELECT id, vacancy_id, question_text, possible_answers_json, max_score, sort_order, created_at, created_by_user_id, allowed_asker_user_ids FROM recruitment_interview_questions WHERE id = @id`, { id });
    const q = row.recordset?.[0];
    const allowed = q?.allowed_asker_user_ids ? (typeof q.allowed_asker_user_ids === 'string' ? JSON.parse(q.allowed_asker_user_ids) : q.allowed_asker_user_ids) : [];
    res.status(201).json({ question: { ...q, possible_answers: possible_answers || [], allowed_asker_user_ids: Array.isArray(allowed) ? allowed : [] } });
  } catch (err) {
    next(err);
  }
});

router.patch('/interview-questions/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { question_text, possible_answers, max_score, sort_order, allowed_asker_user_ids } = req.body || {};
    const updates = [];
    const params = { id };
    if (question_text !== undefined) { updates.push('question_text = @question_text'); params.question_text = (question_text || '').toString().trim(); }
    if (possible_answers !== undefined) { updates.push('possible_answers_json = @possible_answers_json'); params.possible_answers_json = Array.isArray(possible_answers) ? JSON.stringify(possible_answers) : null; }
    if (max_score !== undefined) { updates.push('max_score = @max_score'); params.max_score = max_score; }
    if (sort_order !== undefined) { updates.push('sort_order = @sort_order'); params.sort_order = sort_order; }
    if (allowed_asker_user_ids !== undefined) { updates.push('allowed_asker_user_ids = @allowed_asker_user_ids'); params.allowed_asker_user_ids = Array.isArray(allowed_asker_user_ids) ? JSON.stringify(allowed_asker_user_ids) : null; }
    if (updates.length > 0) await query(`UPDATE recruitment_interview_questions SET ${updates.join(', ')} WHERE id = @id`, params);
    const row = await query(`SELECT id, vacancy_id, question_text, possible_answers_json, max_score, sort_order, created_at, created_by_user_id, allowed_asker_user_ids FROM recruitment_interview_questions WHERE id = @id`, { id });
    const q = row.recordset?.[0];
    const allowed = q?.allowed_asker_user_ids ? (typeof q.allowed_asker_user_ids === 'string' ? JSON.parse(q.allowed_asker_user_ids) : q.allowed_asker_user_ids) : [];
    res.json({ question: { ...q, possible_answers: q?.possible_answers_json ? JSON.parse(q.possible_answers_json) : [], allowed_asker_user_ids: Array.isArray(allowed) ? allowed : [] } });
  } catch (err) {
    next(err);
  }
});

router.delete('/interview-questions/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    await query(`DELETE FROM recruitment_interview_questions WHERE id = @id`, { id });
    res.json({ deleted: id });
  } catch (err) {
    next(err);
  }
});

// --- Panel sessions and scores ---
const panelSessionSelect = `s.id, s.applicant_id, s.vacancy_id, s.conducted_at, s.total_score, s.overall_comments, a.name AS applicant_name, v.title AS vacancy_title, a.cv_id AS applicant_cv_id, c.file_name AS applicant_cv_file_name`;
const panelSessionFrom = `FROM recruitment_panel_sessions s LEFT JOIN recruitment_applicants a ON a.id = s.applicant_id LEFT JOIN recruitment_vacancies v ON v.id = s.vacancy_id LEFT JOIN recruitment_cvs c ON c.id = a.cv_id`;

router.get('/panel-sessions', async (req, res, next) => {
  try {
    const { applicant_id, vacancy_id } = req.query || {};
    let sql = `SELECT ${panelSessionSelect} ${panelSessionFrom} WHERE 1=1`;
    const params = {};
    if (applicant_id) { sql += ` AND s.applicant_id = @applicant_id`; params.applicant_id = applicant_id; }
    if (vacancy_id) { sql += ` AND s.vacancy_id = @vacancy_id`; params.vacancy_id = vacancy_id; }
    sql += ` ORDER BY s.conducted_at DESC`;
    const result = await query(sql, params);
    res.json({ sessions: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/panel-sessions', async (req, res, next) => {
  try {
    const { applicant_id, vacancy_id, total_score, overall_comments } = req.body || {};
    if (!applicant_id || !vacancy_id) return res.status(400).json({ error: 'applicant_id and vacancy_id required' });
    const id = randomUUID();
    await query(
      `INSERT INTO recruitment_panel_sessions (id, applicant_id, vacancy_id, total_score, overall_comments, created_by_user_id) VALUES (@id, @applicant_id, @vacancy_id, @total_score, @overall_comments, @userId)`,
      { id, applicant_id, vacancy_id, total_score: total_score ?? null, overall_comments: (overall_comments || '').toString().trim() || null, userId: req.user?.id || null }
    );
    const row = await query(`SELECT ${panelSessionSelect} ${panelSessionFrom} WHERE s.id = @id`, { id });
    res.status(201).json({ session: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/panel-sessions/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { total_score, overall_comments } = req.body || {};
    const updates = [];
    const params = { id };
    if (total_score !== undefined) { updates.push('total_score = @total_score'); params.total_score = total_score; }
    if (overall_comments !== undefined) { updates.push('overall_comments = @overall_comments'); params.overall_comments = (overall_comments || '').toString().trim() || null; }
    if (updates.length > 0) await query(`UPDATE recruitment_panel_sessions SET ${updates.join(', ')} WHERE id = @id`, params);
    const row = await query(`SELECT ${panelSessionSelect} ${panelSessionFrom} WHERE s.id = @id`, { id });
    res.json({ session: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/panel-sessions/:id/scores', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT sc.id, sc.session_id, sc.question_id, sc.score, sc.comments, q.question_text, q.max_score FROM recruitment_panel_scores sc
       LEFT JOIN recruitment_interview_questions q ON q.id = sc.question_id WHERE sc.session_id = @id`,
      { id }
    );
    res.json({ scores: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

/** Panel: add a question (creates interview question for session's vacancy, linked to current user as asker) */
router.post('/panel/add-question', async (req, res, next) => {
  try {
    const { session_id, question_text, max_score } = req.body || {};
    if (!session_id || !(question_text || '').toString().trim()) return res.status(400).json({ error: 'session_id and question_text required' });
    const sessionRow = await query(`SELECT id, vacancy_id FROM recruitment_panel_sessions WHERE id = @id`, { id: session_id });
    const session = sessionRow.recordset?.[0];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const userId = req.user?.id || null;
    const id = randomUUID();
    const allowedJson = userId ? JSON.stringify([userId]) : null;
    await query(
      `INSERT INTO recruitment_interview_questions (id, vacancy_id, question_text, possible_answers_json, max_score, sort_order, created_by_user_id, allowed_asker_user_ids) VALUES (@id, @vacancy_id, @question_text, NULL, @max_score, 0, @created_by_user_id, @allowed_asker_user_ids)`,
      { id, vacancy_id: session.vacancy_id, question_text: (question_text || '').toString().trim(), max_score: max_score ?? 10, created_by_user_id: userId, allowed_asker_user_ids: allowedJson }
    );
    const row = await query(`SELECT id, vacancy_id, question_text, possible_answers_json, max_score, sort_order, created_at, created_by_user_id, allowed_asker_user_ids FROM recruitment_interview_questions WHERE id = @id`, { id });
    const q = row.recordset?.[0];
    res.status(201).json({ question: { ...q, possible_answers: [], allowed_asker_user_ids: userId ? [userId] : [] } });
  } catch (err) {
    next(err);
  }
});

router.post('/panel-sessions/:id/scores', async (req, res, next) => {
  try {
    const { id: session_id } = req.params;
    const { question_id, score, comments } = req.body || {};
    if (!question_id) return res.status(400).json({ error: 'question_id required' });
    const existing = await query(`SELECT id FROM recruitment_panel_scores WHERE session_id = @session_id AND question_id = @question_id`, { session_id, question_id });
    if (existing.recordset?.length) {
      await query(`UPDATE recruitment_panel_scores SET score = @score, comments = @comments WHERE session_id = @session_id AND question_id = @question_id`, { session_id, question_id, score: score ?? null, comments: (comments || '').toString().trim() || null });
    } else {
      const scoreId = randomUUID();
      await query(`INSERT INTO recruitment_panel_scores (id, session_id, question_id, score, comments, created_by_user_id) VALUES (@scoreId, @session_id, @question_id, @score, @comments, @userId)`, { scoreId, session_id, question_id, score: score ?? null, comments: (comments || '').toString().trim() || null, userId: req.user?.id || null });
    }
    const row = await query(`SELECT sc.id, sc.session_id, sc.question_id, sc.score, sc.comments, q.question_text, q.max_score FROM recruitment_panel_scores sc LEFT JOIN recruitment_interview_questions q ON q.id = sc.question_id WHERE sc.session_id = @session_id`, { session_id });
    res.json({ scores: row.recordset || [] });
  } catch (err) {
    next(err);
  }
});

// --- Results (aggregate scores + AI placeholder) ---
router.get('/results', async (req, res, next) => {
  try {
    const { vacancy_id } = req.query || {};
    let sql = `SELECT s.id, s.applicant_id, s.vacancy_id, s.conducted_at, s.total_score, s.overall_comments, a.name AS applicant_name, a.email AS applicant_email, v.title AS vacancy_title
       FROM recruitment_panel_sessions s
       LEFT JOIN recruitment_applicants a ON a.id = s.applicant_id
       LEFT JOIN recruitment_vacancies v ON v.id = s.vacancy_id WHERE 1=1`;
    const params = {};
    if (vacancy_id) { sql += ` AND s.vacancy_id = @vacancy_id`; params.vacancy_id = vacancy_id; }
    sql += ` ORDER BY s.total_score DESC, s.conducted_at DESC`;
    const result = await query(sql, params);
    const sessions = result.recordset || [];
    const ai_analysis = sessions.length > 0 ? { summary: 'Review the scores and comments below. Consider experience, consistency of scores, and panel comments when making a decision.', recommendation: 'Top-scoring candidates are listed first. Use the Appointments tab to send offers.' } : null;
    res.json({ results: sessions, ai_analysis });
  } catch (err) {
    next(err);
  }
});

// --- Appointments (offers) ---
router.get('/appointments', async (req, res, next) => {
  try {
    const { vacancy_id } = req.query || {};
    let sql = `SELECT o.id, o.applicant_id, o.vacancy_id, o.congratulations_sent_at, o.regret_sent_at, o.status, o.response_at, o.created_at, a.name AS applicant_name, a.email AS applicant_email, v.title AS vacancy_title
       FROM recruitment_appointments o
       LEFT JOIN recruitment_applicants a ON a.id = o.applicant_id
       LEFT JOIN recruitment_vacancies v ON v.id = o.vacancy_id WHERE 1=1`;
    const params = {};
    if (vacancy_id) { sql += ` AND o.vacancy_id = @vacancy_id`; params.vacancy_id = vacancy_id; }
    sql += ` ORDER BY o.created_at DESC`;
    const result = await query(sql, params);
    res.json({ appointments: result.recordset || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/appointments', async (req, res, next) => {
  try {
    const { applicant_id, vacancy_id } = req.body || {};
    if (!applicant_id || !vacancy_id) return res.status(400).json({ error: 'applicant_id and vacancy_id required' });
    const id = randomUUID();
    await query(
      `INSERT INTO recruitment_appointments (id, applicant_id, vacancy_id, status) VALUES (@id, @applicant_id, @vacancy_id, 'pending')`,
      { id, applicant_id, vacancy_id }
    );
    const row = await query(`SELECT o.id, o.applicant_id, o.vacancy_id, o.status, o.created_at, a.name AS applicant_name, a.email AS applicant_email, v.title AS vacancy_title FROM recruitment_appointments o LEFT JOIN recruitment_applicants a ON a.id = o.applicant_id LEFT JOIN recruitment_vacancies v ON v.id = o.vacancy_id WHERE o.id = @id`, { id });
    res.status(201).json({ appointment: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

/** PATCH set status to accepted (when candidate responds) */
router.patch('/appointments/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (status) await query(`UPDATE recruitment_appointments SET status = @status, response_at = CASE WHEN @status = 'accepted' THEN SYSUTCDATETIME() ELSE response_at END, updated_at = SYSUTCDATETIME() WHERE id = @id`, { id, status });
    const row = await query(`SELECT o.*, a.name AS applicant_name, a.email AS applicant_email, v.title AS vacancy_title FROM recruitment_appointments o LEFT JOIN recruitment_applicants a ON a.id = o.applicant_id LEFT JOIN recruitment_vacancies v ON v.id = o.vacancy_id WHERE o.id = @id`, { id });
    res.json({ appointment: row.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

/** POST send congratulations email */
router.post('/appointments/:id/send-congratulations', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT o.id, o.applicant_id, a.name, a.email, v.title AS vacancy_title FROM recruitment_appointments o
       LEFT JOIN recruitment_applicants a ON a.id = o.applicant_id LEFT JOIN recruitment_vacancies v ON v.id = o.vacancy_id WHERE o.id = @id`,
      { id }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Appointment not found' });
    const email = (row.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Applicant has no email' });
    await query(`UPDATE recruitment_appointments SET congratulations_sent_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
    if (isEmailConfigured()) {
      const subject = `Congratulations – Offer for ${row.vacancy_title || 'Position'}`;
      const body = recruitmentCongratulationsHtml({ name: row.name, vacancyTitle: row.vacancy_title });
      await sendEmail({ to: email, subject, body, html: true });
    }
    const updated = await query(`SELECT o.*, a.name AS applicant_name, a.email AS applicant_email, v.title AS vacancy_title FROM recruitment_appointments o LEFT JOIN recruitment_applicants a ON a.id = o.applicant_id LEFT JOIN recruitment_vacancies v ON v.id = o.vacancy_id WHERE o.id = @id`, { id });
    res.json({ appointment: updated.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

/** POST send appointment regret email */
router.post('/appointments/:id/send-regret', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT o.id, o.applicant_id, a.name, a.email, v.title AS vacancy_title FROM recruitment_appointments o
       LEFT JOIN recruitment_applicants a ON a.id = o.applicant_id LEFT JOIN recruitment_vacancies v ON v.id = o.vacancy_id WHERE o.id = @id`,
      { id }
    );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ error: 'Appointment not found' });
    const email = (row.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Applicant has no email' });
    await query(`UPDATE recruitment_appointments SET regret_sent_at = SYSUTCDATETIME(), status = 'declined', updated_at = SYSUTCDATETIME() WHERE id = @id`, { id });
    if (isEmailConfigured()) {
      const subject = `Update on your application – ${row.vacancy_title || 'Position'}`;
      const body = recruitmentAppointmentRegretHtml({ name: row.name, vacancyTitle: row.vacancy_title });
      await sendEmail({ to: email, subject, body, html: true });
    }
    const updated = await query(`SELECT o.*, a.name AS applicant_name, a.email AS applicant_email, v.title AS vacancy_title FROM recruitment_appointments o LEFT JOIN recruitment_applicants a ON a.id = o.applicant_id LEFT JOIN recruitment_vacancies v ON v.id = o.vacancy_id WHERE o.id = @id`, { id });
    res.json({ appointment: updated.recordset?.[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
