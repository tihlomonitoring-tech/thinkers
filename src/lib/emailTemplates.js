/**
 * HTML email templates for notifications.
 * Charcoal theme for breakdown report; clean layout for confirmations.
 */

const wrap = (content, title, options = {}) => {
  const charcoal = options.charcoal !== false;
  const bg = charcoal ? '#2d3748' : '#f7fafc';
  const cardBg = charcoal ? '#1a202c' : '#ffffff';
  const text = charcoal ? '#e2e8f0' : '#2d3748';
  const muted = charcoal ? '#a0aec0' : '#718096';
  const accent = '#3182ce';
  const font = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${bg};font-family:${font};color:${text};font-size:15px;line-height:1.5;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:${cardBg};border-radius:12px;padding:28px;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
      ${content}
    </div>
    <p style="text-align:center;color:${muted};font-size:12px;margin-top:20px;">Thinkers · Fleet & logistics</p>
  </div>
</body>
</html>`;
};

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BORDER_COLOR = '#b4b4b4';
const ROW_STYLE = `padding:10px 12px;border:1px solid ${BORDER_COLOR};vertical-align:top;`;
const LABEL_STYLE = `width:38%;font-weight:bold;color:#212121;font-size:13px;${ROW_STYLE}`;
const VALUE_STYLE = `color:#505050;font-size:13px;white-space:pre-wrap;word-break:break-word;${ROW_STYLE}`;

function sectionBar(title) {
  return `<div style="background:#000;color:#fff;padding:8px 12px;margin:0 0 0;font-size:12px;font-weight:bold;letter-spacing:0.05em;">${escapeHtml(title)}</div>`;
}

function keyValueRow(label, value) {
  if (value == null || value === '') value = '—';
  return `<tr><td style="${LABEL_STYLE}">${escapeHtml(String(label))}</td><td style="${VALUE_STYLE}">${escapeHtml(String(value))}</td></tr>`;
}

function keyValueTable(rows) {
  const body = rows.map(([label, value]) => keyValueRow(label, value)).join('');
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 16px;border:1px solid ${BORDER_COLOR};"><tbody>${body}</tbody></table>`;
}

/** Full breakdown report for CC + Rector – shift report style: section bars + key-value tables. */
export function breakdownReportHtml(data) {
  const {
    driverName,
    truckRegistration,
    routeName,
    reportedAt,
    location,
    type,
    title,
    description,
    severity,
    actionsTaken,
    incidentId,
    contractorName,
    tenantName,
  } = data;

  const incidentDetails = [
    ['Reference ID', incidentId],
    ['Company (contractor)', contractorName || tenantName || '—'],
    ['Type', type],
    ['Title', title],
    ['Severity', severity],
    ['Reported at', reportedAt],
    ['Location', location],
    ['Route', routeName],
    ['Driver', driverName],
    ['Truck', truckRegistration],
  ].filter(([, v]) => v != null && v !== '');

  const content = `
    <div style="margin-bottom:20px;">
      <div style="background:#000;color:#fff;padding:12px 16px;text-align:center;font-size:18px;font-weight:bold;letter-spacing:0.05em;">BREAKDOWN REPORT</div>
      <p style="margin:10px 0 0;color:#505050;font-size:13px;text-align:center;">External driver report · Thinkers</p>
      <div style="border:1px solid ${BORDER_COLOR};border-top:none;height:2px;margin:0 0 20px;"></div>
    </div>

    ${sectionBar('Incident details')}
    ${keyValueTable(incidentDetails)}

    ${(description || actionsTaken) ? `
    ${sectionBar('Description & actions')}
    ${keyValueTable([
      ...(description ? [['Description', description]] : []),
      ...(actionsTaken ? [['Actions taken', actionsTaken]] : []),
    ].filter(Boolean))}
    ` : ''}

    <div style="margin-top:20px;padding:12px;background:#f5f5f5;border:1px solid ${BORDER_COLOR};font-size:12px;color:#505050;">
      <strong>Attachments</strong> (loading slip, seals, picture of problem) are stored in the system. Log in to Command Centre or Contractor to view and manage this incident.
    </div>
  `;
  return wrap(content, 'Breakdown reported', { charcoal: false });
}

/** Confirmation to driver who reported breakdown + how to resolve. */
export function breakdownConfirmationToDriverHtml(driverName) {
  const content = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#2d3748;">Breakdown reported successfully</h1>
    <p style="margin:0 0 16px;">Hi ${escapeHtml(driverName || 'there')},</p>
    <p style="margin:0 0 16px;">Your breakdown report has been received and logged. Command Centre and route managers have been notified.</p>
    <h2 style="margin:24px 0 12px;font-size:16px;color:#2d3748;">When the truck is fixed</h2>
    <p style="margin:0 0 8px;">To resolve this breakdown in the system:</p>
    <ol style="margin:0 0 16px;padding-left:20px;">
      <li>Log in to the <strong>Contractor</strong> portal with your company account.</li>
      <li>Go to <strong>Incidents / breakdowns</strong> (or the relevant section where incidents are listed).</li>
      <li>Find this breakdown and open it.</li>
      <li>Use the <strong>Resolve</strong> or <strong>Mark as resolved</strong> option and upload the offloading slip if required.</li>
    </ol>
    <p style="margin:0;color:#718096;font-size:14px;">If you need help, contact your fleet manager or Command Centre.</p>
  `;
  return wrap(content, 'Breakdown reported successfully', { charcoal: false });
}

/** Notification to CC + Rector: new fleet or driver addition (single or list). Use contractorName for the company; tenantName as fallback. */
export function newFleetDriverNotificationHtml({ type, tenantName, contractorName, list, action = 'added' }) {
  const label = type === 'truck' ? 'Fleet' : 'Driver';
  const companyName = (contractorName && String(contractorName).trim()) || (tenantName && String(tenantName).trim()) || 'Unknown';
  const listHtml = Array.isArray(list) && list.length > 0
    ? `<ul style="margin:8px 0 0;padding-left:20px;">${list.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('')}</ul>`
    : '<p style="margin:8px 0 0;">—</p>';
  const content = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#2d3748;">New ${label} ${action}</h1>
    <p style="margin:0 0 12px;">Contractor company <strong>${escapeHtml(companyName)}</strong>${tenantName && contractorName && String(tenantName) !== String(contractorName) ? ` (tenant: ${escapeHtml(tenantName)})` : ''} has ${action} the following ${type === 'truck' ? 'fleet registration(s)' : 'driver(s)'}:</p>
    ${listHtml}
    <p style="margin:16px 0 0;color:#718096;font-size:14px;">Review in Command Centre → Fleet & driver applications.</p>
  `;
  return wrap(content, `New ${label} ${action}`, { charcoal: false });
}

/** Confirmation to contractor who added fleet/driver. contractorName optional (company name). */
export function newFleetDriverConfirmationHtml({ type, list, action = 'added', contractorName }) {
  const label = type === 'truck' ? 'Fleet' : 'Driver';
  const listHtml = Array.isArray(list) && list.length > 0
    ? `<ul style="margin:8px 0 0;padding-left:20px;">${list.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('')}</ul>`
    : '';
  const companyLine = (contractorName && String(contractorName).trim()) ? `<p style="margin:0 0 12px;">Company: <strong>${escapeHtml(contractorName)}</strong></p>` : '';
  const content = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#2d3748;">${label} ${action} successfully</h1>
    <p style="margin:0 0 12px;">Your ${type === 'truck' ? 'fleet' : 'driver'} addition has been recorded and sent to Command Centre for review.</p>
    ${companyLine}
    ${listHtml ? `<p style="margin:12px 0 0;"><strong>${label}(s):</strong></p>${listHtml}` : ''}
    <p style="margin:16px 0 0;color:#718096;font-size:14px;">Once approved, you can enroll ${type === 'truck' ? 'the truck' : 'the driver'} on the route.</p>
  `;
  return wrap(content, `${label} ${action} successfully`, { charcoal: false });
}

/** Breakdown resolved: notify rector, driver, contractor. contractorName = company (contractor) name. */
export function breakdownResolvedHtml(data) {
  const { ref, title, driverName, truckRegistration, routeName, resolutionNote, resolvedAt, contractorName } = data;
  const rows = [
    ['Reference', ref],
    ['Title', title],
    ['Company (contractor)', contractorName],
    ['Driver', driverName],
    ['Truck', truckRegistration],
    ['Route', routeName],
    ['Resolved at', resolvedAt],
    ['Resolution note', resolutionNote],
  ].filter(([, v]) => v != null && v !== '');
  const content = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#2d3748;">Breakdown resolved</h1>
    <p style="margin:0 0 16px;">The following breakdown has been marked as resolved in Command Centre.</p>
    ${sectionBar('Resolution details')}
    ${keyValueTable(rows)}
    <p style="margin:16px 0 0;color:#718096;font-size:14px;">You can view and download the full report from Command Centre or the Contractor portal.</p>
  `;
  return wrap(content, 'Breakdown resolved', { charcoal: false });
}

/** Trucks enrolled on route: notify Access Management users. */
export function trucksEnrolledOnRouteHtml({ tenantName, routeName, registrations, appUrl }) {
  const listHtml = Array.isArray(registrations) && registrations.length > 0
    ? `<ul style="margin:8px 0 0;padding-left:20px;">${registrations.map((r) => `<li>${escapeHtml(String(r))}</li>`).join('')}</ul>`
    : '<p style="margin:8px 0 0;">—</p>';
  const link = appUrl ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(appUrl)}" style="color:#3182ce;">Open Access Management</a></p>` : '';
  const content = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#2d3748;">Trucks enrolled on route</h1>
    <p style="margin:0 0 12px;">Contractor <strong>${escapeHtml(tenantName || 'Unknown')}</strong> has enrolled the following truck(s) on route <strong>${escapeHtml(routeName || 'Unknown')}</strong>:</p>
    ${listHtml}
    <p style="margin:16px 0 0;color:#718096;font-size:14px;">You can view and manage routes in Access Management.</p>
    ${link}
  `;
  return wrap(content, 'Trucks enrolled on route', { charcoal: false });
}

/** Application approved: truck/driver can now be enrolled on route. contractorName = company name. */
export function applicationApprovedHtml({ entityType, entityLabel, tenantName, contractorName }) {
  const label = entityType === 'truck' ? 'Truck' : 'Driver';
  const companyName = (contractorName && String(contractorName).trim()) || (tenantName && String(tenantName).trim()) || 'your company';
  const content = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#2d3748;">${label} approved</h1>
    <p style="margin:0 0 12px;">Good news — the application for <strong>${escapeHtml(entityLabel || label)}</strong> (company: <strong>${escapeHtml(companyName)}</strong>) has been approved.</p>
    <p style="margin:0 0 12px;">You can now enroll this ${entityType === 'truck' ? 'truck' : 'driver'} on the route in the Contractor portal.</p>
    <p style="margin:16px 0 0;color:#718096;font-size:14px;">Log in to the Contractor section and complete route enrollment for this ${entityType === 'truck' ? 'vehicle' : 'driver'}.</p>
  `;
  return wrap(content, `${label} approved`, { charcoal: false });
}

