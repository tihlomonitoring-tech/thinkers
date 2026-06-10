/** Vehicle inspection compliance scoring and recommendations. */

export const INSPECTION_OVERDUE_DAYS = 30;
export const INSPECTION_WARNING_DAYS = 14;
export const BREAKDOWN_WINDOW_DAYS = 90;
export const LOW_SCORE_THRESHOLD = 70;
export const CRITICAL_SCORE_THRESHOLD = 50;

export function computeInspectionScore(passed, failed, total) {
  const p = Number(passed) || 0;
  const f = Number(failed) || 0;
  const t = Number(total) || 0;
  const checked = p + f;
  if (checked <= 0) return null;
  return Math.round((p / checked) * 100);
}

export function scoreRating(score) {
  if (score == null) return 'Unknown';
  if (score >= 95) return 'Excellent';
  if (score >= 85) return 'Good';
  if (score >= 70) return 'Fair';
  if (score >= 50) return 'Poor';
  return 'Critical';
}

export function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

export function breakdownTrend(recent30, prev30) {
  const r = Number(recent30) || 0;
  const p = Number(prev30) || 0;
  if (r === 0 && p === 0) return 'stable';
  if (r > p && r >= 2) return 'increasing';
  if (r < p) return 'decreasing';
  return 'stable';
}

/**
 * @param {object} row - truck row with inspection + breakdown fields
 */
export function assessTruckCompliance(row) {
  const score = computeInspectionScore(row.passed_items, row.failed_items, row.total_items);
  const rating = scoreRating(score);
  const daysSinceInspection = daysSince(row.last_inspection_date);
  const bd90 = Number(row.breakdown_count_90d) || 0;
  const bd30 = Number(row.breakdown_count_30d) || 0;
  const bdPrev30 = Number(row.breakdown_count_prev_30d) || 0;
  const trend = breakdownTrend(bd30, bdPrev30);
  const lastResult = (row.last_inspection_result || '').toLowerCase();
  const neverInspected = !row.last_inspection_date;
  const overdue = neverInspected || (daysSinceInspection != null && daysSinceInspection > INSPECTION_OVERDUE_DAYS);
  const failedInspection = lastResult === 'fail';
  const isSuspended = !!row.is_suspended;

  const recommendations = [];
  let riskLevel = 'low';

  if (neverInspected) {
    recommendations.push({ code: 'never_inspected', severity: 'high', message: 'No inspection on record — schedule immediately.' });
  }
  if (overdue && !neverInspected) {
    recommendations.push({ code: 'overdue_inspection', severity: daysSinceInspection > 60 ? 'critical' : 'high', message: `Last inspected ${daysSinceInspection} days ago (overdue).` });
  }
  if (failedInspection) {
    recommendations.push({ code: 'failed_inspection', severity: 'critical', message: 'Latest inspection result: FAIL.' });
  }
  if (score != null && score < LOW_SCORE_THRESHOLD) {
    recommendations.push({ code: 'low_score', severity: score < CRITICAL_SCORE_THRESHOLD ? 'critical' : 'high', message: `Inspection score ${score}% (${rating}) — below acceptable threshold.` });
  }
  if (bd90 >= 3) {
    recommendations.push({ code: 'high_breakdowns', severity: 'high', message: `${bd90} breakdown(s) in the last 90 days.` });
  } else if (bd90 >= 1) {
    recommendations.push({ code: 'breakdown_history', severity: 'medium', message: `${bd90} breakdown(s) in the last 90 days.` });
  }
  if (trend === 'increasing') {
    recommendations.push({ code: 'increasing_breakdowns', severity: 'high', message: 'Breakdown frequency is increasing (last 30 days vs prior 30 days).' });
  }

  const forceSuspend =
    failedInspection && score != null && score < LOW_SCORE_THRESHOLD
    || (trend === 'increasing' && (failedInspection || (score != null && score < LOW_SCORE_THRESHOLD)))
    || (neverInspected && bd90 >= 3)
    || (overdue && daysSinceInspection > 60 && bd90 >= 2);

  if (forceSuspend) {
    recommendations.push({ code: 'force_suspend', severity: 'critical', message: 'Mandatory suspension review — failed/low score inspection or worsening breakdown trend.' });
  } else if (overdue || failedInspection || (score != null && score < LOW_SCORE_THRESHOLD) || bd90 >= 2) {
    recommendations.push({ code: 'recommend_suspend', severity: 'high', message: 'Suspension recommended pending haulier response.' });
  }

  if (recommendations.some((r) => ['overdue_inspection', 'failed_inspection', 'low_score', 'never_inspected'].includes(r.code))) {
    recommendations.push({ code: 'notify_haulier', severity: 'medium', message: 'Notify haulier and CC relevant rectors.' });
  }

  if (failedInspection || overdue || (score != null && score < 85)) {
    riskLevel = 'medium';
  }
  if (failedInspection || (score != null && score < LOW_SCORE_THRESHOLD) || overdue || bd90 >= 2 || trend === 'increasing') {
    riskLevel = 'high';
  }
  if (forceSuspend || (score != null && score < CRITICAL_SCORE_THRESHOLD) || (neverInspected && bd90 >= 3)) {
    riskLevel = 'critical';
  }
  if (isSuspended) {
    riskLevel = 'critical';
  }

  return {
    inspection_score: score,
    inspection_rating: rating,
    days_since_inspection: daysSinceInspection,
    never_inspected: neverInspected,
    overdue,
    failed_inspection: failedInspection,
    breakdown_count_90d: bd90,
    breakdown_count_30d: bd30,
    breakdown_count_prev_30d: bdPrev30,
    breakdown_trend: trend,
    risk_level: riskLevel,
    recommendations,
    force_suspend: forceSuspend,
    is_suspended: isSuspended,
  };
}

