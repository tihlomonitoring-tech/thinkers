import sql from 'mssql';
import { parseGuid } from './guidUtils.js';

const NOT_GUID_PARAMS = new Set([
  'entitytype',
  'activitytype',
  'identitytype',
  'idnumnorm',
  'licnumnorm',
  'regnorm',
]);

const EXPLICIT_GUID_KEYS = new Set([
  'id',
  'tenantid',
  'requestid',
  'recipientid',
  'userid',
  'createdbyuserid',
  'entityid',
  'truckid',
  'driverid',
  'excludeid',
  'contractorid',
  'changerequestid',
  'ccuserid',
  'subcontractorid',
  'linkedtruckid',
  'routeid',
  'tripid',
  'addedbyuserid',
  'applicationid',
  'reviewedbyuserid',
  'providerid',
  'pid',
  'ctid',
  'tid',
  'uid',
  'rid',
  'eid',
  'vid',
  'sid',
  'cid',
  'wb',
  'did',
  'obid',
  'fenceid',
  'tabid',
  'periodid',
  'submissionid',
  'evaluateeid',
  'questionid',
  'reportid',
  'scheduleid',
  'breakid',
  'vehicleid',
  'documentid',
  'attid',
  'positionid',
  'policyid',
  'expiryid',
  'counterpartyuserid',
  'requesteruserid',
  'reviewedbyuserid',
  'contractorreviewedbyuserid',
  'submittedbyuserid',
]);

export function isGuidSqlParam(key) {
  const k = (key.startsWith('@') ? key.slice(1) : key).toLowerCase();
  if (NOT_GUID_PARAMS.has(k)) return false;
  if (k.endsWith('norm') || k.endsWith('number')) return false;
  if (EXPLICIT_GUID_KEYS.has(k)) return true;
  if (k === 'id') return true;
  if (k.endsWith('_id')) return true;
  if (/^(sub|dsub|c)\d+$/.test(k)) return true;
  return false;
}

/**
 * Bind query parameters with UNIQUEIDENTIFIER typing where appropriate.
 * @param {import('mssql').Request} request
 * @param {Record<string, unknown>} params
 * @param {{ strict?: boolean }} options - strict: throw on invalid GUID (default false)
 */
export function bindSqlParams(request, params = {}, { strict = false } = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const k = key.startsWith('@') ? key.slice(1) : key;
    if (isGuidSqlParam(k)) {
      if (value === null || value === '') {
        request.input(k, sql.UniqueIdentifier, null);
        continue;
      }
      const g = parseGuid(value);
      if (g) {
        request.input(k, sql.UniqueIdentifier, g);
        continue;
      }
      if (strict) {
        const err = new Error(`Validation failed for parameter '${k}'. Invalid GUID.`);
        err.status = 400;
        throw err;
      }
      request.input(k, sql.UniqueIdentifier, null);
      continue;
    }
    request.input(k, value);
  }
}
