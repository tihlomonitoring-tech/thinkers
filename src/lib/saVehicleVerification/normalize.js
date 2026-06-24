/** Normalize SA number plates for comparison (remove spaces, uppercase). */
export function normalizeSaPlate(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function normalizeVehicleText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\u00a0\-_/]+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Fuzzy compare application make/model against registry make + model + description. */
export function makeModelMatches(appMakeModel, { make, model, description } = {}) {
  const appNorm = normalizeVehicleText(appMakeModel);
  if (!appNorm) return null;
  const parts = [make, model, description].filter(Boolean).map(normalizeVehicleText).filter(Boolean);
  if (!parts.length) return null;
  const combined = parts.join('');
  if (appNorm === combined) return true;
  if (combined.includes(appNorm) || appNorm.includes(combined)) return true;
  const makeNorm = normalizeVehicleText(make);
  const modelNorm = normalizeVehicleText(model);
  if (makeNorm && modelNorm && appNorm.includes(makeNorm) && appNorm.includes(modelNorm)) return true;
  return false;
}

export function platesMatch(a, b) {
  const na = normalizeSaPlate(a);
  const nb = normalizeSaPlate(b);
  if (!na || !nb) return false;
  return na === nb;
}
