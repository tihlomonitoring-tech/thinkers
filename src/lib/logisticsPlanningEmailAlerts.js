import { sendEmail, isEmailConfigured } from './emailService.js';
import { getLogisticsPlanningEmails } from './emailRecipients.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : null;
}

export async function getPlannerEmailPrefs(query, tenantId) {
  const r = await query(
    `SELECT notify_email_plan_published FROM logistics_planner_settings WHERE tenant_id = @tenantId`,
    { tenantId }
  );
  const row = r.recordset?.[0];
  if (!row) return { notify_email_plan_published: true };
  const val = get(row, 'notify_email_plan_published');
  return { notify_email_plan_published: val !== false && val !== 0 };
}

export async function sendLogisticsPlanningEmail({ query, tenantId, subject, body }) {
  if (!isEmailConfigured()) return;
  const prefs = await getPlannerEmailPrefs(query, tenantId);
  if (!prefs.notify_email_plan_published) return;
  const to = await getLogisticsPlanningEmails(query, tenantId);
  if (!to.length) return;
  await sendEmail({ to, subject, body, html: true }).catch((err) => {
    console.warn('[logisticsPlanningEmailAlerts] email failed:', err?.message || err);
  });
}

export async function sendPlanPublishedEmail({ query, tenantId, plan, routes, publishedBy }) {
  const primary = (routes || []).filter((r) => r.enabled && !r.is_plan_b);
  const routeList = primary
    .map((r) => `<li><strong>${r.route_name || 'Route'}</strong> — priority ${r.priority_rank}, expected ${r.expected_loads ?? '—'} loads${r.expected_margin != null ? `, est. margin R ${Number(r.expected_margin).toLocaleString('en-ZA')}` : ''}</li>`)
    .join('');
  const planDate = String(plan?.plan_date || '').slice(0, 10);
  const subject = `[Logistics Planning] Daily plan published — ${planDate}`;
  const body = `
    <p>A logistics plan has been published for <strong>${planDate}</strong>.</p>
    <ul>
      <li>Source: ${plan?.source === 'system_advise' ? 'System advise' : 'Manual planner'}</li>
      <li>Published by: ${publishedBy || '—'}</li>
      <li>Primary routes: ${primary.length}</li>
    </ul>
    ${routeList ? `<p><strong>Routes:</strong></p><ul>${routeList}</ul>` : ''}
    ${plan?.execution_notes ? `<p><strong>Execution notes:</strong> ${plan.execution_notes}</p>` : ''}
    <p>Tracking Management → Logistics activity → Schedule load will show these routes. Off-plan scheduling requires justification.</p>
    <p><em>Loads are verified via loading slips — capture slips before en route for accurate plan tracking.</em></p>
  `;
  await sendLogisticsPlanningEmail({ query, tenantId, subject, body });
}

export async function sendScheduleDeviationPlannerEmail({ query, tenantId, truckRegistration, routeName, justification }) {
  const prefs = await getPlannerEmailPrefs(query, tenantId);
  if (!prefs.notify_email_plan_published) return;
  const subject = `[Logistics Planning] Off-plan schedule — ${truckRegistration}`;
  const body = `
    <p><strong>${truckRegistration}</strong> was scheduled off-plan.</p>
    <ul>
      <li>Route selected: ${routeName || '—'}</li>
      <li>Justification: ${justification || '—'}</li>
      <li>Time: ${new Date().toISOString()}</li>
    </ul>
    <p>Review Plan management for adherence trends. System advise will factor this deviation into future recommendations.</p>
  `;
  await sendLogisticsPlanningEmail({ query, tenantId, subject, body });
}
