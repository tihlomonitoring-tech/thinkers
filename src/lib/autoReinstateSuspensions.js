/**
 * Auto-reinstate suspensions when suspension_ends_at has passed.
 * Sends same reinstatement emails to contractor, rector, and access management.
 * Run periodically from server.js.
 */
import { query } from '../db.js';
import { getTenantUserEmails, getContractorUserEmails, getCommandCentreAndAccessManagementEmails, getRectorEmailsForAlertTypeAndRoutes, getAccessManagementEmails } from './emailRecipients.js';
import { reinstatedToContractorHtml, reinstatedToRectorHtml, reinstatedToAccessManagementHtml } from './emailTemplates.js';
import { sendEmail, isEmailConfigured } from './emailService.js';

function getRow(row, key) {
  if (!row || typeof row !== 'object') return undefined;
  const k = Object.keys(row).find((x) => x.toLowerCase() === String(key).toLowerCase());
  return k ? row[k] : undefined;
}

export async function runAutoReinstateSuspensions() {
  if (!isEmailConfigured?.() || !sendEmail) return { count: 0 };
  let count = 0;
  try {
    const result = await query(
      `SELECT id, tenant_id, entity_type, entity_id FROM contractor_suspensions
       WHERE [status] = N'suspended' AND is_permanent = 0 AND suspension_ends_at IS NOT NULL AND suspension_ends_at < SYSUTCDATETIME()`
    );
    const rows = result.recordset || [];
    for (const row of rows) {
      const id = getRow(row, 'id');
      const tenantId = getRow(row, 'tenant_id');
      const entityType = String(getRow(row, 'entity_type') || '').toLowerCase();
      const entityId = getRow(row, 'entity_id');
      if (entityType !== 'truck' && entityType !== 'driver') continue;
      try {
        await query(
          `UPDATE contractor_suspensions SET [status] = N'reinstated', updated_at = SYSUTCDATETIME() WHERE id = @id`,
          { id }
        );
        count++;
        if (!tenantId || !entityId || !getAccessManagementEmails) continue;
        const tenantRow = await query(`SELECT name FROM tenants WHERE id = @tenantId`, { tenantId });
        const tenantName = tenantRow.recordset?.[0]?.name || 'Unknown';
        let entityLabel = '';
        let entityContractorId = null;
        let routeIds = [];
        if (entityType === 'truck') {
          const truckInfo = await query(`SELECT registration, contractor_id FROM contractor_trucks WHERE id = @entityId AND tenant_id = @tenantId`, { entityId, tenantId });
          const tr = truckInfo.recordset?.[0];
          entityLabel = tr?.registration || `Truck #${entityId}`;
          entityContractorId = tr?.contractor_id ?? tr?.contractor_Id ?? null;
          const trRoutes = await query(`SELECT route_id FROM contractor_route_trucks WHERE truck_id = @entityId`, { entityId });
          routeIds = (trRoutes.recordset || []).map((r) => r.route_id ?? r.route_Id).filter(Boolean);
        } else {
          const driverInfo = await query(`SELECT full_name, contractor_id FROM contractor_drivers WHERE id = @entityId AND tenant_id = @tenantId`, { entityId, tenantId });
          const dr = driverInfo.recordset?.[0];
          entityLabel = dr?.full_name || `Driver #${entityId}`;
          entityContractorId = dr?.contractor_id ?? dr?.contractor_Id ?? null;
          const drRoutes = await query(`SELECT route_id FROM contractor_route_drivers WHERE driver_id = @entityId`, { entityId });
          routeIds = (drRoutes.recordset || []).map((r) => r.route_id ?? r.route_Id).filter(Boolean);
        }
        const appUrl = process.env.APP_URL || '';
        const contractorEmails = entityContractorId ? await getContractorUserEmails(query, tenantId, entityContractorId) : await getTenantUserEmails(query, tenantId);
        const ccAm = await getCommandCentreAndAccessManagementEmails(query);
        const rectorReinst = routeIds.length > 0 ? await getRectorEmailsForAlertTypeAndRoutes(query, 'reinstatement_alerts', routeIds) : [];
        const rectorEmails = [...new Set([...ccAm, ...rectorReinst])];
        const accessManagementEmails = await getAccessManagementEmails(query);
        if (contractorEmails.length) {
          const html = reinstatedToContractorHtml({ entityType, entityLabel, tenantName, appUrl });
          await sendEmail({ to: contractorEmails, subject: `${entityType === 'truck' ? 'Truck' : 'Driver'} reinstated: ${entityLabel}`, body: html, html: true });
        }
        if (rectorEmails.length) {
          const html = reinstatedToRectorHtml({ entityType, entityLabel, tenantName });
          await sendEmail({ to: rectorEmails, subject: `${entityType === 'truck' ? 'Truck' : 'Driver'} reinstated (for your awareness): ${entityLabel} – ${tenantName}`, body: html, html: true });
        }
        if (accessManagementEmails.length) {
          const html = reinstatedToAccessManagementHtml({ entityType, entityLabel, tenantName, reinstatedBy: 'Automatic (suspension period ended)' });
          await sendEmail({ to: accessManagementEmails, subject: `Reinstatement approved: ${entityLabel} (${tenantName})`, body: html, html: true });
        }
      } catch (e) {
        console.warn('[autoReinstate] row', id, e?.message || e);
      }
    }
  } catch (err) {
    console.error('[autoReinstate]', err?.message || err);
  }
  return { count };
}
