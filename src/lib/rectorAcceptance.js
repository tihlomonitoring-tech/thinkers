import { query as defaultQuery } from '../db.js';
import { normTruckRegistration } from './truckRegistration.js';

/**
 * Rector "Accepted trucks" verification helpers.
 *
 * A rector accepts/inducts trucks onto a route (rector_accepted_trucks). The
 * contractor may only enroll a truck on that route if it matches an accepted
 * entry according to the route's verification configuration (rector_route_settings).
 */

export const VERIFY_FIELDS = [
  { key: 'registration', flag: 'verify_registration', label: 'Registration' },
  { key: 'trailer_1_reg_no', flag: 'verify_trailer_1', label: 'Trailer 1' },
  { key: 'trailer_2_reg_no', flag: 'verify_trailer_2', label: 'Trailer 2' },
  { key: 'fleet_no', flag: 'verify_fleet_no', label: 'Fleet number' },
];

export const DEFAULT_ROUTE_SETTINGS = {
  verify_registration: true,
  verify_trailer_1: false,
  verify_trailer_2: false,
  verify_fleet_no: false,
  enforce_acceptance: false,
  notify_email_enabled: true,
};

let tablesEnsured = false;

/** Create the rector-acceptance tables on demand (so the feature works even before the migration is run). */
export async function ensureRectorAcceptanceTables(query = defaultQuery) {
  if (tablesEnsured) return;
  await query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'rector_accepted_trucks')
    CREATE TABLE rector_accepted_trucks (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id),
      route_id UNIQUEIDENTIFIER NOT NULL REFERENCES contractor_routes(id) ON DELETE CASCADE,
      truck_id UNIQUEIDENTIFIER NULL,
      fleet_no NVARCHAR(50) NULL,
      registration NVARCHAR(50) NOT NULL,
      trailer_1_reg_no NVARCHAR(50) NULL,
      trailer_2_reg_no NVARCHAR(50) NULL,
      source NVARCHAR(20) NOT NULL CONSTRAINT DF_rat_source DEFAULT N'manual',
      accepted_by_user_id UNIQUEIDENTIFIER NULL,
      accepted_at DATETIME2 NOT NULL CONSTRAINT DF_rat_accepted_at DEFAULT SYSUTCDATETIME(),
      created_at DATETIME2 NOT NULL CONSTRAINT DF_rat_created_at DEFAULT SYSUTCDATETIME(),
      CONSTRAINT UQ_rector_accepted_trucks_route_reg UNIQUE (route_id, registration)
    );`);
  await query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'rector_route_settings')
    CREATE TABLE rector_route_settings (
      route_id UNIQUEIDENTIFIER PRIMARY KEY REFERENCES contractor_routes(id) ON DELETE CASCADE,
      tenant_id UNIQUEIDENTIFIER NOT NULL,
      verify_registration BIT NOT NULL CONSTRAINT DF_rrs_verify_reg DEFAULT (1),
      verify_trailer_1 BIT NOT NULL CONSTRAINT DF_rrs_verify_t1 DEFAULT (0),
      verify_trailer_2 BIT NOT NULL CONSTRAINT DF_rrs_verify_t2 DEFAULT (0),
      verify_fleet_no BIT NOT NULL CONSTRAINT DF_rrs_verify_fleet DEFAULT (0),
      enforce_acceptance BIT NOT NULL CONSTRAINT DF_rrs_enforce DEFAULT (1),
      notify_email_enabled BIT NOT NULL CONSTRAINT DF_rrs_notify DEFAULT (1),
      updated_by_user_id UNIQUEIDENTIFIER NULL,
      updated_at DATETIME2 NOT NULL CONSTRAINT DF_rrs_updated_at DEFAULT SYSUTCDATETIME()
    );`);
  await query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'rector_acceptance_requests')
    CREATE TABLE rector_acceptance_requests (
      id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
      tenant_id UNIQUEIDENTIFIER NOT NULL REFERENCES tenants(id),
      route_id UNIQUEIDENTIFIER NOT NULL REFERENCES contractor_routes(id) ON DELETE CASCADE,
      truck_id UNIQUEIDENTIFIER NOT NULL,
      registration NVARCHAR(50) NULL,
      fleet_no NVARCHAR(50) NULL,
      trailer_1_reg_no NVARCHAR(50) NULL,
      trailer_2_reg_no NVARCHAR(50) NULL,
      [status] NVARCHAR(20) NOT NULL CONSTRAINT DF_rar_status DEFAULT N'pending',
      note NVARCHAR(MAX) NULL,
      review_note NVARCHAR(MAX) NULL,
      requested_by_user_id UNIQUEIDENTIFIER NULL,
      requested_at DATETIME2 NOT NULL CONSTRAINT DF_rar_requested_at DEFAULT SYSUTCDATETIME(),
      reviewed_by_user_id UNIQUEIDENTIFIER NULL,
      reviewed_at DATETIME2 NULL
    );`);
  tablesEnsured = true;
}

function asBool(v) {
  return v === true || v === 1 || v === '1';
}

export function mapRouteSettings(row) {
  if (!row) return { ...DEFAULT_ROUTE_SETTINGS };
  return {
    verify_registration: asBool(row.verify_registration),
    verify_trailer_1: asBool(row.verify_trailer_1),
    verify_trailer_2: asBool(row.verify_trailer_2),
    verify_fleet_no: asBool(row.verify_fleet_no),
    enforce_acceptance: asBool(row.enforce_acceptance),
    notify_email_enabled: asBool(row.notify_email_enabled),
  };
}

/** Read a route's verification settings. When no row exists, enforcement is OFF (non-breaking). */
export async function getRouteSettings(query, tenantId, routeId) {
  await ensureRectorAcceptanceTables(query);
  const r = await query(
    `SELECT * FROM rector_route_settings WHERE route_id = @routeId AND tenant_id = @tenantId`,
    { routeId, tenantId }
  );
  return mapRouteSettings(r.recordset?.[0]);
}

/** Ensure a settings row exists for a route (created with enforcement ON the first time a rector configures it). */
export async function ensureRouteSettingsRow(query, tenantId, routeId, userId) {
  await ensureRectorAcceptanceTables(query);
  await query(
    `IF NOT EXISTS (SELECT 1 FROM rector_route_settings WHERE route_id = @routeId)
       INSERT INTO rector_route_settings (route_id, tenant_id, updated_by_user_id)
       VALUES (@routeId, @tenantId, @userId)`,
    { routeId, tenantId, userId: userId || null }
  );
}

/** The labels of fields the rector verifies, for clear messaging. */
export function enabledVerifyFields(settings) {
  const enabled = VERIFY_FIELDS.filter((f) => settings[f.flag]);
  // Registration is always a sensible fallback so we never match on "nothing".
  return enabled.length > 0 ? enabled : [VERIFY_FIELDS[0]];
}

/**
 * Verify a contractor truck against the rector's accepted list for a route.
 * Returns { ok, matchedId, missing: [labels], reason }.
 */
export function verifyTruckAgainstAccepted({ settings, truck, acceptedList }) {
  const fields = enabledVerifyFields(settings);
  const truckVals = {};
  for (const f of fields) truckVals[f.key] = normTruckRegistration(truck?.[f.key]);

  const match = (acceptedList || []).find((entry) =>
    fields.every((f) => normTruckRegistration(entry?.[f.key]) === truckVals[f.key])
  );
  if (match) {
    return { ok: true, matchedId: match.id || null, missing: [], reason: '' };
  }

  // Build a precise explanation. If an entry matches on registration but differs
  // on the other configured fields, call out exactly which fields differ.
  const fieldLabels = fields.map((f) => f.label);
  const regNorm = normTruckRegistration(truck?.registration);
  const regMatch = (acceptedList || []).find((e) => normTruckRegistration(e?.registration) === regNorm && regNorm);
  let missing = fieldLabels;
  if (regMatch) {
    missing = fields
      .filter((f) => normTruckRegistration(regMatch[f.key]) !== truckVals[f.key])
      .map((f) => f.label);
  }
  const reg = (truck?.registration || '').toUpperCase() || 'this truck';
  const reason = regMatch
    ? `Truck ${reg} is on the rector's list but the ${missing.join(', ')} do not match what the rector accepted. Please notify the rector and request acceptance.`
    : `Truck ${reg} has not been accepted by the rector for this route (verified by ${fieldLabels.join(', ')}). Please notify the rector and request acceptance.`;
  return { ok: false, matchedId: null, missing, reason };
}
