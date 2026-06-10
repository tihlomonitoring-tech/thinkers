/**
 * South African standard inspection checklist for side tipper coal trucks.
 * Based on SANS 10400, National Road Traffic Act 93 of 1996,
 * NRCS roadworthiness requirements, and AARTO regulations.
 */
export const SA_INSPECTION_CHECKLIST = [
  {
    category: 'Cab & exterior',
    items: [
      { code: 'CAB-01', label: 'Windscreen — no cracks, chips or damage impairing vision' },
      { code: 'CAB-02', label: 'Windscreen wipers & washers operational' },
      { code: 'CAB-03', label: 'All mirrors fitted, secure, and in good condition (rear-view, side)' },
      { code: 'CAB-04', label: 'Doors open, close, and latch securely' },
      { code: 'CAB-05', label: 'Steps and hand-holds clean, secure, and anti-slip' },
      { code: 'CAB-06', label: 'Cab interior clean and free of loose objects' },
      { code: 'CAB-07', label: 'Seats secure with functional seat belts' },
      { code: 'CAB-08', label: 'Sun visor(s) present and functional' },
      { code: 'CAB-09', label: 'Horn operational and audible' },
      { code: 'CAB-10', label: 'Registration plates visible, legible, and correctly fixed' },
    ],
  },
  {
    category: 'Lights & reflectors',
    items: [
      { code: 'LGT-01', label: 'Headlights (high & low beam) operational' },
      { code: 'LGT-02', label: 'Front park / position lights operational' },
      { code: 'LGT-03', label: 'Rear tail lights operational' },
      { code: 'LGT-04', label: 'Brake lights operational' },
      { code: 'LGT-05', label: 'Indicators / turn signals — front, side, rear' },
      { code: 'LGT-06', label: 'Hazard warning lights operational' },
      { code: 'LGT-07', label: 'Reverse light(s) operational' },
      { code: 'LGT-08', label: 'Side marker lights present and working' },
      { code: 'LGT-09', label: 'Chevron / retro-reflective markings (rear) — SANS 1329' },
      { code: 'LGT-10', label: 'Reflectors — red rear, amber side, white front' },
      { code: 'LGT-11', label: 'Number plate light operational' },
      { code: 'LGT-12', label: 'Rotating beacon / strobe light (if required)' },
    ],
  },
  {
    category: 'Engine & drivetrain',
    items: [
      { code: 'ENG-01', label: 'Engine oil level within range' },
      { code: 'ENG-02', label: 'Coolant level within range, no leaks' },
      { code: 'ENG-03', label: 'Power steering fluid level adequate' },
      { code: 'ENG-04', label: 'Fan belts — condition, tension, no cracks' },
      { code: 'ENG-05', label: 'Air filter indicator — clean / within service limit' },
      { code: 'ENG-06', label: 'No visible oil, fuel, or coolant leaks' },
      { code: 'ENG-07', label: 'Exhaust system secure, no leaks, no excessive smoke' },
      { code: 'ENG-08', label: 'Turbo / intercooler hoses secure and intact' },
      { code: 'ENG-09', label: 'Clutch operation smooth, no slip' },
      { code: 'ENG-10', label: 'Gearbox operation — smooth selection, no grinding' },
      { code: 'ENG-11', label: 'Driveshaft(s) — no play, guards in place' },
      { code: 'ENG-12', label: 'Differential — no leaks, oil level correct' },
    ],
  },
  {
    category: 'Brakes',
    items: [
      { code: 'BRK-01', label: 'Service brake — effective, no pull to one side' },
      { code: 'BRK-02', label: 'Parking / hand brake holds vehicle on incline' },
      { code: 'BRK-03', label: 'Air pressure builds to operating range (6–8 bar)' },
      { code: 'BRK-04', label: 'Low air pressure warning buzzer / light functional' },
      { code: 'BRK-05', label: 'Air lines — no leaks, couplings secure' },
      { code: 'BRK-06', label: 'Brake pads / linings — within wear limits' },
      { code: 'BRK-07', label: 'Brake drums / discs — no cracks, scoring within spec' },
      { code: 'BRK-08', label: 'ABS warning light — self-test passes, no fault' },
      { code: 'BRK-09', label: 'Trailer brake coupling and operation verified' },
      { code: 'BRK-10', label: 'Brake adjustment — S-cam / automatic adjusters' },
    ],
  },
  {
    category: 'Steering & suspension',
    items: [
      { code: 'STR-01', label: 'Steering free play within limits (NRT Act Reg 156)' },
      { code: 'STR-02', label: 'Power steering — no leaks, operates smoothly' },
      { code: 'STR-03', label: 'Steering linkage — no play, joints secure' },
      { code: 'STR-04', label: 'King pins and bushes — no excessive play' },
      { code: 'STR-05', label: 'Suspension springs — no broken leaves, cracks' },
      { code: 'STR-06', label: 'Air bags (if fitted) — inflated, no leaks' },
      { code: 'STR-07', label: 'Shock absorbers (if fitted) — functional, no leaks' },
      { code: 'STR-08', label: 'U-bolts and spring hangers secure' },
    ],
  },
  {
    category: 'Wheels & tyres',
    items: [
      { code: 'WHL-01', label: 'Tyre tread depth minimum 1 mm across full width (Reg 213)' },
      { code: 'WHL-02', label: 'No cuts, bulges, exposed cord, or sidewall damage' },
      { code: 'WHL-03', label: 'Tyre pressures correct for load' },
      { code: 'WHL-04', label: 'Matching tyre sizes on same axle' },
      { code: 'WHL-05', label: 'Wheel nuts / studs torqued, none missing' },
      { code: 'WHL-06', label: 'Wheel rims — no cracks, deformation' },
      { code: 'WHL-07', label: 'Spare wheel secure and serviceable' },
      { code: 'WHL-08', label: 'Mud-flaps fitted and in good condition' },
    ],
  },
  {
    category: 'Hydraulic system (side tipper)',
    items: [
      { code: 'HYD-01', label: 'Hydraulic oil level correct' },
      { code: 'HYD-02', label: 'No hydraulic leaks — cylinders, hoses, fittings' },
      { code: 'HYD-03', label: 'Tipping mechanism operates smoothly (left/right/up)' },
      { code: 'HYD-04', label: 'Hydraulic hoses — no chafing, bulging, or deterioration' },
      { code: 'HYD-05', label: 'PTO engagement and disengagement smooth' },
      { code: 'HYD-06', label: 'Safety prop / locking mechanism functional' },
      { code: 'HYD-07', label: 'Hydraulic ram pins and bushes — no excessive wear' },
      { code: 'HYD-08', label: 'Tipping controls — labelled, accessible, operational' },
    ],
  },
  {
    category: 'Body & chassis (side tipper)',
    items: [
      { code: 'BDY-01', label: 'Chassis — no cracks, bending, or corrosion' },
      { code: 'BDY-02', label: 'Cross-members secure and undamaged' },
      { code: 'BDY-03', label: 'Body / bin — no holes, cracks, or excessive wear' },
      { code: 'BDY-04', label: 'Tailgate / rear door — opens, closes, locks securely' },
      { code: 'BDY-05', label: 'Side tipper bin hinges and pivot points — condition' },
      { code: 'BDY-06', label: 'Load containment — no coal spillage risk on road' },
      { code: 'BDY-07', label: 'Sub-frame / turntable (if applicable) — secure' },
      { code: 'BDY-08', label: 'Fifth wheel / kingpin — no excessive wear, lubricated' },
      { code: 'BDY-09', label: 'Tow coupling (drawbar) — secure, safety chain fitted' },
    ],
  },
  {
    category: 'Electrical system',
    items: [
      { code: 'ELC-01', label: 'Battery secure, terminals clean, no corrosion' },
      { code: 'ELC-02', label: 'Battery isolator switch functional' },
      { code: 'ELC-03', label: 'Wiring — no exposed, chafed, or loose cables' },
      { code: 'ELC-04', label: 'Dashboard gauges and warning lights operational' },
      { code: 'ELC-05', label: 'Speedometer / tachograph / speed limiter functional (Reg 215A)' },
      { code: 'ELC-06', label: 'Reverse alarm / buzzer operational' },
    ],
  },
  {
    category: 'Safety equipment',
    items: [
      { code: 'SAF-01', label: 'Fire extinguisher — mounted, serviced, pressure OK (SANS 1910)' },
      { code: 'SAF-02', label: 'Warning triangles — 2 × reflective, in cab (Reg 212)' },
      { code: 'SAF-03', label: 'First aid kit present and stocked' },
      { code: 'SAF-04', label: 'Wheel chocks / scotches available' },
      { code: 'SAF-05', label: 'Spill kit available (coal spillage / hydraulic oil)' },
      { code: 'SAF-06', label: 'High-visibility vest available for driver' },
      { code: 'SAF-07', label: 'Jack and wheel spanner present' },
    ],
  },
  {
    category: 'Documentation & compliance',
    items: [
      { code: 'DOC-01', label: 'Valid motor vehicle licence disc displayed' },
      { code: 'DOC-02', label: 'Certificate of roadworthiness (if applicable)' },
      { code: 'DOC-03', label: 'Valid driver licence (correct code for vehicle)' },
      { code: 'DOC-04', label: 'Professional driving permit (PrDP) valid — goods' },
      { code: 'DOC-05', label: 'Abnormal load permit (if required for dimensions)' },
      { code: 'DOC-06', label: 'Cross-border permits (if applicable)' },
      { code: 'DOC-07', label: 'Weighbridge compliance — within legal GVM/GCM' },
      { code: 'DOC-08', label: 'Dangerous goods placards / labels (if required)' },
    ],
  },
  {
    category: 'Environmental & operational',
    items: [
      { code: 'ENV-01', label: 'No excessive exhaust smoke (Reg 234 — opacity limits)' },
      { code: 'ENV-02', label: 'No fuel leaks or drips' },
      { code: 'ENV-03', label: 'Coal load secured — no risk of road spillage' },
      { code: 'ENV-04', label: 'Dust suppression measures in place (if required on site)' },
      { code: 'ENV-05', label: 'Tracking / GPS device operational' },
      { code: 'ENV-06', label: 'Speed limiter set to ≤ 80 km/h (goods vehicle > 3500 kg)' },
    ],
  },
];

