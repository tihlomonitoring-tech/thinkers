/** Build payload snapshot for shift report AI (matches save payload shape). */
export function buildShiftReportAiPayload({
  formFields,
  truckUpdates,
  incidents,
  nonComplianceCalls,
  investigations,
  commsLog,
  reportKind,
  selectedRoutes,
  otherRoutesText,
  truckDeliveries,
  routeLoadTotals,
}) {
  const filteredTruckUpdates = (truckUpdates || []).filter((u) => u.time || u.summary || u.delays);
  const filteredIncidents = (incidents || []).filter((i) => i.truck_reg || i.driver_name || i.issue);
  const filteredNonCompliance = (nonComplianceCalls || []).filter((n) => n.driver_name || n.truck_reg || n.rule_violated);
  const filteredInvestigations = (investigations || []).filter((inv) => inv.truck_reg || inv.issue_identified || inv.findings);
  const filteredComms = (commsLog || []).filter((c) => c.recipient || c.subject);

  const base = {
    ...(formFields || {}),
    truck_updates: filteredTruckUpdates,
    incidents: filteredIncidents,
    non_compliance_calls: filteredNonCompliance,
    investigations: filteredInvestigations,
    communication_log: filteredComms,
  };

  if (reportKind !== 'single_ops') return base;

  const routes = [...(selectedRoutes || [])];
  const extra = String(otherRoutesText || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = [...new Set([...routes, ...extra])];

  return {
    ...base,
    routes: merged,
    truck_deliveries: (truckDeliveries || []).filter(
      (r) => r.truck_registration || r.driver_name || r.completed_deliveries || r.remarks
    ),
    route_load_totals: (routeLoadTotals || []).filter((r) => r.route_name || r.total_loads_delivered),
  };
}