/** Bulk applications approved: one email listing all approved items with contractor names. */
export function applicationBulkApprovedHtml({ items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return wrap('<p>No items.</p>', 'Applications approved', { charcoal: false });
  }
  const listHtml = items.map((item) => {
    const label = (item.entityType === 'truck' ? 'Truck' : 'Driver') + ': ' + escapeHtml(item.entityLabel || '—');
    const company = (item.contractorName && String(item.contractorName).trim()) ? ` (${escapeHtml(item.contractorName)})` : '';
    return `<li>${label}${company}</li>`;
  }).join('');
  const content = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#2d3748;">Applications approved</h1>
    <p style="margin:0 0 12px;">The following have been approved. You can now enroll them on the route in the Contractor portal.</p>
    <ul style="margin:12px 0 0;padding-left:20px;">${listHtml}</ul>
    <p style="margin:16px 0 0;color:#718096;font-size:14px;">Log in to the Contractor section and complete route enrollment for each.</p>
  `;
  return wrap(content, 'Applications approved', { charcoal: false });
}

/** Application approved – for rector awareness (notification only). */
export function applicationApprovedToRectorHtml({ entityType, entityLabel, tenantName, contractorName }) {
  const label = entityType === 'truck' ? 'Truck' : 'Driver';
  const companyName = (contractorName && String(contractorName).trim()) || (tenantName && String(tenantName).trim()) || '—';
  const content = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#e2e8f0;">${label} approved (for your awareness)</h1>
    <p style="margin:0 0 12px;">Command Centre has approved the application for <strong>${escapeHtml(entityLabel || label)}</strong> (company: <strong>${escapeHtml(companyName)}</strong>).</p>
    <p style="margin:0 0 12px;">They can now enroll this ${entityType === 'truck' ? 'truck' : 'driver'} on the route in the Contractor portal.</p>
  `;
  return wrap(content, `${label} approved`, { charcoal: true });
}

