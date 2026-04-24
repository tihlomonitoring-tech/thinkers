import { useState, useEffect, useMemo } from 'react';
import { addCalendarDays, todayYmd, toYmdFromDbOrString } from './lib/appTime.js';
import { useAuth } from './AuthContext';
import { transportOperations as toApi, downloadAttachmentWithAuth } from './api';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import InfoHint from './components/InfoHint.jsx';

const TABS = [
  { id: 'shift_report', label: 'Shift Report', icon: 'clipboard', section: 'Operations' },
  { id: 'reports_approvals', label: 'Reports and approvals', icon: 'approval', section: 'Operations' },
  { id: 'operations_presentations', label: 'Operations Insights', icon: 'presentation', section: 'Operations' },
  { id: 'presentations', label: 'Presentations', icon: 'slides', section: 'Operations' },
  { id: 'truck_driver_registration', label: 'Truck and driver registration', icon: 'truck', section: 'Fleet' },
  { id: 'accounting', label: 'Accounting', icon: 'calculator', section: 'Accounting' },
];
const SECTIONS = [...new Set(TABS.map((t) => t.section))];

const SHIFT_OPTIONS = [
  { value: 'Day', label: 'Day shift' },
  { value: 'Night', label: 'Night' },
];

const REASON_MISSED_OPTIONS = [
  { value: '', label: '—' },
  { value: 'Traffic', label: 'Traffic' },
  { value: 'Mechanical', label: 'Mechanical' },
  { value: 'Loading Delay', label: 'Loading Delay' },
  { value: 'Driver Issue', label: 'Driver Issue' },
  { value: 'Weather', label: 'Weather' },
  { value: 'Other', label: 'Other' },
];

const REASON_NON_PARTICIPATING_OPTIONS = [
  { value: '', label: '—' },
  { value: 'Maintenance', label: 'Maintenance' },
  { value: 'No Driver', label: 'No Driver' },
  { value: 'No Load', label: 'No Load' },
  { value: 'Standby', label: 'Standby' },
];

function defaultActiveRow() {
  return {
    truck_id: '',
    driver_id: '',
    route_id: '',
    route: '',
    quantity_loaded: '',
    deliveries_completed: '',
    actual_target: '',
    revenue: '',
    reason_missed: '',
    action_taken: '',
    outcome: '',
  };
}

function defaultNonParticipatingRow() {
  return {
    truck_id: '',
    driver_id: '',
    reason: '',
    action_taken: '',
    outcome: '',
  };
}

function parseNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function formatCurrency(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'ZAR', minimumFractionDigits: 2 }).format(n);
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' });
}

/** Collapsible section block (like Command Centre shift report). */
function SectionBlock({ title, open, onToggle, children }) {
  const isOpen = open !== false;
  return (
    <div className="border border-surface-200 rounded-xl overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 bg-surface-50 hover:bg-surface-100 text-left">
        <span className="font-semibold text-surface-900">{title}</span>
        <span className="text-surface-500 text-lg leading-none">{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && <div className="p-4 pt-2 bg-white">{children}</div>}
    </div>
  );
}

function TabIcon({ name, className }) {
  const c = className || 'w-5 h-5';
  const path = (d) => <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d} />;
  switch (name) {
    case 'clipboard':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4')}
        </svg>
      );
    case 'truck':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M8 17h8m0 0a2 2 0 104 0 2 2 0 00-4 0m-4 0a2 2 0 104 0 2 2 0 00-4 0m0-6h.01M12 16h.01M5 8h14l1.921 2.876c.075.113.129.24.16.373a2 2 0 01-.16 1.751L20 14v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2l-.921-1.376a2 2 0 01-.16-1.751 1.006 1.006 0 01.16-.373L5 8z')}
        </svg>
      );
    case 'calculator':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z')}
        </svg>
      );
    case 'approval':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z')}
        </svg>
      );
    case 'presentation':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z')}
        </svg>
      );
    case 'slides':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {path('M9 17V7m-7 10a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2zm12 0a2 2 0 002-2v-2a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2zM4 7a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V7z')}
        </svg>
      );
    default:
      return <span className={c} />;
  }
}

const emptyTruck = {
  registration: '',
  make_model: '',
  fleet_no: '',
  trailer_1_reg_no: '',
  trailer_2_reg_no: '',
  commodity_type: '',
  capacity_tonnes: '',
  year_model: '',
  notes: '',
};

const emptyDriver = {
  full_name: '',
  license_number: '',
  license_expiry: '',
  phone: '',
  email: '',
  id_number: '',
  notes: '',
  user_id: '',
};

const emptyRoute = {
  name: '',
  collection_point: '',
  destination: '',
  rate: '',
  price_per_quantity: '',
  delivery_target: '',
  amount_target: '',
};

