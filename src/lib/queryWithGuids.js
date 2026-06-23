import { getPool } from '../db.js';
import { bindSqlParams } from './sqlGuidParams.js';

/** Run SQL with UNIQUEIDENTIFIER params validated and typed (throws on invalid GUIDs). */
export async function queryWithGuids(text, params = {}) {
  const p = await getPool();
  const request = p.request();
  bindSqlParams(request, params, { strict: true });
  return request.query(text);
}
