import { sendEmail, isEmailConfigured } from './emailService.js';
import { getTrackingManagementEmails } from './emailRecipients.js';

export async function getTrackingAlertEmails(query, tenantId) {
  return getTrackingManagementEmails(query, tenantId);
}

export async function sendGeofenceAlertEmail({ query, tenantId, truckRegistration, geofenceName, eventType, lat, lng, routeName }) {
  if (!isEmailConfigured()) return;
  const to = await getTrackingAlertEmails(query, tenantId);
  if (!to.length) return;
  const eventLabel = eventType === 'exit' ? 'left geofence' : 'entered geofence';
  const subject = `[Tracking] ${truckRegistration} ${eventLabel} — ${geofenceName}`;
  const body = `
    <p><strong>${truckRegistration}</strong> ${eventLabel}.</p>
    <ul>
      <li>Geofence: ${geofenceName}</li>
      ${routeName ? `<li>Route: ${routeName}</li>` : ''}
      <li>Position: ${lat ?? '—'}, ${lng ?? '—'}</li>
      <li>Time: ${new Date().toISOString()}</li>
    </ul>
    <p>Open Tracking Management → Monitor to review fleet distribution.</p>
  `;
  await sendEmail({ to, subject, body, html: true }).catch((err) => {
    console.warn('[trackingEmailAlerts] geofence email failed:', err?.message || err);
  });
}
