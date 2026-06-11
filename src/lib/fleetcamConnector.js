/**
 * FleetCam telematics — supports:
 * - GPSWOX / Laravel API (track.fleetcamonline.com): POST /api/login, GET /api/get_devices
 * - CMSV6 808GPS (legacy fleetcamonline.com): StandardApiAction_* (optional via extra_json.api_flavor=cmsv6)
 */

function parseExtra(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeRegistration(v) {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, '');
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function baseUrl(provider) {
  const extra = parseExtra(provider.extra_json);
  const raw = String(extra.api_base_url || provider.api_base_url || 'https://track.fleetcamonline.com').trim();
  return raw.replace(/\/$/, '');
}

function providerKey(provider) {
  return String(provider.id || `${provider.username}@${baseUrl(provider)}`);
}

function credentials(provider) {
  const email = String(provider.username || '').trim();
  const password = String(provider.api_secret || provider.api_key || '').trim();
  return { email, password };
}

/** @type {Map<string, { hash: string, at: number }>} */
const sessionCache = new Map();
const SESSION_TTL_MS = 25 * 60 * 1000;

async function httpJson(url, { method = 'GET', headers = {}, body } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...headers },
      body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Invalid JSON (${res.status})`);
    }
    if (!res.ok) {
      const msg = data?.message || data?.error || text.slice(0, 200);
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

function isGpswoxFlavor(provider) {
  const extra = parseExtra(provider.extra_json);
  if (String(extra.api_flavor || '').toLowerCase() === 'cmsv6') return false;
  const host = baseUrl(provider).toLowerCase();
  if (host.includes('track.fleetcamonline.com')) return true;
  if (String(extra.api_flavor || '').toLowerCase() === 'gpswox') return true;
  return !host.includes('808gps') && !host.includes('fleetcamonline.com/808gps');
}

async function loginGpswox(provider, { force = false } = {}) {
  const key = providerKey(provider);
  const cached = sessionCache.get(key);
  if (!force && cached && Date.now() - cached.at < SESSION_TTL_MS) return cached.hash;

  const { email, password } = credentials(provider);
  if (!email || !password) throw new Error('FleetCam email and password required');

  const data = await httpJson(`${baseUrl(provider)}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (Number(data?.status) !== 1 || !data?.user_api_hash) {
    throw new Error(data?.message || 'FleetCam login failed');
  }
  sessionCache.set(key, { hash: data.user_api_hash, at: Date.now() });
  return data.user_api_hash;
}

function flattenGpswoxDevices(groups) {
  const out = [];
  for (const group of groups || []) {
    for (const item of group.items || []) {
      out.push(item);
    }
  }
  return out;
}

function positionFromGpswoxItem(item) {
  const lat = num(item?.lat ?? item?.device_data?.lastValidLatitude ?? item?.device_data?.traccar?.lastValidLatitude);
  const lng = num(item?.lng ?? item?.device_data?.lastValidLongitude ?? item?.device_data?.traccar?.lastValidLongitude);
  if (lat == null || lng == null || (lat === 0 && lng === 0)) return null;

  const plate = item?.device_data?.plate_number || item?.name || '';
  const reg = normalizeRegistration(plate);
  let driver = item?.driver_data?.name || item?.driver;
  if (driver === '-') driver = null;

  return {
    external_id: String(item.id ?? ''),
    registration: reg,
    lat,
    lng,
    speed_kmh: num(item.speed),
    heading_deg: num(item.course),
    online: item.online,
    driver_name: driver && String(driver).trim() !== '-' ? String(driver).trim() : null,
    device_name: item.name || null,
    plate_number: item?.device_data?.plate_number || null,
  };
}

async function fetchGpswoxPositions(provider, vehicles) {
  let hash = await loginGpswox(provider);
  let url = `${baseUrl(provider)}/api/get_devices?user_api_hash=${encodeURIComponent(hash)}`;
  let groups = await httpJson(url);

  if (!Array.isArray(groups)) {
    await loginGpswox(provider, { force: true });
    hash = sessionCache.get(providerKey(provider))?.hash;
    url = `${baseUrl(provider)}/api/get_devices?user_api_hash=${encodeURIComponent(hash)}`;
    groups = await httpJson(url);
  }

  const allDevices = flattenGpswoxDevices(groups);
  const linkedIds = new Set(vehicles.filter((v) => v.external_vehicle_id).map((v) => String(v.external_vehicle_id)));
  const linkedRegs = new Set(vehicles.map((v) => normalizeRegistration(v.truck_registration)));

  const positions = [];
  for (const item of allDevices) {
    const pos = positionFromGpswoxItem(item);
    if (!pos) continue;
    const idMatch = linkedIds.size === 0 || linkedIds.has(pos.external_id);
    const regMatch = linkedRegs.has(pos.registration);
    if (!idMatch && !regMatch) continue;
    positions.push(pos);
  }
  return positions;
}

