import sql from 'mssql';
import { getPool } from '../db.js';
import { parseGuid } from './guidUtils.js';

const GUID_KEYS = new Set([
  'id',
  'tenantid',
  'requestid',
  'recipientid',
  'userid',
  'createdbyuserid',
]);

function isGuidParam(key) {
  const k = (key.startsWith('@') ? key.slice(1) : key).toLowerCase();
  if (GUID_KEYS.has(k)) return true;
  return k.endsWith('id') || k.includes('_id');
}

/** Run SQL with UNIQUEIDENTIFIER params validated and typed (avoids "Invalid string" on @id). */
export async function queryWithGuids(text, params = {}) {
  const p = await getPool();
  const request = p.request();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const k = key.startsWith('@') ? key.slice(1) : key;
    if (isGuidParam(k)) {
      const g = parseGuid(value);
      if (!g) {
        const err = new Error(`Validation failed for parameter '${k}'. Invalid string.`);
        err.status = 400;
        throw err;
      }
      request.input(k, sql.UniqueIdentifier, g);
    } else {
      request.input(k, value);
    }
  }
  return request.query(text);
}