/** Bulk applications approved – for rector awareness (notification only). */
export function applicationBulkApprovedToRectorHtml({ items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return wrap('<p>No items.</p>', 'Applications approved', { charcoal: true });
  }
  const listHtml = items.map((item) => {
    const label = (item.entityType === 'truck' ? 'Truck' : 'Driver') + ': ' + escapeHtml(item.entityLabel || '—');
    const company = (item.contractorName && String(item.contractorName).trim()) ? ` (${escapeHtml(item.contractorName)})` : '';
    return `<li>${label}${company}</li>`;
  }).join('');
  const content = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#e2e8f0;">Applications approved (for your awareness)</h1>
    <p style="margin:0 0 12px;">Command Centre has approved the following. They can now be enrolled on the route in the Contractor portal.</p>
    <ul style="margin:12px 0 0;padding-left:20px;">${listHtml}</ul>
  `;
  return wrap(content, 'Applications approved', { charcoal: true });
}

/** Truck suspended (Command Centre): to contractor – grey template, with instructions to lift suspension. */
export function truckSuspendedToContractorHtml({ truckRegistration, tenantName, reason, isPermanent, suspensionEndsAt, appUrl }) {
  const reasonText = reason || 'Suspended from Command Centre (Fleet and driver compliance).';
  const durationText = isPermanent
    ? 'The suspension is permanent until reinstated by Command Centre.'
    : (suspensionEndsAt ? `The suspension is in effect until ${escapeHtml(String(suspensionEndsAt))}.` : 'The suspension is time-limited. Contact Command Centre for the exact end date.');
  const content = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#e2e8f0;">Truck suspended</h1>
    <p style="margin:0 0 12px;">Your truck <strong>${escapeHtml(truckRegistration || 'Unknown')}</strong> (${escapeHtml(tenantName || 'contractor')}) has been suspended by Command Centre.</p>
    <p style="margin:0 0 12px;"><strong>Reason:</strong> ${escapeHtml(reasonText)}</p>
    <p style="margin:0 0 12px;">${durationText}</p>
    <p style="margin:16px 0 8px;font-weight:bold;color:#e2e8f0;">This truck has been removed from all route enrollments and will not appear on list distribution until reinstated.</p>
    ${sectionBar('How to lift the suspension')}
    <p style="margin:8px 0 0;">To have the suspension lifted (reinstatement):</p>
    <ol style="margin:8px 0 0;padding-left:20px;">
      <li>Address the reason for suspension (compliance, documentation, or other requirements).</li>
      <li>Contact Command Centre or your route rector to request reinstatement.</li>
      <li>Command Centre will reinstate the truck when the matter is resolved; you will receive an email when the truck is reinstated.</li>
    </ol>
    <p style="margin:16px 0 0;color:#a0aec0;font-size:14px;">You can view suspension status in the Contractor portal under Suspensions and appeals.</p>
    ${appUrl ? `<p style="margin:12px 0 0;"><a href="${escapeHtml(appUrl)}" style="color:#63b3ed;">Open Contractor portal</a></p>` : ''}
  `;
  return wrap(content, 'Truck suspended', { charcoal: true });
}

