/** Shared corridor fields kept in sync between contractor_routes and Rector target regulations. */

export const ROUTE_CORRIDOR_FIELD_KEYS = [
  'starting_point',
  'destination',
  'loading_address',
  'destination_address',
  'distance_km',
];

export function parseCorridorFields(body) {
  const b = body || {};
  const out = {};
  for (const key of ['starting_point', 'destination', 'loading_address', 'destination_address']) {
    if (b[key] !== undefined) {
      out[key] = b[key] != null ? String(b[key]).trim() || null : null;
    }
  }
  if (b.distance_km !== undefined) {
    if (b.distance_km == null || b.distance_km === '') out.distance_km = null;
    else {
      const n = Number(b.distance_km);
      out.distance_km = Number.isFinite(n) && n >= 0 ? n : null;
    }
  }
  return out;
}

export async function updateRouteCorridor(query, tenantId, routeId, fields) {
  if (!fields || !Object.keys(fields).length) return;
  const updates = [];
  const params = { tenantId, routeId };
  const map = {
    starting_point: 'starting_point',
    destination: 'destination',
    loading_address: 'loading_address',
    destination_address: 'destination_address',
    distance_km: 'distance_km',
  };
  for (const [key, col] of Object.entries(map)) {
    if (fields[key] !== undefined) {
      const p = `c_${key}`;
      updates.push(`${col} = @${p}`);
      params[p] = fields[key];
    }
  }
  if (!updates.length) return;
  updates.push('updated_at = SYSUTCDATETIME()');
  await query(
    `UPDATE contractor_routes SET ${updates.join(', ')} WHERE id = @routeId AND tenant_id = @tenantId`,
    params
  );
}

/** Mirror distance onto regulations row when one exists (legacy column; route table is canonical). */
export async function syncDistanceToRegulations(query, tenantId, routeId, distanceKm) {
  if (distanceKm === undefined) return;
  await query(
    `UPDATE access_route_target_regulations
     SET distance_km = @distance_km, updated_at = SYSUTCDATETIME()
     WHERE tenant_id = @tenantId AND route_id = @routeId`,
    { tenantId, routeId, distance_km: distanceKm }
  );
}

export function effectiveDistanceKm(routeRow, regulationRow) {
  const fromRoute = routeRow?.distance_km ?? routeRow?.Distance_Km;
  if (fromRoute != null && fromRoute !== '') return Number(fromRoute);
  const fromReg = regulationRow?.distance_km ?? regulationRow?.Distance_Km;
  if (fromReg != null && fromReg !== '') return Number(fromReg);
  return null;
}
