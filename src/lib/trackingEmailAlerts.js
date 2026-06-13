import { sendEmail, isEmailConfigured } from './emailService.js';
import { getTrackingManagementEmails } from './emailRecipients.js';

function get(row, key) {
  if (!row) return undefined;
  const lower = key.toLowerCase();
  const entry = Object.entries(row).find(([k]) => k && String(k).toLowerCase() === lower);
  return entry ? entry[1] : undefined;
}

export const TRACKING_EMAIL_NOTIFICATION_KEYS = [
  'notify_email_deviation',
  'notify_email_overspeed',
  'notify_email_parking',
  'notify_email_loading',
  'notify_email_offloading',
];

/** Map alarm / event category to settings column suffix. */
export const TRACKING_NOTIFICATION_TYPES = {
  deviation: 'notify_email_deviation',
  overspeed: 'notify_email_overspeed',
  parking: 'notify_email_parking',
  loading: 'notify_email_loading',
  offloading: 'notify_email_offloading',
};

export async function getTrackingAlertEmails(query, tenantId) {
  return getTrackingManagementEmails(query, tenantId);
}

export async function getTrackingEmailPrefs(query, tenantId) {
  const r = await query(
    `SELECT notify_email_deviation, notify_email_overspeed, notify_email_parking,
            notify_email_loading, notify_email_offloading
     FROM tracking_tenant_settings WHERE tenant_id = @tenantId`,
    { tenantId }
  );
  const row = r.recordset?.[0];
  const defaults = Object.fromEntries(TRACKING_EMAIL_NOTIFICATION_KEYS.map((k) => [k, true]));
  if (!row) return defaults;
  return {
    notify_email_deviation: get(row, 'notify_email_deviation') !== false && get(row, 'notify_email_deviation') !== 0,
    notify_email_overspeed: get(row, 'notify_email_overspeed') !== false && get(row, 'notify_email_overspeed') !== 0,
    notify_email_parking: get(row, 'notify_email_parking') !== false && get(row, 'notify_email_parking') !== 0,
    notify_email_loading: get(row, 'notify_email_loading') !== false && get(row, 'notify_email_loading') !== 0,
    notify_email_offloading: get(row, 'notify_email_offloading') !== false && get(row, 'notify_email_offloading') !== 0,
  };
}

export function isTrackingEmailEnabled(prefs, notificationType) {
  if (!notificationType) return true;
  const key = TRACKING_NOTIFICATION_TYPES[notificationType];
  if (!key) return true;
  return prefs?.[key] !== false;
}

/**
 * Send a tracking alert email when the notification type is enabled for the tenant.
 * @param {string|null} notificationType — deviation | overspeed | parking | loading | offloading
 */
export async function sendTrackingNotificationEmail({
  query,
  tenantId,
  notificationType,
  truckRegistration,
  subject,
  body,
}) {
  if (!isEmailConfigured()) return;
  const prefs = await getTrackingEmailPrefs(query, tenantId);
  if (!isTrackingEmailEnabled(prefs, notificationType)) return;
  const to = await getTrackingAlertEmails(query, tenantId);
  if (!to.length) return;
  await sendEmail({ to, subject, body, html: true }).catch((err) => {
    console.warn('[trackingEmailAlerts] notification email failed:', err?.message || err);
  });
}

export function resolveGeofenceNotificationType({ leg, eventType, fenceType }) {
  const l = String(leg || '').toLowerCase();
  const ft = String(fenceType || '').toLowerCase();
  if (eventType === 'entry') {
    if (l === 'origin') return 'loading';
    if (l === 'destination') return 'offloading';
    if (l === 'alert' || ft === 'hazard') return null;
  }
  if (eventType === 'exit' && l === 'corridor') return 'deviation';
  return null;
}

export async function sendGeofenceAlertEmail({
  query,
  tenantId,
  truckRegistration,
  geofenceName,
  eventType,
  lat,
  lng,
  routeName,
  leg,
  fenceType,
  notificationType,
}) {
  const type = notificationType ?? resolveGeofenceNotificationType({ leg, eventType, fenceType });
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
  await sendTrackingNotificationEmail({
    query,
    tenantId,
    notificationType: type,
    truckRegistration,
    subject,
    body,
  });
}

export async function sendDeviationAlertEmail({ query, tenantId, truckRegistration, lat, lng, detail }) {
  const subject = `[Tracking] Route deviation — ${truckRegistration}`;
  const body = `
    <p><strong>${truckRegistration}</strong> has deviated from the planned route.</p>
    <ul>
      <li>Detail: ${detail || 'Route deviation'}</li>
      <li>Position: ${lat ?? '—'}, ${lng ?? '—'}</li>
      <li>Time: ${new Date().toISOString()}</li>
    </ul>
    <p>Open Tracking Management → Monitor to review.</p>
  `;
  await sendTrackingNotificationEmail({
    query,
    tenantId,
    notificationType: 'deviation',
    truckRegistration,
    subject,
    body,
  });
}

export async function sendOverspeedAlertEmail({ query, tenantId, truckRegistration, lat, lng, speedKmh, limitKmh }) {
  const subject = `[Tracking] Speed alert — ${truckRegistration}`;
  const body = `
    <p><strong>${truckRegistration}</strong> exceeded the speed limit.</p>
    <ul>
      <li>Speed: ${speedKmh} km/h (limit ${limitKmh} km/h)</li>
      <li>Position: ${lat ?? '—'}, ${lng ?? '—'}</li>
      <li>Time: ${new Date().toISOString()}</li>
    </ul>
    <p>Open Tracking Management → Monitor to review.</p>
  `;
  await sendTrackingNotificationEmail({
    query,
    tenantId,
    notificationType: 'overspeed',
    truckRegistration,
    subject,
    body,
  });
}

export async function sendParkingAlertEmail({ query, tenantId, truckRegistration, lat, lng, idleMinutes }) {
  const subject = `[Tracking] Parking / idle alert — ${truckRegistration}`;
  const body = `
    <p><strong>${truckRegistration}</strong> has been stationary for longer than the idle threshold.</p>
    <ul>
      <li>Idle threshold: ${idleMinutes} minutes</li>
      <li>Position: ${lat ?? '—'}, ${lng ?? '—'}</li>
      <li>Time: ${new Date().toISOString()}</li>
    </ul>
    <p>Open Tracking Management → Monitor to review.</p>
  `;
  await sendTrackingNotificationEmail({
    query,
    tenantId,
    notificationType: 'parking',
    truckRegistration,
    subject,
    body,
  });
}
