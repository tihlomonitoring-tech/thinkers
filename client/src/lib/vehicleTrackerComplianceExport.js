import { loadExcelJS } from './lazyExceljs.js';
import { buildStyledListSheet } from './styledListExcel.js';

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtDateOnly(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function boolLabel(v) {
  if (v === true || v === 1) return 'Yes';
  if (v === false || v === 0) return 'No';
  return '—';
}

function checkResultLabel(c) {
  if (c.status === 'grace') return 'Grace period';
  if (c.status === 'expired') return 'Expired (was compliant)';
  if (c.status === 'suspended') return 'Suspended';
  if (c.status === 'resolved') return 'Resolved';
  return c.is_compliant ? 'Compliant' : 'Not compliant';
}

export async function downloadTrackerComplianceHistoryExcel(checks, { dateFrom, dateTo, tenantName } = {}) {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Thinkers';
  workbook.created = new Date();

  const rows = (checks || []).map((c) => ({
    checked_at: fmtDate(c.checked_at),
    registration: c.registration || '',
    fleet_no: c.fleet_no || '',
    contractor: c.contractor_name || '',
    sub_contractor: c.sub_contractor || '',
    driver: c.driver_name || '',
    result: checkResultLabel(c),
    checked_by: c.checked_by_name || '',
    has_camera: boolLabel(c.has_camera),
    load_camera: boolLabel(c.load_camera_working),
    cab_camera: boolLabel(c.cab_camera_working),
    road_camera: boolLabel(c.road_camera_working),
    tracking: boolLabel(c.tracking_updating),
    driver_ppe: c.driver_section_used ? boolLabel(c.driver_wearing_ppe) : 'N/A',
    driver_overspeed: c.driver_section_used ? boolLabel(!c.driver_no_overspeeding_24h) : 'N/A',
    driver_license: c.driver_section_used ? boolLabel(c.driver_license_valid) : 'N/A',
    fail_reasons: (c.fail_reasons || []).join('; '),
    notified: c.notified_at ? fmtDate(c.notified_at) : '',
    grace_expires: c.grace_period_expires_at ? fmtDate(c.grace_period_expires_at) : '',
    compliance_expires: c.compliance_expires_at ? fmtDate(c.compliance_expires_at) : '',
    notes: c.notes || '',
  }));

  const rangeLabel =
    dateFrom && dateTo
      ? `${fmtDateOnly(dateFrom)} – ${fmtDateOnly(dateTo)}`
      : dateFrom
        ? `From ${fmtDateOnly(dateFrom)}`
        : dateTo
          ? `Until ${fmtDateOnly(dateTo)}`
          : 'All dates';

  buildStyledListSheet(workbook, {
    sheetName: 'Compliance history',
    headers: [
      'Checked at',
      'Registration',
      'Fleet no',
      'Contractor',
      'Sub-contractor',
      'Driver',
      'Result',
      'Checked by',
      'Has camera',
      'Load camera',
      'Cab camera',
      'Road camera',
      'Tracking updating',
      'Driver PPE',
      'Overspeeding (24h)',
      'Driver license',
      'Fail reasons',
      'Notified',
      'Grace expires',
      'Compliance expires',
      'Notes',
    ],
    keys: [
      'checked_at',
      'registration',
      'fleet_no',
      'contractor',
      'sub_contractor',
      'driver',
      'result',
      'checked_by',
      'has_camera',
      'load_camera',
      'cab_camera',
      'road_camera',
      'tracking',
      'driver_ppe',
      'driver_overspeed',
      'driver_license',
      'fail_reasons',
      'notified',
      'grace_expires',
      'compliance_expires',
      'notes',
    ],
    rows,
    groupBy: 'sub_contractor',
    autoFilter: true,
    info: [
      ['Report:', 'Vehicle tracker compliance check history'],
      ['Tenant:', tenantName || '—'],
      ['Date range:', rangeLabel],
      ['Generated:', fmtDate(new Date())],
      ['Total records:', String(rows.length)],
    ],
    minColumnWidth: 10,
    maxColumnWidth: 48,
    valueStyles: {
      result: {
        Compliant: { fill: 'FFd1fae5', font: { color: { argb: 'FF065f46' }, bold: true } },
        'Not compliant': { fill: 'FFfee2e2', font: { color: { argb: 'FF991b1b' }, bold: true } },
        'Grace period': { fill: 'FFfef3c7', font: { color: { argb: 'FF92400e' }, bold: true } },
        'Expired (was compliant)': { fill: 'FFe2e8f0', font: { color: { argb: 'FF475569' }, bold: true } },
        Suspended: { fill: 'FFfecaca', font: { color: { argb: 'FF7f1d1d' }, bold: true } },
      },
    },
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fromPart = dateFrom ? fmtDateOnly(dateFrom).replace(/\//g, '-') : 'all';
  const toPart = dateTo ? fmtDateOnly(dateTo).replace(/\//g, '-') : 'all';
  a.href = url;
  a.download = `vehicle-tracker-compliance-${fromPart}-to-${toPart}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