/** List all FleetCam devices for discovery / auto-link UI. */
export async function listFleetcamDevices(provider) {
  if (!isGpswoxFlavor(provider)) {
    return { flavor: 'cmsv6', devices: [], message: 'Device discovery only supported for track.fleetcamonline.com (GPSWOX API)' };
  }
  const hash = await loginGpswox(provider);
  const groups = await httpJson(`${baseUrl(provider)}/api/get_devices?user_api_hash=${encodeURIComponent(hash)}`);
  const devices = flattenGpswoxDevices(groups).map((item) => {
    const pos = positionFromGpswoxItem(item);
    return {
      id: String(item.id),
      name: item.name,
      plate_number: item?.device_data?.plate_number || null,
      registration: pos?.registration || normalizeRegistration(item?.device_data?.plate_number),
      online: item.online,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      object_owner: item?.device_data?.object_owner || null,
      group_id: item?.device_data?.pivot?.group_id || item?.group_id || null,
    };
  });
  return { flavor: 'gpswox', devices, groups: (groups || []).length };
}

export async function testFleetcamConnection(provider) {
  const { email, password } = credentials(provider);
  if (!email || !password) return { ok: false, error: 'Email and password required' };
  if (isGpswoxFlavor(provider)) {
    const hash = await loginGpswox(provider, { force: true });
    const groups = await httpJson(`${baseUrl(provider)}/api/get_devices?user_api_hash=${encodeURIComponent(hash)}`);
    const count = flattenGpswoxDevices(groups).length;
    return { ok: true, flavor: 'gpswox', device_count: count, base_url: baseUrl(provider) };
  }
  return { ok: false, error: 'CMSV6 FleetCam host not configured for this tenant yet' };
}

// ---- Legacy CMSV6 (808GPS) ----

async function loginCmsv6(provider) {
  const { email, password } = credentials(provider);
  const account = email;
  const url = `${baseUrl(provider)}/StandardApiAction_login.action?account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`;
  const data = await httpJson(url);
  if (Number(data?.result) !== 0 || !data?.jsession) {
    throw new Error(data?.message || 'CMSV6 login failed');
  }
  return data.jsession;
}

function scaledCoord(v) {
  const n = num(v);
  if (n == null || n === 0) return null;
  if (Math.abs(n) <= 180) return n;
  return n / 1_000_000;
}

async function fetchCmsv6Positions(provider, vehicles) {
  const jsession = await loginCmsv6(provider);
  const devIds = vehicles.map((v) => v.external_vehicle_id).filter(Boolean);
  const vehiIds = vehicles.filter((v) => !v.external_vehicle_id).map((v) => v.truck_registration).filter(Boolean);
  const params = new URLSearchParams({ jsession, toMap: '1' });
  if (devIds.length) params.set('devIdno', devIds.join(','));
  else if (vehiIds.length) params.set('vehiIdno', vehiIds.map((r) => String(r).trim()).join(','));
  else return [];

  const data = await httpJson(`${baseUrl(provider)}/StandardApiAction_getDeviceStatus.action?${params}`);
  if (Number(data?.result) !== 0) return [];

  return (data.status || [])
    .map((row) => {
      const lat = num(row.mlat) ?? scaledCoord(row.lat);
      const lng = num(row.mlng) ?? scaledCoord(row.lng);
      if (lat == null || lng == null) return null;
      const spd = num(row.sp);
      return {
        external_id: String(row.id ?? ''),
        registration: normalizeRegistration(row.vid),
        lat,
        lng,
        speed_kmh: spd != null ? spd / 10 : null,
        heading_deg: num(row.hx),
      };
    })
    .filter(Boolean);
}

export async function fetchFleetcamPositions(provider, vehicles) {
  try {
    if (isGpswoxFlavor(provider)) {
      return await fetchGpswoxPositions(provider, vehicles);
    }
    return await fetchCmsv6Positions(provider, vehicles);
  } catch (err) {
    console.warn('[fleetcamConnector]', baseUrl(provider), err?.message || err);
    return [];
  }
}
