/**
 * Sample single-operations shift report for PDF layout preview (not saved to the API).
 * @param {number} [rowsPerSection=10]
 * @param {object} [opts]
 * @param {string} [opts.createdByName]
 */
export function buildMockSingleOpsShiftReport(rowsPerSection = 10, opts = {}) {
  const n = Math.max(1, Math.min(50, Number(rowsPerSection) || 10));
  const pad = (i) => String(i + 1).padStart(2, '0');
  const today = new Date();
  const ymd = today.toISOString().slice(0, 10);
  const createdBy = opts.createdByName || 'Preview Controller';

  const routes = ['Majuba line', 'Bethal circuit', 'Anthra siding', 'Leandra return'];
  const routeLine = routes.join(', ');

  const truckUpdates = Array.from({ length: n }, (_, i) => ({
    time: `${String(5 + Math.floor(i / 2)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
    summary: `Fleet snapshot ${i + 1}: ${i % 3 === 0 ? 'Queuing at load point' : i % 3 === 1 ? 'En route to offload' : 'Parked — awaiting instruction'}.`,
    delays: i % 4 === 0 ? `Delay ${i + 1}: weather / traffic (+${15 + i} min).` : '',
  }));

  const incidents = Array.from({ length: n }, (_, i) => ({
    truck_reg: `GP${100000 + i * 11}L`,
    time_reported: `${String(6 + (i % 12)).padStart(2, '0')}:${pad(i)}`,
    driver_name: `Driver ${pad(i)}`,
    issue: i % 2 === 0 ? `Tyre pressure warning — truck ${i + 1}` : `Unscheduled stop reported (${i + 1})`,
    status: i % 3 === 0 ? 'Open' : 'Resolved',
  }));

  const nonComplianceCalls = Array.from({ length: n }, (_, i) => ({
    driver_name: `Driver ${pad((i + 3) % n)}`,
    truck_reg: `NC${2000 + i}GP`,
    rule_violated: i % 2 === 0 ? 'Speed limit corridor' : 'Rest period documentation',
    time_of_call: `${String(8 + (i % 8)).padStart(2, '0')}:15`,
    summary: `Call summary ${i + 1}: controller reminded operator of procedure.`,
    driver_response: i % 2 === 0 ? 'Acknowledged; corrective action taken.' : 'Disputed; follow-up scheduled.',
  }));

  const investigations = Array.from({ length: n }, (_, i) => ({
    truck_reg: `INV${300 + i}GP`,
    time: `${String(9 + (i % 5)).padStart(2, '0')}:30`,
    location: i % 2 === 0 ? 'N3 weighbridge' : 'Majuba gate',
    issue_identified: `Observation ${i + 1}: route adherence / documentation gap.`,
    findings: `Findings: verified GPS log; ${i % 2 === 0 ? 'minor discrepancy' : 'aligned with policy'}.`,
    action_taken: `Action: ${i % 2 === 0 ? 'Warning issued' : 'Transporter notified'}.`,
  }));

  const communicationLog = Array.from({ length: n }, (_, i) => ({
    time: `${String(10 + (i % 6)).padStart(2, '0')}:${pad((i * 3) % 60)}`,
    recipient: i % 3 === 0 ? 'Fleet manager' : i % 3 === 1 ? 'Client dispatch' : 'Workshop',
    subject: `Handover note ${i + 1} — shift coordination`,
    method: i % 2 === 0 ? 'WhatsApp' : 'Phone',
    action_required: i % 2 === 0 ? 'Confirm by 18:00' : 'None',
  }));

  const routeLoadTotals = Array.from({ length: n }, (_, i) => ({
    route_name: routes[i % routes.length] + (i >= routes.length ? ` (${Math.floor(i / routes.length) + 1})` : ''),
    total_loads_delivered: 12 + (i % 9),
  }));

  const truckDeliveries = Array.from({ length: n }, (_, i) => ({
    truck_registration: `KMRGMG${pad(i)}`,
    driver_name: ['Kea Modila', 'Thabo Nkosi', 'Nomsa Dlamini', 'Pieter van Wyk'][i % 4],
    completed_deliveries: 3 + (i % 8),
    remarks:
      i % 3 === 0
        ? 'The driver was lazy on paperwork; deliveries completed on time.'
        : i % 3 === 1
          ? 'Strong performance; assisted with backlog clearance.'
          : 'Minor delay at security; no further action.',
  }));

  return {
    id: 'mock-preview',
    report_kind: 'single_ops',
    routes,
    route: routeLine,
    report_date: ymd,
    shift_date: ymd,
    shift_start: '06:00',
    shift_end: '18:00',
    controller1_name: 'Primary Controller (Mock)',
    controller1_email: 'primary.controller@example.com',
    controller2_name: 'Secondary Controller (Mock)',
    controller2_email: 'secondary.controller@example.com',
    status: 'Mock preview',
    created_by_name: createdBy,
    created_at: today.toISOString(),
    tenant_name: 'Demo Logistics',
    total_trucks_scheduled: 48 + n,
    balance_brought_down: 6,
    total_loads_dispatched: 120 + n,
    total_pending_deliveries: 14,
    total_loads_delivered: 95 + n,
    overall_performance:
      'Mock single-operations shift: multi-route coverage with steady throughput. Bottlenecks cleared after midday. This paragraph demonstrates how overall performance wraps in the PDF summary section.',
    key_highlights:
      '• Routes balanced\n• No major safety incidents\n• Handover notes complete\n• (Mock data for layout preview)',
    truck_updates: truckUpdates,
    incidents,
    non_compliance_calls: nonComplianceCalls,
    investigations,
    communication_log: communicationLog,
    route_load_totals: routeLoadTotals,
    truck_deliveries: truckDeliveries,
    outstanding_issues: 'Mock outstanding: follow up on two transporter certificates (preview only).',
    handover_key_info: 'Mock handover: night shift to monitor Bethal queue and confirm Majuba loading window.',
    declaration:
      'As the controller(s) on duty, I/we certify that the information in this shift report is accurate and complete to the best of my/our knowledge. (Mock preview document.)',
    shift_conclusion_time: '17:45',
    submitted_to_name: 'Approver Example',
    submitted_to_email: 'approver@example.com',
    submitted_at: today.toISOString(),
    approved_by_name: 'Preview Approver',
    approved_at: today.toISOString(),
  };
}