export function mapTruckRow(row) {
  const assessment = assessTruckCompliance(row);
  return {
    truck_id: row.truck_id,
    registration: row.registration,
    make_model: row.make_model,
    fleet_no: row.fleet_no,
    contractor_id: row.contractor_id,
    contractor_name: row.contractor_name,
    sub_contractor: row.sub_contractor,
    tenant_id: row.tenant_id,
    tenant_name: row.tenant_name,
    last_inspection_date: row.last_inspection_date,
    last_inspection_result: row.last_inspection_result,
    last_inspection_ref: row.last_inspection_ref,
    last_inspection_source: row.last_inspection_source,
    passed_items: row.passed_items,
    failed_items: row.failed_items,
    total_items: row.total_items,
    ...assessment,
  };
}

export function buildHaulierSummary(trucks) {
  const byContractor = new Map();
  for (const t of trucks) {
    const key = t.contractor_id || 'unknown';
    if (!byContractor.has(key)) {
      byContractor.set(key, {
        contractor_id: t.contractor_id,
        contractor_name: t.contractor_name || 'Unknown haulier',
        truck_count: 0,
        inspected_count: 0,
        overdue_count: 0,
        failed_count: 0,
        high_risk_count: 0,
        critical_risk_count: 0,
        suspended_count: 0,
        avg_score: null,
        score_sum: 0,
        score_n: 0,
        trucks: [],
      });
    }
    const h = byContractor.get(key);
    h.truck_count += 1;
    h.trucks.push(t);
    if (!t.never_inspected) h.inspected_count += 1;
    if (t.overdue) h.overdue_count += 1;
    if (t.failed_inspection) h.failed_count += 1;
    if (t.risk_level === 'high') h.high_risk_count += 1;
    if (t.risk_level === 'critical') h.critical_risk_count += 1;
    if (t.is_suspended) h.suspended_count += 1;
    if (t.inspection_score != null) {
      h.score_sum += t.inspection_score;
      h.score_n += 1;
    }
  }
  return Array.from(byContractor.values()).map((h) => ({
    ...h,
    avg_score: h.score_n > 0 ? Math.round(h.score_sum / h.score_n) : null,
    trucks: undefined,
  })).sort((a, b) => a.contractor_name.localeCompare(b.contractor_name));
}

export function buildSummary(trucks) {
  const scores = trucks.filter((t) => t.inspection_score != null).map((t) => t.inspection_score);
  return {
    total_trucks: trucks.length,
    inspected: trucks.filter((t) => !t.never_inspected).length,
    overdue: trucks.filter((t) => t.overdue).length,
    failed: trucks.filter((t) => t.failed_inspection).length,
    high_risk: trucks.filter((t) => t.risk_level === 'high').length,
    critical_risk: trucks.filter((t) => t.risk_level === 'critical').length,
    suspended: trucks.filter((t) => t.is_suspended).length,
    force_suspend: trucks.filter((t) => t.force_suspend && !t.is_suspended).length,
    avg_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
  };
}
