/**
 * Clear login lockout for a user by email (failed attempts + login_locked_at).
 * Run on a machine with database credentials (e.g. same .env as the API):
 *
 *   node scripts/unlock-user-login.js you@company.com
 *
 * Use when the only super admin is locked and cannot open User management → Block requests.
 */
import 'dotenv/config';
import { query, close } from '../src/db.js';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/unlock-user-login.js <email>');
  process.exit(1);
}

try {
  const r = await query(
    `UPDATE users
     SET login_failed_attempts = 0, login_locked_at = NULL, updated_at = SYSUTCDATETIME()
     OUTPUT INSERTED.id AS id, INSERTED.email AS email, INSERTED.role AS role, INSERTED.full_name AS full_name
     WHERE LOWER(LTRIM(RTRIM(email))) = @email`,
    { email }
  );
  const row = r.recordset?.[0];
  if (!row) {
    console.error('No user found with email:', email);
    process.exit(2);
  }
  console.log('Login lock cleared for:', row.email, `(${row.full_name || '—'} · ${row.role || '—'})`);
} catch (e) {
  console.error(e.message || e);
  process.exit(3);
} finally {
  await close();
}