/** Truck suspended: to rector (and CC) – grey template, rector-relevant. */
export function truckSuspendedToRectorHtml({ truckRegistration, tenantName, reason, isPermanent, suspensionEndsAt }) {
  const reasonText = reason || 'Suspended from Command Centre.';
  const content = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#e2e8f0;">Truck suspended (for your awareness)</h1>
    <p style="margin:0 0 12px;">Command Centre has suspended truck <strong>${escapeHtml(truckRegistration || 'Unknown')}</strong> for contractor <strong>${escapeHtml(tenantName || 'Unknown')}</strong>.</p>
    <p style="margin:0 0 12px;"><strong>Reason:</strong> ${escapeHtml(reasonText)}</p>
    <p style="margin:0 0 12px;">The truck has been removed from all route enrollments and will not appear on list distribution until reinstatement.</p>
    <p style="margin:16px 0 0;color:#a0aec0;font-size:14px;">You may be contacted by the contractor to request reinstatement. Reinstatement is done via Command Centre or Access Management.</p>
  `;
  return wrap(content, 'Truck suspended', { charcoal: true });
}

/** Truck reinstated: to contractor – grey template. */
export function truckReinstatedToContractorHtml({ truckRegistration, tenantName, appUrl }) {
  const content = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#e2e8f0;">Truck reinstated</h1>
    <p style="margin:0 0 12px;">Your truck <strong>${escapeHtml(truckRegistration || 'Unknown')}</strong> (${escapeHtml(tenantName || 'contractor')}) has been reinstated.</p>
    <p style="margin:0 0 12px;">It is no longer suspended and can be enrolled on routes again in the Contractor portal (Fleet and driver enrollment).</p>
    <p style="margin:16px 0 0;color:#a0aec0;font-size:14px;">Re-enroll the truck on the required route(s) to include it in list distribution.</p>
    ${appUrl ? `<p style="margin:12px 0 0;"><a href="${escapeHtml(appUrl)}" style="color:#63b3ed;">Open Contractor portal</a></p>` : ''}
  `;
  return wrap(content, 'Truck reinstated', { charcoal: true });
}

/** Truck reinstated: to rector – grey template, rector-relevant. */
export function truckReinstatedToRectorHtml({ truckRegistration, tenantName }) {
  const content = `
    <h1 style="margin:0 0 16px;font-size:20px;color:#e2e8f0;">Truck reinstated (for your awareness)</h1>
    <p style="margin:0 0 12px;">Truck <strong>${escapeHtml(truckRegistration || 'Unknown')}</strong> for contractor <strong>${escapeHtml(tenantName || 'Unknown')}</strong> has been reinstated.</p>
    <p style="margin:0 0 12px;">The contractor can now re-enroll this truck on routes; it will appear on list distribution once enrolled.</p>
  `;
  return wrap(content, 'Truck reinstated', { charcoal: true });
}

/** Green modern layout for reinstatement emails (contractor, rector, access management). */
function reinstatementEmailLayout(title, subtitle, innerContent) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; font-family: 'Segoe UI', system-ui, sans-serif; background-color: #f0fdf4;">
  <div style="max-width: 560px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: linear-gradient(135deg, #047857 0%, #059669 50%, #10b981 100%); border-radius: 12px; padding: 24px 28px; color: #fff; margin-bottom: 24px;">
      <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 600;">Reinstatement</h1>
      <p style="margin: 0; font-size: 14px; opacity: 0.95;">${escapeHtml(title)} · ${escapeHtml(subtitle)}</p>
    </div>
    <div style="background: #fff; border-radius: 12px; padding: 24px 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #a7f3d0;">
      ${innerContent}
      <div style="border-top: 1px solid #a7f3d0; padding-top: 20px; margin-top: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: #047857;">Thinkers · Fleet & logistics</p>
        <p style="margin: 0; font-size: 13px; color: #475569;">Access Management & route rectors</p>
      </div>
    </div>
    <p style="margin: 24px 0 0 0; font-size: 12px; color: #94a3b8; text-align: center;">Thinkers Afrika Management System</p>
  </div>
