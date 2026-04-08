/**
 * Browser Geolocation API only — no third-party location services (cost-free).
 * @returns {{ latitude: number, longitude: number, accuracy_meters: number }}
 */
export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not supported in this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_meters: pos.coords.accuracy,
        });
      },
      (err) => {
        reject(err || new Error('Could not read location.'));
      },
      {
        enableHighAccuracy: true,
        timeout: options.timeout ?? 25000,
        maximumAge: 0,
        ...options,
      }
    );
  });
}
