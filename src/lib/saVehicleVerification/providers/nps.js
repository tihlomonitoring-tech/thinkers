import { makeModelMatches, normalizeSaPlate, platesMatch } from '../normalize.js';

const DEFAULT_BASE = 'https://api.nptracker.co.za';

function pick(obj, ...keys) {
  if (!obj) return undefined;
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== '') return obj[key];
    const lower = String(key).toLowerCase();
    for (const k of Object.keys(obj)) {
      if (k && String(k).toLowerCase() === lower && obj[k] != null && obj[k] !== '') return obj[k];
    }
  }
  return undefined;
}

function isMeaningfulNpsValue(value) {
  if (value == null) return false;
  const s = String(value).trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower === '-' || lower === 'undef' || lower === 'undefined' || lower === 'null' || lower === 'n/a' || lower === 'na' || lower === 'none') {
    return false;
  }
  return true;
}

function cleanNpsValue(value) {
  return isMeaningfulNpsValue(value) ? String(value).trim() : null;
}

function deepFindValue(obj, keyNames, depth = 0, seen = new Set()) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  if (seen.has(obj)) return null;
  seen.add(obj);

  for (const key of keyNames) {
    const v = pick(obj, key);
    if (isMeaningfulNpsValue(v)) return String(v).trim();
  }

  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') {
      const found = deepFindValue(val, keyNames, depth + 1, seen);
      if (found) return found;
    }
  }
  return null;
}