</body>
</html>`;
}

/** Reinstated (truck or driver): to contractor – green modern template. */
export function reinstatedToContractorHtml({ entityType, entityLabel, tenantName, appUrl }) {
  const isTruck = entityType === 'truck';
  const content = `
    <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">Your ${isTruck ? 'truck' : 'driver'} <strong>${escapeHtml(entityLabel || 'Unknown')}</strong> (${escapeHtml(tenantName || 'contractor')}) has been reinstated.</p>
    <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">The suspension has been lifted. You can ${isTruck ? 're-enroll this truck on routes in Fleet and driver enrollment' : 're-enroll this driver on routes'} in the Contractor portal.</p>
    ${appUrl ? `<p style="margin: 16px 0 0;"><a href="${escapeHtml(appUrl)}" style="color: #059669; font-weight: 600; text-decoration: none;">Open Contractor portal →</a></p>` : ''}
  `;
  return reinstatementEmailLayout('Reinstated', isTruck ? 'Truck' : 'Driver', content);
}

/** Reinstated (truck or driver): to rector – green modern, rector-relevant. */
export function reinstatedToRectorHtml({ entityType, entityLabel, tenantName }) {
  const isTruck = entityType === 'truck';
  const content = `
    <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">${isTruck ? 'Truck' : 'Driver'} <strong>${escapeHtml(entityLabel || 'Unknown')}</strong> for contractor <strong>${escapeHtml(tenantName || 'Unknown')}</strong> has been reinstated by Access Management.</p>
    <p style="margin: 0 0 0; font-size: 15px; color: #334155; line-height: 1.5;">The contractor can now re-enroll this ${isTruck ? 'truck' : 'driver'} on routes; it will appear on list distribution once enrolled.</p>
  `;
  return reinstatementEmailLayout('Reinstated (for your awareness)', isTruck ? 'Truck' : 'Driver', content);
}

/** Reinstated (truck or driver): to access management – green modern, confirmation. */
export function reinstatedToAccessManagementHtml({ entityType, entityLabel, tenantName, reinstatedBy }) {
  const isTruck = entityType === 'truck';
  const content = `
    <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">The reinstatement request for ${isTruck ? 'truck' : 'driver'} <strong>${escapeHtml(entityLabel || 'Unknown')}</strong> (${escapeHtml(tenantName || 'Unknown')}) has been approved.</p>
    <p style="margin: 0 0 0; font-size: 15px; color: #334155; line-height: 1.5;">${reinstatedBy ? `Reinstated by ${escapeHtml(reinstatedBy)}.` : 'Status updated to reinstated.'} The contractor and rector have been notified.</p>
  `;
  return reinstatementEmailLayout('Reinstatement approved', isTruck ? 'Truck' : 'Driver', content);
}

const TASK_ROW_STYLE = `padding:10px 12px;border:1px solid #fecaca;vertical-align:top;`;
const TASK_LABEL_STYLE = `width:38%;font-weight:bold;color:#1f2937;font-size:13px;${TASK_ROW_STYLE}`;
const TASK_VALUE_STYLE = `color:#374151;font-size:13px;white-space:pre-wrap;word-break:break-word;${TASK_ROW_STYLE}`;

function taskKeyValueRow(label, value) {
  if (value == null || value === '') value = '—';
  return `<tr><td style="${TASK_LABEL_STYLE}">${escapeHtml(String(label))}</td><td style="${TASK_VALUE_STYLE}">${escapeHtml(String(value))}</td></tr>`;
}

function taskKeyValueTable(rows) {
  const body = rows.map(([label, value]) => taskKeyValueRow(label, value)).join('');
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 16px;border:1px solid #fecaca;"><tbody>${body}</tbody></table>`;
}

function taskSectionBar(title) {
  return `<div style="background: linear-gradient(90deg, #991b1b, #b91c1c); color:#fff; padding:8px 12px; margin:0 0 12px; font-size:12px; font-weight:bold; letter-spacing:0.05em; border-radius:6px;">${escapeHtml(title)}</div>`;
}

/** Red modern email layout (tasks, work schedule, etc.). section = "Tasks" | "Work schedule" etc. */
function taskEmailLayout(subtitle, innerContent, section = 'Tasks') {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; font-family: 'Segoe UI', system-ui, sans-serif; background-color: #fef2f2;">
  <div style="max-width: 560px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: linear-gradient(135deg, #991b1b 0%, #dc2626 50%, #b91c1c 100%); border-radius: 12px; padding: 24px 28px; color: #fff; margin-bottom: 24px;">
      <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 600;">Thinkers</h1>
      <p style="margin: 0; font-size: 14px; opacity: 0.95;">${escapeHtml(section)} · ${escapeHtml(subtitle)}</p>
    </div>
    <div style="background: #fff; border-radius: 12px; padding: 24px 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #fecaca;">
      ${innerContent}
      <div style="border-top: 1px solid #fecaca; padding-top: 20px; margin-top: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: #b91c1c;">Monitoring Team</p>
        <p style="margin: 0; font-size: 13px; color: #475569;">For further inquiries please contact: <a href="mailto:vincent@thinkersafrika.co.za" style="color: #dc2626; text-decoration: none;">vincent@thinkersafrika.co.za</a></p>
      </div>
    </div>
    <p style="margin: 24px 0 0 0; font-size: 12px; color: #94a3b8; text-align: center;">Thinkers Afrika Management System</p>
  </div>
</body>
</html>`;
}

/** Shared task email template: same layout as task creation (assigned). Subtitle + first paragraph + Task details table + link. */
function taskNotificationHtml(subtitle, firstParagraphHtml, taskTitle, dueDate, taskId, appUrl) {
  const dueStr = dueDate ? new Date(dueDate).toLocaleDateString() : (dueDate === null || dueDate === undefined ? 'Not set' : '—');
  const content = `
    ${firstParagraphHtml}
    ${taskSectionBar('Task details')}
    ${taskKeyValueTable([
      ['Title', taskTitle],
      ['Due date', dueStr],
    ])}
    <p style="margin: 16px 0 0;"><a href="${escapeHtml((appUrl || '') + '/tasks?task=' + (taskId || ''))}" style="color: #dc2626; font-weight: 600; text-decoration: none;">Open task in Thinkers →</a></p>
  `;
  return taskEmailLayout(subtitle, content);
}

/** Task assigned: notify assignee(s) – same template as task creation. */
export function taskAssignedHtml({ taskTitle, assignerName, dueDate, taskId, appUrl }) {
  const firstParagraph = `<p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;"><strong>${escapeHtml(assignerName || 'A colleague')}</strong> has assigned you a task.</p>`;
  return taskNotificationHtml('Task assigned to you', firstParagraph, taskTitle, dueDate, taskId, appUrl);
}

