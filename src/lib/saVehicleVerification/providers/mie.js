import { makeModelMatches, normalizeSaPlate, platesMatch } from '../normalize.js';

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

function mieConfigured() {
  const base = String(process.env.MIE_API_BASE_URL || '').trim();
  const key = String(process.env.MIE_API_KEY || process.env.MIE_API_TOKEN || '').trim();
  return !!(base && key);
}

async function mieRequest(path, body) {
  const base = String(process.env.MIE_API_BASE_URL || '').trim().replace(/\/$/, '');
  const key = String(process.env.MIE_API_KEY || process.env.MIE_API_TOKEN || '').trim();
  if (!base || !key) {
    const err = new Error('MIE API not configured');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const authHeader = String(process.env.MIE_API_AUTH_HEADER || 'Authorization').trim();
  const authScheme = String(process.env.MIE_API_AUTH_SCHEME || 'Bearer').trim();
  headers[authHeader] = authScheme ? `${authScheme} ${key}` : key;
  if (process.env.MIE_API_KEY_HEADER) {
    headers[String(process.env.MIE_API_KEY_HEADER).trim()] = key;
  }
  const res = await fetch(url, {
    method: String(process.env.MIE_API_METHOD || 'POST').toUpperCase(),
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(pick(data, 'message', 'error', 'detail') || `MIE request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function mapMieVehicleResponse(data, input) {
  const root = pick(data, 'data', 'result', 'vehicle', 'response') || data;
  const validRaw = pick(root, 'valid', 'verified', 'isValid', 'is_valid', 'success');
  const valid = validRaw === true || validRaw === 'true' || validRaw === 1 || validRaw === '1';
  const plate = pick(root, 'registration', 'registrationNumber', 'licensePlate', 'plate', 'licence_plate');
  const make = pick(root, 'make', 'vehicleMake');
  const model = pick(root, 'model', 'vehicleModel');
  const description = pick(root, 'description', 'vehicleDescription');
  const vin = pick(root, 'vin', 'VIN', 'chassisNumber', 'chassis_number');
  const colour = pick(root, 'colour', 'color');
  const engineNumber = pick(root, 'engineNumber', 'engine_number', 'engine');
  const discExpiry = pick(root, 'licenseDiscExpiry', 'licenceDiscExpiry', 'discExpiry', 'disc_expiry', 'license_disc_expiry');
  const discValidRaw = pick(root, 'licenseDiscValid', 'licenceDiscValid', 'discValid', 'disc_valid');
  const discValid = discValidRaw == null ? null : discValidRaw === true || discValidRaw === 'true' || discValidRaw === 1;
  const registryFound = valid || !!(vin || make || model || plate);
  return {
    provider: 'mie',
    registration: plate || input.registration,
    verified: {
      vin: vin ? String(vin).trim() : null,
      make: make ? String(make).trim() : null,
      model: model ? String(model).trim() : null,
      description: description ? String(description).trim() : null,
      colour: colour ? String(colour).trim() : null,
      engineNumber: engineNumber ? String(engineNumber).trim() : null,
      licenseDiscExpiry: discExpiry ? String(discExpiry).trim() : null,
      licenseDiscValid: discValid,
      pictureUrl: null,
      suspectFlag: null,
    },
    registryFound,
    registrationMatch: plate ? platesMatch(plate, input.registration) : null,
    makeModelMatch: makeModelMatches(input.makeModel, { make, model, description }),
  };
}

/** MIE vehicle registration / ownership check (enterprise REST — configure URL from MIE). */
export async function verifyVehicleWithMie({ registration, vin, makeModel, idNumber }) {
  const plate = normalizeSaPlate(registration);
  if (!plate && !vin) {
    return { provider: 'mie', configured: mieConfigured(), status: 'error', message: 'Registration number is required' };
  }
  const path = String(process.env.MIE_VEHICLE_PATH || '/vehicle/verify').trim();
  const body = {
    registrationNumber: plate,
    licensePlate: plate,
    registration: plate,
    vin: vin ? String(vin).trim() : undefined,
    idNumber: idNumber ? String(idNumber).trim() : undefined,
  };
  const data = await mieRequest(path, body);
  const mapped = mapMieVehicleResponse(data, { registration: plate, makeModel });
  if (!mapped.registryFound) {
    return {
      ...mapped,
      configured: true,
      status: 'invalid',
      message: pick(data, 'message') || 'Registration not verified by MIE',
      checkedAt: new Date().toISOString(),
    };
  }
  let status = 'valid';
  let message = pick(data, 'message') || 'Registration verified by MIE';
  if (mapped.verified.licenseDiscValid === false) {
    status = 'invalid';
    message = 'Vehicle licence disc expired according to MIE';
  } else if (mapped.makeModelMatch === false) {
    status = 'mismatch';
    message = 'Registration verified but make/model does not match the application';
  }
  return {
    ...mapped,
    configured: true,
    status,
    message,
    checkedAt: new Date().toISOString(),
  };
}

function mapMieDriverResponse(data, input) {
  const root = pick(data, 'data', 'result', 'license', 'licence', 'response') || data;
  const validRaw = pick(root, 'valid', 'verified', 'isValid', 'success');
  const valid = validRaw === true || validRaw === 'true' || validRaw === 1;
  const licenseNumber = pick(root, 'licenseNumber', 'licenceNumber', 'license_number');
  const idNumber = pick(root, 'idNumber', 'id_number', 'nationalId');
  const expiry = pick(root, 'expiryDate', 'expiry_date', 'licenseExpiry', 'licenceExpiry');
  const codes = pick(root, 'codes', 'licenseCodes', 'licenceCodes');
  const prdp = pick(root, 'prdpValid', 'prdp_valid', 'prdp');
  const isExpired = pick(root, 'expired') === true || pick(root, 'expired') === 'true';
  return {
    provider: 'mie',
    verified: {
      licenseNumber: licenseNumber ? String(licenseNumber).trim() : null,
      idNumber: idNumber ? String(idNumber).trim() : null,
      licenseDiscExpiry: expiry ? String(expiry).trim() : null,
      licenseDiscValid: valid && !isExpired,
      licenseCodes: codes ? String(codes).trim() : null,
      prdpValid: prdp == null ? null : prdp === true || prdp === 'true',
    },
    registryFound: valid,
    licenseMatch: licenseNumber && input.licenseNumber
      ? String(licenseNumber).replace(/\s/g, '') === String(input.licenseNumber).replace(/\s/g, '')
      : null,
    idMatch: idNumber && input.idNumber
      ? String(idNumber).replace(/\s/g, '') === String(input.idNumber).replace(/\s/g, '')
      : null,
  };
}

/** MIE driver licence / PrDP check. */
export async function verifyDriverLicenseWithMie({ licenseNumber, idNumber, surname }) {
  if (!licenseNumber && !idNumber) {
    return { provider: 'mie', configured: mieConfigured(), status: 'error', message: 'Licence number or ID number required' };
  }
  const path = String(process.env.MIE_DRIVER_LICENSE_PATH || '/driver-license/verify').trim();
  const body = {
    licenseNumber: licenseNumber ? String(licenseNumber).trim() : undefined,
    licenceNumber: licenseNumber ? String(licenseNumber).trim() : undefined,
    idNumber: idNumber ? String(idNumber).trim() : undefined,
    nationalId: idNumber ? String(idNumber).trim() : undefined,
    surname: surname ? String(surname).trim() : undefined,
  };
  const data = await mieRequest(path, body);
  const mapped = mapMieDriverResponse(data, { licenseNumber, idNumber });
  if (!mapped.registryFound) {
    return {
      ...mapped,
      configured: true,
      status: 'invalid',
      message: pick(data, 'message') || 'Driver licence not verified by MIE',
      checkedAt: new Date().toISOString(),
    };
  }
  let status = 'valid';
  let message = pick(data, 'message') || 'Driver licence verified by MIE';
  if (mapped.verified.licenseDiscValid === false) {
    status = 'invalid';
    message = 'Driver licence expired according to MIE';
  } else if (mapped.licenseMatch === false || mapped.idMatch === false) {
    status = 'mismatch';
    message = 'Licence verified but number/ID does not match the application';
  }
  return {
    ...mapped,
    configured: true,
    status,
    message,
    checkedAt: new Date().toISOString(),
  };
}

export { mieConfigured };
