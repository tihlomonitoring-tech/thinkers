/** Client mirror of src/lib/routeRiskAssessment.js */

export const RISK_FACTOR_DEFS = [
  { id: 'road_surface', section: 'Road surface & geometry', items: [
    { id: 'surface_condition', label: 'Surface condition (paved / gravel / poor)' },
    { id: 'gradient', label: 'Gradient, passes & elevation change' },
    { id: 'curves', label: 'Sharp curves & sight distance' },
    { id: 'width', label: 'Lane width & turning constraints' },
  ]},
  { id: 'traffic_security', section: 'Traffic & security', items: [
    { id: 'traffic_density', label: 'Traffic density & congestion' },
    { id: 'crime_hijack', label: 'Crime / hijacking / theft exposure' },
    { id: 'blockades', label: 'Protest, blockade or unrest history' },
    { id: 'pedestrian', label: 'Pedestrian / informal crossing risk' },
  ]},
  { id: 'environmental', section: 'Environmental & weather', items: [
    { id: 'weather', label: 'Adverse weather exposure (rain, fog, wind)' },
    { id: 'flood', label: 'Flood, washaway or subsidence risk' },
    { id: 'dust_visibility', label: 'Dust, smoke or visibility impairment' },
  ]},
  { id: 'infrastructure', section: 'Infrastructure & compliance', items: [
    { id: 'bridges', label: 'Bridge / structure weight & height limits' },
    { id: 'tunnels', label: 'Tunnel / overhead restrictions' },
    { id: 'weighbridge', label: 'Weighbridge & compliance stops' },
    { id: 'roadworks', label: 'Roadworks / temporary deviations' },
  ]},
  { id: 'operational', section: 'Operational haulage', items: [
    { id: 'night_travel', label: 'Night travel necessity & lighting' },
    { id: 'load_spill', label: 'Load spill / contamination risk' },
    { id: 'fatigue', label: 'Driver fatigue (distance without rest)' },
    { id: 'escort', label: 'Escort / convoy requirements' },
  ]},
  { id: 'emergency', section: 'Emergency response', items: [
    { id: 'medical', label: 'Proximity to medical / trauma facility' },
    { id: 'recovery', label: 'Breakdown recovery & tow access' },
    { id: 'comms', label: 'Mobile / radio communication coverage' },
  ]},
];

export const SCORE_LABELS = { 1: 'Minimal', 2: 'Low', 3: 'Moderate', 4: 'High', 5: 'Severe' };

export function defaultRiskAssessment() {
  const scores = {};
  const mitigations = {};
  const notes = {};
  for (const sec of RISK_FACTOR_DEFS) {
    for (const item of sec.items) {
      scores[item.id] = 2;
      mitigations[item.id] = '';
      notes[item.id] = '';
    }
  }
  return {
    version: 1,
    corridor_summary: '',
    hazards_identified: '',
    control_measures: '',
    emergency_plan: '',
    escort_required: false,
    night_travel_allowed: true,
    recommended_max_speed_kmh: null,
    review_due_date: null,
    assessor_name: '',
    assessor_role: '',
    scores,
    mitigations,
    notes,
  };
}

export function computeRiskAssessment(assessment = {}) {
  const scores = assessment.scores || {};
  const values = Object.values(scores).map((v) => Number(v)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const rounded = avg != null ? Math.round(avg * 100) / 100 : null;

  let level = 'not_assessed';
  let levelLabel = 'Not assessed';
  if (rounded != null) {
    if (rounded >= 3.75) { level = 'critical'; levelLabel = 'Critical'; }
    else if (rounded >= 3.0) { level = 'high'; levelLabel = 'High'; }
    else if (rounded >= 2.25) { level = 'medium'; levelLabel = 'Medium'; }
    else { level = 'low'; levelLabel = 'Low'; }
  }

  const topRisks = Object.entries(scores)
    .map(([id, score]) => {
      const item = RISK_FACTOR_DEFS.flatMap((s) => s.items).find((i) => i.id === id);
      return { id, label: item?.label || id, score: Number(score) || 0, mitigation: assessment.mitigations?.[id] || '' };
    })
    .filter((r) => r.score >= 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const recommendations = [];
  if (level === 'critical' || level === 'high') {
    recommendations.push('Route requires documented control measures and management sign-off before night travel or peak-risk periods.');
  }
  if (assessment.escort_required) {
    recommendations.push('Armed or traffic escort is mandated for this corridor.');
  }
  if (!assessment.night_travel_allowed) {
    recommendations.push('Night travel is not permitted on this route until controls are verified.');
  }
  for (const r of topRisks) {
    if (!r.mitigation?.trim()) {
      recommendations.push(`Define mitigation for: ${r.label} (score ${r.score}/5).`);
    }
  }
  if (rounded != null && rounded >= 3 && !assessment.emergency_plan?.trim()) {
    recommendations.push('Document emergency response plan including nearest medical and recovery contacts.');
  }

  return {
    average_score: rounded,
    max_score: values.length ? Math.max(...values) : null,
    level,
    level_label: levelLabel,
    top_risks: topRisks,
    recommendations,
    factors_assessed: values.length,
  };
}

export function mergeRiskAssessment(existing) {
  const base = defaultRiskAssessment();
  if (!existing) return base;
  return {
    ...base,
    ...existing,
    scores: { ...base.scores, ...(existing.scores || {}) },
    mitigations: { ...base.mitigations, ...(existing.mitigations || {}) },
    notes: { ...base.notes, ...(existing.notes || {}) },
  };
}