/** Task completed: notify person who assigned (creator). */
export function taskCompletedHtml({ taskTitle, completedByName, completedAt, taskId, appUrl }) {
  const content = `
    <p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">A task you created or assigned has been marked complete.</p>
    ${taskSectionBar('Details')}
    ${taskKeyValueTable([
      ['Task', taskTitle],
      ['Completed by', completedByName],
      ['Completed at', completedAt],
    ])}
    <p style="margin: 16px 0 0;"><a href="${escapeHtml((appUrl || '') + '/tasks?task=' + (taskId || ''))}" style="color: #dc2626; font-weight: 600; text-decoration: none;">View in Thinkers →</a></p>
  `;
  return taskEmailLayout('Task completed', content);
}

/** Task overdue: same template as task creation (assigned), with overdue message. */
export function taskOverdueHtml({ taskTitle, dueDate, taskId, appUrl }) {
  const firstParagraph = `<p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">This task is <strong style="color: #b91c1c;">overdue</strong>. Please complete it or update the due date.</p>`;
  return taskNotificationHtml('Task overdue', firstParagraph, taskTitle, dueDate, taskId, appUrl);
}

/** Work schedule created: notify the employee. Same red template as task emails (Tasks · subtitle, Task details bar, table, link). */
export function scheduleCreatedHtml({ scheduleTitle, periodStart, periodEnd, createdByName, appUrl }) {
  const startStr = periodStart ? new Date(periodStart + 'T12:00:00').toLocaleDateString() : '—';
  const endStr = periodEnd ? new Date(periodEnd + 'T12:00:00').toLocaleDateString() : '—';
  const firstParagraph = `<p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">Your work schedule has been created${createdByName ? ` by <strong>${escapeHtml(createdByName)}</strong>` : ''}.</p>`;
  const content = `
    ${firstParagraph}
    ${taskSectionBar('Task details')}
    ${taskKeyValueTable([
      ['Title', scheduleTitle],
      ['Period start', startStr],
      ['Period end', endStr],
    ])}
    <p style="margin: 16px 0 0;"><a href="${escapeHtml((appUrl || '') + '/profile')}" style="color: #dc2626; font-weight: 600; text-decoration: none;">View schedule in Profile →</a></p>
  `;
  return taskEmailLayout('Schedule created', content);
}

/** Leave applied: notify management (same red template as tasks). */
export function leaveAppliedHtml({ applicantName, leaveType, startDate, endDate, daysRequested, reason, appUrl }) {
  const startStr = startDate ? new Date(startDate + 'T12:00:00').toLocaleDateString() : '—';
  const endStr = endDate ? new Date(endDate + 'T12:00:00').toLocaleDateString() : '—';
  const firstParagraph = `<p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;"><strong>${escapeHtml(applicantName || 'An employee')}</strong> has submitted a leave application for your review.</p>`;
  const rows = [
    ['Applicant', applicantName],
    ['Leave type', leaveType],
    ['Start date', startStr],
    ['End date', endStr],
    ['Days requested', String(daysRequested ?? '—')],
    ...(reason ? [['Reason', reason]] : []),
  ];
  const content = `
    ${firstParagraph}
    ${taskSectionBar('Task details')}
    ${taskKeyValueTable(rows)}
    <p style="margin: 16px 0 0;"><a href="${escapeHtml((appUrl || '') + '/management')}" style="color: #dc2626; font-weight: 600; text-decoration: none;">Review in Management →</a></p>
  `;
  return taskEmailLayout('Leave application submitted', content);
}

/** Leave approved or declined: notify applicant (same red template as tasks). */
export function leaveReviewedHtml({ status, leaveType, startDate, endDate, reviewedByName, reviewNotes, appUrl }) {
  const startStr = startDate ? new Date(startDate + 'T12:00:00').toLocaleDateString() : '—';
  const endStr = endDate ? new Date(endDate + 'T12:00:00').toLocaleDateString() : '—';
  const isApproved = status === 'approved';
  const firstParagraph = `<p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">Your leave application has been <strong style="color: ${isApproved ? '#15803d' : '#b91c1c'};">${isApproved ? 'approved' : 'declined'}</strong>${reviewedByName ? ` by <strong>${escapeHtml(reviewedByName)}</strong>` : ''}.</p>`;
  const rows = [
    ['Leave type', leaveType],
    ['Start date', startStr],
    ['End date', endStr],
    ['Status', isApproved ? 'Approved' : 'Declined'],
    ...(reviewNotes ? [['Notes', reviewNotes]] : []),
  ];
  const content = `
    ${firstParagraph}
    ${taskSectionBar('Task details')}
    ${taskKeyValueTable(rows)}
    <p style="margin: 16px 0 0;"><a href="${escapeHtml((appUrl || '') + '/profile')}" style="color: #dc2626; font-weight: 600; text-decoration: none;">View in Profile →</a></p>
  `;
  return taskEmailLayout(isApproved ? 'Leave approved' : 'Leave declined', content);
}