async function fetchNpsJson(path, params) {
  const base = (process.env.NPS_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  const token = String(process.env.NPS_API_TOKEN || '').trim();
  if (!token) {
    const err = new Error('NP Tracker API token not configured');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const url = new URL(`${base}${path}`);
  url.searchParams.set('token', token);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && String(v).trim() !== '') url.searchParams.set(k, String(v).trim());
  }
  const res = await fetch(url.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(pick(data, 'message', 'error', 'detail') || `NP Tracker request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function mapVcrResults(data, input) {
  const plate = deepFindValue(data, ['plate', 'Plate', 'registration', 'Registration', 'licence_plate', 'number_plate']);
  const make = deepFindValue(data, ['Make', 'make', 'manufacturer', 'Manufacturer']);
  const model = deepFindValue(data, ['Model', 'model']);
  const description = deepFindValue(data, ['Description', 'description', 'vehicle_description', 'VehicleDescription']);
  const vin = deepFindValue(data, ['VIN', 'vin', 'Vin', 'vin_number', 'VINNumber', 'chassis', 'Chassis']);
  const colour = deepFindValue(data, ['Colour', 'colour', 'color', 'Color']);
  const engineNumber = deepFindValue(data, ['Engine', 'engine', 'engine_number', 'EngineNumber']);
  const pictureUrl = deepFindValue(data, ['PictureURL', 'pictureUrl', 'picture_url', 'PictureUrl']);
  const sourceId = deepFindValue(data, ['SourceID', 'sourceId', 'source_id', 'SourceId']);
  const suspectDirect = pick(data, 'NPTracker', 'npTracker', 'suspect', 'Suspect');
  const suspectRaw = deepFindValue(data, ['NPTracker', 'npTracker', 'suspect', 'NP_TRACKER', 'Suspect']);
  const suspectFlag =
    suspectDirect === true ||
    suspectDirect === 1 ||
    suspectDirect === '1' ||
    suspectDirect === 'true' ||
    suspectRaw === 'true' ||
    suspectRaw === '1' ||
    suspectRaw === 'yes';

  const verified = {
    plate: cleanNpsValue(plate),
    vin: cleanNpsValue(vin),
    make: cleanNpsValue(make),
    model: cleanNpsValue(model),
    description: cleanNpsValue(description),
    colour: cleanNpsValue(colour),
    engineNumber: cleanNpsValue(engineNumber),
    sourceId: cleanNpsValue(sourceId),
    pictureUrl: cleanNpsValue(pictureUrl),
    licenseDiscExpiry: cleanNpsValue(deepFindValue(data, ['licenseDiscExpiry', 'LicenceDiscExpiry', 'disc_expiry'])),
    licenseDiscValid: null,
    suspectFlag,
  };

  const hasVehicleDetails = !!(verified.vin || verified.make || verified.model || verified.description);
  const hasPlate = !!verified.plate;
  const registryFound = hasVehicleDetails || hasPlate;

  return {
    provider: 'nps',
    registration: verified.plate || input.registration,
    verified,
    registryFound,
    registrationMatch: verified.plate ? platesMatch(verified.plate, input.registration) : null,
    makeModelMatch: makeModelMatches(input.makeModel, {
      make: verified.make,
      model: verified.model,
      description: verified.description,
    }),
    raw: data,
  };
}

/** Vehicle check by registration or VIN (NPS-VCR). */
export async function verifyVehicleWithNps({ registration, vin, makeModel }) {
  const vinregs = normalizeSaPlate(registration) || String(vin || '').trim().toUpperCase();
  if (!vinregs) {
    return {
      provider: 'nps',
      status: 'error',
      message: 'Registration number or VIN is required',
      configured: true,
    };
  }

  let data;
  try {
    data = await fetchNpsJson('/NPS-VCR/', { vinregs });
  } catch (err) {
    if (err.code === 'NOT_CONFIGURED') throw err;
    try {
      data = await fetchNpsJson('/NPS-VCR', { vinregs });
    } catch (err2) {
      throw err;
    }
  }

  const mapped = mapVcrResults(data, { registration: vinregs, makeModel });

  if (!mapped.registryFound) {
    return {
      ...mapped,
      configured: true,
      status: 'invalid',
      message: 'No matching vehicle found in the NP Tracker register for this registration',
      checkedAt: new Date().toISOString(),
      rawResponse: data,
    };
  }

  const { verified } = mapped;
  const hasDetails = !!(verified.vin || verified.make || verified.model || verified.description);

  let status = 'valid';
  let message = 'Registration verified against SA vehicle register (NP Tracker)';

  if (!hasDetails && verified.plate) {
    status = 'partial';
    message = 'Registration found on NP Tracker but full vehicle details (VIN, make, model) are not available for this plate yet';
  } else if (mapped.makeModelMatch === false) {
    status = 'mismatch';
    message = 'Registration exists but make/model does not match the application';
  }

  if (verified.suspectFlag) {
    message += ' — flagged on NP Tracker suspect database';
  }

  return {
    ...mapped,
    configured: true,
    status,
    message,
    checkedAt: new Date().toISOString(),
    rawResponse: data,
  };
}

/** Driver licence PDF417 decode (NPS-DL) — optional when barcode supplied later. */
export async function verifyDriverLicenseBarcodeWithNps({ barcode }) {
  const code = String(barcode || '').trim();
  if (!code) {
    return { provider: 'nps', configured: true, status: 'error', message: 'Licence barcode required for NP Tracker decode' };
  }
  const data = await fetchNpsJson('/NPS-DL/', { code });
  const results = pick(data, 'results') || data;
  const validTo = pick(results, 'ValidTo', 'validTo', 'valid_to');
  const expired = pick(results, 'expired');
  const licenseNumber = pick(results, 'LicenceNumber', 'licenceNumber', 'licenseNumber');
  const idNumber = pick(results, 'IDNumber', 'idNumber', 'id_number');
  const isExpired = expired === true || expired === 'true';
  return {
    provider: 'nps',
    configured: true,
    status: isExpired ? 'invalid' : 'valid',
    message: isExpired ? 'Licence expired according to barcode' : 'Licence barcode decoded successfully',
    verified: {
      licenseNumber: licenseNumber ? String(licenseNumber).trim() : null,
      idNumber: idNumber ? String(idNumber).trim() : null,
      licenseDiscExpiry: validTo ? String(validTo).trim() : null,
      licenseDiscValid: !isExpired,
    },
    checkedAt: new Date().toISOString(),
  };
}
