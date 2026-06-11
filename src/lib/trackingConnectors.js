import { fetchFleetcamPositions as fetchFleetcamPositionsImpl } from './fleetcamConnector.js';

/**
 * Telematics provider connectors — Cartrack, FleetCam, configurable REST, and demo simulation.
 * Returns normalized positions: { external_id, registration, lat, lng, speed_kmh, heading_deg }
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

function dig(obj, path) {
  if (!path || !obj) return undefined;
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeRegistration(v) {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, '');
}

function authHeaders(provider) {
  const headers = { Accept: 'application/json' };
  const key = provider.api_key;
  const secret = provider.api_secret;
  const user = provider.username;
  const extra = parseExtra(provider.extra_json);
  const authType = String(extra.auth_type || 'bearer').toLowerCase();

  if (authType === 'basic' && user && secret) {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
  } else if (authType === 'api_key_header' && extra.api_key_header && key) {
    headers[extra.api_key_header] = key;
  } else if (key) {
    headers.Authorization = `${extra.auth_prefix || 'Bearer '}${key}`;
  } else if (user && secret) {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
  }
  return headers;
}

function mapListResponse(data, extra) {
  let list;
  if (extra.response_list_path) list = dig(data, extra.response_list_path);
  if (!Array.isArray(list)) {
    if (Array.isArray(data)) list = data;
    else if (Array.isArray(data?.vehicles)) list = data.vehicles;
    else if (Array.isArray(data?.data)) list = data.data;
    else if (Array.isArray(data?.results)) list = data.results;
    else list = [];
  }
  const fm = extra.field_map || {};
  const idF = fm.id || 'vehicle_id';
  const regF = fm.registration || 'registration';
  const latF = fm.lat || 'latitude';
  const lngF = fm.lng || 'longitude';
  const spdF = fm.speed || 'speed_kmh';
  const hdgF = fm.heading || 'heading';

  return list
    .map((row) => {
      const lat = num(dig(row, latF) ?? row.lat ?? row.latitude);
      const lng = num(dig(row, lngF) ?? row.lng ?? row.longitude ?? row.lon);
      if (lat == null || lng == null) return null;
      return {
        external_id: String(dig(row, idF) ?? row.id ?? row.vehicle_id ?? ''),
        registration: normalizeRegistration(dig(row, regF) ?? row.registration ?? row.reg ?? ''),
        lat,
        lng,
        speed_kmh: num(dig(row, spdF) ?? row.speed ?? row.speed_kmh),
        heading_deg: num(dig(row, hdgF) ?? row.heading ?? row.heading_deg),
      };
    })
    .filter(Boolean);
}

async function httpGetJson(url, headers, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchRestPositions(provider, vehicles) {
  const base = String(provider.api_base_url || '').trim().replace(/\/$/, '');
  if (!base || base.includes('demo.example.invalid')) return [];

  const extra = parseExtra(provider.extra_json);
  const path = extra.positions_url || extra.positions_path || '/vehicles/positions';
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  const data = await httpGetJson(url, authHeaders(provider));
  return mapListResponse(data, extra);
}

async function fetchCartrackPositions(provider, vehicles) {
  const extra = parseExtra(provider.extra_json);
  const base = String(provider.api_base_url || 'https://fleet.cartrack.com').trim().replace(/\/$/, '');
  const path = extra.positions_url || '/api/tracking/vehicles';
  try {
    return await fetchRestPositions({ ...provider, api_base_url: base, extra_json: { ...extra, positions_url: path, response_list_path: extra.response_list_path || 'data' } }, vehicles);
  } catch (err) {
    console.warn('[trackingConnectors] Cartrack fetch failed:', err?.message || err);
    return [];
  }
}

async function fetchFleetcamPositions(provider, vehicles) {
  try {
    return await fetchFleetcamPositionsImpl(provider, vehicles);
  } catch (err) {
    console.warn('[trackingConnectors] FleetCam fetch failed:', err?.message || err);
    return [];
  }
}

/** Demo / offline simulation — nudge positions for linked vehicles. */
export function simulateProviderPositions(provider, vehicles, tripByReg) {
  const out = [];
  const t = Date.now() / 9000;
  for (const v of vehicles) {
    const reg = normalizeRegistration(v.truck_registration);
    const trip = tripByReg.get(reg);
    let lat = trip?.last_lat != null ? Number(trip.last_lat) : -26.2;
    let lng = trip?.last_lng != null ? Number(trip.last_lng) : 28.05;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      lat = -26.2;
      lng = 28.05;
    }
    const seed = String(v.external_vehicle_id || v.id || reg).split('').reduce((s, c) => s + c.charCodeAt(0), 0);
    const rad = t + (seed % 100) * 0.01;
    lat += Math.sin(rad) * 0.002;
    lng += Math.cos(rad * 1.27) * 0.002;
    out.push({
      external_id: v.external_vehicle_id || v.id,
      registration: reg,
      lat,
      lng,
      speed_kmh: 52 + Math.round((Math.sin(rad * 2) + 1) * 15),
      heading_deg: ((Math.atan2(Math.cos(rad * 1.3), Math.sin(rad)) * 180) / Math.PI + 360) % 360,
      simulated: true,
    });
  }
  return out;
}

export async function fetchProviderPositions(provider, vehicles, { tripByReg = new Map(), allowSimulate = true } = {}) {
  const type = String(provider.provider_type || '').toLowerCase();
  const extra = parseExtra(provider.extra_json);
  const forceSim = extra.simulate === true || process.env.TRACKING_POLL_SIMULATE === '1';
  const isDemo = String(provider.display_name || '').toLowerCase().includes('demo')
    || String(provider.api_base_url || '').includes('demo.example.invalid');

  if (forceSim || isDemo || type === 'mock') {
    return simulateProviderPositions(provider, vehicles, tripByReg);
  }

  let positions = [];
  try {
    if (type === 'cartrack' || type === 'car_track') {
      positions = await fetchCartrackPositions(provider, vehicles);
    } else if (type === 'fleetcam') {
      positions = await fetchFleetcamPositions(provider, vehicles);
    } else if (type === 'custom_rest' || type === 'netstar' || type === 'bitrack' || type === 'ctrack' || type === 'tracker' || type === 'geotab' || type === 'mixtelematics') {
      positions = await fetchRestPositions(provider, vehicles);
    }
  } catch (err) {
    console.warn(`[trackingConnectors] ${type} ${provider.display_name}:`, err?.message || err);
  }

  if (!positions.length && allowSimulate && process.env.TRACKING_POLL_FALLBACK_SIMULATE === '1') {
    return simulateProviderPositions(provider, vehicles, tripByReg);
  }
  return positions;
}

export function matchPositionToVehicle(pos, vehicles) {
  const byExt = new Map(vehicles.filter((v) => v.external_vehicle_id).map((v) => [String(v.external_vehicle_id), v]));
  const byReg = new Map(vehicles.map((v) => [normalizeRegistration(v.truck_registration), v]));
  if (pos.external_id && byExt.has(String(pos.external_id))) return byExt.get(String(pos.external_id));
  if (pos.registration && byReg.has(pos.registration)) return byReg.get(pos.registration);
  return null;
}