/** Warning issued: notify the employee (same red template as tasks). */
export function warningIssuedHtml({ warningType, description, issuedByName, appUrl }) {
  const firstParagraph = `<p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">A disciplinary warning has been issued to you${issuedByName ? ` by <strong>${escapeHtml(issuedByName)}</strong>` : ''}.</p>`;
  const rows = [
    ['Type', warningType],
    ...(description ? [['Description', description]] : []),
  ];
  const content = `
    ${firstParagraph}
    ${taskSectionBar('Task details')}
    ${taskKeyValueTable(rows)}
    <p style="margin: 16px 0 0;"><a href="${escapeHtml((appUrl || '') + '/profile')}" style="color: #dc2626; font-weight: 600; text-decoration: none;">View in Profile →</a></p>
  `;
  return taskEmailLayout('Warning issued', content);
}

/** Reward issued: notify the employee (same red template as tasks). */
export function rewardIssuedHtml({ rewardType, description, issuedByName, appUrl }) {
  const firstParagraph = `<p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">You have received a reward${issuedByName ? ` from <strong>${escapeHtml(issuedByName)}</strong>` : ''}.</p>`;
  const rows = [
    ['Type', rewardType],
    ...(description ? [['Description', description]] : []),
  ];
  const content = `
    ${firstParagraph}
    ${taskSectionBar('Task details')}
    ${taskKeyValueTable(rows)}
    <p style="margin: 16px 0 0;"><a href="${escapeHtml((appUrl || '') + '/profile')}" style="color: #dc2626; font-weight: 600; text-decoration: none;">View in Profile →</a></p>
  `;
  return taskEmailLayout('Reward issued', content);
}

// —— Gold template for super admin notifications (new user / new tenant) ——
const GOLD_ROW_STYLE = `padding:10px 12px;border:1px solid #fde68a;vertical-align:top;`;
const GOLD_LABEL_STYLE = `width:38%;font-weight:bold;color:#1f2937;font-size:13px;${GOLD_ROW_STYLE}`;
const GOLD_VALUE_STYLE = `color:#374151;font-size:13px;white-space:pre-wrap;word-break:break-word;${GOLD_ROW_STYLE}`;

function goldKeyValueRow(label, value) {
  if (value == null || value === '') value = '—';
  return `<tr><td style="${GOLD_LABEL_STYLE}">${escapeHtml(String(label))}</td><td style="${GOLD_VALUE_STYLE}">${escapeHtml(String(value))}</td></tr>`;
}

function goldKeyValueTable(rows) {
  const body = rows.map(([label, value]) => goldKeyValueRow(label, value)).join('');
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 16px;border:1px solid #fde68a;"><tbody>${body}</tbody></table>`;
}

function goldSectionBar(title) {
  return `<div style="background: linear-gradient(90deg, #b45309, #d97706); color:#fff; padding:8px 12px; margin:0 0 12px; font-size:12px; font-weight:bold; letter-spacing:0.05em; border-radius:6px;">${escapeHtml(title)}</div>`;
}

/** Gold layout for super admin notifications (same structure as task template, gold theme). */
function goldEmailLayout(subtitle, innerContent, section = 'User management') {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; font-family: 'Segoe UI', system-ui, sans-serif; background-color: #fffbeb;">
  <div style="max-width: 560px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: linear-gradient(135deg, #b45309 0%, #d97706 50%, #ea580c 100%); border-radius: 12px; padding: 24px 28px; color: #fff; margin-bottom: 24px;">
      <h1 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 600;">Thinkers</h1>
      <p style="margin: 0; font-size: 14px; opacity: 0.95;">${escapeHtml(section)} · ${escapeHtml(subtitle)}</p>
    </div>
    <div style="background: #fff; border-radius: 12px; padding: 24px 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #fde68a;">
      ${innerContent}
      <div style="border-top: 1px solid #fde68a; padding-top: 20px; margin-top: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: #b45309;">Monitoring Team</p>
        <p style="margin: 0; font-size: 13px; color: #475569;">For further inquiries please contact: <a href="mailto:vincent@thinkersafrika.co.za" style="color: #d97706; text-decoration: none;">vincent@thinkersafrika.co.za</a></p>
      </div>
    </div>
    <p style="margin: 24px 0 0 0; font-size: 12px; color: #94a3b8; text-align: center;">Thinkers Afrika Management System</p>
  </div>
</body>
</html>`;
}

/** New user created: notify super admin (gold template). */
export function newUserCreatedHtml({ createdByName, userEmail, userFullName, userRole, tenantName, appUrl }) {
  const firstParagraph = `<p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">A new user has been created${createdByName ? ` by <strong>${escapeHtml(createdByName)}</strong>` : ''}.</p>`;
  const rows = [
    ['Email', userEmail],
    ['Full name', userFullName || '—'],
    ['Role', userRole || '—'],
    ['Tenant', tenantName || '—'],
  ];
  const content = `
    ${firstParagraph}
    ${goldSectionBar('User details')}
    ${goldKeyValueTable(rows)}
    <p style="margin: 16px 0 0;"><a href="${escapeHtml((appUrl || '') + '/users')}" style="color: #d97706; font-weight: 600; text-decoration: none;">View in User management →</a></p>
  `;
  return goldEmailLayout('New user created', content);
}