export default function TransportOperations() {
  const { user, loading: authLoading } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('transport-operations');
  const [activeTab, setActiveTab] = useState('shift_report');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Shared data (from Transport Operations API only)
  const [trucks, setTrucks] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [tenantUsers, setTenantUsers] = useState([]);

  // Shift report state
  const [controllerUserIds, setControllerUserIds] = useState([]);
  const [submittedToUserIds, setSubmittedToUserIds] = useState([]);
  const [controllerSearchQuery, setControllerSearchQuery] = useState('');
  const [submitToSearchQuery, setSubmitToSearchQuery] = useState('');
  const [routesSearchQuery, setRoutesSearchQuery] = useState('');
  const [shift, setShift] = useState('Day');
  const [reportDate, setReportDate] = useState(() => todayYmd());
  const [availableRoutes, setAvailableRoutes] = useState([]);
  const [activeRows, setActiveRows] = useState([defaultActiveRow()]);
  const [nonParticipatingRows, setNonParticipatingRows] = useState([defaultNonParticipatingRow()]);
  const [notesForNextController, setNotesForNextController] = useState('');
  const [declarationChecked, setDeclarationChecked] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Shift summary & overview (Command Centre style)
  const [shiftSummary, setShiftSummary] = useState({
    total_trucks_scheduled: '',
    balance_brought_down: '',
    total_loads_dispatched: '',
    total_pending_deliveries: '',
    total_loads_delivered: '',
    overall_performance: '',
    key_highlights: '',
  });
  const [truckUpdates, setTruckUpdates] = useState([{ time: '', summary: '', delays: '' }]);
  const [incidents, setIncidents] = useState([{ truck_reg: '', time_reported: '', driver_name: '', issue: '', status: '' }]);
  const [nonComplianceCalls, setNonComplianceCalls] = useState([{ driver_name: '', truck_reg: '', rule_violated: '', time_of_call: '', summary: '', driver_response: '' }]);
  const [investigations, setInvestigations] = useState([{ truck_reg: '', time: '', location: '', issue_identified: '', findings: '', action_taken: '' }]);
  const [commsLog, setCommsLog] = useState([{ time: '', recipient: '', subject: '', method: '', action_required: '' }]);
  const [openSection, setOpenSection] = useState('shift_details');
  const SHIFT_REPORT_SECTIONS = [
    { id: 'shift_details', label: 'Shift details' },
    { id: 'shift_summary', label: 'Shift summary & overview' },
    { id: 'truck_updates', label: 'Truck updates & logistics' },
    { id: 'incidents', label: 'Incidents/breakdowns' },
    { id: 'non_compliance', label: 'Non-compliance calls' },
    { id: 'investigations', label: 'Investigations' },
    { id: 'comms', label: 'Communication log' },
    { id: 'active_fleet', label: 'Active Fleet Log' },
    { id: 'non_participating', label: 'Non-Participating Trucks' },
    { id: 'handover', label: 'Handover & declaration' },
  ];

  // Truck and driver registration
  const [truckForm, setTruckForm] = useState(emptyTruck);
  const [editingTruckId, setEditingTruckId] = useState(null);
  const [showTruckForm, setShowTruckForm] = useState(false);
  const [driverForm, setDriverForm] = useState(emptyDriver);
  const [editingDriverId, setEditingDriverId] = useState(null);
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [savingTruck, setSavingTruck] = useState(false);
  const [savingDriver, setSavingDriver] = useState(false);

  // Accounting (routes with rates and targets)
  const [routeForm, setRouteForm] = useState(emptyRoute);
  const [editingRouteId, setEditingRouteId] = useState(null);
  const [showRouteForm, setShowRouteForm] = useState(false);
  const [savingRoute, setSavingRoute] = useState(false);

  // Reports and approvals
  const [reportsList, setReportsList] = useState([]);
  const [reportsFilter, setReportsFilter] = useState('pending');
  const [reportsLoading, setReportsLoading] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [reportDetail, setReportDetail] = useState(null);
  const [evalQuestions, setEvalQuestions] = useState([]);
  const [evaluationAnswers, setEvaluationAnswers] = useState({});
  const [evaluationComment, setEvaluationComment] = useState('');
  const [myEvaluation, setMyEvaluation] = useState(null);
  const [reportsDetailLoading, setReportsDetailLoading] = useState(false);
  const [savingEvaluation, setSavingEvaluation] = useState(false);
  const [approving, setApproving] = useState(false);

  // Operations Insights (insights, recommendations, accountability)
  const [presentationsDateFrom, setPresentationsDateFrom] = useState(() => addCalendarDays(todayYmd(), -30));
  const [presentationsDateTo, setPresentationsDateTo] = useState(() => todayYmd());
  const [presentationsInsights, setPresentationsInsights] = useState(null);
  const [presentationsLoading, setPresentationsLoading] = useState(false);
  const [presentationsError, setPresentationsError] = useState('');
  const [presentationsRecs, setPresentationsRecs] = useState([]);
  const [presentationsRecsLoading, setPresentationsRecsLoading] = useState(false);
  const [savingRecId, setSavingRecId] = useState(null);
  const [savingGeneratedRecs, setSavingGeneratedRecs] = useState(false);

  // Presentations (PowerPoint)
  const [presentationsPptxDateFrom, setPresentationsPptxDateFrom] = useState(() => addCalendarDays(todayYmd(), -30));
  const [presentationsPptxDateTo, setPresentationsPptxDateTo] = useState(() => todayYmd());
  const [presentationsPptxShift, setPresentationsPptxShift] = useState('');
  const [presentationsPptxDownloading, setPresentationsPptxDownloading] = useState(false);

  const hasTenant = user?.tenant_id;

  function loadData() {
    if (!hasTenant) return;
    setLoading(true);
    setError('');
    Promise.all([
      toApi.trucks.list().then((r) => r.trucks || []),
      toApi.routes.list().then((r) => r.routes || []),
      toApi.drivers.list().then((r) => r.drivers || []),
      toApi.tenantUsers().then((r) => {
        const list = r.users || [];
        const byId = new Map();
        list.forEach((u) => { if (u?.id != null && !byId.has(u.id)) byId.set(u.id, u); });
        return [...byId.values()];
      }),
    ])
      .then(([tList, rList, dList, uList]) => {
        setTrucks(tList);
        setRoutes(rList);
        setDrivers(dList);
        setTenantUsers(uList);
      })
      .catch((err) => setError(err?.message || 'Failed to load data'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (hasTenant) loadData();
    else setLoading(false);
  }, [hasTenant]);

  useEffect(() => {
    if (activeTab !== 'operations_presentations' || !hasTenant) return;
    setPresentationsRecsLoading(true);
    toApi.presentations.recommendations()
      .then((r) => setPresentationsRecs(r.recommendations || []))
      .catch(() => setPresentationsRecs([]))
      .finally(() => setPresentationsRecsLoading(false));
  }, [activeTab, hasTenant]);

  useEffect(() => {
    if (activeTab !== 'reports_approvals' || !hasTenant) return;
    setReportsLoading(true);
    toApi.shiftReports.list(reportsFilter === 'pending' ? { pending_my_approval: true } : {})
      .then((r) => setReportsList(r.reports || []))
      .catch(() => setReportsList([]))
      .finally(() => setReportsLoading(false));
  }, [activeTab, hasTenant, reportsFilter]);

  useEffect(() => {
    if (!selectedReportId || !hasTenant) {
      setReportDetail(null);
      setEvalQuestions([]);
      setMyEvaluation(null);
      setEvaluationAnswers({});
      setEvaluationComment('');
      return;
    }
    setReportsDetailLoading(true);
    Promise.all([
      toApi.shiftReports.get(selectedReportId),
      toApi.shiftReports.evaluationQuestions(selectedReportId),
      toApi.shiftReports.getEvaluation(selectedReportId),
    ])
      .then(([reportRes, qRes, evalRes]) => {
        setReportDetail(reportRes.report || null);
        setEvalQuestions(qRes.questions || []);
        const ev = evalRes.evaluation;
        setMyEvaluation(ev || null);
        if (ev?.answers && Array.isArray(ev.answers)) {
          const next = {};
          ev.answers.forEach((a) => { next[a.id || a.question_id] = a.value; });
          setEvaluationAnswers(next);
        } else {
          setEvaluationAnswers({});
        }
        setEvaluationComment(ev?.overall_comment || '');
      })
      .catch(() => {
        setReportDetail(null);
        setEvalQuestions([]);
        setMyEvaluation(null);
      })
      .finally(() => setReportsDetailLoading(false));
  }, [selectedReportId, hasTenant]);

  // Derived: target missed, revenue from quantity_loaded * price_per_quantity when route_id set, and summary
  const activeRowsWithDerived = useMemo(() => {
    return activeRows.map((row) => {
      const completed = parseNum(row.deliveries_completed);
      const target = parseNum(row.actual_target);
      const targetMissed = target != null && completed != null && completed < target;
      const quantityLoaded = parseNum(row.quantity_loaded);
      const route = row.route_id ? routes.find((r) => r.id === row.route_id) : null;
      const pricePerQty = route?.price_per_quantity != null ? Number(route.price_per_quantity) : null;
      const computedRevenue = quantityLoaded != null && pricePerQty != null ? quantityLoaded * pricePerQty : null;
      const revenueNum = parseNum(row.revenue) ?? computedRevenue;
      return { ...row, targetMissed, revenueNum, completed, target, quantityLoaded, computedRevenue };
    });
  }, [activeRows, routes]);

  const summary = useMemo(() => {
    let totalRevenue = 0;
    let totalDeliveries = 0;
    let totalTarget = 0;
    activeRowsWithDerived.forEach((r) => {
      if (r.revenueNum != null) totalRevenue += r.revenueNum;
      if (r.completed != null) totalDeliveries += r.completed;
      if (r.target != null) totalTarget += r.target;
    });
    const pctTargetMet = totalTarget > 0 ? Math.round((totalDeliveries / totalTarget) * 100) : null;
    return { totalRevenue, totalDeliveries, totalTarget, pctTargetMet };
  }, [activeRowsWithDerived]);

  const updateActiveRow = (index, field, value) => {
    setActiveRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addActiveRow = () => setActiveRows((prev) => [...prev, defaultActiveRow()]);
  const removeActiveRow = (index) => {
    if (activeRows.length <= 1) return;
    setActiveRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateNonParticipatingRow = (index, field, value) => {
    setNonParticipatingRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addNonParticipatingRow = () => setNonParticipatingRows((prev) => [...prev, defaultNonParticipatingRow()]);
  const removeNonParticipatingRow = (index) => {
    if (nonParticipatingRows.length <= 1) return;
    setNonParticipatingRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmitShiftReport = async (e) => {
    e.preventDefault();
    setSubmitStatus(null);
    setSubmitError('');
    if (!declarationChecked) {
      setSubmitError('Please confirm the declaration before submitting.');
      setSubmitStatus('error');
      return;
    }
    setSubmitting(true);
    const payload = {
      controller_user_ids: controllerUserIds,
      submitted_to_user_ids: submittedToUserIds,
      shift,
      report_date: reportDate,
      available_route_ids: availableRoutes,
      active_fleet_log: activeRowsWithDerived.map((r) => {
        const truck = trucks.find((t) => t.id === r.truck_id);
        const driver = drivers.find((d) => d.id === r.driver_id);
        return {
          truck_id: r.truck_id,
          truck_label: truck ? (truck.registration || truck.fleet_no || truck.id) : null,
          driver_id: r.driver_id || null,
          driver_name: driver ? (driver.full_name || driver.id) : null,
          route_id: r.route_id || null,
          route: r.route,
          quantity_loaded: parseNum(r.quantity_loaded),
          deliveries_completed: parseNum(r.deliveries_completed),
          actual_target: parseNum(r.actual_target),
          revenue: parseNum(r.revenue) ?? r.computedRevenue ?? null,
          target_missed: r.targetMissed,
          reason_missed: r.reason_missed || null,
          action_taken: r.action_taken || null,
          outcome: r.outcome || null,
        };
      }),
      non_participating: nonParticipatingRows.map((r) => {
        const truck = trucks.find((t) => t.id === r.truck_id);
        const driver = drivers.find((d) => d.id === r.driver_id);
        return {
          truck_id: r.truck_id,
          truck_label: truck ? (truck.registration || truck.fleet_no || truck.id) : null,
          driver_id: r.driver_id || null,
          driver_name: driver ? (driver.full_name || driver.id) : null,
          reason: r.reason || null,
          action_taken: r.action_taken || null,
          outcome: r.outcome || null,
        };
      }),
      notes_for_next_controller: notesForNextController.trim(),
      shift_summary: (shiftSummary.total_trucks_scheduled || shiftSummary.balance_brought_down || shiftSummary.total_loads_dispatched || shiftSummary.total_pending_deliveries || shiftSummary.total_loads_delivered || shiftSummary.overall_performance || shiftSummary.key_highlights) ? shiftSummary : null,
      truck_updates: truckUpdates.filter((u) => u.time || u.summary || u.delays),
      incidents: incidents.filter((i) => i.truck_reg || i.driver_name || i.issue),
      non_compliance_calls: nonComplianceCalls.filter((n) => n.driver_name || n.truck_reg || n.rule_violated),
      investigations: investigations.filter((inv) => inv.truck_reg || inv.issue_identified || inv.findings),
      communication_log: commsLog.filter((c) => c.recipient || c.subject),
    };
    try {
      await toApi.shiftReports.create(payload);
      setSubmitStatus('success');
      setSubmitError('');
    } catch (err) {
      setSubmitError(err?.message || 'Failed to save report');
      setSubmitStatus('error');
    } finally {
      setSubmitting(false);
    }
  };

  const saveTruck = async (e) => {
    e.preventDefault();
    setSavingTruck(true);
    try {
      if (editingTruckId) {
        await toApi.trucks.update(editingTruckId, truckForm);
        setEditingTruckId(null);
      } else {
        await toApi.trucks.create(truckForm);
      }
      setTruckForm(emptyTruck);
      setShowTruckForm(false);
      loadData();
    } catch (err) {
      setError(err?.message || 'Failed to save truck');
    } finally {
      setSavingTruck(false);
    }
  };

  const saveDriver = async (e) => {
    e.preventDefault();
    setSavingDriver(true);
    try {
      const payload = { ...driverForm };
      if (payload.user_id === '') delete payload.user_id;
      if (editingDriverId) {
        await toApi.drivers.update(editingDriverId, payload);
        setEditingDriverId(null);
      } else {
        await toApi.drivers.create(payload);
      }
      setDriverForm(emptyDriver);
      setShowDriverForm(false);
      loadData();
    } catch (err) {
      setError(err?.message || 'Failed to save driver');
    } finally {
      setSavingDriver(false);
    }
  };

  const saveRoute = async (e) => {
    e.preventDefault();
    setSavingRoute(true);
    try {
      const body = {
        name: routeForm.name || (routeForm.collection_point && routeForm.destination ? `${routeForm.collection_point} → ${routeForm.destination}` : 'Route'),
        collection_point: routeForm.collection_point || null,
        destination: routeForm.destination || null,
        rate: parseNum(routeForm.rate) ?? null,
        price_per_quantity: parseNum(routeForm.price_per_quantity) ?? null,
        delivery_target: parseNum(routeForm.delivery_target) ?? null,
        amount_target: parseNum(routeForm.amount_target) ?? null,
      };
      if (editingRouteId) {
        await toApi.routes.update(editingRouteId, body);
        setEditingRouteId(null);
      } else {
        await toApi.routes.create(body);
      }
      setRouteForm(emptyRoute);
      setShowRouteForm(false);
      loadData();
    } catch (err) {
      setError(err?.message || 'Failed to save route');
    } finally {
      setSavingRoute(false);
    }
  };

  const openEditTruck = (t) => {
    setEditingTruckId(t.id);
    setTruckForm({
      registration: t.registration || '',
      make_model: t.make_model || '',
      fleet_no: t.fleet_no || '',
      trailer_1_reg_no: t.trailer_1_reg_no || '',
      trailer_2_reg_no: t.trailer_2_reg_no || '',
      commodity_type: t.commodity_type || '',
      capacity_tonnes: t.capacity_tonnes ?? '',
      year_model: t.year_model || '',
      notes: t.notes || '',
    });
    setShowTruckForm(true);
  };

  const openEditDriver = (d) => {
    setEditingDriverId(d.id);
    setDriverForm({
      full_name: d.full_name || '',
      license_number: d.license_number || '',
      license_expiry: d.license_expiry ? d.license_expiry.slice(0, 10) : '',
      phone: d.phone || '',
      email: d.email || '',
      id_number: d.id_number || '',
      notes: d.notes || '',
      user_id: d.user_id || '',
    });
    setShowDriverForm(true);
  };

  const submitEvaluationForReport = async (e) => {
    e.preventDefault();
    if (!selectedReportId) return;
    setSavingEvaluation(true);
    try {
      const answers = evalQuestions.map((q) => ({ id: q.id, label: q.label, value: evaluationAnswers[q.id] ?? null }));
      await toApi.shiftReports.submitEvaluation(selectedReportId, { answers, overall_comment: evaluationComment });
      setMyEvaluation({ answers, overall_comment: evaluationComment });
    } catch (err) {
      setError(err?.message || 'Failed to save evaluation');
    } finally {
      setSavingEvaluation(false);
    }
  };

  const approveReport = async () => {
    if (!selectedReportId) return;
    setApproving(true);
    try {
      await toApi.shiftReports.approve(selectedReportId);
      setReportDetail((prev) => (prev ? { ...prev, status: 'approved' } : null));
      setReportsList((prev) => prev.map((r) => (r.id === selectedReportId ? { ...r, status: 'approved' } : r)));
    } catch (err) {
      setError(err?.message || 'Failed to approve');
    } finally {
      setApproving(false);
    }
  };

  const openEditRoute = (r) => {
    setEditingRouteId(r.id);
    setRouteForm({
      name: r.name || '',
      collection_point: r.collection_point || '',
      destination: r.destination || '',
      rate: r.rate ?? '',
      price_per_quantity: r.price_per_quantity ?? '',
      delivery_target: r.delivery_target ?? '',
      amount_target: r.amount_target ?? '',
    });
    setShowRouteForm(true);
  };

  const navAutoHideReady = !authLoading && !loading && !!hasTenant;
  useAutoHideNavAfterTabChange(activeTab, { ready: navAutoHideReady });

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="text-surface-500">Loading…</div>
      </div>
    );
  }

  if (!hasTenant) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-lg font-semibold text-amber-800">Transport Operations</h2>
        <p className="mt-2 text-sm text-amber-700">This area is available only to users linked to a company.</p>
      </div>
    );
  }

  return (
    <div className="flex gap-0 min-h-[calc(100vh-8rem)]">
      <nav className={`shrink-0 border-r border-surface-200 bg-white flex flex-col transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`} aria-label="Transport operations" aria-hidden={navHidden}>
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-surface-900">Transport Operations</h2>
            <p className="text-xs text-surface-500 mt-0.5">Shift reports, fleet & accounting</p>
            <p className="text-xs text-surface-500 mt-1.5">Showing data for <strong className="text-surface-700">{user?.tenant_name || 'your company'}</strong></p>
          </div>
          <button type="button" onClick={() => setNavHidden(true)} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Hide navigation" title="Hide navigation">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 w-72">
          {SECTIONS.map((section) => (
            <div key={section} className="mb-4">
              <p className="px-4 py-1.5 text-xs font-medium text-surface-400 uppercase tracking-wider">{section}</p>
              <ul className="space-y-0.5">
                {TABS.filter((t) => t.section === section).map((tab) => (
                  <li key={tab.id}>
                    <button
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                        activeTab === tab.id
                          ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium'
                          : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent'
                      }`}
                    >
                      <TabIcon name={tab.icon} className="w-5 h-5 shrink-0 text-inherit opacity-90" />
                      <span className="min-w-0 break-words">{tab.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="flex-1 min-w-0 overflow-auto p-4 sm:p-6 flex flex-col">
        {navHidden && (
          <button type="button" onClick={() => setNavHidden(false)} className="self-start flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-surface-50 text-sm font-medium shadow-sm" aria-label="Show navigation">
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            Show navigation
          </button>
        )}
        <div className="w-full max-w-7xl mx-auto flex-1">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm flex items-center justify-between">
              <span>{error}</span>
              <button type="button" onClick={() => setError('')} className="text-red-600 hover:underline">Dismiss</button>
            </div>
          )}

          {activeTab === 'shift_report' && (
            <form onSubmit={handleSubmitShiftReport} className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-lg font-semibold text-surface-900">Shift Report</h2>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setOpenSection(null)} className="text-xs px-3 py-1.5 rounded-lg border border-surface-300 text-surface-600 hover:bg-surface-100">Collapse all</button>
                  <button type="submit" disabled={submitting} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50">
                    {submitting ? 'Saving…' : 'Submit shift report'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Total Revenue (Shift)</p>
                  <p className="mt-1 text-2xl font-semibold text-surface-800">{formatCurrency(summary.totalRevenue)}</p>
                </div>
                <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Total Deliveries</p>
                  <p className="mt-1 text-2xl font-semibold text-surface-800">{summary.totalDeliveries}</p>
                </div>
                <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">% of Target Met</p>
                  <p className="mt-1 text-2xl font-semibold text-surface-800">{summary.pctTargetMet != null ? `${summary.pctTargetMet}%` : '—'}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-b border-surface-100 pb-3">
                {SHIFT_REPORT_SECTIONS.map((s) => (
                  <button key={s.id} type="button" onClick={() => setOpenSection((p) => (p === s.id ? null : s.id))} className={`text-xs px-3 py-1.5 rounded-full font-medium ${openSection === s.id ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}>{s.label}</button>
                ))}
              </div>

              <SectionBlock title="Shift details" open={openSection === 'shift_details'} onToggle={() => setOpenSection((p) => (p === 'shift_details' ? null : 'shift_details'))}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                  <div className="sm:col-span-2 lg:col-span-1">
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Controllers</label>
                    <div className="relative rounded-lg border border-surface-200 bg-white shadow-sm min-h-[2.75rem] focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500 transition-shadow">
                      <div className="flex flex-wrap gap-1.5 p-2">
                        {controllerUserIds.map((id) => {
                          const u = tenantUsers.find((x) => String(x.id) === id);
                          const label = u ? (u.full_name || u.email || id) : id;
                          return (
                            <span key={id} className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800">
                              <span className="max-w-[120px] truncate">{label}</span>
                              <button type="button" onClick={() => setControllerUserIds((prev) => prev.filter((i) => i !== id))} className="rounded p-0.5 hover:bg-brand-200/60 text-brand-700" aria-label="Remove">×</button>
                            </span>
                          );
                        })}
                        <input
                          type="text"
                          placeholder={controllerUserIds.length ? "Add another…" : "Search and select…"}
                          value={controllerSearchQuery}
                          onChange={(e) => setControllerSearchQuery(e.target.value)}
                          className="min-w-[8rem] flex-1 border-0 bg-transparent py-1.5 px-1 text-sm text-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-0"
                        />
                      </div>
                      {(() => {
                        const q = (controllerSearchQuery || '').trim().toLowerCase();
                        if (!q) return null;
                        const filtered = tenantUsers.filter((u) => {
                          if (controllerUserIds.includes(String(u.id))) return false;
                          const name = (u.full_name || '').toLowerCase();
                          const email = (u.email || '').toLowerCase();
                          return name.includes(q) || email.includes(q);
                        });
                        if (filtered.length === 0) return null;
                        return (
                          <ul className="absolute z-10 mt-0 w-full rounded-b-lg border border-t-0 border-surface-200 bg-white py-1 shadow-lg max-h-48 overflow-auto">
                            {filtered.slice(0, 50).map((u) => (
                              <li key={u.id}>
                                <button type="button" className="w-full px-3 py-2 text-left text-sm text-surface-700 hover:bg-surface-50 focus:bg-surface-50 focus:outline-none" onMouseDown={(e) => { e.preventDefault(); setControllerUserIds((prev) => [...prev, String(u.id)]); setControllerSearchQuery(''); }}>
                                  {u.full_name || u.email || u.id}
                                </button>
                              </li>
                            ))}
                          </ul>
                        );
                      })()}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Shift</label>
                    <select value={shift} onChange={(e) => setShift(e.target.value)} className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 shadow-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                      {SHIFT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Date</label>
                    <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-800 shadow-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-1">
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Available routes</label>
                    <div className="relative rounded-lg border border-surface-200 bg-white shadow-sm min-h-[2.75rem] focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500 transition-shadow">
                      <div className="flex flex-wrap gap-1.5 p-2">
                        {availableRoutes.map((id) => {
                          const r = routes.find((x) => String(x.id) === id);
                          const label = r ? (r.name || `${r.collection_point || '—'} → ${r.destination || '—'}`) : id;
                          return (
                            <span key={id} className="inline-flex items-center gap-1 rounded-md bg-surface-100 px-2 py-0.5 text-xs font-medium text-surface-700">
                              <span className="max-w-[140px] truncate">{label}</span>
                              <button type="button" onClick={() => setAvailableRoutes((prev) => prev.filter((i) => i !== id))} className="rounded p-0.5 hover:bg-surface-200 text-surface-500" aria-label="Remove">×</button>
                            </span>
                          );
                        })}
                        <input
                          type="text"
                          placeholder={availableRoutes.length ? "Add route…" : "Search and select routes…"}
                          value={routesSearchQuery}
                          onChange={(e) => setRoutesSearchQuery(e.target.value)}
                          className="min-w-[8rem] flex-1 border-0 bg-transparent py-1.5 px-1 text-sm text-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-0"
                        />
                      </div>
                      {(() => {
                        const q = (routesSearchQuery || '').trim().toLowerCase();
                        if (!q) return null;
                        const filtered = routes.filter((r) => {
                          if (availableRoutes.includes(String(r.id))) return false;
                          const name = (r.name || '').toLowerCase();
                          const from = (r.collection_point || '').toLowerCase();
                          const to = (r.destination || '').toLowerCase();
                          return name.includes(q) || from.includes(q) || to.includes(q);
                        });
                        if (filtered.length === 0) return null;
                        return (
                          <ul className="absolute z-10 mt-0 w-full rounded-b-lg border border-t-0 border-surface-200 bg-white py-1 shadow-lg max-h-48 overflow-auto">
                            {filtered.slice(0, 50).map((r) => (
                              <li key={r.id}>
                                <button type="button" className="w-full px-3 py-2 text-left text-sm text-surface-700 hover:bg-surface-50 focus:bg-surface-50 focus:outline-none" onMouseDown={(e) => { e.preventDefault(); setAvailableRoutes((prev) => [...prev, String(r.id)]); setRoutesSearchQuery(''); }}>
                                  {r.name || `${r.collection_point || '—'} → ${r.destination || '—'}`}
                                </button>
                              </li>
                            ))}
                          </ul>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-4">
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Submit to (approvers)</label>
                    <p className="text-xs text-surface-500 mb-1.5">Users who will see and approve this report.</p>
                    <div className="relative rounded-lg border border-surface-200 bg-white shadow-sm min-h-[2.75rem] focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500 transition-shadow">
                      <div className="flex flex-wrap gap-1.5 p-2">
                        {submittedToUserIds.map((id) => {
                          const u = tenantUsers.find((x) => String(x.id) === id);
                          const label = u ? (u.full_name || u.email || id) : id;
                          return (
                            <span key={id} className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                              <span className="max-w-[120px] truncate">{label}</span>
                              <button type="button" onClick={() => setSubmittedToUserIds((prev) => prev.filter((i) => i !== id))} className="rounded p-0.5 hover:bg-amber-200/60 text-amber-700" aria-label="Remove">×</button>
                            </span>
                          );
                        })}
                        <input
                          type="text"
                          placeholder={submittedToUserIds.length ? "Add another…" : "Search and select approvers…"}
                          value={submitToSearchQuery}
                          onChange={(e) => setSubmitToSearchQuery(e.target.value)}
                          className="min-w-[8rem] flex-1 border-0 bg-transparent py-1.5 px-1 text-sm text-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-0"
                        />
                      </div>
                      {(() => {
                        const q = (submitToSearchQuery || '').trim().toLowerCase();
                        if (!q) return null;
                        const filtered = tenantUsers.filter((u) => {
                          if (submittedToUserIds.includes(String(u.id))) return false;
                          const name = (u.full_name || '').toLowerCase();
                          const email = (u.email || '').toLowerCase();
                          return name.includes(q) || email.includes(q);
                        });
                        if (filtered.length === 0) return null;
                        return (
                          <ul className="absolute z-10 mt-0 w-full rounded-b-lg border border-t-0 border-surface-200 bg-white py-1 shadow-lg max-h-48 overflow-auto">
                            {filtered.slice(0, 50).map((u) => (
                              <li key={u.id}>
                                <button type="button" className="w-full px-3 py-2 text-left text-sm text-surface-700 hover:bg-surface-50 focus:bg-surface-50 focus:outline-none" onMouseDown={(e) => { e.preventDefault(); setSubmittedToUserIds((prev) => [...prev, String(u.id)]); setSubmitToSearchQuery(''); }}>
                                  {u.full_name || u.email || u.id}
                                </button>
                              </li>
                            ))}
                          </ul>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </SectionBlock>

              <SectionBlock title="Shift summary & overview" open={openSection === 'shift_summary'} onToggle={() => setOpenSection((p) => (p === 'shift_summary' ? null : 'shift_summary'))}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {['total_trucks_scheduled', 'balance_brought_down', 'total_loads_dispatched', 'total_pending_deliveries', 'total_loads_delivered'].map((key) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-surface-600 mb-1">{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</label>
                      <input type="text" value={shiftSummary[key] || ''} onChange={(e) => setShiftSummary((s) => ({ ...s, [key]: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" />
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <label className="block text-xs font-medium text-surface-600 mb-1">Overall performance</label>
                  <textarea value={shiftSummary.overall_performance || ''} onChange={(e) => setShiftSummary((s) => ({ ...s, overall_performance: e.target.value }))} rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" placeholder="Brief summary of shift performance" />
                </div>
                <div className="mt-4">
                  <label className="block text-xs font-medium text-surface-600 mb-1">Key highlights</label>
                  <textarea value={shiftSummary.key_highlights || ''} onChange={(e) => setShiftSummary((s) => ({ ...s, key_highlights: e.target.value }))} rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" placeholder="Brief bullet-style highlights" />
                </div>
              </SectionBlock>

              <SectionBlock title="Truck updates & logistics flow" open={openSection === 'truck_updates'} onToggle={() => setOpenSection((p) => (p === 'truck_updates' ? null : 'truck_updates'))}>
                <p className="text-xs text-surface-500 mb-3">Time-based snapshot of truck positions and delays.</p>
                {truckUpdates.map((row, i) => (
                  <div key={i} className="flex flex-wrap gap-3 items-start p-3 rounded-lg bg-surface-50 border border-surface-100 mb-2">
                    <input type="time" value={row.time} onChange={(e) => setTruckUpdates((prev) => prev.map((r, j) => (j === i ? { ...r, time: e.target.value } : r)))} className="w-28 rounded-lg border border-surface-300 px-2 py-2 text-sm" placeholder="Time" />
                    <input type="text" value={row.summary} onChange={(e) => setTruckUpdates((prev) => prev.map((r, j) => (j === i ? { ...r, summary: e.target.value } : r)))} className="flex-1 min-w-[200px] rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Summary (e.g. 1 truck parked, 4 en route)" />
                    <input type="text" value={row.delays} onChange={(e) => setTruckUpdates((prev) => prev.map((r, j) => (j === i ? { ...r, delays: e.target.value } : r)))} className="w-48 rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Delays" />
                    <button type="button" onClick={() => setTruckUpdates((prev) => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)} className="text-surface-400 hover:text-red-600 p-2" aria-label="Remove">×</button>
                  </div>
                ))}
                <button type="button" onClick={() => setTruckUpdates((prev) => [...prev, { time: '', summary: '', delays: '' }])} className="text-sm font-medium text-brand-600 hover:text-brand-700">+ Add truck update</button>
              </SectionBlock>

              <SectionBlock title="Incidents/breakdowns" open={openSection === 'incidents'} onToggle={() => setOpenSection((p) => (p === 'incidents' ? null : 'incidents'))}>
                {incidents.map((row, i) => (
                  <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 rounded-lg bg-surface-50 border border-surface-100 mb-2">
                    <select value={row.truck_reg} onChange={(e) => setIncidents((prev) => prev.map((r, j) => (j === i ? { ...r, truck_reg: e.target.value } : r)))} className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm">
                      <option value="">Truck</option>
                      {trucks.map((t) => <option key={t.id} value={t.registration || t.fleet_no || t.id}>{t.registration || t.fleet_no || t.id}</option>)}
                    </select>
                    <input type="time" value={row.time_reported} onChange={(e) => setIncidents((prev) => prev.map((r, j) => (j === i ? { ...r, time_reported: e.target.value } : r)))} placeholder="Time" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                    <select value={row.driver_name} onChange={(e) => setIncidents((prev) => prev.map((r, j) => (j === i ? { ...r, driver_name: e.target.value } : r)))} className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm">
                      <option value="">Driver</option>
                      {drivers.map((d) => <option key={d.id} value={d.full_name || ''}>{d.full_name || d.email || d.id}</option>)}
                    </select>
                    <input type="text" value={row.issue} onChange={(e) => setIncidents((prev) => prev.map((r, j) => (j === i ? { ...r, issue: e.target.value } : r)))} placeholder="Issue" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                    <div className="flex gap-1 items-center">
                      <input type="text" value={row.status} onChange={(e) => setIncidents((prev) => prev.map((r, j) => (j === i ? { ...r, status: e.target.value } : r)))} placeholder="Status" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm flex-1" />
                      <button type="button" onClick={() => setIncidents((prev) => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)} className="text-surface-400 hover:text-red-600 text-sm">Remove</button>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setIncidents((prev) => [...prev, { truck_reg: '', time_reported: '', driver_name: '', issue: '', status: '' }])} className="text-sm font-medium text-brand-600 hover:text-brand-700">+ Add incident</button>
              </SectionBlock>

              <SectionBlock title="Non-compliance calls" open={openSection === 'non_compliance'} onToggle={() => setOpenSection((p) => (p === 'non_compliance' ? null : 'non_compliance'))}>
                {nonComplianceCalls.map((row, i) => (
                  <div key={i} className="grid grid-cols-2 sm:grid-cols-6 gap-2 p-3 rounded-lg bg-amber-50/50 border border-amber-100 mb-2">
                    <select value={row.driver_name} onChange={(e) => setNonComplianceCalls((prev) => prev.map((r, j) => (j === i ? { ...r, driver_name: e.target.value } : r)))} className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm">
                      <option value="">Driver</option>
                      {drivers.map((d) => <option key={d.id} value={d.full_name || ''}>{d.full_name || d.email || d.id}</option>)}
                    </select>
                    <select value={row.truck_reg} onChange={(e) => setNonComplianceCalls((prev) => prev.map((r, j) => (j === i ? { ...r, truck_reg: e.target.value } : r)))} className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm">
                      <option value="">Truck</option>
                      {trucks.map((t) => <option key={t.id} value={t.registration || t.fleet_no || t.id}>{t.registration || t.fleet_no || t.id}</option>)}
                    </select>
                    <input type="text" value={row.rule_violated} onChange={(e) => setNonComplianceCalls((prev) => prev.map((r, j) => (j === i ? { ...r, rule_violated: e.target.value } : r)))} placeholder="Rule violated" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                    <input type="text" value={row.time_of_call} onChange={(e) => setNonComplianceCalls((prev) => prev.map((r, j) => (j === i ? { ...r, time_of_call: e.target.value } : r)))} placeholder="Time" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                    <input type="text" value={row.summary} onChange={(e) => setNonComplianceCalls((prev) => prev.map((r, j) => (j === i ? { ...r, summary: e.target.value } : r)))} placeholder="Summary" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm col-span-2" />
                    <input type="text" value={row.driver_response} onChange={(e) => setNonComplianceCalls((prev) => prev.map((r, j) => (j === i ? { ...r, driver_response: e.target.value } : r)))} placeholder="Driver response" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm col-span-2" />
                    <button type="button" onClick={() => setNonComplianceCalls((prev) => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)} className="text-sm text-surface-400 hover:text-red-600">Remove</button>
                  </div>
                ))}
                <button type="button" onClick={() => setNonComplianceCalls((prev) => [...prev, { driver_name: '', truck_reg: '', rule_violated: '', time_of_call: '', summary: '', driver_response: '' }])} className="text-sm font-medium text-brand-600 hover:text-brand-700">+ Add non-compliance call</button>
              </SectionBlock>

              <SectionBlock title="Investigations (findings & action taken)" open={openSection === 'investigations'} onToggle={() => setOpenSection((p) => (p === 'investigations' ? null : 'investigations'))}>
                {investigations.map((row, i) => (
                  <div key={i} className="p-3 rounded-lg bg-surface-50 border border-surface-100 mb-2 space-y-2">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <select value={row.truck_reg} onChange={(e) => setInvestigations((prev) => prev.map((r, j) => (j === i ? { ...r, truck_reg: e.target.value } : r)))} className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm">
                        <option value="">Truck</option>
                        {trucks.map((t) => <option key={t.id} value={t.registration || t.fleet_no || t.id}>{t.registration || t.fleet_no || t.id}</option>)}
                      </select>
                      <input type="text" value={row.time} onChange={(e) => setInvestigations((prev) => prev.map((r, j) => (j === i ? { ...r, time: e.target.value } : r)))} placeholder="Time" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                      <input type="text" value={row.location} onChange={(e) => setInvestigations((prev) => prev.map((r, j) => (j === i ? { ...r, location: e.target.value } : r)))} placeholder="Location" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm sm:col-span-2" />
                    </div>
                    <input type="text" value={row.issue_identified} onChange={(e) => setInvestigations((prev) => prev.map((r, j) => (j === i ? { ...r, issue_identified: e.target.value } : r)))} placeholder="Issue identified (e.g. Overspeeding, unscheduled stop)" className="w-full rounded-lg border border-surface-300 px-3 py-1.5 text-sm" />
                    <textarea value={row.findings} onChange={(e) => setInvestigations((prev) => prev.map((r, j) => (j === i ? { ...r, findings: e.target.value } : r)))} placeholder="Findings" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-1.5 text-sm" />
                    <textarea value={row.action_taken} onChange={(e) => setInvestigations((prev) => prev.map((r, j) => (j === i ? { ...r, action_taken: e.target.value } : r)))} placeholder="Action taken (e.g. Warning issued. Transporter notified.)" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-1.5 text-sm" />
                    <button type="button" onClick={() => setInvestigations((prev) => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)} className="text-sm text-surface-400 hover:text-red-600">Remove</button>
                  </div>
                ))}
                <button type="button" onClick={() => setInvestigations((prev) => [...prev, { truck_reg: '', time: '', location: '', issue_identified: '', findings: '', action_taken: '' }])} className="text-sm font-medium text-brand-600 hover:text-brand-700">+ Add investigation</button>
              </SectionBlock>

              <SectionBlock title="Communication log" open={openSection === 'comms'} onToggle={() => setOpenSection((p) => (p === 'comms' ? null : 'comms'))}>
                {commsLog.map((row, i) => (
                  <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 rounded-lg bg-surface-50 border border-surface-100 mb-2">
                    <input type="time" value={row.time} onChange={(e) => setCommsLog((prev) => prev.map((r, j) => (j === i ? { ...r, time: e.target.value } : r)))} placeholder="Time" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                    <input type="text" value={row.recipient} onChange={(e) => setCommsLog((prev) => prev.map((r, j) => (j === i ? { ...r, recipient: e.target.value } : r)))} placeholder="Recipient" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                    <input type="text" value={row.subject} onChange={(e) => setCommsLog((prev) => prev.map((r, j) => (j === i ? { ...r, subject: e.target.value } : r)))} placeholder="Subject" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                    <input type="text" value={row.method} onChange={(e) => setCommsLog((prev) => prev.map((r, j) => (j === i ? { ...r, method: e.target.value } : r)))} placeholder="Method (e.g. WhatsApp/Call)" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                    <div className="flex gap-1 items-center">
                      <input type="text" value={row.action_required} onChange={(e) => setCommsLog((prev) => prev.map((r, j) => (j === i ? { ...r, action_required: e.target.value } : r)))} placeholder="Action required" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm flex-1" />
                      <button type="button" onClick={() => setCommsLog((prev) => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)} className="text-surface-400 hover:text-red-600 text-sm">Remove</button>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setCommsLog((prev) => [...prev, { time: '', recipient: '', subject: '', method: '', action_required: '' }])} className="text-sm font-medium text-brand-600 hover:text-brand-700">+ Add communication</button>
              </SectionBlock>

              <SectionBlock title="Active Fleet Logistics Log" open={openSection === 'active_fleet'} onToggle={() => setOpenSection((p) => (p === 'active_fleet' ? null : 'active_fleet'))}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead>
                      <tr className="bg-surface-100 text-left">
                        <th className="px-3 py-2 font-medium text-surface-600">Truck</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Driver</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Route</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Quantity loaded</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Deliveries completed</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Actual target</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Revenue</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Target missed?</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Reason for missed target</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Action taken</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Outcome</th>
                        <th className="px-3 py-2 w-20" />
                      </tr>
                    </thead>
                    <tbody>
                      {activeRowsWithDerived.map((row, index) => (
                        <tr key={index} className={`border-t border-surface-100 ${row.targetMissed ? 'bg-red-50' : ''}`}>
                          <td className="px-3 py-2">
                            <select value={row.truck_id} onChange={(e) => updateActiveRow(index, 'truck_id', e.target.value)} className={`w-full rounded border px-2 py-1.5 text-surface-800 ${row.targetMissed ? 'border-red-200 bg-white' : 'border-surface-300'}`} title="Truck registration">
                              <option value="">—</option>
                              {trucks.map((t) => <option key={t.id} value={t.id}>{t.registration || t.fleet_no || t.id}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select value={row.driver_id || ''} onChange={(e) => updateActiveRow(index, 'driver_id', e.target.value)} className={`w-full rounded border px-2 py-1.5 text-surface-800 min-w-[100px] ${row.targetMissed ? 'border-red-200' : 'border-surface-300'}`}>
                              <option value="">—</option>
                              {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name || d.email || d.id}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select value={row.route_id} onChange={(e) => updateActiveRow(index, 'route_id', e.target.value)} className={`w-full rounded border px-2 py-1.5 text-surface-800 min-w-[120px] ${row.targetMissed ? 'border-red-200' : 'border-surface-300'}`}>
                              <option value="">—</option>
                              {routes.map((r) => <option key={r.id} value={r.id}>{r.name || `${r.collection_point || '—'} → ${r.destination || '—'}`}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min={0} value={row.quantity_loaded} onChange={(e) => updateActiveRow(index, 'quantity_loaded', e.target.value)} className={`w-full rounded border px-2 py-1.5 text-surface-800 w-20 ${row.targetMissed ? 'border-red-200' : 'border-surface-300'}`} placeholder="0" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min={0} value={row.deliveries_completed} onChange={(e) => updateActiveRow(index, 'deliveries_completed', e.target.value)} className={`w-full rounded border px-2 py-1.5 text-surface-800 w-20 ${row.targetMissed ? 'border-red-200' : 'border-surface-300'}`} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" min={0} value={row.actual_target} onChange={(e) => updateActiveRow(index, 'actual_target', e.target.value)} className={`w-full rounded border px-2 py-1.5 text-surface-800 w-20 ${row.targetMissed ? 'border-red-200' : 'border-surface-300'}`} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="text" value={row.revenue} onChange={(e) => updateActiveRow(index, 'revenue', e.target.value)} placeholder={row.computedRevenue != null ? String(row.computedRevenue) : '0.00'} className={`w-full rounded border px-2 py-1.5 text-surface-800 min-w-[90px] ${row.targetMissed ? 'border-red-200' : 'border-surface-300'}`} title={row.computedRevenue != null ? `Auto: ${row.computedRevenue}` : ''} />
                          </td>
                          <td className="px-3 py-2">
                            <span className={`font-medium ${row.targetMissed ? 'text-red-600' : 'text-surface-600'}`}>{row.targetMissed ? 'Yes' : 'No'}</span>
                          </td>
                          <td className="px-3 py-2">
                            <select value={row.reason_missed} onChange={(e) => updateActiveRow(index, 'reason_missed', e.target.value)} className={`w-full rounded border px-2 py-1.5 text-surface-800 min-w-[120px] ${row.targetMissed ? 'border-red-300 bg-red-50' : 'border-surface-300'}`}>
                              {REASON_MISSED_OPTIONS.map((o) => <option key={o.value || 'empty'} value={o.value}>{o.label}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="text" value={row.action_taken} onChange={(e) => updateActiveRow(index, 'action_taken', e.target.value)} className={`w-full rounded border px-2 py-1.5 text-surface-800 min-w-[100px] ${row.targetMissed ? 'border-red-200' : 'border-surface-300'}`} />
                          </td>
                          <td className="px-3 py-2">
                            <input type="text" value={row.outcome} onChange={(e) => updateActiveRow(index, 'outcome', e.target.value)} className={`w-full rounded border px-2 py-1.5 text-surface-800 min-w-[100px] ${row.targetMissed ? 'border-red-200' : 'border-surface-300'}`} />
                          </td>
                          <td className="px-3 py-2">
                            <button type="button" onClick={() => removeActiveRow(index)} disabled={activeRows.length <= 1} className="text-red-600 hover:text-red-700 disabled:opacity-40 text-xs font-medium">Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-6 py-3 border-t border-surface-200 bg-surface-50">
                  <button type="button" onClick={addActiveRow} className="text-sm font-medium text-brand-600 hover:text-brand-700">+ Add row</button>
                </div>
              </SectionBlock>

              <SectionBlock title="Non-Participating Trucks" open={openSection === 'non_participating'} onToggle={() => setOpenSection((p) => (p === 'non_participating' ? null : 'non_participating'))}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead>
                      <tr className="bg-surface-100 text-left">
                        <th className="px-3 py-2 font-medium text-surface-600">Truck</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Driver</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Reason</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Action taken</th>
                        <th className="px-3 py-2 font-medium text-surface-600">Outcome / status</th>
                        <th className="px-3 py-2 w-20" />
                      </tr>
                    </thead>
                    <tbody>
                      {nonParticipatingRows.map((row, index) => (
                        <tr key={index} className="border-t border-surface-100">
                          <td className="px-3 py-2">
                            <select value={row.truck_id} onChange={(e) => updateNonParticipatingRow(index, 'truck_id', e.target.value)} className="w-full rounded border border-surface-300 px-2 py-1.5 text-surface-800" title="Truck registration">
                              <option value="">—</option>
                              {trucks.map((t) => <option key={t.id} value={t.id}>{t.registration || t.fleet_no || t.id}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select value={row.driver_id || ''} onChange={(e) => updateNonParticipatingRow(index, 'driver_id', e.target.value)} className="w-full rounded border border-surface-300 px-2 py-1.5 text-surface-800 min-w-[100px]">
                              <option value="">—</option>
                              {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name || d.email || d.id}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select value={row.reason} onChange={(e) => updateNonParticipatingRow(index, 'reason', e.target.value)} className="w-full rounded border border-surface-300 px-2 py-1.5 text-surface-800">
                              {REASON_NON_PARTICIPATING_OPTIONS.map((o) => <option key={o.value || 'empty'} value={o.value}>{o.label}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="text" value={row.action_taken} onChange={(e) => updateNonParticipatingRow(index, 'action_taken', e.target.value)} className="w-full rounded border border-surface-300 px-2 py-1.5 text-surface-800 min-w-[120px]" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="text" value={row.outcome} onChange={(e) => updateNonParticipatingRow(index, 'outcome', e.target.value)} className="w-full rounded border border-surface-300 px-2 py-1.5 text-surface-800 min-w-[120px]" />
                          </td>
                          <td className="px-3 py-2">
                            <button type="button" onClick={() => removeNonParticipatingRow(index)} disabled={nonParticipatingRows.length <= 1} className="text-red-600 hover:text-red-700 disabled:opacity-40 text-xs font-medium">Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-6 py-3 border-t border-surface-200 bg-surface-50">
                  <button type="button" onClick={addNonParticipatingRow} className="text-sm font-medium text-brand-600 hover:text-brand-700">+ Add row</button>
                </div>
              </SectionBlock>

              <SectionBlock title="Handover & declaration" open={openSection === 'handover'} onToggle={() => setOpenSection((p) => (p === 'handover' ? null : 'handover'))}>
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">Notes for next controller</label>
                  <textarea value={notesForNextController} onChange={(e) => setNotesForNextController(e.target.value)} rows={4} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800 focus:ring-2 focus:ring-brand-500 focus:border-brand-500" placeholder="Add any handover notes…" />
                </div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={declarationChecked} onChange={(e) => setDeclarationChecked(e.target.checked)} className="mt-1 rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
                  <span className="text-sm text-surface-700">I hereby declare this information is an accurate reflection of the shift.</span>
                </label>
                {submitStatus === 'error' && submitError && <p className="text-sm text-red-600">{submitError}</p>}
                {submitStatus === 'success' && <p className="text-sm text-green-600 font-medium">Shift report saved successfully.</p>}
                <button type="submit" disabled={submitting} className="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-700 focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50">
                  {submitting ? 'Saving…' : 'Submit shift report'}
                </button>
              </SectionBlock>
            </form>
          )}

          {activeTab === 'reports_approvals' && (
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-surface-900">Reports and approvals</h2>
                <InfoHint title="Reports and approvals help" text="View shift reports submitted for your approval. Complete the evaluation, then approve. Once approved, the report is available for PDF download (evaluation results appear on a separate page in the PDF)." />
              </div>

              <div className="flex gap-2 items-center">
                <span className="text-sm text-surface-600">Show:</span>
                <button type="button" onClick={() => setReportsFilter('pending')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${reportsFilter === 'pending' ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-700 hover:bg-surface-200'}`}>Pending my approval</button>
                <button type="button" onClick={() => setReportsFilter('all')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${reportsFilter === 'all' ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-700 hover:bg-surface-200'}`}>All reports</button>
              </div>

              {!selectedReportId ? (
                <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
                  {reportsLoading ? <p className="p-6 text-surface-500">Loading…</p> : reportsList.length === 0 ? <p className="p-6 text-surface-500">No reports found.</p> : (
                    <table className="w-full text-sm">
                      <thead className="bg-surface-50 border-b border-surface-200">
                        <tr>
                          <th className="text-left p-3 font-medium text-surface-700">Date</th>
                          <th className="text-left p-3 font-medium text-surface-700">Shift</th>
                          <th className="text-left p-3 font-medium text-surface-700">Controllers</th>
                          <th className="text-left p-3 font-medium text-surface-700">Status</th>
                          <th className="p-3 w-28" />
                        </tr>
                      </thead>
                      <tbody>
                        {reportsList.map((r) => (
                          <tr key={r.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                            <td className="p-3">{formatDate(r.report_date)}</td>
                            <td className="p-3">{r.shift || '—'}</td>
                            <td className="p-3">{(() => { try { const ids = typeof r.controller_user_ids === 'string' ? JSON.parse(r.controller_user_ids || '[]') : (r.controller_user_ids || []); return Array.isArray(ids) && ids.length ? `${ids.length} controller(s)` : (r.controller_name || '—'); } catch (_) { return r.controller_name || '—'; } })()}</td>
                            <td className="p-3"><span className={`font-medium ${r.status === 'approved' ? 'text-green-600' : r.status === 'pending_approval' ? 'text-amber-600' : 'text-surface-600'}`}>{r.status === 'approved' ? 'Approved' : r.status === 'pending_approval' ? 'Pending approval' : 'Draft'}</span></td>
                            <td className="p-3">
                              <button type="button" onClick={() => setSelectedReportId(r.id)} className="text-brand-600 hover:underline font-medium">View</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  <button type="button" onClick={() => setSelectedReportId(null)} className="text-sm font-medium text-surface-600 hover:text-surface-800">← Back to list</button>
                  {reportsDetailLoading ? (
                    <div className="rounded-xl border border-surface-200 bg-white p-12 text-center">
                      <p className="text-surface-500">Loading report…</p>
                    </div>
                  ) : reportDetail && (
                    <>
                      {/* Report header */}
                      <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
                        <div className="bg-gradient-to-r from-surface-800 to-surface-700 px-6 py-4 text-white">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <h2 className="text-lg font-semibold tracking-tight">Shift report</h2>
                              <p className="text-surface-200 text-sm mt-0.5">
                                {formatDate(reportDetail.report_date)} · {reportDetail.shift || '—'} shift
                                {reportDetail.controller_user_names?.length ? ` · ${reportDetail.controller_user_names.join(', ')}` : reportDetail.controller_name ? ` · ${reportDetail.controller_name}` : ''}
                              </p>
                            </div>
                            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                              reportDetail.status === 'approved' ? 'bg-green-500/20 text-green-200' :
                              reportDetail.status === 'pending_approval' ? 'bg-amber-500/20 text-amber-200' :
                              'bg-surface-500/20 text-surface-200'
                            }`}>
                              {reportDetail.status === 'approved' ? 'Approved' : reportDetail.status === 'pending_approval' ? 'Pending approval' : reportDetail.status || '—'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Notes for next controller */}
                      <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
                        <div className="border-b border-surface-100 bg-surface-50/80 px-5 py-3">
                          <h3 className="text-sm font-semibold text-surface-800">Notes for next controller</h3>
                        </div>
                        <div className="p-5">
                          <p className="text-sm text-surface-700 whitespace-pre-wrap leading-relaxed">{reportDetail.notes_for_next_controller?.trim() || '—'}</p>
                        </div>
                      </div>

                      {/* Shift summary & overview */}
                      <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
                        <div className="border-b border-surface-100 bg-surface-50/80 px-5 py-3">
                          <h3 className="text-sm font-semibold text-surface-800">Shift summary & overview</h3>
                        </div>
                        <div className="p-5">
                          {reportDetail.shift_summary && (reportDetail.shift_summary.total_trucks_scheduled != null || reportDetail.shift_summary.balance_brought_down != null || reportDetail.shift_summary.total_loads_dispatched != null || reportDetail.shift_summary.total_pending_deliveries != null || reportDetail.shift_summary.total_loads_delivered != null || reportDetail.shift_summary.overall_performance || reportDetail.shift_summary.key_highlights) ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                              {reportDetail.shift_summary.total_trucks_scheduled != null && (
                                <div className="rounded-lg bg-surface-50 p-4 border border-surface-100">
                                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Total trucks scheduled</p>
                                  <p className="text-lg font-semibold text-surface-900 mt-1">{reportDetail.shift_summary.total_trucks_scheduled}</p>
                                </div>
                              )}
                              {reportDetail.shift_summary.balance_brought_down != null && (
                                <div className="rounded-lg bg-surface-50 p-4 border border-surface-100">
                                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Balance brought down</p>
                                  <p className="text-lg font-semibold text-surface-900 mt-1">{reportDetail.shift_summary.balance_brought_down}</p>
                                </div>
                              )}
                              {reportDetail.shift_summary.total_loads_dispatched != null && (
                                <div className="rounded-lg bg-surface-50 p-4 border border-surface-100">
                                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Total loads dispatched</p>
                                  <p className="text-lg font-semibold text-surface-900 mt-1">{reportDetail.shift_summary.total_loads_dispatched}</p>
                                </div>
                              )}
                              {reportDetail.shift_summary.total_pending_deliveries != null && (
                                <div className="rounded-lg bg-surface-50 p-4 border border-surface-100">
                                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Total pending deliveries</p>
                                  <p className="text-lg font-semibold text-surface-900 mt-1">{reportDetail.shift_summary.total_pending_deliveries}</p>
                                </div>
                              )}
                              {reportDetail.shift_summary.total_loads_delivered != null && (
                                <div className="rounded-lg bg-surface-50 p-4 border border-surface-100">
                                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Total loads delivered</p>
                                  <p className="text-lg font-semibold text-surface-900 mt-1">{reportDetail.shift_summary.total_loads_delivered}</p>
                                </div>
                              )}
                              {(reportDetail.shift_summary.overall_performance || reportDetail.shift_summary.key_highlights) && (
                                <div className="sm:col-span-2 lg:col-span-3 rounded-lg bg-surface-50 p-4 border border-surface-100 space-y-3">
                                  {reportDetail.shift_summary.overall_performance && (
                                    <div>
                                      <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Overall performance</p>
                                      <p className="text-sm text-surface-800 mt-1">{reportDetail.shift_summary.overall_performance}</p>
                                    </div>
                                  )}
                                  {reportDetail.shift_summary.key_highlights && (
                                    <div>
                                      <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Key highlights</p>
                                      <p className="text-sm text-surface-800 mt-1">{reportDetail.shift_summary.key_highlights}</p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-surface-500">No summary data.</p>
                          )}
                        </div>
                      </div>

                      {/* Truck updates & logistics flow */}
                      <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
                        <div className="border-b border-surface-100 bg-surface-50/80 px-5 py-3">
                          <h3 className="text-sm font-semibold text-surface-800">Truck updates & logistics flow</h3>
                        </div>
                        <div className="overflow-x-auto">
                          {reportDetail.truck_updates?.length > 0 ? (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-surface-50 border-b border-surface-200">
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Time</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Summary</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Delays</th>
                                </tr>
                              </thead>
                              <tbody>
                                {reportDetail.truck_updates.map((u, i) => (
                                  <tr key={i} className="border-b border-surface-100 hover:bg-surface-50/50">
                                    <td className="py-2.5 px-4 text-surface-800 font-medium">{u.time || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{u.summary || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-600">{u.delays || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="p-5 text-sm text-surface-500">No truck updates recorded.</div>
                          )}
                        </div>
                      </div>

                      {/* Incidents/breakdowns */}
                      <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
                        <div className="border-b border-surface-100 bg-surface-50/80 px-5 py-3">
                          <h3 className="text-sm font-semibold text-surface-800">Incidents / breakdowns</h3>
                        </div>
                        <div className="overflow-x-auto">
                          {reportDetail.incidents?.length > 0 ? (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-surface-50 border-b border-surface-200">
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Truck</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Time</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Driver</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Issue</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {reportDetail.incidents.map((i, idx) => (
                                  <tr key={idx} className="border-b border-surface-100 hover:bg-surface-50/50">
                                    <td className="py-2.5 px-4 text-surface-800 font-medium">{i.truck_reg || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{i.time_reported || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{i.driver_name || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{i.issue || '—'}</td>
                                    <td className="py-2.5 px-4"><span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">{i.status || '—'}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="p-5 text-sm text-surface-500">No incidents recorded.</div>
                          )}
                        </div>
                      </div>

                      {/* Non-compliance calls */}
                      <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
                        <div className="border-b border-surface-100 bg-surface-50/80 px-5 py-3">
                          <h3 className="text-sm font-semibold text-surface-800">Non-compliance calls</h3>
                        </div>
                        <div className="overflow-x-auto">
                          {reportDetail.non_compliance_calls?.length > 0 ? (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-surface-50 border-b border-surface-200">
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Driver</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Truck</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Rule violated</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Time</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Summary</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Response</th>
                                </tr>
                              </thead>
                              <tbody>
                                {reportDetail.non_compliance_calls.map((n, idx) => (
                                  <tr key={idx} className="border-b border-surface-100 hover:bg-surface-50/50">
                                    <td className="py-2.5 px-4 text-surface-800 font-medium">{n.driver_name || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{n.truck_reg || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{n.rule_violated || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{n.time_of_call || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{n.summary || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-600">{n.driver_response || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="p-5 text-sm text-surface-500">No non-compliance calls recorded.</div>
                          )}
                        </div>
                      </div>

                      {/* Investigations */}
                      <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
                        <div className="border-b border-surface-100 bg-surface-50/80 px-5 py-3">
                          <h3 className="text-sm font-semibold text-surface-800">Investigations (findings & action taken)</h3>
                        </div>
                        <div className="p-5">
                          {reportDetail.investigations?.length > 0 ? (
                            <div className="space-y-4">
                              {reportDetail.investigations.map((inv, idx) => (
                                <div key={idx} className="rounded-lg border border-surface-200 bg-surface-50/50 overflow-hidden">
                                  <div className="px-4 py-2.5 bg-surface-100 border-b border-surface-200 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                    <span className="font-medium text-surface-800">{inv.truck_reg || '—'}</span>
                                    <span className="text-surface-600">{inv.time || '—'}</span>
                                    <span className="text-surface-600">{inv.location || '—'}</span>
                                  </div>
                                  <div className="px-4 py-3 space-y-2 text-sm">
                                    {inv.issue_identified && <p><span className="font-medium text-surface-600">Issue:</span> <span className="text-surface-800">{inv.issue_identified}</span></p>}
                                    {inv.findings && <p><span className="font-medium text-surface-600">Findings:</span> <span className="text-surface-800">{inv.findings}</span></p>}
                                    {inv.action_taken && <p><span className="font-medium text-surface-600">Action taken:</span> <span className="text-surface-800">{inv.action_taken}</span></p>}
                                    {!inv.issue_identified && !inv.findings && !inv.action_taken && <p className="text-surface-500">—</p>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-surface-500">No investigations recorded.</p>
                          )}
                        </div>
                      </div>

                      {/* Communication log */}
                      <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
                        <div className="border-b border-surface-100 bg-surface-50/80 px-5 py-3">
                          <h3 className="text-sm font-semibold text-surface-800">Communication log</h3>
                        </div>
                        <div className="overflow-x-auto">
                          {reportDetail.communication_log?.length > 0 ? (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-surface-50 border-b border-surface-200">
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Time</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Recipient</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Subject</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Method</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Action required</th>
                                </tr>
                              </thead>
                              <tbody>
                                {reportDetail.communication_log.map((c, idx) => (
                                  <tr key={idx} className="border-b border-surface-100 hover:bg-surface-50/50">
                                    <td className="py-2.5 px-4 text-surface-800 font-medium">{c.time || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{c.recipient || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{c.subject || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{c.method || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-600">{c.action_required || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="p-5 text-sm text-surface-500">No communication log entries.</div>
                          )}
                        </div>
                      </div>

                      {/* Active fleet logistics log */}
                      {reportDetail.active_fleet_log?.length > 0 && (
                        <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
                          <div className="border-b border-surface-100 bg-surface-50/80 px-5 py-3 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-surface-800">Active fleet logistics log</h3>
                            <span className="text-xs text-surface-500">{reportDetail.active_fleet_log.length} entries</span>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-surface-50 border-b border-surface-200">
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Truck</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Driver</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Route</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Qty loaded</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Deliveries</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Target</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Revenue</th>
                                </tr>
                              </thead>
                              <tbody>
                                {reportDetail.active_fleet_log.map((row, i) => (
                                  <tr key={i} className="border-b border-surface-100 hover:bg-surface-50/50">
                                    <td className="py-2.5 px-4 text-surface-800 font-medium">{row.truck_label || row.truck_id || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{row.driver_name || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{row.route || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{row.quantity_loaded ?? '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{row.deliveries_completed ?? '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{row.actual_target ?? '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{row.revenue != null ? formatCurrency(row.revenue) : '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Non-participating trucks */}
                      {reportDetail.non_participating?.length > 0 && (
                        <div className="rounded-xl border border-surface-200 bg-white shadow-sm overflow-hidden">
                          <div className="border-b border-surface-100 bg-surface-50/80 px-5 py-3">
                            <h3 className="text-sm font-semibold text-surface-800">Non-participating trucks</h3>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-surface-50 border-b border-surface-200">
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Truck</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Driver</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Reason</th>
                                  <th className="text-left py-3 px-4 font-semibold text-surface-700">Action taken</th>
                                </tr>
                              </thead>
                              <tbody>
                                {reportDetail.non_participating.map((row, i) => (
                                  <tr key={i} className="border-b border-surface-100 hover:bg-surface-50/50">
                                    <td className="py-2.5 px-4 text-surface-800 font-medium">{row.truck_label || row.truck_id || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{row.driver_name || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-700">{row.reason || '—'}</td>
                                    <td className="py-2.5 px-4 text-surface-600">{row.action_taken || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {reportDetail.status === 'pending_approval' && (
                        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
                          <h3 className="text-sm font-semibold text-surface-800 mb-4">Evaluation (required before approval)</h3>
                          {myEvaluation && (
                            <div className="mb-4 overflow-hidden rounded-lg border border-surface-200">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="bg-surface-100 border-b border-surface-200">
                                    <th className="text-left py-2.5 px-3 font-medium text-surface-700">Evaluator</th>
                                    <th className="text-left py-2.5 px-3 font-medium text-surface-700">Date</th>
                                    <th className="text-left py-2.5 px-3 font-medium text-surface-700">Comment</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr className="border-b border-surface-100">
                                    <td className="py-2.5 px-3 text-surface-800">{user?.full_name || user?.email || '—'}</td>
                                    <td className="py-2.5 px-3 text-surface-600">{myEvaluation.created_at ? new Date(myEvaluation.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                                    <td className="py-2.5 px-3 text-surface-700 whitespace-pre-wrap">{(myEvaluation.overall_comment || '').trim() || '—'}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                          <form onSubmit={submitEvaluationForReport} className="space-y-4">
                            {evalQuestions.map((q) => (
                              <div key={q.id}>
                                <label className="block text-sm font-medium text-surface-700 mb-1">{q.label}</label>
                                <select value={evaluationAnswers[q.id] ?? ''} onChange={(e) => setEvaluationAnswers((prev) => ({ ...prev, [q.id]: e.target.value ? Number(e.target.value) : null }))} className="w-full max-w-xs rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800">
                                  <option value="">—</option>
                                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {n === 1 ? '(Poor)' : n === 5 ? '(Excellent)' : ''}</option>)}
                                </select>
                              </div>
                            ))}
                            <div>
                              <label className="block text-sm font-medium text-surface-700 mb-1">Overall comment</label>
                              <textarea value={evaluationComment} onChange={(e) => setEvaluationComment(e.target.value)} rows={3} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" placeholder="Optional comment" />
                            </div>
                            <button type="submit" disabled={savingEvaluation} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{myEvaluation ? 'Update evaluation' : 'Submit evaluation'}</button>
                          </form>
                          {myEvaluation && <p className="mt-2 text-sm text-green-600 font-medium">Evaluation submitted. You can now approve the report.</p>}
                        </div>
                      )}

                      {reportDetail.status === 'pending_approval' && myEvaluation && (
                        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
                          <button type="button" onClick={approveReport} disabled={approving} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">Approve report</button>
                        </div>
                      )}

                      {reportDetail.status === 'approved' && (
                        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
                          <p className="text-sm text-green-600 font-medium">This report has been approved.</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'operations_presentations' && (
            <div className="space-y-8">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-surface-900">Operations Insights</h2>
                <InfoHint title="Operations insights help" text="AI-powered insights from approved shift reports. Get recommendations and hold your team accountable when they are not applied." />
              </div>

              <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-surface-800 mb-4">Generate insights</h3>
                <div className="flex flex-wrap gap-4 items-end">
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">From</label>
                    <input type="date" value={presentationsDateFrom} onChange={(e) => setPresentationsDateFrom(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">To</label>
                    <input type="date" value={presentationsDateTo} onChange={(e) => setPresentationsDateTo(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPresentationsLoading(true);
                      setPresentationsError('');
                      toApi.presentations.insights({ dateFrom: presentationsDateFrom, dateTo: presentationsDateTo })
                        .then((data) => setPresentationsInsights(data))
                        .catch((err) => { setPresentationsError(err?.message || 'Failed to load insights'); setPresentationsInsights(null); })
                        .finally(() => setPresentationsLoading(false));
                    }}
                    disabled={presentationsLoading}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {presentationsLoading ? 'Generating…' : 'Generate insights'}
                  </button>
                </div>
                {presentationsError && <p className="mt-3 text-sm text-red-600">{presentationsError}</p>}
              </div>

              {presentationsInsights && (
                <>
                  <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
                    <div className="px-6 py-4 border-b border-surface-100 bg-gradient-to-r from-surface-50 to-brand-50">
                      <h3 className="font-semibold text-surface-900 flex items-center gap-2">
                        <span className="text-lg">Insights</span>
                        <span className="text-xs font-normal text-surface-500 bg-surface-200 px-2 py-0.5 rounded-full">From {presentationsInsights.summary?.report_count ?? 0} approved report(s)</span>
                      </h3>
                      <p className="text-sm text-surface-600 mt-0.5">What is happening in your operations over the selected period.</p>
                    </div>
                    <div className="p-6 space-y-3">
                      {(!presentationsInsights.insights || presentationsInsights.insights.length === 0) ? (
                        <p className="text-surface-500 text-sm">No insights for the selected period. Approve more shift reports and try again.</p>
                      ) : (
                        presentationsInsights.insights.map((item, i) => (
                          <div
                            key={i}
                            className={`flex items-start gap-3 rounded-xl p-4 text-sm ${
                              item.type === 'positive' ? 'bg-green-50 border border-green-100 text-green-900' :
                              item.type === 'attention' ? 'bg-amber-50 border border-amber-100 text-amber-900' :
                              'bg-surface-50 border border-surface-100 text-surface-800'
                            }`}
                          >
                            <span className="shrink-0 mt-0.5">{item.type === 'positive' ? '✓' : item.type === 'attention' ? '!' : '●'}</span>
                            <span>{item.text}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {presentationsInsights.recommendations?.length > 0 && (
                    <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
                      <div className="px-6 py-4 border-b border-surface-100 bg-gradient-to-r from-surface-50 to-brand-50 flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <h3 className="font-semibold text-surface-900 text-lg">Recommendations & advice</h3>
                          <p className="text-sm text-surface-600 mt-0.5">Suggested actions. Save to list to assign owners and track accountability.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSavingGeneratedRecs(true);
                            toApi.presentations.saveRecommendationsFromInsights(presentationsInsights.recommendations)
                              .then(() => {
                                toApi.presentations.recommendations().then((r) => setPresentationsRecs(r.recommendations || []));
                              })
                              .finally(() => setSavingGeneratedRecs(false));
                          }}
                          disabled={savingGeneratedRecs}
                          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                        >
                          {savingGeneratedRecs ? 'Saving…' : 'Save all to list'}
                        </button>
                      </div>
                      <div className="p-6 space-y-4">
                        {presentationsInsights.recommendations.map((rec, i) => (
                          <div key={i} className={`rounded-lg p-4 border ${rec.priority === 'action' ? 'bg-amber-50/50 border-amber-200' : 'bg-surface-50 border-surface-100'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-surface-900">{rec.title}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${rec.priority === 'action' ? 'bg-amber-200 text-amber-800' : 'bg-surface-200 text-surface-700'}`}>{rec.priority}</span>
                            </div>
                            {rec.body && <p className="text-sm text-surface-600 mt-1">{rec.body}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {presentationsInsights.summary && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Reports</p>
                        <p className="mt-1 text-xl font-semibold text-surface-800">{presentationsInsights.summary.report_count}</p>
                      </div>
                      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Loads delivered</p>
                        <p className="mt-1 text-xl font-semibold text-surface-800">{presentationsInsights.summary.total_loads_delivered ?? '—'}</p>
                      </div>
                      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Incidents</p>
                        <p className="mt-1 text-xl font-semibold text-surface-800">{presentationsInsights.summary.total_incidents ?? '—'}</p>
                      </div>
                      <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
                        <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Non-compliance</p>
                        <p className="mt-1 text-xl font-semibold text-surface-800">{presentationsInsights.summary.total_non_compliance ?? '—'}</p>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-surface-200 bg-surface-50">
                  <h3 className="text-sm font-semibold text-surface-800">Recommendations list</h3>
                  <p className="text-xs text-surface-600 mt-0.5">Assign owners and mark as applied to hold people accountable.</p>
                </div>
                {presentationsRecsLoading ? <p className="p-6 text-surface-500">Loading…</p> : presentationsRecs.length === 0 ? (
                  <p className="p-6 text-surface-500">No recommendations yet. Generate insights and click “Save all to list”, or add your own.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[700px] text-sm">
                      <thead>
                        <tr className="bg-surface-100 text-left">
                          <th className="px-3 py-2 font-medium text-surface-600">Recommendation</th>
                          <th className="px-3 py-2 font-medium text-surface-600">Assigned to</th>
                          <th className="px-3 py-2 font-medium text-surface-600">Due</th>
                          <th className="px-3 py-2 font-medium text-surface-600">Status</th>
                          <th className="px-3 py-2 w-40">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {presentationsRecs.map((rec) => {
                          const dueDate = rec.due_by ? toYmdFromDbOrString(rec.due_by) : '';
                          const today = todayYmd();
                          const isOverdue = rec.status === 'pending' && dueDate && dueDate < today;
                          return (
                            <tr key={rec.id} className={`border-t border-surface-100 ${isOverdue ? 'bg-red-50/50' : ''}`}>
                              <td className="px-3 py-2">
                                <span className="font-medium text-surface-800">{rec.title}</span>
                                {rec.body && <p className="text-xs text-surface-500 mt-0.5 line-clamp-2">{rec.body}</p>}
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={rec.assigned_to_user_id || ''}
                                  onChange={(e) => {
                                    const uid = e.target.value || null;
                                    setSavingRecId(rec.id);
                                    toApi.presentations.updateRecommendation(rec.id, { assigned_to_user_id: uid })
                                      .then((r) => setPresentationsRecs((prev) => prev.map((p) => p.id === rec.id ? { ...p, assigned_to_user_id: uid, assigned_to_name: r.recommendation?.assigned_to_name } : p)))
                                      .finally(() => setSavingRecId(null));
                                  }}
                                  disabled={savingRecId === rec.id}
                                  className="rounded border border-surface-300 px-2 py-1 text-surface-800 min-w-[140px]"
                                >
                                  <option value="">— Unassigned</option>
                                  {tenantUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email || u.id}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="date"
                                  value={dueDate}
                                  onChange={(e) => {
                                    const val = e.target.value || null;
                                    setSavingRecId(rec.id);
                                    toApi.presentations.updateRecommendation(rec.id, { due_by: val })
                                      .then(() => setPresentationsRecs((prev) => prev.map((p) => p.id === rec.id ? { ...p, due_by: val } : p)))
                                      .finally(() => setSavingRecId(null));
                                  }}
                                  disabled={savingRecId === rec.id}
                                  className="rounded border border-surface-300 px-2 py-1 text-surface-800 w-36"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <span className={`font-medium ${rec.status === 'applied' ? 'text-green-600' : rec.status === 'dismissed' ? 'text-surface-500' : 'text-amber-600'}`}>
                                  {rec.status === 'applied' ? 'Applied' : rec.status === 'dismissed' ? 'Dismissed' : 'Pending'}
                                </span>
                                {rec.status === 'applied' && rec.applied_by_name && <span className="text-xs text-surface-500 block">by {rec.applied_by_name}</span>}
                              </td>
                              <td className="px-3 py-2">
                                {rec.status === 'pending' && (
                                  <>
                                    <button type="button" onClick={() => { setSavingRecId(rec.id); toApi.presentations.updateRecommendation(rec.id, { status: 'applied' }).then(() => { toApi.presentations.recommendations().then((r) => setPresentationsRecs(r.recommendations || [])); }).finally(() => setSavingRecId(null)); }} disabled={savingRecId === rec.id} className="text-green-600 hover:underline font-medium text-xs mr-2">Apply</button>
                                    <button type="button" onClick={() => { setSavingRecId(rec.id); toApi.presentations.updateRecommendation(rec.id, { status: 'dismissed' }).then(() => { toApi.presentations.recommendations().then((r) => setPresentationsRecs(r.recommendations || [])); }).finally(() => setSavingRecId(null)); }} disabled={savingRecId === rec.id} className="text-surface-500 hover:underline text-xs">Dismiss</button>
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-red-100 bg-red-50/50 overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-red-100">
                  <h3 className="text-sm font-semibold text-red-900">Accountability</h3>
                  <p className="text-xs text-red-800 mt-0.5">Recommendations not yet applied. Assign owners and due dates to hold users accountable.</p>
                </div>
                <div className="p-6">
                  {presentationsRecsLoading ? <p className="text-surface-500 text-sm">Loading…</p> : (() => {
                    const pending = presentationsRecs.filter((r) => r.status === 'pending');
                    const today = todayYmd();
                    const overdue = pending.filter((r) => r.due_by && r.due_by < today);
                    const noOwner = pending.filter((r) => !r.assigned_to_user_id);
                    if (pending.length === 0) return <p className="text-sm text-green-700 font-medium">All recommendations have been applied or dismissed.</p>;
                    return (
                      <div className="space-y-4">
                        {overdue.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-red-700 uppercase tracking-wider mb-2">Overdue ({overdue.length})</p>
                            <ul className="text-sm text-red-900 space-y-1">
                              {overdue.map((r) => (
                                <li key={r.id}><strong>{r.title}</strong> — Assigned to: {r.assigned_to_name || r.assigned_to_email || 'Unassigned'} · Due: {formatDate(r.due_by)}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {noOwner.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-2">Unassigned ({noOwner.length})</p>
                            <ul className="text-sm text-surface-800 space-y-1">
                              {noOwner.map((r) => (
                                <li key={r.id}>{r.title}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <p className="text-xs text-surface-600">Total pending: {pending.length}. Use the table above to assign and mark as applied.</p>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'presentations' && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-surface-900">Presentations</h2>
              <p className="text-sm text-surface-600">Generate a PowerPoint presentation about production from approved shift reports. Use the filters below to choose the period and shift.</p>

              <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-surface-800 mb-4">Filters</h3>
                <div className="flex flex-wrap gap-6 items-end">
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">From date</label>
                    <input type="date" value={presentationsPptxDateFrom} onChange={(e) => setPresentationsPptxDateFrom(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">To date</label>
                    <input type="date" value={presentationsPptxDateTo} onChange={(e) => setPresentationsPptxDateTo(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">Shift</label>
                    <select value={presentationsPptxShift} onChange={(e) => setPresentationsPptxShift(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800 min-w-[140px]">
                      <option value="">All shifts</option>
                      {SHIFT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={presentationsPptxDownloading}
                    onClick={() => {
                      setPresentationsPptxDownloading(true);
                      const params = { dateFrom: presentationsPptxDateFrom, dateTo: presentationsPptxDateTo };
                      if (presentationsPptxShift) params.shift = presentationsPptxShift;
                      const url = toApi.presentations.pptxDownloadUrl(params);
                      const filename = `production-report-${presentationsPptxDateFrom}-${presentationsPptxDateTo}${presentationsPptxShift ? `-${presentationsPptxShift}` : ''}.pptx`;
                      downloadAttachmentWithAuth(url, filename)
                        .catch((e) => window.alert(e?.message || 'Could not download PowerPoint'))
                        .finally(() => setPresentationsPptxDownloading(false));
                    }}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {presentationsPptxDownloading ? 'Generating…' : 'Generate PowerPoint'}
                  </button>
                </div>
                <p className="text-xs text-surface-500 mt-3">Only approved shift reports in the selected range are included. The presentation includes a summary, daily trend, and production by shift.</p>
              </div>
            </div>
          )}

          {activeTab === 'truck_driver_registration' && (
            <div className="space-y-8">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-surface-900">Truck and driver registration</h2>
                <InfoHint title="Truck and driver registration help" text="Register trucks and drivers here. They appear in the Shift Report tab for selection." />
              </div>

              <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
                <div className="px-6 py-4 border-b border-surface-200 bg-surface-50 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-surface-800">Trucks</h3>
                  <button type="button" onClick={() => { setEditingTruckId(null); setTruckForm(emptyTruck); setShowTruckForm(true); }} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700">Add truck</button>
                </div>
                {showTruckForm && (
                  <form onSubmit={saveTruck} className="p-6 border-b border-surface-200 bg-surface-50/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {['registration', 'make_model', 'fleet_no', 'trailer_1_reg_no', 'trailer_2_reg_no', 'commodity_type', 'capacity_tonnes', 'year_model'].map((key) => (
                      <div key={key}>
                        <label className="block text-xs font-medium text-surface-600 mb-1">{key.replace(/_/g, ' ')}</label>
                        <input type="text" value={truckForm[key]} onChange={(e) => setTruckForm((f) => ({ ...f, [key]: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" />
                      </div>
                    ))}
                    <div className="sm:col-span-2 lg:col-span-4">
                      <label className="block text-xs font-medium text-surface-600 mb-1">Notes</label>
                      <textarea value={truckForm.notes} onChange={(e) => setTruckForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
                      <button type="submit" disabled={savingTruck} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{editingTruckId ? 'Update' : 'Add'} truck</button>
                      <button type="button" onClick={() => { setShowTruckForm(false); setEditingTruckId(null); setTruckForm(emptyTruck); }} className="rounded-lg border border-surface-300 px-4 py-2 text-sm font-medium text-surface-700 hover:bg-surface-50">Cancel</button>
                    </div>
                  </form>
                )}
                {loading ? <p className="p-6 text-surface-500">Loading…</p> : trucks.length === 0 ? <p className="p-6 text-surface-500">No trucks yet. Click “Add truck” to register.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-50 border-b border-surface-200">
                        <tr>
                          <th className="text-left p-3 font-medium text-surface-700">Registration</th>
                          <th className="text-left p-3 font-medium text-surface-700">Make/Model</th>
                          <th className="text-left p-3 font-medium text-surface-700">Fleet no</th>
                          <th className="text-left p-3 font-medium text-surface-700">Trailers</th>
                          <th className="text-left p-3 font-medium text-surface-700">Commodity</th>
                          <th className="text-left p-3 font-medium text-surface-700">Capacity (t)</th>
                          <th className="p-3 w-24" />
                        </tr>
                      </thead>
                      <tbody>
                        {trucks.map((t) => (
                          <tr key={t.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                            <td className="p-3">{t.registration || '—'}</td>
                            <td className="p-3">{t.make_model || '—'}</td>
                            <td className="p-3">{t.fleet_no || '—'}</td>
                            <td className="p-3">{(t.trailer_1_reg_no || t.trailer_2_reg_no) ? [t.trailer_1_reg_no, t.trailer_2_reg_no].filter(Boolean).join(', ') : '—'}</td>
                            <td className="p-3">{t.commodity_type || '—'}</td>
                            <td className="p-3">{t.capacity_tonnes != null ? t.capacity_tonnes : '—'}</td>
                            <td className="p-3">
                              <button type="button" onClick={() => openEditTruck(t)} className="text-brand-600 hover:underline mr-2">Edit</button>
                              <button type="button" onClick={() => { if (window.confirm('Delete this truck?')) toApi.trucks.delete(t.id).then(loadData); }} className="text-red-600 hover:underline">Delete</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
                <div className="px-6 py-4 border-b border-surface-200 bg-surface-50 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-surface-800">Drivers</h3>
                  <button type="button" onClick={() => { setEditingDriverId(null); setDriverForm(emptyDriver); setShowDriverForm(true); }} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700">Add driver</button>
                </div>
                {showDriverForm && (
                  <form onSubmit={saveDriver} className="p-6 border-b border-surface-200 bg-surface-50/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {['full_name', 'license_number', 'license_expiry', 'phone', 'email', 'id_number'].map((key) => (
                      <div key={key}>
                        <label className="block text-xs font-medium text-surface-600 mb-1">{key.replace(/_/g, ' ')}</label>
                        <input type={key === 'license_expiry' ? 'date' : key === 'email' ? 'email' : 'text'} value={driverForm[key]} onChange={(e) => setDriverForm((f) => ({ ...f, [key]: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" />
                      </div>
                    ))}
                    <div className="sm:col-span-2 lg:col-span-4">
                      <label className="block text-xs font-medium text-surface-600 mb-1">Link to user (portal user as driver)</label>
                      <select value={driverForm.user_id || ''} onChange={(e) => setDriverForm((f) => ({ ...f, user_id: e.target.value || '' }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800">
                        <option value="">— No user linked</option>
                        {tenantUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email || u.id}</option>)}
                      </select>
                      <p className="text-xs text-surface-500 mt-1">Optionally link this driver to a tenant user account.</p>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4">
                      <label className="block text-xs font-medium text-surface-600 mb-1">Notes</label>
                      <textarea value={driverForm.notes} onChange={(e) => setDriverForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
                      <button type="submit" disabled={savingDriver} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{editingDriverId ? 'Update' : 'Add'} driver</button>
                      <button type="button" onClick={() => { setShowDriverForm(false); setEditingDriverId(null); setDriverForm(emptyDriver); }} className="rounded-lg border border-surface-300 px-4 py-2 text-sm font-medium text-surface-700 hover:bg-surface-50">Cancel</button>
                    </div>
                  </form>
                )}
                {loading ? <p className="p-6 text-surface-500">Loading…</p> : drivers.length === 0 ? <p className="p-6 text-surface-500">No drivers yet. Click “Add driver” to register.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-50 border-b border-surface-200">
                        <tr>
                          <th className="text-left p-3 font-medium text-surface-700">Name</th>
                          <th className="text-left p-3 font-medium text-surface-700">License</th>
                          <th className="text-left p-3 font-medium text-surface-700">License expiry</th>
                          <th className="text-left p-3 font-medium text-surface-700">Phone</th>
                          <th className="text-left p-3 font-medium text-surface-700">Email</th>
                          <th className="text-left p-3 font-medium text-surface-700">Linked user</th>
                          <th className="p-3 w-24" />
                        </tr>
                      </thead>
                      <tbody>
                        {drivers.map((d) => (
                          <tr key={d.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                            <td className="p-3">{d.full_name || '—'}</td>
                            <td className="p-3">{d.license_number || '—'}</td>
                            <td className="p-3">{formatDate(d.license_expiry)}</td>
                            <td className="p-3">{d.phone || '—'}</td>
                            <td className="p-3">{d.email || '—'}</td>
                            <td className="p-3">{d.linked_user_name ? <span className="text-brand-600">{d.linked_user_name}</span> : '—'}</td>
                            <td className="p-3">
                              <button type="button" onClick={() => openEditDriver(d)} className="text-brand-600 hover:underline mr-2">Edit</button>
                              <button type="button" onClick={() => { if (window.confirm('Delete this driver?')) toApi.drivers.delete(d.id).then(loadData); }} className="text-red-600 hover:underline">Delete</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'accounting' && (
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-surface-900">Accounting</h2>
                <InfoHint title="Accounting setup help" text="Create routes with collection point and destination, set rates and targets (delivery target and amount target) for calculations." />
              </div>

              <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
                <div className="px-6 py-4 border-b border-surface-200 bg-surface-50 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-surface-800">Routes (rates & targets)</h3>
                  <button type="button" onClick={() => { setEditingRouteId(null); setRouteForm(emptyRoute); setShowRouteForm(true); }} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700">Add route</button>
                </div>
                {showRouteForm && (
                  <form onSubmit={saveRoute} className="p-6 border-b border-surface-200 bg-surface-50/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1">Name (optional)</label>
                      <input type="text" value={routeForm.name} onChange={(e) => setRouteForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" placeholder="e.g. Route A" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1">Collection point</label>
                      <input type="text" value={routeForm.collection_point} onChange={(e) => setRouteForm((f) => ({ ...f, collection_point: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" placeholder="Collection point" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1">Destination</label>
                      <input type="text" value={routeForm.destination} onChange={(e) => setRouteForm((f) => ({ ...f, destination: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" placeholder="Destination" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1">Rate (ZAR)</label>
                      <input type="number" step="0.01" min={0} value={routeForm.rate} onChange={(e) => setRouteForm((f) => ({ ...f, rate: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" placeholder="0.00" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1">Price per quantity (ZAR)</label>
                      <input type="number" step="0.01" min={0} value={routeForm.price_per_quantity} onChange={(e) => setRouteForm((f) => ({ ...f, price_per_quantity: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" placeholder="For revenue: qty × this" />
                      <p className="text-xs text-surface-500 mt-1">Used with quantity loaded to support revenue on shift report.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1">Delivery target</label>
                      <input type="number" min={0} value={routeForm.delivery_target} onChange={(e) => setRouteForm((f) => ({ ...f, delivery_target: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" placeholder="Deliveries" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1">Amount target (ZAR)</label>
                      <input type="number" step="0.01" min={0} value={routeForm.amount_target} onChange={(e) => setRouteForm((f) => ({ ...f, amount_target: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-800" placeholder="0.00" />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3 flex gap-2">
                      <button type="submit" disabled={savingRoute} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{editingRouteId ? 'Update' : 'Add'} route</button>
                      <button type="button" onClick={() => { setShowRouteForm(false); setEditingRouteId(null); setRouteForm(emptyRoute); }} className="rounded-lg border border-surface-300 px-4 py-2 text-sm font-medium text-surface-700 hover:bg-surface-50">Cancel</button>
                    </div>
                  </form>
                )}
                {loading ? <p className="p-6 text-surface-500">Loading…</p> : routes.length === 0 ? <p className="p-6 text-surface-500">No routes yet. Click “Add route” to create a route with collection point, destination, rate and targets.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-50 border-b border-surface-200">
                        <tr>
                          <th className="text-left p-3 font-medium text-surface-700">Name</th>
                          <th className="text-left p-3 font-medium text-surface-700">Collection point</th>
                          <th className="text-left p-3 font-medium text-surface-700">Destination</th>
                          <th className="text-left p-3 font-medium text-surface-700">Rate</th>
                          <th className="text-left p-3 font-medium text-surface-700">Price per qty</th>
                          <th className="text-left p-3 font-medium text-surface-700">Delivery target</th>
                          <th className="text-left p-3 font-medium text-surface-700">Amount target</th>
                          <th className="p-3 w-24" />
                        </tr>
                      </thead>
                      <tbody>
                        {routes.map((r) => (
                          <tr key={r.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                            <td className="p-3">{r.name || '—'}</td>
                            <td className="p-3">{r.collection_point || '—'}</td>
                            <td className="p-3">{r.destination || '—'}</td>
                            <td className="p-3">{formatCurrency(r.rate)}</td>
                            <td className="p-3">{r.price_per_quantity != null ? formatCurrency(r.price_per_quantity) : '—'}</td>
                            <td className="p-3">{r.delivery_target != null ? r.delivery_target : '—'}</td>
                            <td className="p-3">{formatCurrency(r.amount_target)}</td>
                            <td className="p-3">
                              <button type="button" onClick={() => openEditRoute(r)} className="text-brand-600 hover:underline mr-2">Edit</button>
                              <button type="button" onClick={() => { if (window.confirm('Delete this route?')) toApi.routes.delete(r.id).then(loadData); }} className="text-red-600 hover:underline">Delete</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