/** Governing bodies and standards referenced by the national side-tipper inspection checklist. */
export const SA_INSPECTION_GOVERNING_BODIES = [
  { body: 'Department of Transport (DoT)', role: 'National road traffic policy & heavy vehicle regulation' },
  { body: 'National Road Traffic Act 93 of 1996 (NRT Act)', role: 'Primary roadworthiness & vehicle fitness legislation' },
  { body: 'Road Traffic Management Corporation (RTMC)', role: 'National road safety & traffic law enforcement coordination' },
  { body: 'National Regulator for Compulsory Specifications (NRCS)', role: 'Roadworthiness & compulsory vehicle specifications' },
  { body: 'Administrative Adjudication of Road Traffic Offences (AARTO)', role: 'Traffic offence adjudication & demerit system' },
  { body: 'SANS 10400 / SANS 1329 / SANS 1910', role: 'Building, retro-reflective markings & fire extinguisher standards' },
];

export function flatChecklist() {
  let sort = 0;
  const items = [];
  for (const cat of SA_INSPECTION_CHECKLIST) {
    for (const it of cat.items) {
      items.push({ category: cat.category, ...it, sort_order: sort++ });
    }
  }
  return items;
}

export function computeResult(itemResults) {
  let passed = 0, failed = 0, na = 0, notChecked = 0;
  for (const r of itemResults) {
    const v = String(r.result || r).toLowerCase();
    if (v === 'pass') passed++;
    else if (v === 'fail') failed++;
    else if (v === 'n/a' || v === 'na') na++;
    else notChecked++;
  }
  const total = itemResults.length;
  const overall = notChecked > 0 ? 'incomplete' : failed > 0 ? 'fail' : 'pass';
  return { total, passed, failed, na, notChecked, overall };
}