/** New tenant created: notify super admin (gold template). */
export function newTenantCreatedHtml({ createdByName, tenantName, tenantSlug, tenantPlan, appUrl }) {
  const firstParagraph = `<p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">A new tenant has been created${createdByName ? ` by <strong>${escapeHtml(createdByName)}</strong>` : ''}.</p>`;
  const rows = [
    ['Name', tenantName],
    ['Slug', tenantSlug || '—'],
    ['Plan', tenantPlan || '—'],
  ];
  const content = `
    ${firstParagraph}
    ${goldSectionBar('Tenant details')}
    ${goldKeyValueTable(rows)}
    <p style="margin: 16px 0 0;"><a href="${escapeHtml((appUrl || '') + '/tenants')}" style="color: #d97706; font-weight: 600; text-decoration: none;">View in Tenants →</a></p>
  `;
  return goldEmailLayout('New tenant created', content, 'Tenant management');
}

/** Password reset: link + code (red task-style template). */
export function passwordResetHtml({ resetLink, code, appUrl }) {
  const firstParagraph = `<p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">You requested a password reset. Use the link below and enter this code when prompted:</p>`;
  const content = `
    ${firstParagraph}
    ${taskSectionBar('Reset code')}
    <p style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; letter-spacing: 0.2em; color: #1e40af; font-family: monospace;">${escapeHtml(code)}</p>
    <p style="margin: 16px 0 0; font-size: 14px; color: #64748b;">This code expires in 1 hour. If you did not request this, you can ignore this email.</p>
    <p style="margin: 16px 0 0;"><a href="${escapeHtml(resetLink)}" style="color: #dc2626; font-weight: 600; text-decoration: none;">Reset password →</a></p>
  `;
  return taskEmailLayout('Password reset', content);
}

/** Shift report override request: Access Management receives code to give to requester (red template). */
export function shiftReportOverrideRequestHtml({ requesterName, requesterEmail, reportRoute, reportDate, code, appUrl }) {
  const firstParagraph = `<p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">A shift report approver has requested an <strong>override code</strong> to change their approval decision. Please provide the code below to the requester.</p>`;
  const rows = [
    ['Requester', [requesterName, requesterEmail].filter(Boolean).join(' · ') || '—'],
    ['Shift report', [reportRoute, reportDate].filter(Boolean).join(' — ') || '—'],
  ];
  const content = `
    ${firstParagraph}
    ${taskSectionBar('Override request')}
    ${taskKeyValueTable(rows)}
    <p style="margin: 12px 0 4px; font-size: 12px; font-weight: 600; color: #64748b;">OVERRIDE CODE (share with requester)</p>
    <p style="margin: 0 0 16px; font-size: 22px; font-weight: 700; letter-spacing: 0.15em; color: #b91c1c; font-family: monospace;">${escapeHtml(code)}</p>
    <p style="margin: 16px 0 0; font-size: 14px; color: #64748b;">Share this code with <strong>${escapeHtml(requesterName || requesterEmail || 'the requester')}</strong> so they can complete their action in Command Centre → Requests.</p>
    <p style="margin: 16px 0 0;"><a href="${escapeHtml((appUrl || '') + '/command-centre')}" style="color: #dc2626; font-weight: 600; text-decoration: none;">Command Centre →</a></p>
  `;
  return taskEmailLayout('Override code requested', content, 'Command Centre');
}

/** Override code sent to the requester so they receive it directly (red template). */
export function shiftReportOverrideCodeToRequesterHtml({ reportRoute, reportDate, code, appUrl }) {
  const firstParagraph = `<p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">You requested an <strong>override code</strong> to change your approval decision on a shift report. Use the code below in Command Centre → Requests.</p>`;
  const rows = [
    ['Shift report', [reportRoute, reportDate].filter(Boolean).join(' — ') || '—'],
  ];
  const content = `
    ${firstParagraph}
    ${taskSectionBar('Your override code')}
    ${taskKeyValueTable(rows)}
    <p style="margin: 12px 0 4px; font-size: 12px; font-weight: 600; color: #64748b;">OVERRIDE CODE</p>
    <p style="margin: 0 0 16px; font-size: 22px; font-weight: 700; letter-spacing: 0.15em; color: #b91c1c; font-family: monospace;">${escapeHtml(code)}</p>
    <p style="margin: 16px 0 0; font-size: 14px; color: #64748b;">Enter this code in the override field and then choose Approve, Reject, or Provisional approval.</p>
    <p style="margin: 16px 0 0;"><a href="${escapeHtml((appUrl || '') + '/command-centre')}" style="color: #dc2626; font-weight: 600; text-decoration: none;">Command Centre →</a></p>
  `;
  return taskEmailLayout('Your override code', content, 'Command Centre');
}

/** Account approved: login details (same style as forgot password). */
export function accountApprovedHtml({ loginUrl, email, temporaryPassword, appUrl }) {
  const firstParagraph = `<p style="margin: 0 0 16px 0; font-size: 15px; color: #334155; line-height: 1.5;">Your sign-up request has been approved. You can now sign in with the details below. Please change your password after your first login.</p>`;
  const rows = [
    ['Email (username)', email || ''],
    ['Temporary password', temporaryPassword || ''],
  ];
  const content = `
    ${firstParagraph}
    ${taskSectionBar('Login details')}
    ${taskKeyValueTable(rows)}
    <p style="margin: 16px 0 0;"><a href="${escapeHtml(loginUrl || (appUrl || '') + '/login')}" style="color: #dc2626; font-weight: 600; text-decoration: none;">Sign in →</a></p>
  `;
  return taskEmailLayout('Account approved', content);
}
