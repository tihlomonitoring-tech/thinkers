/**
 * Word-compatible HTML for shift report template (.doc via application/msword).
 * Mirrors structure of generateShiftReportPdf for manual fill / print.
 */

function h(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sectionBar(title) {
  return `<div style="background:#000;color:#fff;font-weight:bold;padding:6px 8px;font-size:9pt;margin:18px 0 8px 0;text-transform:uppercase;">${h(title)}</div>`;
}

function kvTable(rows) {
  const body = rows
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `<tr><td style="border:1px solid #333;padding:4px 8px;font-weight:bold;width:38%;vertical-align:top;">${h(k)}</td><td style="border:1px solid #333;padding:4px 8px;vertical-align:top;color:#333;">${h(String(v))}</td></tr>`)
    .join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:10px;">${body}</table>`;
}

function dataTable(headers, rows) {
  const head = `<tr>${headers.map((x) => `<th style="border:1px solid #333;padding:4px 6px;background:#f5f5f5;font-size:8pt;">${h(x)}</th>`).join('')}</tr>`;
  const body = (rows || [])
    .map((cells) => `<tr>${cells.map((c) => `<td style="border:1px solid #333;padding:4px 6px;font-size:8pt;vertical-align:top;">${h(c != null ? String(c) : '')}</td>`).join('')}</tr>`)
    .join('');
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:12px;">${head}${body}</table>`;
}

function buildDeclaration(report) {
  const c1 = (report.controller1_name || '').trim();
  const c2 = (report.controller2_name || '').trim();
  if (c1 && c2) {
    return `As the controllers on duty, ${c1} and ${c2}, we certify that the information contained in this shift report is accurate and complete to the best of our knowledge.`;
  }
  if (c1) {
    return `As the controller on duty, ${c1}, I certify that the information contained in this shift report is accurate and complete to the best of my knowledge.`;
  }
  return 'As the controller(s) on duty, we certify that the information contained in this shift report is accurate and complete to the best of our knowledge.';
}

/**
 * @param {object} report - Same shape as shift report PDF (template or saved report)
 * @param {{ logoDataUrl?: string }} options
 * @returns {string} HTML document
 */
