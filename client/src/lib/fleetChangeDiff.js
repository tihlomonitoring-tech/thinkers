/** Labels for truck fields in fleet change request diffs. */
export const TRUCK_CHANGE_FIELD_LABELS = {
  registration: 'Registration',
  main_contractor: 'Main contractor',
  sub_contractor: 'Sub-contractor',
  make_model: 'Make / model',
  year_model: 'Year model',
  ownership_desc: 'Ownership',
  fleet_no: 'Fleet number',
  trailer_1_reg_no: 'Trailer 1 reg',
  trailer_2_reg_no: 'Trailer 2 reg',
  tracking_provider: 'Tracking provider',
  tracking_username: 'Tracking username',
  tracking_password: 'Tracking password',
  commodity_type: 'Commodity type',
  capacity_tonnes: 'Capacity (tonnes)',
  fuel_tank_capacity_litres: 'Fuel tank capacity (L)',
  fuel_consumption_litres_per_100km: 'Fuel consumption (L/100 km)',
  status: 'Status',
};

const TRUCK_CHANGE_FIELD_ORDER = Object.keys(TRUCK_CHANGE_FIELD_LABELS);

function normVal(key, v) {
  if (v == null || v === '') return '';
  if (key === 'tracking_password') return v ? '••••••••' : '';
  return String(v).trim();
}

/** Rows where previous !== proposed (password only if new value provided). */
export function computeTruckChangeRows(previous = {}, proposed = {}) {
  const rows = [];
  for (const key of TRUCK_CHANGE_FIELD_ORDER) {
    const before = normVal(key, previous[key]);
    const after = normVal(key, proposed[key]);
    if (key === 'tracking_password') {
      const newPwd = proposed[key] != null && String(proposed[key]).trim() !== '' && proposed[key] !== previous[key];
      if (!newPwd && before === after) continue;
      if (!newPwd) continue;
      rows.push({
        key,
        label: TRUCK_CHANGE_FIELD_LABELS[key] || key,
        before: before || '(unchanged)',
        after: '•••••••• (updated)',
      });
      continue;
    }
    if (before !== after) {
      rows.push({
        key,
        label: TRUCK_CHANGE_FIELD_LABELS[key] || key,
        before: before || '—',
        after: after || '—',
      });
    }
  }
  return rows;
}

export function parsePendingChangeJson(truck) {
  const pc = truck?.pending_change || {};
  let previous = pc.previous;
  let proposed = pc.proposed;
  if (!previous && truck?.pending_change_previous_json) {
    try { previous = JSON.parse(truck.pending_change_previous_json); } catch (_) {}
  }
  if (!proposed && truck?.pending_change_proposed_json) {
    try { proposed = JSON.parse(truck.pending_change_proposed_json); } catch (_) {}
  }
  return { previous: previous || {}, proposed: proposed || {} };
}
