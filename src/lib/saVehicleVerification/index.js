import { mieConfigured, verifyDriverLicenseWithMie, verifyVehicleWithMie } from './providers/mie.js';
import { verifyVehicleWithNps } from './providers/nps.js';

function npsConfigured() {
  return !!String(process.env.NPS_API_TOKEN || '').trim();
}

/** Vehicle checks: NP Tracker by default; MIE optional later. */
export function getSaVerificationConfig() {
  const providerPref = String(process.env.SA_VERIFY_PROVIDER || 'nps').trim().toLowerCase();
  const mie = mieConfigured();
  const nps = npsConfigured();
  let vehicleProvider = null;
  if (providerPref === 'mie' && mie) vehicleProvider = 'mie';
  else if (providerPref === 'nps' && nps) vehicleProvider = 'nps';
  else if (providerPref === 'auto') {
    if (nps) vehicleProvider = 'nps';
    else if (mie) vehicleProvider = 'mie';
  } else if (providerPref === 'nps' || providerPref === 'mie') {
    vehicleProvider = null;
  }
  return {
    provider: vehicleProvider,
    vehicleProvider,
    driverProvider: mie ? 'mie' : null,
    mieConfigured: mie,
    npsConfigured: nps,
    configured: !!vehicleProvider,
    driverVerificationEnabled: mie,
    providerPreference: providerPref,
  };
}

export async function verifySaVehicle(input = {}) {
  const config = getSaVerificationConfig();
  if (!config.configured) {
    return {
      configured: false,
      provider: null,
      status: 'unavailable',
      message: 'Truck registration verification is not configured. Set NPS_API_TOKEN in server environment (register at npscloud.co.za).',
      checkedAt: new Date().toISOString(),
    };
  }
  try {
    if (config.vehicleProvider === 'mie') return await verifyVehicleWithMie(input);
    return await verifyVehicleWithNps(input);
  } catch (err) {
    if (err.code === 'NOT_CONFIGURED') {
      return {
        configured: false,
        provider: config.vehicleProvider,
        status: 'unavailable',
        message: err.message,
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      configured: true,
      provider: config.vehicleProvider,
      status: 'error',
      message: err.message || 'Verification request failed',
      checkedAt: new Date().toISOString(),
    };
  }
}

/** Driver checks deferred until MIE enterprise API is configured. */
export async function verifySaDriverLicense(input = {}) {
  if (mieConfigured()) {
    try {
      return await verifyDriverLicenseWithMie(input);
    } catch (err) {
      return {
        configured: true,
        provider: 'mie',
        status: 'error',
        message: err.message || 'MIE driver licence verification failed',
        checkedAt: new Date().toISOString(),
      };
    }
  }
  return {
    configured: false,
    provider: null,
    status: 'unavailable',
    message: 'Driver licence verification will be enabled when MIE API credentials are configured.',
    checkedAt: new Date().toISOString(),
  };
}