export function buildShiftReportTemplateWordHtml(report, options = {}) {
  const logoDataUrl = options.logoDataUrl;
  const logoBlock = logoDataUrl
    ? `<div style="text-align:center;margin-bottom:12px;"><img src="${logoDataUrl}" alt="Logo" style="max-height:72px;width:auto;max-width:120px;" /></div>`
    : '';

  const routeLine = report.route ? `Route: ${report.route}` : 'Route: —';
  const shiftTime = [report.shift_start, report.shift_end].filter(Boolean).join(' - ') || '';

  const infoRows = [
    ['Route', report.route],
    ['Report Date', report.report_date ? new Date(report.report_date).toLocaleDateString() : ''],
    ['Shift Date', report.shift_date ? new Date(report.shift_date).toLocaleDateString() : ''],
    ['Shift Time', shiftTime],
    ['Controller 1', report.controller1_name],
    ['Controller 1 Email', report.controller1_email],
    ['Controller 2', report.controller2_name],
    ['Controller 2 Email', report.controller2_email],
    ['Report Status', report.status],
    ['Created By', report.created_by_name],
    ['Created At', report.created_at ? new Date(report.created_at).toLocaleString() : ''],
  ];

  const summaryEntries = [
    ['Total Trucks Scheduled', report.total_trucks_scheduled],
    ['Balance Brought Down', report.balance_brought_down],
    ['Total Loads Dispatched', report.total_loads_dispatched],
    ['Total Pending Deliveries', report.total_pending_deliveries],
    ['Total Loads Delivered', report.total_loads_delivered],
  ].filter(([, v]) => v != null && String(v).trim() !== '');
  if ((report.overall_performance || '').trim()) summaryEntries.push(['Overall Performance', report.overall_performance]);
  if ((report.key_highlights || '').trim()) summaryEntries.push(['Key Highlights', report.key_highlights]);

  const truckUpdates = Array.isArray(report.truck_updates) ? report.truck_updates : [];
  const incidents = Array.isArray(report.incidents) ? report.incidents : [];
  const nonComp = Array.isArray(report.non_compliance_calls) ? report.non_compliance_calls : [];
  const invs = Array.isArray(report.investigations) ? report.investigations : [];
  const comms = Array.isArray(report.communication_log) ? report.communication_log : [];

  const invRows = invs.map((inv) => [
    inv.truck_reg,
    inv.time,
    inv.location,
    [inv.issue_identified, inv.findings].filter(Boolean).join(' — ') || '—',
  ]);

  const approverRows = [];
  const subTo =
    (report.submitted_to_name || report.submitted_to_email) &&
    (report.status === 'pending_approval' || report.status === 'provisional' || report.status === 'approved');
  if (subTo) {
    approverRows.push([
      'Submitted to',
      report.submitted_to_name || '—',
      report.submitted_to_email || '—',
      report.submitted_at ? new Date(report.submitted_at).toLocaleString() : '—',
    ]);
  }
  if (report.approved_by_name || report.approved_at) {
    approverRows.push(['Approved by', report.approved_by_name || '—', '—', report.approved_at ? new Date(report.approved_at).toLocaleString() : '—']);
  }

  const margin = '2.54cm';
  const parts = [
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">',
    '<head><meta charset="utf-8"/><title>Shift report template</title>',
    `<style>
      body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.35; color: #222; margin: ${margin}; }
      h1 { text-align: center; font-size: 18pt; margin: 0 0 4px 0; }
      .sub { text-align: center; font-size: 9pt; color: #555; margin: 2px 0; }
      hr { border: none; border-top: 1px solid #000; margin: 14px 0; }
    </style></head>`,
    `<body style="margin:${margin};">`,
    logoBlock,
    '<h1>SHIFT REPORT</h1>',
    `<p class="sub">${h(routeLine)}</p>`,
    `<p class="sub">Thinkers Afrika's Official Controller Shift Documentation</p>`,
    '<hr />',
    sectionBar('Report information'),
    kvTable(infoRows.filter(([, v]) => v != null && String(v).trim() !== '')),
    sectionBar('Shift summary & overview'),
    summaryEntries.length ? kvTable(summaryEntries) : '<p style="font-size:9pt;color:#666;">—</p>',
  ];

  if (truckUpdates.length) {
    parts.push(sectionBar('Truck updates & logistics flow'));
    parts.push(
      dataTable(
        ['Time', 'Summary', 'Delays'],
        truckUpdates.map((u) => [u.time || '—', u.summary || '—', u.delays || '—'])
      )
    );
  }

  if (incidents.length) {
    parts.push(sectionBar('Incidents/breakdowns'));
    parts.push(
      dataTable(
        ['Truck', 'Time', 'Driver', 'Issue', 'Status'],
        incidents.map((i) => [i.truck_reg, i.time_reported, i.driver_name, i.issue, i.status])
      )
    );
  }

  if (nonComp.length) {
    parts.push(sectionBar('Non-compliance calls'));
    parts.push(
      dataTable(
        ['Driver', 'Truck', 'Rule violated', 'Time', 'Summary', 'Response'],
        nonComp.map((n) => [n.driver_name, n.truck_reg, n.rule_violated, n.time_of_call, n.summary, n.driver_response])
      )
    );
  }

  if (invRows.length) {
    parts.push(sectionBar('Investigations (findings & action taken)'));
    parts.push(dataTable(['Truck', 'Time', 'Location', 'Issue / Findings'], invRows));
  }

  if (comms.length) {
    parts.push(sectionBar('Communication log'));
    parts.push(
      dataTable(
        ['Time', 'Recipient', 'Subject', 'Method', 'Action required'],
        comms.map((c) => [c.time || '—', c.recipient || '—', c.subject || '—', c.method || '—', c.action_required || '—'])
      )
    );
  }

  const handoverRows = [
    ['Outstanding issues', report.outstanding_issues],
    ['Key information', report.handover_key_info],
  ].filter(([, v]) => v != null && String(v).trim() !== '');
  parts.push(sectionBar('Handover information for incoming controller'));
  parts.push(handoverRows.length ? kvTable(handoverRows) : '<p style="font-size:9pt;color:#666;">—</p>');

  const declText = (report.declaration || '').trim() || buildDeclaration(report);
  const declRows = [
    ['Declaration', declText],
    ['Shift conclusion time', report.shift_conclusion_time],
  ].filter(([, v]) => v != null && String(v).trim() !== '');
  parts.push(sectionBar('Controller declaration'));
  parts.push(kvTable(declRows));

  parts.push(sectionBar('Approvers / Approval information'));
  if (approverRows.length) {
    parts.push(dataTable(['Role', 'Name', 'Email', 'Date'], approverRows));
  } else {
    parts.push('<p style="font-size:9pt;color:#666;">No approval information recorded.</p>');
  }

  parts.push(`<p style="font-size:8pt;color:#888;margin-top:24px;">Generated ${h(new Date().toLocaleString())}</p>`);
  parts.push('</body></html>');

  return parts.join('\n');
}

/**
 * Trigger download of .doc file (Word opens HTML-based documents).
 */
export function downloadShiftReportTemplateWord(htmlString, filename = 'shift-report-template.doc') {
  const blob = new Blob([htmlString], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
