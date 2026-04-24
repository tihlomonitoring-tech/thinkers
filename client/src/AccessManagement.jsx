import { useState, useEffect, useRef, useMemo } from 'react';
import { todayYmd } from './lib/appTime.js';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { useAutoHideNavAfterTabChange } from './lib/useAutoHideNavAfterTabChange.js';
import { useAuth } from './AuthContext';
import { contractor as contractorApi, users as usersApi, progressReports as progressReportsApi, actionPlans as actionPlansApi, monthlyPerformanceReports as monthlyPerformanceReportsApi } from './api';
import { getApiBase } from './lib/apiBase.js';
import { generateProgressReportPdf } from './lib/progressReportPdf.js';
import { generateActionPlanPdf } from './lib/actionPlanPdf.js';
import { normalizeSectionsForForm, serializeSectionsForApi, parseTsvFromClipboard, tsvToKeyMetrics, tsvToBreakdowns, tsvToFleetPerformance } from './lib/monthlyPerfReportHelpers.js';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', section: 'Overview' },
  { id: 'routes', label: 'Route management', icon: 'route', section: 'Routes' },
  { id: 'rectors', label: 'Route rectors', icon: 'users', section: 'Routes' },
  { id: 'reinstatement', label: 'Reinstatement requests', icon: 'reinstatement', section: 'Routes' },
  { id: 'distribution', label: 'List distribution', icon: 'share', section: 'Distribution' },
  { id: 'pilot-distribution', label: 'Pilot distribution', icon: 'clock', section: 'Distribution' },
  { id: 'distribution-history', label: 'Distribution history', icon: 'history', section: 'Distribution' },
  { id: 'progress-report-creation', label: 'Project progress report creation', icon: 'file', section: 'Reports' },
  { id: 'action-plan-timelines', label: 'Action plan and Project timelines', icon: 'calendar', section: 'Reports' },
  { id: 'monthly-performance-reports', label: 'Monthly performance reports', icon: 'chart', section: 'Reports' },
];
const SECTIONS = [...new Set(TABS.map((t) => t.section))];

const FLEET_COLUMNS = [
  { key: 'registration', label: 'Registration' },
  { key: 'make_model', label: 'Make/Model' },
  { key: 'fleet_no', label: 'Fleet No' },
  { key: 'trailer_1_reg_no', label: 'Trailer 1 reg' },
  { key: 'trailer_2_reg_no', label: 'Trailer 2 reg' },
  { key: 'commodity_type', label: 'Commodity' },
  { key: 'capacity_tonnes', label: 'Capacity (t)' },
  { key: 'route_name', label: 'Route' },
];
const DRIVER_COLUMNS = [
  { key: 'full_name', label: 'Name' },
  { key: 'license_number', label: 'License' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'route_name', label: 'Route' },
];

// Automated alert types for route rectors (stored comma-separated)
const RECTOR_ALERT_OPTIONS = [
  { value: 'route_expiration', label: 'Route expiration reminder' },
  { value: 'capacity_tonnage', label: 'Capacity / tonnage alerts' },
  { value: 'weekly_summary', label: 'Weekly summary' },
  { value: 'incident_alerts', label: 'Incident alerts' },
  { value: 'list_distribution', label: 'List distribution updates' },
  { value: 'suspension_alerts', label: 'Truck/driver suspension alerts' },
  { value: 'reinstatement_alerts', label: 'Truck/driver reinstatement alerts' },
];

function TabIcon({ name, className }) {
  const c = className || 'w-5 h-5';
  switch (name) {
    case 'dashboard':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      );
    case 'route':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 0V4m0 0v0" />
        </svg>
      );
    case 'users':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      );
    case 'share':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
      );
    case 'history':
    case 'clock':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'reinstatement':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'file':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case 'calendar':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case 'chart':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      );
    default:
      return <span className={c} />;
  }
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function normalizeIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))];
}

function RouteChecklist({ routes, selectedIds, onToggle }) {
  const normalized = Array.isArray(selectedIds) ? selectedIds.map((id) => String(id)) : [];
  return (
    <div className="rounded-lg border border-surface-300 p-3 max-h-48 overflow-auto space-y-2 bg-white">
      {routes.length === 0 ? (
        <p className="text-sm text-surface-500">No routes available yet.</p>
      ) : (
        routes.map((r) => {
          const routeId = String(r.id);
          const checked = normalized.includes(routeId);
          return (
            <label key={routeId} className="flex items-center gap-2 text-sm text-surface-700 cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(routeId)}
                className="rounded border-surface-300 text-brand-600 focus:ring-brand-500"
              />
              <span>{r.name || 'Unnamed route'}</span>
            </label>
          );
        })
      )}
    </div>
  );
}

export default function AccessManagement() {
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [navHidden, setNavHidden] = useSecondaryNavHidden('access-mgmt');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contextError, setContextError] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [rectors, setRectors] = useState([]);
  const [saving, setSaving] = useState(false);

  // Route form (create/edit)
  const [routeForm, setRouteForm] = useState({ name: '', starting_point: '', destination: '', capacity: '', max_tons: '', route_expiration: '' });
  const [editingRouteId, setEditingRouteId] = useState(null);
  const [showRouteForm, setShowRouteForm] = useState(false);

  // Route rector form (create/edit) - user_id = assign existing user to route
  const [rectorForm, setRectorForm] = useState({ route_ids: [], user_id: '', name: '', company: '', email: '', phone: '', mobile_alt: '', address: '', role_or_type: '', notes: '', alert_types: [] });
  const [editingRectorId, setEditingRectorId] = useState(null);
  const [showRectorForm, setShowRectorForm] = useState(false);
  const [tenantUsers, setTenantUsers] = useState([]);

  // List distribution: per-route fleet & drivers, select routes then choose how to distribute
  const [distRouteDetails, setDistRouteDetails] = useState({});
  const [distSelectedRouteIds, setDistSelectedRouteIds] = useState([]);
  const [distLoadingDetails, setDistLoadingDetails] = useState(false);
  const [distDownloading, setDistDownloading] = useState(null);
  const [distRecipientEmail, setDistRecipientEmail] = useState('');
  const [distRecipientWhatsApp, setDistRecipientWhatsApp] = useState('');
  const [distFormat, setDistFormat] = useState('csv');
  const [distIncludeFleet, setDistIncludeFleet] = useState(true);
  const [distIncludeDrivers, setDistIncludeDrivers] = useState(true);
  const [distRecipients, setDistRecipients] = useState([]);
  const [distCustomEmail, setDistCustomEmail] = useState('');
  const [distSending, setDistSending] = useState(false);
  const [distSendResult, setDistSendResult] = useState(null);
  const [distFleetColumns, setDistFleetColumns] = useState(FLEET_COLUMNS.map((c) => c.key));
  const [distDriverColumns, setDistDriverColumns] = useState(DRIVER_COLUMNS.map((c) => c.key));
  const [distEmailFormat, setDistEmailFormat] = useState('excel');
  const [distSendPerContractor, setDistSendPerContractor] = useState(false);
  const [distContractors, setDistContractors] = useState([]);
  const [distSelectedContractorIds, setDistSelectedContractorIds] = useState([]);
  const [distContractorSearch, setDistContractorSearch] = useState('');
  const [distCcRecipients, setDistCcRecipients] = useState([]);
  const [distCustomCcEmail, setDistCustomCcEmail] = useState('');

  // Distribution history tab
  const [distHistory, setDistHistory] = useState([]);
  const [distHistoryLoading, setDistHistoryLoading] = useState(false);
  const [distHistoryFilters, setDistHistoryFilters] = useState({ dateFrom: '', dateTo: '', routeId: '', listType: '', channel: '', search: '' });
  const [distHistoryExporting, setDistHistoryExporting] = useState(false);

  const [pilots, setPilots] = useState([]);
  const [pilotLoading, setPilotLoading] = useState(false);
  const [pilotSaving, setPilotSaving] = useState(false);
  const [pilotError, setPilotError] = useState('');
  const [pilotSuccess, setPilotSuccess] = useState('');
  const [pilotMigration, setPilotMigration] = useState(false);
  const [pilotForm, setPilotForm] = useState({
    name: '',
    route_id: '',
    contractor_ids: [],
    list_type: 'both',
    attach_format: 'excel',
    frequency: 'daily',
    time_hhmm: '09:00',
    weekday: 1,
  });
  const [pilotFleetCols, setPilotFleetCols] = useState(() => FLEET_COLUMNS.map((c) => c.key));
  const [pilotDriverCols, setPilotDriverCols] = useState(() => DRIVER_COLUMNS.map((c) => c.key));
  const [pilotContractorSearch, setPilotContractorSearch] = useState('');
  const [pilotInnerTab, setPilotInnerTab] = useState('schedules');
  const [pilotRecipients, setPilotRecipients] = useState([]);
  const [pilotCcRecipients, setPilotCcRecipients] = useState([]);
  const [pilotCustomEmail, setPilotCustomEmail] = useState('');
  const [pilotCustomCcEmail, setPilotCustomCcEmail] = useState('');
  const [pilotHistory, setPilotHistory] = useState([]);
  const [pilotHistoryLoading, setPilotHistoryLoading] = useState(false);
  const [pilotHistoryMigration, setPilotHistoryMigration] = useState(false);

  // Reinstatement requests tab
  const [reinstatementRequests, setReinstatementRequests] = useState([]);
  const [reinstatementLoading, setReinstatementLoading] = useState(false);
  const [reinstatementSelected, setReinstatementSelected] = useState(null);
  const [reinstatingId, setReinstatingId] = useState(null);
  const [reinstatementError, setReinstatementError] = useState('');
  const [reinstatementSuccess, setReinstatementSuccess] = useState('');
  const [reinstatementHistory, setReinstatementHistory] = useState([]);
  const [reinstatementHistoryLoading, setReinstatementHistoryLoading] = useState(false);

  // Project progress report creation tab
  const [progressReportsList, setProgressReportsList] = useState([]);
  const [progressReportForm, setProgressReportForm] = useState({
    title: '',
    report_date: todayYmd(),
    reporting_status: '',
    route_ids: [],
    narrative_updates: '',
    phases: [{ name: '', description: '' }],
    contractor_status: [{ contractor_name: '', operational_total: '', integrated_count_1: '', integrated_date_1: '', integrated_count_2: '', integrated_date_2: '', percent_increase: '', narrative: '' }],
    conclusion_text: '',
  });
  const [editingProgressReportId, setEditingProgressReportId] = useState(null);
  const [progressReportSaving, setProgressReportSaving] = useState(false);
  const [progressReportsListLoading, setProgressReportsListLoading] = useState(false);
  const [progressReportSubTab, setProgressReportSubTab] = useState('creation'); // 'creation' | 'published'
  const [shareEmailOpen, setShareEmailOpen] = useState(false);
  const [shareEmailReport, setShareEmailReport] = useState(null); // full report for PDF + email
  const [shareEmailRecipients, setShareEmailRecipients] = useState([]);
  const [shareEmailToIds, setShareEmailToIds] = useState([]);
  const [shareEmailCcIds, setShareEmailCcIds] = useState([]); // users to CC (from same list)
  const [shareEmailCc, setShareEmailCc] = useState(''); // additional CC emails (free text)
  const [shareEmailMessage, setShareEmailMessage] = useState('');
  const [shareEmailSending, setShareEmailSending] = useState(false);
  const [shareEmailError, setShareEmailError] = useState('');

  // Action plan and Project timelines tab
  const [actionPlansList, setActionPlansList] = useState([]);
  const [actionPlansListLoading, setActionPlansListLoading] = useState(false);
  const [actionPlanForm, setActionPlanForm] = useState({
    title: 'Action Plan',
    project_name: '',
    document_date: todayYmd(),
    document_id: '',
    route_ids: [],
    items: [{ phase: '', start_date: '', action_description: '', participants: '', due_date: '', status: 'not started' }],
  });
  const [editingActionPlanId, setEditingActionPlanId] = useState(null);
  const [actionPlanSaving, setActionPlanSaving] = useState(false);
  const [actionPlanSubTab, setActionPlanSubTab] = useState('creation'); // 'creation' | 'published'
  const [shareActionPlanEmailOpen, setShareActionPlanEmailOpen] = useState(false);
  const [shareActionPlanEmailPlan, setShareActionPlanEmailPlan] = useState(null);
  const [shareActionPlanEmailRecipients, setShareActionPlanEmailRecipients] = useState([]);
  const [shareActionPlanEmailToIds, setShareActionPlanEmailToIds] = useState([]);
  const [shareActionPlanEmailCcIds, setShareActionPlanEmailCcIds] = useState([]);
  const [shareActionPlanEmailCc, setShareActionPlanEmailCc] = useState('');
  const [shareActionPlanEmailMessage, setShareActionPlanEmailMessage] = useState('');
  const [shareActionPlanEmailSending, setShareActionPlanEmailSending] = useState(false);
  const [shareActionPlanEmailError, setShareActionPlanEmailError] = useState('');

  // Monthly performance reports
  const [monthlyPerfList, setMonthlyPerfList] = useState([]);
  const [monthlyPerfListLoading, setMonthlyPerfListLoading] = useState(false);
  const [monthlyPerfForm, setMonthlyPerfForm] = useState({
    title: '',
    reporting_period_start: '',
    reporting_period_end: '',
    submitted_date: todayYmd(),
    prepared_by: 'Tihlo (Thinkers Afrika)',
    route_ids: [],
    executive_summary: '',
    key_metrics: [{ metric: '', value: '', commentary: '' }],
    sections: [{ heading: '', subsections: [{ subheading: '', blocks: [{ type: 'text', text: '' }] }] }],
    breakdowns: [{ date: '', time: '', route: '', truck_reg: '', description: '', company: '' }],
    fleet_performance: [{ haulier: '', trips: '', pct_trips: '', tonnage: '', pct_tonnage: '', avg_t_per_trip: '', trucks_deployed: '' }],
  });
  const [editingMonthlyPerfId, setEditingMonthlyPerfId] = useState(null);
  const [monthlyPerfSaving, setMonthlyPerfSaving] = useState(false);
  const [monthlyPerfSubTab, setMonthlyPerfSubTab] = useState('creation');
  const monthlyPerfExecSummaryRef = useRef(null);
  const monthlyPerfBlockRefs = useRef({});
  const [monthlyPerfCursor, setMonthlyPerfCursor] = useState(null); // { type: 'executive'|'block', sectionIdx?, subIdx?, blockIdx?, start, end }
  const routeNameById = useMemo(
    () => Object.fromEntries((routes || []).map((r) => [String(r.id), r.name || 'Unnamed route'])),
    [routes]
  );

  const hasTenant = user?.tenant_id;

  useEffect(() => {
    const requested = (() => {
      try { return sessionStorage.getItem('access-management-global-target-tab'); } catch (_) { return null; }
    })();
    if (!requested) return;
    if (TABS.some((t) => t.id === requested)) setActiveTab(requested);
    try { sessionStorage.removeItem('access-management-global-target-tab'); } catch (_) {}
  }, []);

  const navAutoHideReady = !authLoading && !loading;
  useAutoHideNavAfterTabChange(activeTab, { ready: navAutoHideReady });

  const insertAtFocusedMonthlyPerfText = (prefix) => {
    const cur = monthlyPerfCursor;
    if (!cur) return;
    let text = '';
    if (cur.type === 'executive') {
      text = monthlyPerfForm.executive_summary || '';
    } else if (cur.type === 'block' && cur.sectionIdx != null && cur.subIdx != null && cur.blockIdx != null) {
      const sub = monthlyPerfForm.sections[cur.sectionIdx]?.subsections?.[cur.subIdx];
      const block = sub?.blocks?.[cur.blockIdx];
      text = (block?.type === 'text' && block?.text) ? block.text : '';
    }
    const start = typeof cur.start === 'number' ? cur.start : 0;
    const end = typeof cur.end === 'number' ? cur.end : start;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const insert = start === 0 ? prefix : `\n${prefix}`;
    const newText = before + insert + after;
    const newCursor = start + insert.length;
    if (cur.type === 'executive') {
      setMonthlyPerfForm((f) => ({ ...f, executive_summary: newText }));
    } else if (cur.type === 'block' && cur.sectionIdx != null && cur.subIdx != null && cur.blockIdx != null) {
      const i = cur.sectionIdx, subIdx = cur.subIdx, blockIdx = cur.blockIdx;
      setMonthlyPerfForm((f) => ({
        ...f,
        sections: f.sections.map((s, j) => j !== i ? s : {
          ...s,
          subsections: (s.subsections || []).map((sb, k) => k !== subIdx ? sb : {
            ...sb,
            blocks: (sb.blocks || []).map((b, bi) => bi !== blockIdx ? b : { ...b, text: newText }),
          }),
        }),
      }));
    }
    setTimeout(() => {
      const el = cur.type === 'executive' ? monthlyPerfExecSummaryRef.current : monthlyPerfBlockRefs.current[`${cur.sectionIdx}-${cur.subIdx}-${cur.blockIdx}`];
      if (el && el.focus) { el.focus(); el.setSelectionRange(newCursor, newCursor); }
    }, 0);
  };

  function load() {
    if (!hasTenant) return;
    setLoading(true);
    setError('');
    setContextError(null);
    Promise.all([
      contractorApi.context().catch((e) => {
        if (e?.message?.includes('tenant') || e?.message?.includes('403')) setContextError('Your account is not linked to a company.');
        throw e;
      }),
      contractorApi.routes.list().then((r) => r.routes || []),
      contractorApi.routeFactors.list().then((r) => r.factors || []),
      usersApi.list({ tenant_id: user?.tenant_id, limit: 500 }).then((r) => r.users || []).catch(() => []),
    ])
      .then(([ctx, rList, fList, uList]) => {
        if (!ctx?.tenantId) setContextError('Your account is not linked to a company.');
        setRoutes(rList);
        setRectors(fList);
        setTenantUsers(uList);
      })
      .catch((err) => setError(err?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (hasTenant) load();
    else setLoading(false);
  }, [hasTenant]);

  // When opening the rector form or switching to routes/rectors tab, refetch routes so the Route(s) dropdown includes newly created routes
  useEffect(() => {
    if (!hasTenant) return;
    if (showRectorForm || activeTab === 'routes' || activeTab === 'rectors') {
      contractorApi.routes.list()
        .then((r) => setRoutes(r.routes || []))
        .catch(() => {});
    }
  }, [showRectorForm, activeTab, hasTenant]);

  // Load contractors for list distribution / pilot
  useEffect(() => {
    if (activeTab !== 'distribution' && activeTab !== 'pilot-distribution') return;
    contractorApi.distributionHistory.contractors()
      .then((r) => setDistContractors(r.contractors || []))
      .catch(() => setDistContractors([]));
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'pilot-distribution' || !hasTenant) return;
    setPilotLoading(true);
    setPilotMigration(false);
    contractorApi.pilotDistribution
      .list()
      .then((r) => {
        setPilots(r.pilots || []);
        setPilotMigration(!!r.migration_needed);
      })
      .catch(() => setPilots([]))
      .finally(() => setPilotLoading(false));
  }, [activeTab, hasTenant]);

  useEffect(() => {
    if (activeTab !== 'pilot-distribution' || pilotInnerTab !== 'history' || !hasTenant) return;
    setPilotHistoryLoading(true);
    setPilotHistoryMigration(false);
    contractorApi.pilotDistribution
      .history()
      .then((r) => {
        setPilotHistory(r.history || []);
        setPilotHistoryMigration(!!r.migration_needed);
      })
      .catch(() => setPilotHistory([]))
      .finally(() => setPilotHistoryLoading(false));
  }, [activeTab, pilotInnerTab, hasTenant]);

  // Load fleet & drivers per route when List distribution or Pilot tab is active
  useEffect(() => {
    if ((activeTab !== 'distribution' && activeTab !== 'pilot-distribution') || !routes.length) {
      if (activeTab !== 'pilot-distribution' && activeTab !== 'distribution') setDistRouteDetails({});
      return;
    }
    let cancelled = false;
    setDistLoadingDetails(true);
    Promise.all(routes.map((r) => contractorApi.routes.get(r.id)))
      .then((results) => {
        if (cancelled) return;
        const next = {};
        routes.forEach((r, i) => {
          const data = results[i];
          next[r.id] = { trucks: data?.trucks || [], drivers: data?.drivers || [] };
        });
        setDistRouteDetails(next);
      })
      .catch(() => { if (!cancelled) setDistRouteDetails({}); })
      .finally(() => { if (!cancelled) setDistLoadingDetails(false); });
    return () => { cancelled = true; };
  }, [activeTab, routes]);

  const pilotContractorsForRoute = useMemo(() => {
    const rid = pilotForm.route_id;
    if (!rid || !distRouteDetails[rid]) return distContractors;
    const d = distRouteDetails[rid];
    const ids = new Set();
    (d.trucks || []).forEach((t) => {
      const cid = t.contractor_id ?? t.contractor_Id;
      if (cid) ids.add(String(cid));
    });
    (d.drivers || []).forEach((dr) => {
      const cid = dr.contractor_id ?? dr.contractor_Id;
      if (cid) ids.add(String(cid));
    });
    if (ids.size === 0) return distContractors;
    return distContractors.filter((c) => ids.has(String(c.id)));
  }, [pilotForm.route_id, distRouteDetails, distContractors]);

  // Load progress reports list when Project progress report tab is active
  useEffect(() => {
    if (activeTab !== 'progress-report-creation' || !hasTenant) return;
    setProgressReportsListLoading(true);
    progressReportsApi.list()
      .then((r) => setProgressReportsList(r.reports || []))
      .catch(() => setProgressReportsList([]))
      .finally(() => setProgressReportsListLoading(false));
  }, [activeTab, hasTenant]);

  // Load action plans list when Action plan and Project timelines tab is active
  useEffect(() => {
    if (activeTab !== 'action-plan-timelines' || !hasTenant) return;
    setActionPlansListLoading(true);
    actionPlansApi.list()
      .then((r) => setActionPlansList(r.plans || []))
      .catch(() => setActionPlansList([]))
      .finally(() => setActionPlansListLoading(false));
  }, [activeTab, hasTenant]);

  // Load monthly performance reports when tab is active
  useEffect(() => {
    if (activeTab !== 'monthly-performance-reports' || !hasTenant) return;
    setMonthlyPerfListLoading(true);
    monthlyPerformanceReportsApi.list()
      .then((r) => setMonthlyPerfList(r.reports || []))
      .catch(() => setMonthlyPerfList([]))
      .finally(() => setMonthlyPerfListLoading(false));
  }, [activeTab, hasTenant]);

  const getProgressReportPdfAsBase64 = (report) => {
    return new Promise((resolve, reject) => {
      const run = (logoDataUrl) => {
        try {
          const doc = generateProgressReportPdf(report, logoDataUrl ? { logoDataUrl } : {});
          const name = (report.title || 'progress-report').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 50);
          const filename = `${name}-${report.report_date || 'report'}.pdf`;
          const blob = doc.output('blob');
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result;
            const base64 = dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:') ? dataUrl.split(',')[1] : '';
            resolve({ base64, filename });
          };
          reader.onerror = () => reject(new Error('PDF encoding failed'));
          reader.readAsDataURL(blob);
        } catch (e) {
          reject(e);
        }
      };
      fetch('/logos/tihlo-logo.png', { credentials: 'include' })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
          if (!blob) { run(null); return; }
          const reader = new FileReader();
          reader.onload = () => run(reader.result);
          reader.onerror = () => run(null);
          reader.readAsDataURL(blob);
        })
        .catch(() => run(null));
    });
  };

  const openShareEmailModal = (reportFromList) => {
    setShareEmailError('');
    setShareEmailToIds([]);
    setShareEmailCcIds([]);
    setShareEmailCc('');
    setShareEmailMessage('');
    setShareEmailReport(null);
    setShareEmailOpen(true);
    progressReportsApi.recipients()
      .then((r) => setShareEmailRecipients(r.users || []))
      .catch(() => setShareEmailRecipients([]));
    progressReportsApi.get(reportFromList.id)
      .then((res) => setShareEmailReport(res.report || null))
      .catch(() => setShareEmailError('Failed to load report'));
  };

  const sendProgressReportEmail = () => {
    if (!shareEmailReport || !shareEmailReport.id) return;
    if (shareEmailToIds.length === 0) {
      setShareEmailError('Select at least one recipient.');
      return;
    }
    setShareEmailError('');
    setShareEmailSending(true);
    getProgressReportPdfAsBase64(shareEmailReport)
      .then(({ base64, filename }) => {
        const ccFromUsers = shareEmailCcIds.map((id) => shareEmailRecipients.find((u) => u.id === id)?.email).filter((e) => e && e.includes('@'));
        const ccFromText = shareEmailCc.split(/[\s,;]+/).map((e) => e.trim()).filter((e) => e && e.includes('@'));
        const ccList = [...new Set([...ccFromUsers, ...ccFromText])];
        return progressReportsApi.sendEmail(shareEmailReport.id, {
          to_user_ids: shareEmailToIds,
          cc_emails: ccList,
          message: shareEmailMessage.trim() || undefined,
          pdf_base64: base64,
          pdf_filename: filename,
        });
      })
      .then(() => setShareEmailOpen(false))
      .catch((e) => setShareEmailError(e?.message || 'Failed to send email'))
      .finally(() => setShareEmailSending(false));
  };

  const getActionPlanPdfAsBase64 = (plan) => {
    return new Promise((resolve, reject) => {
      const run = (logoDataUrl) => {
        try {
          const doc = generateActionPlanPdf(plan, logoDataUrl ? { logoDataUrl } : {});
          const name = (plan.title || 'action-plan').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 50);
          const filename = `${name}-${plan.document_date || 'plan'}.pdf`;
          const blob = doc.output('blob');
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result;
            const base64 = dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:') ? dataUrl.split(',')[1] : '';
            resolve({ base64, filename });
          };
          reader.onerror = () => reject(new Error('PDF encoding failed'));
          reader.readAsDataURL(blob);
        } catch (e) {
          reject(e);
        }
      };
      fetch('/logos/tihlo-logo.png', { credentials: 'include' })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
          if (!blob) { run(null); return; }
          const reader = new FileReader();
          reader.onload = () => run(reader.result);
          reader.onerror = () => run(null);
          reader.readAsDataURL(blob);
        })
        .catch(() => run(null));
    });
  };

  const openShareActionPlanEmailModal = (planFromList) => {
    setShareActionPlanEmailError('');
    setShareActionPlanEmailToIds([]);
    setShareActionPlanEmailCcIds([]);
    setShareActionPlanEmailCc('');
    setShareActionPlanEmailMessage('');
    setShareActionPlanEmailPlan(null);
    setShareActionPlanEmailOpen(true);
    actionPlansApi.recipients()
      .then((r) => setShareActionPlanEmailRecipients(r.users || []))
      .catch(() => setShareActionPlanEmailRecipients([]));
    actionPlansApi.get(planFromList.id)
      .then((res) => setShareActionPlanEmailPlan(res.plan || null))
      .catch(() => setShareActionPlanEmailError('Failed to load action plan'));
  };

  const sendActionPlanEmail = () => {
    if (!shareActionPlanEmailPlan || !shareActionPlanEmailPlan.id) return;
    if (shareActionPlanEmailToIds.length === 0) {
      setShareActionPlanEmailError('Select at least one recipient.');
      return;
    }
    setShareActionPlanEmailError('');
    setShareActionPlanEmailSending(true);
    getActionPlanPdfAsBase64(shareActionPlanEmailPlan)
      .then(({ base64, filename }) => {
        const ccFromUsers = shareActionPlanEmailCcIds.map((id) => shareActionPlanEmailRecipients.find((u) => u.id === id)?.email).filter((e) => e && e.includes('@'));
        const ccFromText = shareActionPlanEmailCc.split(/[\s,;]+/).map((e) => e.trim()).filter((e) => e && e.includes('@'));
        const ccList = [...new Set([...ccFromUsers, ...ccFromText])];
        return actionPlansApi.sendEmail(shareActionPlanEmailPlan.id, {
          to_user_ids: shareActionPlanEmailToIds,
          cc_emails: ccList,
          message: shareActionPlanEmailMessage.trim() || undefined,
          pdf_base64: base64,
          pdf_filename: filename,
        });
      })
      .then(() => setShareActionPlanEmailOpen(false))
      .catch((e) => setShareActionPlanEmailError(e?.message || 'Failed to send email'))
      .finally(() => setShareActionPlanEmailSending(false));
  };

  // Load distribution history when tab is active
  useEffect(() => {
    if (activeTab !== 'distribution-history') return;
    let cancelled = false;
    setDistHistoryLoading(true);
    const params = {};
    if (distHistoryFilters.dateFrom) params.dateFrom = distHistoryFilters.dateFrom;
    if (distHistoryFilters.dateTo) params.dateTo = distHistoryFilters.dateTo;
    if (distHistoryFilters.routeId) params.routeId = distHistoryFilters.routeId;
    if (distHistoryFilters.listType) params.listType = distHistoryFilters.listType;
    if (distHistoryFilters.channel) params.channel = distHistoryFilters.channel;
    if (distHistoryFilters.search && distHistoryFilters.search.trim()) params.search = distHistoryFilters.search.trim();
    contractorApi.distributionHistory.list(params)
      .then((r) => { if (!cancelled) setDistHistory(r.history || []); })
      .catch(() => { if (!cancelled) setDistHistory([]); })
      .finally(() => { if (!cancelled) setDistHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, distHistoryFilters]);

  // Load reinstatement requests when tab is active
  useEffect(() => {
    if (activeTab !== 'reinstatement') return;
    let cancelled = false;
    setReinstatementLoading(true);
    setReinstatementError('');
    contractorApi.reinstatementRequests()
      .then((r) => { if (!cancelled) setReinstatementRequests(r.requests || []); })
      .catch((e) => { if (!cancelled) { setReinstatementRequests([]); setReinstatementError(e?.message || 'Failed to load'); } })
      .finally(() => { if (!cancelled) setReinstatementLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab]);

  // Load reinstated history when reinstatement tab is active
  useEffect(() => {
    if (activeTab !== 'reinstatement') return;
    let cancelled = false;
    setReinstatementHistoryLoading(true);
    contractorApi.reinstatementHistory()
      .then((r) => { if (!cancelled) setReinstatementHistory(r.history || []); })
      .catch(() => { if (!cancelled) setReinstatementHistory([]); })
      .finally(() => { if (!cancelled) setReinstatementHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab]);

  const openEditRoute = (r) => {
    setEditingRouteId(r.id);
    setRouteForm({
      name: r.name || '',
      starting_point: r.starting_point || '',
      destination: r.destination || '',
      capacity: r.capacity != null ? String(r.capacity) : '',
      max_tons: r.max_tons != null ? String(r.max_tons) : '',
      route_expiration: r.route_expiration ? r.route_expiration.slice(0, 10) : '',
    });
    setShowRouteForm(true);
  };

  const saveRoute = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: routeForm.name.trim(),
        starting_point: routeForm.starting_point.trim() || null,
        destination: routeForm.destination.trim() || null,
        capacity: routeForm.capacity.trim() ? parseInt(routeForm.capacity, 10) : null,
        max_tons: routeForm.max_tons.trim() ? parseFloat(routeForm.max_tons) : null,
        route_expiration: routeForm.route_expiration.trim() || null,
      };
      if (editingRouteId) {
        const data = await contractorApi.routes.update(editingRouteId, payload);
        setRoutes((prev) => prev.map((r) => (r.id === editingRouteId ? (data.route || r) : r)));
        setShowRouteForm(false);
        setEditingRouteId(null);
      } else {
        const data = await contractorApi.routes.create(payload);
        if (data.route) {
          const r = data.route;
          setRoutes((prev) => [...prev, { ...r, id: r.id ?? r.Id, name: r.name ?? r.Name ?? r.name }]);
        }
        setShowRouteForm(false);
        setRouteForm({ name: '', starting_point: '', destination: '', capacity: '', max_tons: '', route_expiration: '' });
      }
      // Refetch routes and rectors only (don't run full load() which can overwrite routes if context fails)
      contractorApi.routes.list().then((r) => setRoutes(r.routes || [])).catch(() => {});
      contractorApi.routeFactors.list().then((r) => setRectors(r.factors || [])).catch(() => {});
    } catch (err) {
      setError(err?.message || 'Failed to save route');
    } finally {
      setSaving(false);
    }
  };

  const deleteRoute = async (id) => {
    if (!window.confirm('Delete this route? Enrollments will be removed.')) return;
    setError('');
    try {
      await contractorApi.routes.delete(id);
      load();
    } catch (err) {
      setError(err?.message || 'Failed to delete');
    }
  };

  const openEditRector = (f) => {
    setEditingRectorId(f.id);
    const alertList = (f.alert_types && typeof f.alert_types === 'string') ? f.alert_types.split(',').map((s) => s.trim()).filter(Boolean) : [];
    setRectorForm({
      route_ids: f.route_id ? [String(f.route_id)] : [],
      user_id: f.user_id || '',
      name: f.name || '',
      company: f.company || '',
      email: f.email || '',
      phone: f.phone || '',
      mobile_alt: f.mobile_alt || '',
      address: f.address || '',
      role_or_type: f.role_or_type || '',
      notes: f.notes || '',
      alert_types: alertList,
    });
    setShowRectorForm(true);
  };

  const saveRector = async (e) => {
    e.preventDefault();
    const assignUser = rectorForm.user_id && String(rectorForm.user_id).trim();
    if (!assignUser) {
      setError('Select an existing user. Create the user in User management first, then assign them to a route here.');
      return;
    }
    const routeIds = Array.isArray(rectorForm.route_ids) ? rectorForm.route_ids.filter(Boolean) : [];
    if (routeIds.length === 0) {
      setError('Please select at least one route. Rectors must be linked to at least one route.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const basePayload = {
        user_id: assignUser || null,
        name: rectorForm.name?.trim() || null,
        company: rectorForm.company?.trim() || null,
        email: rectorForm.email?.trim() || null,
        phone: rectorForm.phone?.trim() || null,
        mobile_alt: rectorForm.mobile_alt?.trim() || null,
        address: rectorForm.address?.trim() || null,
        role_or_type: rectorForm.role_or_type?.trim() || null,
        notes: rectorForm.notes?.trim() || null,
        alert_types: rectorForm.alert_types?.length ? rectorForm.alert_types : null,
      };
      if (editingRectorId) {
        await contractorApi.routeFactors.update(editingRectorId, { ...basePayload, route_id: routeIds[0] });
        setShowRectorForm(false);
        setEditingRectorId(null);
      } else {
        await contractorApi.routeFactors.bulkCreate({ ...basePayload, route_ids: routeIds });
        setShowRectorForm(false);
        setRectorForm({ route_ids: [], user_id: '', name: '', company: '', email: '', phone: '', mobile_alt: '', address: '', role_or_type: '', notes: '', alert_types: [] });
      }
      load();
    } catch (err) {
      setError(err?.message || 'Failed to save route rector');
    } finally {
      setSaving(false);
    }
  };

  const toggleRectorAlert = (value) => {
    setRectorForm((prev) => ({
      ...prev,
      alert_types: prev.alert_types.includes(value) ? prev.alert_types.filter((x) => x !== value) : [...prev.alert_types, value],
    }));
  };

  const deleteRector = async (id) => {
    if (!window.confirm('Delete this route rector?')) return;
    setError('');
    try {
      await contractorApi.routeFactors.delete(id);
      load();
    } catch (err) {
      setError(err?.message || 'Failed to delete');
    }
  };

  const addRectorsToRoute = (routeId) => {
    setRectorForm((prev) => ({ ...prev, route_ids: [String(routeId)], user_id: '' }));
    setEditingRectorId(null);
    setShowRectorForm(true);
  };

  const distToggleRoute = (routeId) => {
    const id = String(routeId);
    setDistSelectedRouteIds((prev) =>
      prev.includes(id) ? prev.filter((rid) => rid !== id) : [...prev, id]
    );
  };
  const distSelectAllRoutes = () => setDistSelectedRouteIds(routes.map((r) => String(r.id ?? r.Id)));
  const distClearAllRoutes = () => setDistSelectedRouteIds([]);
  const distAllSelected = routes.length > 0 && distSelectedRouteIds.length === routes.length;

  const recordDistribution = (list_type, format, channel, recipient_email = null, recipient_phone = null) => {
    contractorApi.distributionHistory
      .create({
        list_type,
        route_ids: distSelectedRouteIds.length > 0 ? distSelectedRouteIds : null,
        format: format === 'excel' ? 'excel' : format === 'pdf' ? 'pdf' : 'csv',
        channel,
        recipient_email: recipient_email || null,
        recipient_phone: recipient_phone || null,
      })
      .catch(() => {});
  };

  const downloadList = (listKind, format) => {
    const isFleet = listKind === 'fleet';
    setDistDownloading(isFleet ? 'fleet-' + format : 'driver-' + format);
    const ids = distSelectedRouteIds.length > 0 ? distSelectedRouteIds : [];
    const params = new URLSearchParams();
    if (ids.length === 1) params.set('routeId', ids[0]);
    else if (ids.length > 1) params.set('routeIds', ids.join(','));
    if (format === 'excel') params.set('format', 'excel');
    const q = params.toString() ? `?${params.toString()}` : '';
    const path = isFleet ? `/contractor/enrollment/fleet-list${q}` : `/contractor/enrollment/driver-list${q}`;
    const ext = format === 'excel' ? 'xlsx' : 'csv';
    const filename = (isFleet ? 'fleet-list' : 'driver-list') + '.' + ext;
    fetch(`${getApiBase()}${path}`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to download list');
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        recordDistribution(listKind === 'fleet' ? 'fleet' : 'driver', format, 'download');
      })
      .catch((err) => setError(err?.message || 'Download failed'))
      .finally(() => setDistDownloading(null));
  };

  const addRecipientFromUser = (user) => {
    const email = (user.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    setDistRecipients((prev) => (prev.some((r) => r.email === email) ? prev : [...prev, { email, label: user.full_name || user.email }]));
  };
  const addRecipientByEmail = () => {
    const email = distCustomEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    setDistRecipients((prev) => (prev.some((r) => r.email === email) ? prev : [...prev, { email, label: null }]));
    setDistCustomEmail('');
  };
  const removeDistRecipient = (email) => setDistRecipients((prev) => prev.filter((r) => r.email !== email));

  const addCcFromUser = (user) => {
    const email = (user.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    setDistCcRecipients((prev) => (prev.some((r) => r.email === email) ? prev : [...prev, { email, label: user.full_name || user.email }]));
  };
  const addCcByEmail = () => {
    const email = distCustomCcEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    setDistCcRecipients((prev) => (prev.some((r) => r.email === email) ? prev : [...prev, { email, label: null }]));
    setDistCustomCcEmail('');
  };
  const removeDistCcRecipient = (email) => setDistCcRecipients((prev) => prev.filter((r) => r.email !== email));

  const addPilotRecipientFromUser = (user) => {
    const email = (user.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    setPilotRecipients((prev) => (prev.some((r) => r.email === email) ? prev : [...prev, { email, label: user.full_name || user.email }]));
  };
  const addPilotRecipientByEmail = () => {
    const email = pilotCustomEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    setPilotRecipients((prev) => (prev.some((r) => r.email === email) ? prev : [...prev, { email, label: null }]));
    setPilotCustomEmail('');
  };
  const removePilotRecipient = (email) => setPilotRecipients((prev) => prev.filter((r) => r.email !== email));
  const addPilotCcFromUser = (user) => {
    const email = (user.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    setPilotCcRecipients((prev) => (prev.some((r) => r.email === email) ? prev : [...prev, { email, label: user.full_name || user.email }]));
  };
  const addPilotCcByEmail = () => {
    const email = pilotCustomCcEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    setPilotCcRecipients((prev) => (prev.some((r) => r.email === email) ? prev : [...prev, { email, label: null }]));
    setPilotCustomCcEmail('');
  };
  const removePilotCcRecipient = (email) => setPilotCcRecipients((prev) => prev.filter((r) => r.email !== email));

  const sendFromSystem = () => {
    const listType = distIncludeFleet && distIncludeDrivers ? 'both' : distIncludeFleet ? 'fleet' : 'driver';
    if (listType !== 'both' && !distIncludeFleet && !distIncludeDrivers) {
      setError('Select at least one: Include fleet list or Include driver list.');
      return;
    }
    if (distRecipients.length === 0) {
      setError('Add at least one recipient (from users or enter email).');
      return;
    }
    if (distSendPerContractor && distSelectedContractorIds.length === 0) {
      setError('Send per contractor is on: select at least one contractor.');
      return;
    }
    setDistSendResult(null);
    setError('');
    setDistSending(true);
    const selectedRouteIds = distSelectedRouteIds.length > 0 ? distSelectedRouteIds.map((id) => String(id)) : null;
    contractorApi.distributionHistory
      .sendEmail({
        recipients: distRecipients.map((r) => r.email),
        cc: distCcRecipients.length > 0 ? distCcRecipients.map((r) => r.email) : undefined,
        list_type: listType,
        route_ids: selectedRouteIds,
        fleet_columns: distIncludeFleet && distFleetColumns.length > 0 ? distFleetColumns : null,
        driver_columns: distIncludeDrivers && distDriverColumns.length > 0 ? distDriverColumns : null,
        format: distEmailFormat,
        send_per_contractor: distSendPerContractor || undefined,
        contractor_ids: distSendPerContractor && distSelectedContractorIds.length > 0 ? distSelectedContractorIds : undefined,
      })
      .then((data) => {
        setDistSendResult(data);
        if (data.sent > 0) setDistRecipients([]);
      })
      .catch((err) => setError(err?.message || 'Failed to send'))
      .finally(() => setDistSending(false));
  };

  const sendViaEmail = () => {
    const parts = [];
    if (distIncludeFleet) parts.push('Fleet');
    if (distIncludeDrivers) parts.push('Driver');
    const listLabel = parts.length ? parts.join(' and ') + ' list' : 'List';
    const listType = distIncludeFleet && distIncludeDrivers ? 'both' : distIncludeFleet ? 'fleet' : 'driver';
    recordDistribution(listType, distFormat, 'email', distRecipientEmail || null, null);
    const subject = encodeURIComponent(listLabel);
    const body = encodeURIComponent(`Please find the attached ${listLabel.toLowerCase()}.`);
    const mailto = `mailto:${distRecipientEmail || ''}?subject=${subject}&body=${body}`;
    window.open(mailto);
  };

  const shareViaWhatsApp = () => {
    const listType = distIncludeFleet && distIncludeDrivers ? 'both' : distIncludeFleet ? 'fleet' : 'driver';
    recordDistribution(listType, distFormat, 'whatsapp', null, distRecipientWhatsApp || null);
    const parts = [];
    if (distIncludeFleet) parts.push('fleet');
    if (distIncludeDrivers) parts.push('driver');
    const listLabel = parts.length ? parts.join(' and ') + ' list' : 'list';
    const text = encodeURIComponent(`Please find the ${listLabel}. Download from the Access management portal.`);
    const num = (distRecipientWhatsApp || '').replace(/\D/g, '');
    const url = num ? `https://wa.me/${num}?text=${text}` : 'https://wa.me/?text=' + text;
    window.open(url, '_blank');
  };

  if (authLoading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-surface-500">Loading…</p>
      </div>
    );
  }

  if (!hasTenant || contextError) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h2 className="font-semibold text-lg">Access management</h2>
          <p className="mt-2 text-sm">This area is available only to users linked to a company. Your account is not linked to a company.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-0 min-h-[calc(100vh-8rem)]">
      <nav
        className={`shrink-0 border-r border-surface-200 bg-white flex flex-col transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`}
        aria-label="Access management"
        aria-hidden={navHidden}
      >
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-surface-900">Access management</h2>
            <p className="text-xs text-surface-500 mt-0.5">Routes, rectors & distribution</p>
            <p className="text-xs text-surface-500 mt-1.5">Showing data for <strong className="text-surface-700">{user?.tenant_name || 'your company'}</strong></p>
          </div>
          <button
            type="button"
            onClick={() => setNavHidden(true)}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700 transition-colors"
            aria-label="Hide navigation to see full content"
            title="Hide navigation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
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
          <button
            type="button"
            onClick={() => setNavHidden(false)}
            className="self-start flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-surface-50 text-sm font-medium shadow-sm"
            aria-label="Show navigation"
          >
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
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

      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-surface-900">Dashboard</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Routes</p>
              <p className="mt-1 text-2xl font-semibold text-surface-900">{loading ? '—' : routes.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Route rectors</p>
              <p className="mt-1 text-2xl font-semibold text-surface-900">{loading ? '—' : rectors.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Expiring routes</p>
              <p className="mt-1 text-2xl font-semibold text-surface-900">
                {loading ? '—' : routes.filter((r) => r.route_expiration && new Date(r.route_expiration) < new Date()).length}
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'routes' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-surface-900">Route management</h2>
            <button
              type="button"
              onClick={() => { setEditingRouteId(null); setRouteForm({ name: '', starting_point: '', destination: '', capacity: '', max_tons: '', route_expiration: '' }); setShowRouteForm(true); }}
              className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700"
            >
              Register route
            </button>
          </div>
          <p className="text-sm text-surface-500">Register a route with starting point, destination, capacity, maximum tons, and expiration. Add route rectors to assign owners and alert preferences.</p>
          <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
            {loading ? (
              <p className="p-6 text-surface-500">Loading…</p>
            ) : routes.length === 0 ? (
              <p className="p-6 text-surface-500">No routes yet. Click “Register route” to add one.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-surface-50 border-b border-surface-200">
                  <tr>
                    <th className="text-left p-3 font-medium text-surface-700">Name</th>
                    <th className="text-left p-3 font-medium text-surface-700">Starting point</th>
                    <th className="text-left p-3 font-medium text-surface-700">Destination</th>
                    <th className="text-left p-3 font-medium text-surface-700">Capacity</th>
                    <th className="text-left p-3 font-medium text-surface-700">Max tons</th>
                    <th className="text-left p-3 font-medium text-surface-700">Expiration</th>
                    <th className="p-3 w-32" />
                  </tr>
                </thead>
                <tbody>
                  {routes.map((r) => (
                    <tr key={r.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                      <td className="p-3">{r.name}</td>
                      <td className="p-3">{r.starting_point || '—'}</td>
                      <td className="p-3">{r.destination || '—'}</td>
                      <td className="p-3">{r.capacity != null ? r.capacity : '—'}</td>
                      <td className="p-3">{r.max_tons != null ? r.max_tons : '—'}</td>
                      <td className="p-3">{formatDate(r.route_expiration)}</td>
                      <td className="p-3">
                        <button type="button" onClick={() => openEditRoute(r)} className="text-brand-600 hover:underline mr-2">Edit</button>
                        <button type="button" onClick={() => addRectorsToRoute(r.id)} className="text-brand-600 hover:underline mr-2">Add rectors</button>
                        <button type="button" onClick={() => deleteRoute(r.id)} className="text-red-600 hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {showRouteForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowRouteForm(false)}>
              <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                <h3 className="font-semibold text-surface-900 mb-4">{editingRouteId ? 'Edit route' : 'Register route'}</h3>
                <form onSubmit={saveRoute} className="space-y-3">
                  <input
                    required
                    placeholder="Route name"
                    value={routeForm.name}
                    onChange={(e) => setRouteForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="Starting point"
                    value={routeForm.starting_point}
                    onChange={(e) => setRouteForm((f) => ({ ...f, starting_point: e.target.value }))}
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  />
                  <input
                    placeholder="Destination"
                    value={routeForm.destination}
                    onChange={(e) => setRouteForm((f) => ({ ...f, destination: e.target.value }))}
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    min="0"
                    placeholder="Capacity"
                    value={routeForm.capacity}
                    onChange={(e) => setRouteForm((f) => ({ ...f, capacity: e.target.value }))}
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Max tons"
                    value={routeForm.max_tons}
                    onChange={(e) => setRouteForm((f) => ({ ...f, max_tons: e.target.value }))}
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="date"
                    placeholder="Route expiration"
                    value={routeForm.route_expiration}
                    onChange={(e) => setRouteForm((f) => ({ ...f, route_expiration: e.target.value }))}
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2 pt-2">
                    <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Save</button>
                    <button type="button" onClick={() => setShowRouteForm(false)} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'rectors' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-surface-900">Route rectors</h2>
            <button
              type="button"
              onClick={() => { setEditingRectorId(null); setRectorForm({ route_ids: [], user_id: '', name: '', company: '', email: '', phone: '', mobile_alt: '', address: '', role_or_type: '', notes: '', alert_types: [] }); setShowRectorForm(true); }}
              className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700"
            >
              Assign user to route
            </button>
          </div>
          <p className="text-sm text-surface-500">Rectors must be created as users first (User management). Then link them to a route here. When they open the Rector page, they will only see data for the route(s) they are assigned to.</p>
          <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
            {loading ? (
              <p className="p-6 text-surface-500">Loading…</p>
            ) : rectors.length === 0 ? (
              <p className="p-6 text-surface-500">No route rectors yet. Create users in User management, then click “Assign user to route” or “Add rectors” on a route.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-surface-50 border-b border-surface-200">
                  <tr>
                    <th className="text-left p-3 font-medium text-surface-700">Name</th>
                    <th className="text-left p-3 font-medium text-surface-700">Company</th>
                    <th className="text-left p-3 font-medium text-surface-700">Contact</th>
                    <th className="text-left p-3 font-medium text-surface-700">Route</th>
                    <th className="text-left p-3 font-medium text-surface-700">Alerts</th>
                    <th className="p-3 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {rectors.map((f) => (
                    <tr key={f.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                      <td className="p-3">{f.user_full_name || f.name || '—'}{f.user_id ? <span className="ml-1 text-xs text-surface-500">(sees Rector page)</span> : <span className="ml-1 text-xs text-amber-600">(no user — no Rector access)</span>}</td>
                      <td className="p-3">{f.company || '—'}</td>
                      <td className="p-3">{f.user_email || f.email || f.phone || '—'}</td>
                      <td className="p-3">{f.route_name || '—'}</td>
                      <td className="p-3 text-surface-600">
                        {f.alert_types
                          ? f.alert_types
                              .split(',')
                              .map((v) => RECTOR_ALERT_OPTIONS.find((o) => o.value === v.trim())?.label || v)
                              .filter(Boolean)
                              .join(', ')
                          : '—'}
                      </td>
                      <td className="p-3">
                        <button type="button" onClick={() => openEditRector(f)} className="text-brand-600 hover:underline mr-2">Edit</button>
                        <button type="button" onClick={() => deleteRector(f.id)} className="text-red-600 hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {showRectorForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowRectorForm(false)}>
              <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
                <h3 className="font-semibold text-surface-900 mb-4">{editingRectorId ? 'Edit route rector' : 'Assign user to route(s)'}</h3>
                <p className="text-xs text-surface-500 mb-4">User must exist in User management first. Select one or more routes to assign them as rector. They will only see data for their assigned route(s) on the Rector page.</p>
                <form onSubmit={saveRector} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">User (required)</label>
                    <select
                      value={rectorForm.user_id}
                      onChange={(e) => setRectorForm((f) => ({ ...f, user_id: e.target.value }))}
                      className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                      required
                    >
                      <option value="">— Select user —</option>
                      {tenantUsers.map((u) => (
                        <option key={u.id} value={u.id}>{u.full_name || u.email} {u.email ? `(${u.email})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">Route(s) (required) — select one or more</label>
                    <select
                      multiple
                      value={(rectorForm.route_ids || []).map((id) => String(id))}
                      onChange={(e) => setRectorForm((f) => ({ ...f, route_ids: Array.from(e.target.selectedOptions, (o) => o.value) }))}
                      className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm min-h-[100px]"
                      required
                    >
                      {routes.map((r) => (
                        <option key={r.id} value={String(r.id)}>{r.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-surface-500 mt-1">Hold Ctrl/Cmd to select multiple routes. {rectorForm.route_ids?.length > 0 ? `${rectorForm.route_ids.length} selected` : ''}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-surface-600 mb-2">Automated alerts to receive</p>
                    <div className="space-y-2">
                      {RECTOR_ALERT_OPTIONS.map((opt) => (
                        <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rectorForm.alert_types.includes(opt.value)}
                            onChange={() => toggleRectorAlert(opt.value)}
                            className="rounded border-surface-300"
                          />
                          <span className="text-sm">{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <textarea
                    placeholder="Notes (optional)"
                    rows={2}
                    value={rectorForm.notes}
                    onChange={(e) => setRectorForm((f) => ({ ...f, notes: e.target.value }))}
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2 pt-2">
                    <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Save</button>
                    <button type="button" onClick={() => setShowRectorForm(false)} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'reinstatement' && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-surface-900">Reinstatement requests</h2>
          <p className="text-sm text-surface-500">Appeals from contractors requesting reinstatement of a suspended fleet or driver. View the full appeal and contractor reply, then reinstate to approve. You and the rector will receive an alert when reinstated.</p>

          {reinstatementSuccess && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex justify-between items-center">
              <span>{reinstatementSuccess}</span>
              <button type="button" onClick={() => setReinstatementSuccess('')} className="text-emerald-600 hover:text-emerald-900 font-medium">Dismiss</button>
            </div>
          )}
          {reinstatementError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex justify-between items-center">
              <span>{reinstatementError}</span>
              <button type="button" onClick={() => setReinstatementError('')} className="text-amber-600 hover:text-amber-900 font-medium">Dismiss</button>
            </div>
          )}

          {reinstatementLoading ? (
            <p className="text-surface-500">Loading reinstatement requests…</p>
          ) : reinstatementRequests.length === 0 ? (
            <div className="bg-white rounded-xl border border-surface-200 p-8 text-center text-surface-500">
              <p className="font-medium text-surface-700">No reinstatement requests</p>
              <p className="text-sm mt-1">When contractors submit an appeal (Suspensions and appeals on the Contractor page), requests will appear here. You can view the appeal and reinstate the fleet or driver.</p>
            </div>
          ) : (
            <div className="flex gap-6 flex-wrap">
              <div className={`bg-white rounded-xl border border-surface-200 overflow-hidden ${reinstatementSelected ? 'flex-1 min-w-0 max-w-2xl' : 'flex-1 min-w-0'}`}>
                <div className="px-4 py-3 border-b border-surface-100 bg-surface-50 font-medium text-surface-800">Requests ({reinstatementRequests.length})</div>
                <table className="w-full text-sm">
                  <thead className="bg-surface-50 border-b border-surface-200">
                    <tr>
                      <th className="text-left p-3 font-medium text-surface-700">Type</th>
                      <th className="text-left p-3 font-medium text-surface-700">Fleet / Driver</th>
                      <th className="text-left p-3 font-medium text-surface-700">Contractor</th>
                      <th className="text-left p-3 font-medium text-surface-700">Submitted</th>
                      <th className="p-3 w-28" />
                    </tr>
                  </thead>
                  <tbody>
                    {reinstatementRequests.map((req) => (
                      <tr
                        key={req.id}
                        className={`border-b border-surface-100 hover:bg-surface-50/50 cursor-pointer ${reinstatementSelected?.id === req.id ? 'bg-emerald-50/50' : ''}`}
                        onClick={() => setReinstatementSelected(reinstatementSelected?.id === req.id ? null : req)}
                      >
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${req.entity_type === 'truck' ? 'bg-blue-100 text-blue-800' : 'bg-violet-100 text-violet-800'}`}>
                            {req.entity_type === 'truck' ? 'Fleet' : 'Driver'}
                          </span>
                        </td>
                        <td className="p-3 font-medium text-surface-900">{req.entity_label || '—'}</td>
                        <td className="p-3 text-surface-600">{req.tenant_name || '—'}</td>
                        <td className="p-3 text-surface-600">{formatDateTime(req.created_at)}</td>
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            disabled={reinstatingId === req.id}
                            onClick={async () => {
                              if (!window.confirm(`Reinstate this ${req.entity_type === 'truck' ? 'truck' : 'driver'}? The contractor and rector will be notified.`)) return;
                              setReinstatingId(req.id);
                              setReinstatementError('');
                              setReinstatementSuccess('');
                              try {
                                await contractorApi.suspensions.update(req.id, { status: 'reinstated' });
                                setReinstatementSuccess(`${req.entity_type === 'truck' ? 'Truck' : 'Driver'} reinstated. Contractor and rector have been notified.`);
                                const r = await contractorApi.reinstatementRequests();
                                setReinstatementRequests(r.requests || []);
                                if (reinstatementSelected?.id === req.id) setReinstatementSelected(null);
                              } catch (e) {
                                setReinstatementError(e?.message || 'Failed to reinstate');
                              } finally {
                                setReinstatingId(null);
                              }
                            }}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {reinstatingId === req.id ? 'Reinstating…' : 'Reinstate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {reinstatementSelected && (
                <div className="bg-white rounded-xl border border-surface-200 overflow-hidden w-full max-w-md shrink-0">
                  <div className="px-4 py-3 border-b border-surface-100 bg-surface-50 flex justify-between items-center">
                    <span className="font-medium text-surface-800">Appeal details</span>
                    <button type="button" onClick={() => setReinstatementSelected(null)} className="text-surface-500 hover:text-surface-700 p-1" aria-label="Close">×</button>
                  </div>
                  <div className="p-4 space-y-4 text-sm">
                    <div>
                      <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">{reinstatementSelected.entity_type === 'truck' ? 'Fleet' : 'Driver'}</p>
                      <p className="font-medium text-surface-900">{reinstatementSelected.entity_label || '—'}</p>
                      {reinstatementSelected.entity_type === 'truck' && reinstatementSelected.truck_make_model && (
                        <p className="text-surface-600 text-xs mt-0.5">{reinstatementSelected.truck_make_model}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Contractor</p>
                      <p className="text-surface-800">{reinstatementSelected.tenant_name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Reason for suspension</p>
                      <p className="text-surface-800 whitespace-pre-wrap">{reinstatementSelected.reason || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Contractor appeal / reply</p>
                      <p className="text-surface-800 whitespace-pre-wrap bg-surface-50 rounded-lg p-3 border border-surface-100">{reinstatementSelected.appeal_notes || '—'}</p>
                    </div>
                    <div className="pt-2 border-t border-surface-100">
                      <button
                        type="button"
                        disabled={reinstatingId === reinstatementSelected.id}
                        onClick={async () => {
                          if (!window.confirm(`Reinstate this ${reinstatementSelected.entity_type === 'truck' ? 'truck' : 'driver'}? The contractor and rector will be notified.`)) return;
                          setReinstatingId(reinstatementSelected.id);
                          setReinstatementError('');
                          setReinstatementSuccess('');
                          try {
                            await contractorApi.suspensions.update(reinstatementSelected.id, { status: 'reinstated' });
                            setReinstatementSuccess(`${reinstatementSelected.entity_type === 'truck' ? 'Truck' : 'Driver'} reinstated. Contractor and rector have been notified.`);
                            const r = await contractorApi.reinstatementRequests();
                            setReinstatementRequests(r.requests || []);
                            setReinstatementSelected(null);
                          } catch (e) {
                            setReinstatementError(e?.message || 'Failed to reinstate');
                          } finally {
                            setReinstatingId(null);
                          }
                        }}
                        className="w-full px-4 py-2.5 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {reinstatingId === reinstatementSelected.id ? 'Reinstating…' : 'Reinstate fleet/driver'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reinstated history: CC, auto or AM reinstatements */}
          <div className="mt-8 pt-8 border-t border-surface-200">
            <h3 className="font-semibold text-surface-900 mb-2">Reinstated history</h3>
            <p className="text-sm text-surface-500 mb-3">Reinstatements done from Command Centre, automatically when suspension period ended, or from here. Contractor receives an email for each.</p>
            {reinstatementHistoryLoading ? (
              <p className="text-surface-500 text-sm">Loading…</p>
            ) : reinstatementHistory.length === 0 ? (
              <p className="text-surface-500 text-sm">No reinstated records yet.</p>
            ) : (
              <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface-50 border-b border-surface-200">
                    <tr>
                      <th className="text-left p-3 font-medium text-surface-700">Type</th>
                      <th className="text-left p-3 font-medium text-surface-700">Fleet / Driver</th>
                      <th className="text-left p-3 font-medium text-surface-700">Contractor</th>
                      <th className="text-left p-3 font-medium text-surface-700">Reinstated at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reinstatementHistory.map((h) => (
                      <tr key={h.id} className="border-b border-surface-100 last:border-0">
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${h.entity_type === 'truck' ? 'bg-blue-100 text-blue-800' : 'bg-violet-100 text-violet-800'}`}>
                            {h.entity_type === 'truck' ? 'Fleet' : 'Driver'}
                          </span>
                        </td>
                        <td className="p-3 font-medium text-surface-900">{h.entity_label || '—'}</td>
                        <td className="p-3 text-surface-600">{h.tenant_name || '—'}</td>
                        <td className="p-3 text-surface-600">{formatDateTime(h.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'distribution' && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-surface-900">List distribution</h2>
          <p className="text-sm text-surface-500">Fleet and drivers are shown per route. Select the routes you want, then choose how to distribute the list (download, email, or WhatsApp).</p>

          {distLoadingDetails && <p className="text-sm text-surface-500">Loading fleet and drivers per route…</p>}

          {routes.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center mb-4">
              <span className="text-sm font-medium text-surface-700">Select routes:</span>
              <button type="button" onClick={distSelectAllRoutes} className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">
                Select all
              </button>
              <button type="button" onClick={distClearAllRoutes} className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">
                Clear all
              </button>
              {distSelectedRouteIds.length > 0 && (
                <span className="text-sm text-surface-500">
                  {distSelectedRouteIds.length} route{distSelectedRouteIds.length !== 1 ? 's' : ''} selected
                </span>
              )}
              {distSelectedRouteIds.length === 0 && routes.length > 0 && (
                <span className="text-sm text-surface-500">No routes selected — list will include all approved fleet/drivers. Or select routes above for route-specific lists.</span>
              )}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {routes.map((r) => {
              const detail = distRouteDetails[r.id];
              const trucks = detail?.trucks || [];
              const drivers = detail?.drivers || [];
              const selected = distSelectedRouteIds.includes(String(r.id ?? r.Id));
              return (
                <div key={r.id} className="bg-white rounded-xl border border-surface-200 overflow-hidden">
                  <div className="p-4 border-b border-surface-100 flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => distToggleRoute(r.id)}
                        className="rounded border-surface-300"
                      />
                      <span className="font-medium text-surface-900">{r.name}</span>
                    </label>
                  </div>
                  <div className="p-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-2">Fleet ({trucks.length})</p>
                      {trucks.length === 0 ? (
                        <p className="text-sm text-surface-400">No trucks enrolled</p>
                      ) : (
                        <ul className="text-sm text-surface-700 space-y-1">
                          {trucks.slice(0, 8).map((t) => (
                            <li key={t.truck_id}>{t.registration}{t.make_model ? ` · ${t.make_model}` : ''}{t.fleet_no ? ` #${t.fleet_no}` : ''}</li>
                          ))}
                          {trucks.length > 8 && <li className="text-surface-500">+{trucks.length - 8} more</li>}
                        </ul>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-2">Drivers ({drivers.length})</p>
                      {drivers.length === 0 ? (
                        <p className="text-sm text-surface-400">No drivers enrolled</p>
                      ) : (
                        <ul className="text-sm text-surface-700 space-y-1">
                          {drivers.slice(0, 8).map((d) => (
                            <li key={d.driver_id}>{d.full_name}{d.license_number ? ` · ${d.license_number}` : ''}</li>
                          ))}
                          {drivers.length > 8 && <li className="text-surface-500">+{drivers.length - 8} more</li>}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {routes.length === 0 && !loading && (
            <p className="text-sm text-surface-500">No routes yet. Add routes in Route management and enrol fleet and drivers on each route.</p>
          )}

          <div className="bg-white rounded-xl border border-surface-200 p-6 space-y-4">
            <h3 className="font-medium text-surface-900">How to distribute</h3>
            <p className="text-sm text-surface-500">Choose what to include and the format. If no routes are selected, the list includes all approved fleet/drivers.</p>
            <div className="flex flex-wrap gap-4 items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={distIncludeFleet} onChange={(e) => setDistIncludeFleet(e.target.checked)} className="rounded border-surface-300" />
                <span className="text-sm">Include fleet list</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={distIncludeDrivers} onChange={(e) => setDistIncludeDrivers(e.target.checked)} className="rounded border-surface-300" />
                <span className="text-sm">Include driver list</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-surface-600">Format:</span>
                <select value={distFormat} onChange={(e) => setDistFormat(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
                  <option value="csv">CSV</option>
                  <option value="excel">Excel (.xls)</option>
                </select>
              </div>
            </div>

            {distIncludeFleet && (
              <div className="pt-2">
                <p className="text-xs font-medium text-surface-500 mb-2">Fleet list columns to include in email attachment:</p>
                <div className="flex flex-wrap gap-3">
                  {FLEET_COLUMNS.filter((c) => c.key !== 'route_name' || distSelectedRouteIds.length > 0).map((col) => (
                    <label key={col.key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={distFleetColumns.includes(col.key)}
                        onChange={(e) => setDistFleetColumns((prev) => (e.target.checked ? [...prev, col.key] : prev.filter((k) => k !== col.key)))}
                        className="rounded border-surface-300"
                      />
                      <span className="text-sm text-surface-700">{col.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {distIncludeDrivers && (
              <div className="pt-2">
                <p className="text-xs font-medium text-surface-500 mb-2">Driver list columns to include in email attachment:</p>
                <div className="flex flex-wrap gap-3">
                  {DRIVER_COLUMNS.filter((c) => c.key !== 'route_name' || distSelectedRouteIds.length > 0).map((col) => (
                    <label key={col.key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={distDriverColumns.includes(col.key)}
                        onChange={(e) => setDistDriverColumns((prev) => (e.target.checked ? [...prev, col.key] : prev.filter((k) => k !== col.key)))}
                        className="rounded border-surface-300"
                      />
                      <span className="text-sm text-surface-700">{col.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              {distIncludeFleet && (
                <>
                  <button
                    type="button"
                    disabled={distDownloading !== null}
                    onClick={() => downloadList('fleet', 'csv')}
                    className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50 disabled:opacity-50"
                  >
                    {distDownloading === 'fleet-csv' ? 'Downloading…' : 'Download fleet (CSV)'}
                  </button>
                  <button
                    type="button"
                    disabled={distDownloading !== null}
                    onClick={() => downloadList('fleet', 'excel')}
                    className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50 disabled:opacity-50"
                  >
                    {distDownloading === 'fleet-excel' ? 'Downloading…' : 'Download fleet (Excel)'}
                  </button>
                </>
              )}
              {distIncludeDrivers && (
                <>
                  <button
                    type="button"
                    disabled={distDownloading !== null}
                    onClick={() => downloadList('driver', 'csv')}
                    className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50 disabled:opacity-50"
                  >
                    {distDownloading === 'driver-csv' ? 'Downloading…' : 'Download drivers (CSV)'}
                  </button>
                  <button
                    type="button"
                    disabled={distDownloading !== null}
                    onClick={() => downloadList('driver', 'excel')}
                    className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50 disabled:opacity-50"
                  >
                    {distDownloading === 'driver-excel' ? 'Downloading…' : 'Download drivers (Excel)'}
                  </button>
                </>
              )}
              <button type="button" onClick={() => window.print()} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">
                Print / Save as PDF
              </button>
            </div>

            <h3 className="font-medium text-surface-900 pt-4">Send from system (actual fleet/driver list attached)</h3>
            <p className="text-sm text-surface-500">Add recipients from existing users or enter any email address. Choose attachment format: Excel (professional layout), PDF, or CSV.</p>
            <div className="mt-3 rounded-lg border border-surface-300 bg-surface-50/50 p-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distSendPerContractor}
                  onChange={(e) => setDistSendPerContractor(e.target.checked)}
                  className="rounded border-surface-300"
                />
                <span className="text-sm font-medium text-surface-700">Send list per contractor (one list per contractor and route; file names: route, contractor, date and time)</span>
              </label>
              {distSendPerContractor && (
                <div className="mt-3 pl-6 space-y-3 border-t border-surface-200 pt-3">
                  <p className="text-xs text-surface-600">Select contractors to include (each gets fleet/driver list per route):</p>
                  {(() => {
                    const q = (distContractorSearch || '').trim().toLowerCase();
                    const filtered = q
                      ? distContractors.filter((c) => (c.name || '').toLowerCase().includes(q))
                      : distContractors;
                    const selectedSet = new Set(distSelectedContractorIds.map(String));
                    const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selectedSet.has(String(c.id)));
                    const someFilteredSelected = filtered.some((c) => selectedSet.has(String(c.id)));
                    return (
                      <div className="rounded-lg border border-surface-300 bg-white overflow-hidden">
                        <div className="flex flex-wrap gap-2 items-center p-2 border-b border-surface-200 bg-surface-50">
                          <input
                            type="search"
                            placeholder="Search contractors…"
                            value={distContractorSearch}
                            onChange={(e) => setDistContractorSearch(e.target.value)}
                            className="flex-1 min-w-[160px] rounded-md border border-surface-300 px-3 py-2 text-sm placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                            aria-label="Search contractors"
                          />
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-surface-500 whitespace-nowrap">
                              {distSelectedContractorIds.length} of {distContractors.length} selected
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const add = filtered.filter((c) => !selectedSet.has(String(c.id))).map((c) => c.id);
                                setDistSelectedContractorIds((prev) => [...new Set([...prev, ...add])]);
                              }}
                              className="px-3 py-1.5 text-xs font-medium rounded-md border border-surface-300 text-surface-700 bg-white hover:bg-surface-50"
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (filtered.length === 0) return;
                                const removeIds = new Set(filtered.map((c) => String(c.id)));
                                setDistSelectedContractorIds((prev) => prev.filter((id) => !removeIds.has(String(id))));
                              }}
                              className="px-3 py-1.5 text-xs font-medium rounded-md border border-surface-300 text-surface-700 bg-white hover:bg-surface-50"
                            >
                              Clear
                            </button>
                            {distContractors.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setDistSelectedContractorIds(allFilteredSelected ? [] : distContractors.map((c) => c.id))}
                                className="px-3 py-1.5 text-xs font-medium rounded-md border border-brand-400 text-brand-700 bg-brand-50 hover:bg-brand-100"
                              >
                                {allFilteredSelected ? 'Deselect all' : 'Select all (list)'}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="max-h-[220px] overflow-y-auto p-1" role="listbox" aria-multiselectable aria-label="Contractors">
                          {filtered.length === 0 ? (
                            <p className="py-4 text-center text-sm text-surface-500">
                              {distContractors.length === 0 ? 'No contractors available.' : 'No contractors match your search.'}
                            </p>
                          ) : (
                            filtered.map((c) => {
                              const id = String(c.id);
                              const checked = selectedSet.has(id);
                              return (
                                <label
                                  key={c.id}
                                  role="option"
                                  aria-selected={checked}
                                  className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm select-none ${checked ? 'bg-brand-50 text-surface-900 border border-brand-200' : 'hover:bg-surface-100 text-surface-800 border border-transparent'}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      setDistSelectedContractorIds((prev) =>
                                        prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                                      );
                                    }}
                                    className="rounded border-surface-300 text-brand-600 focus:ring-brand-500"
                                    aria-label={`Select ${c.name || 'contractor'}`}
                                  />
                                  <span className="flex-1 truncate">{c.name || 'Unnamed'}</span>
                                </label>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  {distSelectedContractorIds.length > 0 && (
                    <p className="text-xs text-surface-500">Each selected contractor will receive one list per route; PDF/Excel title = contractor name and route name.</p>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-4 items-center mt-3">
              <span className="text-sm text-surface-600">Attachment format:</span>
              <select
                value={distEmailFormat}
                onChange={(e) => setDistEmailFormat(e.target.value)}
                className="rounded-lg border border-surface-300 px-3 py-2 text-sm"
              >
                <option value="excel">Excel (.xlsx) – professional</option>
                <option value="pdf">PDF</option>
                <option value="csv">CSV</option>
              </select>
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <label className="text-xs font-medium text-surface-500">Add from users:</label>
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    const u = tenantUsers.find((x) => x.id === id);
                    if (u) addRecipientFromUser(u);
                    e.target.value = '';
                  }}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[200px]"
                >
                  <option value="">Choose a user…</option>
                  {tenantUsers.filter((u) => (u.email || '').trim()).map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <label className="text-xs font-medium text-surface-500">Or enter email:</label>
                <input
                  type="email"
                  placeholder="email@example.com"
                  value={distCustomEmail}
                  onChange={(e) => setDistCustomEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRecipientByEmail())}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-56"
                />
                <button type="button" onClick={addRecipientByEmail} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">
                  Add
                </button>
              </div>
              {distRecipients.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {distRecipients.map((r) => (
                    <span
                      key={r.email}
                      className="inline-flex items-center gap-1.5 rounded-full bg-surface-100 border border-surface-200 px-3 py-1 text-sm text-surface-800"
                    >
                      {r.label || r.email}
                      {r.label && <span className="text-surface-500 truncate max-w-[120px]">({r.email})</span>}
                      <button type="button" onClick={() => removeDistRecipient(r.email)} className="text-surface-500 hover:text-red-600 ml-0.5" aria-label="Remove">×</button>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs font-medium text-surface-500 pt-2">CC (optional)</p>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    const u = tenantUsers.find((x) => x.id === id);
                    if (u) addCcFromUser(u);
                    e.target.value = '';
                  }}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[200px]"
                >
                  <option value="">Add CC from users…</option>
                  {tenantUsers.filter((u) => (u.email || '').trim()).map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email} ({u.email})</option>
                  ))}
                </select>
                <input
                  type="email"
                  placeholder="Or enter CC email"
                  value={distCustomCcEmail}
                  onChange={(e) => setDistCustomCcEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCcByEmail())}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-48"
                />
                <button type="button" onClick={addCcByEmail} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">
                  Add CC
                </button>
              </div>
              {distCcRecipients.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {distCcRecipients.map((r) => (
                    <span
                      key={r.email}
                      className="inline-flex items-center gap-1.5 rounded-full bg-surface-100 border border-surface-200 px-3 py-1 text-sm text-surface-600"
                    >
                      CC: {r.label || r.email}
                      <button type="button" onClick={() => removeDistCcRecipient(r.email)} className="text-surface-500 hover:text-red-600 ml-0.5" aria-label="Remove">×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2 items-center pt-2">
                <button
                  type="button"
                  disabled={distSending || distRecipients.length === 0}
                  onClick={sendFromSystem}
                  className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {distSending ? 'Sending…' : 'Send list(s) via email'}
                </button>
                {distSendResult && (
                  <span className="text-sm text-green-700">
                    Sent to {distSendResult.sent} recipient(s).
                    {distSendResult.failed > 0 && ` ${distSendResult.failed} failed.`}
                  </span>
                )}
              </div>
            </div>

            <h3 className="font-medium text-surface-900 pt-4">Other options</h3>
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1">Recipient email (open your mail client)</label>
                <input
                  type="email"
                  placeholder="email@example.com"
                  value={distRecipientEmail}
                  onChange={(e) => setDistRecipientEmail(e.target.value)}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-56"
                />
              </div>
              <button type="button" onClick={sendViaEmail} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">
                Open mail client
              </button>
            </div>
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1">WhatsApp number (with country code)</label>
                <input
                  type="tel"
                  placeholder="e.g. 27123456789"
                  value={distRecipientWhatsApp}
                  onChange={(e) => setDistRecipientWhatsApp(e.target.value)}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-56"
                />
              </div>
              <button type="button" onClick={shareViaWhatsApp} className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700">
                Share via WhatsApp
              </button>
            </div>
            <p className="text-xs text-surface-500">Use “Send list(s) via email” to send the actual fleet/driver list from the system. “Open mail client” opens your email app so you can attach a file you downloaded.</p>
          </div>
        </div>
      )}

      {activeTab === 'pilot-distribution' && (
        <div className="space-y-6 max-w-5xl">
          <div>
            <h2 className="text-lg font-semibold text-surface-900">Pilot distribution</h2>
            <p className="text-sm text-surface-500 mt-1">
              Schedule automatic list emails (same attachments as <strong>List distribution → Send from system</strong>). Choose fleet and driver columns for each file below (same as <strong>How to distribute</strong> on List distribution). Times use the app timezone (default <strong>Africa/Johannesburg</strong>; override with <code className="text-xs bg-surface-100 px-1 rounded">EMAIL_TIMEZONE</code> in .env).
            </p>
          </div>

          <div className="flex gap-1 border-b border-surface-200">
            <button
              type="button"
              onClick={() => setPilotInnerTab('schedules')}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${pilotInnerTab === 'schedules' ? 'border-brand-600 text-brand-700 bg-surface-50' : 'border-transparent text-surface-600 hover:text-surface-900'}`}
            >
              Schedules
            </button>
            <button
              type="button"
              onClick={() => setPilotInnerTab('history')}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${pilotInnerTab === 'history' ? 'border-brand-600 text-brand-700 bg-surface-50' : 'border-transparent text-surface-600 hover:text-surface-900'}`}
            >
              Publication history
            </button>
          </div>

          {pilotError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 flex justify-between">
              <span>{pilotError}</span>
              <button type="button" onClick={() => setPilotError('')} className="text-red-600">Dismiss</button>
            </div>
          )}
          {pilotSuccess && pilotInnerTab === 'schedules' && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 flex justify-between">
              <span>{pilotSuccess}</span>
              <button type="button" onClick={() => setPilotSuccess('')} className="text-emerald-600">Dismiss</button>
            </div>
          )}

          {pilotInnerTab === 'schedules' && (
          <>
          {pilotMigration && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              Run <code className="bg-amber-100 px-1 rounded">npm run db:pilot-distribution</code> to enable pilot schedules.
            </div>
          )}

          <div className="bg-white rounded-xl border border-surface-200 p-6 space-y-4">
            <h3 className="font-medium text-surface-900">New pilot schedule</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-surface-500 mb-1">Label (optional)</label>
                <input
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  placeholder="e.g. Route A – weekly to ops"
                  value={pilotForm.name}
                  onChange={(e) => setPilotForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1">Route</label>
                <select
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  value={pilotForm.route_id}
                  onChange={(e) => setPilotForm((f) => ({ ...f, route_id: e.target.value, contractor_ids: [] }))}
                >
                  <option value="">Select route…</option>
                  {routes.map((r) => (
                    <option key={r.id} value={String(r.id)}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1">Frequency</label>
                <select
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  value={pilotForm.frequency}
                  onChange={(e) => setPilotForm((f) => ({ ...f, frequency: e.target.value }))}
                >
                  <option value="hourly">Hourly (at the chosen minute past each hour)</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1">Time (HH:MM, 24h)</label>
                <input
                  type="time"
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  value={pilotForm.time_hhmm.length === 5 ? pilotForm.time_hhmm : '09:00'}
                  onChange={(e) => setPilotForm((f) => ({ ...f, time_hhmm: e.target.value || '09:00' }))}
                />
                {pilotForm.frequency === 'hourly' && (
                  <p className="text-xs text-surface-500 mt-1">Only the <strong>minute</strong> is used (e.g. :00 = top of each hour).</p>
                )}
              </div>
              {pilotForm.frequency === 'weekly' && (
                <div>
                  <label className="block text-xs font-medium text-surface-500 mb-1">Day of week</label>
                  <select
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                    value={pilotForm.weekday}
                    onChange={(e) => setPilotForm((f) => ({ ...f, weekday: parseInt(e.target.value, 10) }))}
                  >
                    <option value={1}>Monday</option>
                    <option value={2}>Tuesday</option>
                    <option value={3}>Wednesday</option>
                    <option value={4}>Thursday</option>
                    <option value={5}>Friday</option>
                    <option value={6}>Saturday</option>
                    <option value={7}>Sunday</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1">List type</label>
                <select
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  value={pilotForm.list_type}
                  onChange={(e) => setPilotForm((f) => ({ ...f, list_type: e.target.value }))}
                >
                  <option value="both">Fleet + driver</option>
                  <option value="fleet">Fleet only</option>
                  <option value="driver">Driver only</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1">Attachment format</label>
                <select
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  value={pilotForm.attach_format}
                  onChange={(e) => setPilotForm((f) => ({ ...f, attach_format: e.target.value }))}
                >
                  <option value="excel">Excel</option>
                  <option value="pdf">PDF</option>
                  <option value="csv">CSV</option>
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-surface-200 bg-surface-50/80 p-4 space-y-4">
              <div>
                <h4 className="text-sm font-medium text-surface-900">Attachment columns</h4>
                <p className="text-sm text-surface-500 mt-1">
                  Choose which columns appear in each file. This matches <strong>List distribution</strong> → <strong>How to distribute</strong> (fleet and driver attachments). Applies to Excel, CSV, and the data shown in PDF.
                </p>
              </div>
              {(pilotForm.list_type === 'both' || pilotForm.list_type === 'fleet') && (
                <div>
                  <p className="text-xs font-medium text-surface-500 mb-2">Fleet list columns to include in the attachment:</p>
                  <div className="flex flex-wrap gap-3">
                    {FLEET_COLUMNS.filter((c) => c.key !== 'route_name' || pilotForm.route_id).map((col) => (
                      <label key={col.key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pilotFleetCols.includes(col.key)}
                          onChange={(e) =>
                            setPilotFleetCols((prev) =>
                              e.target.checked ? [...prev, col.key] : prev.filter((k) => k !== col.key)
                            )
                          }
                          className="rounded border-surface-300"
                        />
                        <span className="text-sm text-surface-700">{col.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {(pilotForm.list_type === 'both' || pilotForm.list_type === 'driver') && (
                <div>
                  <p className="text-xs font-medium text-surface-500 mb-2">Driver list columns to include in the attachment:</p>
                  <div className="flex flex-wrap gap-3">
                    {DRIVER_COLUMNS.filter((c) => c.key !== 'route_name' || pilotForm.route_id).map((col) => (
                      <label key={col.key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pilotDriverCols.includes(col.key)}
                          onChange={(e) =>
                            setPilotDriverCols((prev) =>
                              e.target.checked ? [...prev, col.key] : prev.filter((k) => k !== col.key)
                            )
                          }
                          className="rounded border-surface-300"
                        />
                        <span className="text-sm text-surface-700">{col.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-surface-500 mb-2">Companies on route (per-company lists)</label>
              <input
                type="search"
                placeholder="Search contractors…"
                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2"
                value={pilotContractorSearch}
                onChange={(e) => setPilotContractorSearch(e.target.value)}
              />
              <div className="max-h-40 overflow-y-auto rounded-lg border border-surface-200 p-2 space-y-1">
                {(() => {
                  const q = pilotContractorSearch.trim().toLowerCase();
                  const list = q ? pilotContractorsForRoute.filter((c) => (c.name || '').toLowerCase().includes(q)) : pilotContractorsForRoute;
                  const sel = new Set(pilotForm.contractor_ids.map(String));
                  return list.length === 0 ? (
                    <p className="text-sm text-surface-500 py-2">{pilotForm.route_id ? 'No contractors on this route yet.' : 'Select a route first.'}</p>
                  ) : (
                    list.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer py-1">
                        <input
                          type="checkbox"
                          checked={sel.has(String(c.id))}
                          onChange={() => {
                            setPilotForm((f) => {
                              const id = String(c.id);
                              const has = f.contractor_ids.map(String).includes(id);
                              return {
                                ...f,
                                contractor_ids: has ? f.contractor_ids.filter((x) => String(x) !== id) : [...f.contractor_ids, c.id],
                              };
                            });
                          }}
                          className="rounded border-surface-300"
                        />
                        {c.name || 'Unnamed'}
                      </label>
                    ))
                  );
                })()}
              </div>
            </div>
            <div className="space-y-3 rounded-lg border border-surface-200 bg-surface-50/50 p-4">
              <p className="text-xs font-medium text-surface-600">To — add from system users or enter an email</p>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    const u = tenantUsers.find((x) => x.id === id);
                    if (u) addPilotRecipientFromUser(u);
                    e.target.value = '';
                  }}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[200px] bg-white"
                >
                  <option value="">Add recipient from users…</option>
                  {tenantUsers.filter((u) => (u.email || '').trim()).map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email} ({u.email})</option>
                  ))}
                </select>
                <input
                  type="email"
                  placeholder="Or type email"
                  value={pilotCustomEmail}
                  onChange={(e) => setPilotCustomEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPilotRecipientByEmail())}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-52 bg-white"
                />
                <button type="button" onClick={addPilotRecipientByEmail} className="px-3 py-2 text-sm rounded-lg border border-surface-300 bg-white hover:bg-surface-50">Add</button>
              </div>
              {pilotRecipients.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pilotRecipients.map((r) => (
                    <span key={r.email} className="inline-flex items-center gap-1 rounded-full bg-white border border-surface-200 px-3 py-1 text-sm">
                      {r.label || r.email}
                      {r.label && <span className="text-surface-500 text-xs">({r.email})</span>}
                      <button type="button" onClick={() => removePilotRecipient(r.email)} className="text-surface-500 hover:text-red-600 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs font-medium text-surface-600 pt-2">CC (optional)</p>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    const u = tenantUsers.find((x) => x.id === id);
                    if (u) addPilotCcFromUser(u);
                    e.target.value = '';
                  }}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[200px] bg-white"
                >
                  <option value="">Add CC from users…</option>
                  {tenantUsers.filter((u) => (u.email || '').trim()).map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name || u.email} ({u.email})</option>
                  ))}
                </select>
                <input
                  type="email"
                  placeholder="Or CC email"
                  value={pilotCustomCcEmail}
                  onChange={(e) => setPilotCustomCcEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPilotCcByEmail())}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-48 bg-white"
                />
                <button type="button" onClick={addPilotCcByEmail} className="px-3 py-2 text-sm rounded-lg border border-surface-300 bg-white hover:bg-surface-50">Add CC</button>
              </div>
              {pilotCcRecipients.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pilotCcRecipients.map((r) => (
                    <span key={r.email} className="inline-flex items-center gap-1 rounded-full bg-white border border-surface-200 px-3 py-1 text-sm text-surface-600">
                      CC: {r.label || r.email}
                      <button type="button" onClick={() => removePilotCcRecipient(r.email)} className="text-surface-500 hover:text-red-600 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pilotSaving || pilotMigration}
                className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                onClick={() => {
                  setPilotError('');
                  setPilotSuccess('');
                  if (!pilotForm.route_id) {
                    setPilotError('Select a route.');
                    return;
                  }
                  if (!pilotForm.contractor_ids.length) {
                    setPilotError('Select at least one company.');
                    return;
                  }
                  const to = [...new Set(pilotRecipients.map((r) => r.email))];
                  if (!to.length) {
                    setPilotError('Add at least one recipient (from users or enter an email).');
                    return;
                  }
                  const ccList = pilotCcRecipients.length > 0 ? pilotCcRecipients.map((r) => r.email) : undefined;
                  setPilotSaving(true);
                  contractorApi.pilotDistribution
                    .create({
                      name: pilotForm.name.trim() || undefined,
                      route_id: pilotForm.route_id,
                      contractor_ids: pilotForm.contractor_ids,
                      recipient_emails: to.join(','),
                      cc_emails: ccList && ccList.length ? ccList.join(',') : undefined,
                      list_type: pilotForm.list_type,
                      attach_format: pilotForm.attach_format,
                      fleet_columns: pilotFleetCols,
                      driver_columns: pilotDriverCols,
                      frequency: pilotForm.frequency,
                      time_hhmm: pilotForm.time_hhmm,
                      weekday: pilotForm.frequency === 'weekly' ? pilotForm.weekday : undefined,
                    })
                    .then(() => {
                      setPilotSuccess('Pilot schedule saved. It will run on the next matching time.');
                      setPilotForm((f) => ({
                        ...f,
                        name: '',
                        contractor_ids: [],
                      }));
                      setPilotRecipients([]);
                      setPilotCcRecipients([]);
                      return contractorApi.pilotDistribution.list();
                    })
                    .then((r) => setPilots(r.pilots || []))
                    .catch((e) => setPilotError(e?.message || 'Failed to save'))
                    .finally(() => setPilotSaving(false));
                }}
              >
                {pilotSaving ? 'Saving…' : 'Save pilot schedule'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-100 font-medium text-surface-800">Schedules</div>
            {pilotLoading ? (
              <p className="p-4 text-sm text-surface-500">Loading…</p>
            ) : pilots.length === 0 ? (
              <p className="p-4 text-sm text-surface-500">No pilot schedules yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-50 border-b border-surface-200">
                    <tr>
                      <th className="text-left p-3 font-medium text-surface-700">Label / route</th>
                      <th className="text-left p-3 font-medium text-surface-700">Schedule</th>
                      <th className="text-left p-3 font-medium text-surface-700">Last run</th>
                      <th className="text-left p-3 font-medium text-surface-700">Status</th>
                      <th className="p-3 w-40" />
                    </tr>
                  </thead>
                  <tbody>
                    {pilots.map((p) => {
                      const wd = ['—', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                      const sched =
                        p.frequency === 'hourly'
                          ? `Hourly at :${String(p.time_hhmm || '00:00').slice(-2)}`
                          : p.frequency === 'daily'
                            ? `Daily ${p.time_hhmm || ''}`
                            : `Weekly ${wd[p.weekday] || '?'} ${p.time_hhmm || ''}`;
                      const active = !!p.is_active;
                      const refreshPilots = () => contractorApi.pilotDistribution.list().then((r) => setPilots(r.pilots || []));
                      return (
                        <tr key={p.id} className="border-b border-surface-100">
                          <td className="p-3">
                            <div className="font-medium text-surface-900">{p.name || '—'}</div>
                            <div className="text-surface-600 text-xs">{p.route_name || p.route_id}</div>
                          </td>
                          <td className="p-3 text-surface-700">{sched}</td>
                          <td className="p-3 text-surface-600 text-xs max-w-[200px]">
                            {p.last_run_at ? formatDateTime(p.last_run_at) : '—'}
                            {p.last_run_status && (
                              <div className={p.last_run_status === 'ok' ? 'text-emerald-700' : 'text-amber-800'}>
                                {p.last_run_status}: {(p.last_run_detail || '').slice(0, 80)}
                                {(p.last_run_detail || '').length > 80 ? '…' : ''}
                              </div>
                            )}
                          </td>
                          <td className="p-3">
                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${active ? 'bg-emerald-100 text-emerald-800' : 'bg-surface-200 text-surface-600'}`}>
                              {active ? 'Active' : 'Off'}
                            </span>
                          </td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-2 items-center">
                              {active ? (
                                <button
                                  type="button"
                                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-surface-400 text-surface-800 bg-surface-100 hover:bg-surface-200"
                                  onClick={() => {
                                    contractorApi.pilotDistribution.update(p.id, { is_active: false }).then(refreshPilots).catch(() => {});
                                  }}
                                >
                                  Switch off
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-brand-500 text-brand-700 bg-brand-50 hover:bg-brand-100"
                                  onClick={() => {
                                    contractorApi.pilotDistribution.update(p.id, { is_active: true }).then(refreshPilots).catch(() => {});
                                  }}
                                >
                                  Turn on
                                </button>
                              )}
                              <button
                                type="button"
                                className="text-red-600 text-xs hover:underline"
                                onClick={() => {
                                  if (!window.confirm('Delete this pilot schedule?')) return;
                                  contractorApi.pilotDistribution
                                    .delete(p.id)
                                    .then(refreshPilots)
                                    .catch((e) => setPilotError(e?.message || 'Delete failed'));
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </>
          )}

          {pilotInnerTab === 'history' && (
            <div className="space-y-4">
              {pilotHistoryMigration && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                  Run <code className="bg-amber-100 px-1 rounded">npm run db:access-distribution-pilot</code> so pilot sends appear in this history.
                </div>
              )}
              <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-surface-100 font-medium text-surface-800">Emails sent by pilot schedules</div>
                {pilotHistoryLoading ? (
                  <p className="p-4 text-sm text-surface-500">Loading…</p>
                ) : pilotHistory.length === 0 ? (
                  <p className="p-4 text-sm text-surface-500">No pilot publication history yet. History is recorded after each automated send (requires the migration above).</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-50 border-b border-surface-200">
                        <tr>
                          <th className="text-left p-3 font-medium text-surface-700">When</th>
                          <th className="text-left p-3 font-medium text-surface-700">Schedule</th>
                          <th className="text-left p-3 font-medium text-surface-700">Recipient</th>
                          <th className="text-left p-3 font-medium text-surface-700">Route</th>
                          <th className="text-left p-3 font-medium text-surface-700">List</th>
                          <th className="text-left p-3 font-medium text-surface-700">Format</th>
                          <th className="text-left p-3 font-medium text-surface-700">Sent by</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pilotHistory.map((h) => {
                          const rid = h.route_ids ? String(h.route_ids).split(',')[0] : '';
                          const routeLabel = routes.find((r) => String(r.id) === rid)?.name || h.route_ids || '—';
                          return (
                            <tr key={h.id} className="border-b border-surface-100">
                              <td className="p-3 text-surface-600 whitespace-nowrap">{formatDateTime(h.created_at)}</td>
                              <td className="p-3 text-surface-800">{h.pilot_schedule_name || '—'}</td>
                              <td className="p-3 text-surface-700">{h.recipient_email || '—'}</td>
                              <td className="p-3 text-surface-600 text-xs max-w-[140px] truncate" title={routeLabel}>{routeLabel}</td>
                              <td className="p-3 text-surface-600">{h.list_type || '—'}</td>
                              <td className="p-3 text-surface-600">{h.format || '—'}</td>
                              <td className="p-3 text-surface-600 text-xs">{h.created_by_name || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'distribution-history' && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-surface-900">Distribution history</h2>
          <p className="text-sm text-surface-500">View and filter all fleet/driver list distributions (downloads, email, WhatsApp). Export with advanced filters.</p>

          <div className="bg-white rounded-xl border border-surface-200 p-4 space-y-4">
            <h3 className="font-medium text-surface-900">Advanced filters</h3>
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1">Date from</label>
                <input
                  type="date"
                  value={distHistoryFilters.dateFrom}
                  onChange={(e) => setDistHistoryFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1">Date to</label>
                <input
                  type="date"
                  value={distHistoryFilters.dateTo}
                  onChange={(e) => setDistHistoryFilters((f) => ({ ...f, dateTo: e.target.value }))}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1">Route</label>
                <select
                  value={distHistoryFilters.routeId}
                  onChange={(e) => setDistHistoryFilters((f) => ({ ...f, routeId: e.target.value }))}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[140px]"
                >
                  <option value="">All routes</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1">List type</label>
                <select
                  value={distHistoryFilters.listType}
                  onChange={(e) => setDistHistoryFilters((f) => ({ ...f, listType: e.target.value }))}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm"
                >
                  <option value="">All</option>
                  <option value="fleet">Fleet</option>
                  <option value="driver">Driver</option>
                  <option value="both">Both</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1">Channel</label>
                <select
                  value={distHistoryFilters.channel}
                  onChange={(e) => setDistHistoryFilters((f) => ({ ...f, channel: e.target.value }))}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm"
                >
                  <option value="">All</option>
                  <option value="download">Download</option>
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1">Search (recipient / created by)</label>
                <input
                  type="text"
                  placeholder="Search…"
                  value={distHistoryFilters.search}
                  onChange={(e) => setDistHistoryFilters((f) => ({ ...f, search: e.target.value }))}
                  className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-44"
                />
              </div>
              <button
                type="button"
                disabled={distHistoryExporting}
                onClick={() => {
                  setDistHistoryExporting(true);
                  const params = {};
                  if (distHistoryFilters.dateFrom) params.dateFrom = distHistoryFilters.dateFrom;
                  if (distHistoryFilters.dateTo) params.dateTo = distHistoryFilters.dateTo;
                  if (distHistoryFilters.routeId) params.routeId = distHistoryFilters.routeId;
                  if (distHistoryFilters.listType) params.listType = distHistoryFilters.listType;
                  if (distHistoryFilters.channel) params.channel = distHistoryFilters.channel;
                  const url = contractorApi.distributionHistory.exportUrl(params);
                  fetch(url, { credentials: 'include' })
                    .then((res) => { if (!res.ok) throw new Error('Export failed'); return res.blob(); })
                    .then((blob) => {
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = 'distribution-history.csv';
                      a.click();
                      URL.revokeObjectURL(a.href);
                    })
                    .catch((err) => setError(err?.message || 'Export failed'))
                    .finally(() => setDistHistoryExporting(false));
                }}
                className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50 disabled:opacity-50"
              >
                {distHistoryExporting ? 'Exporting…' : 'Export CSV'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
            {distHistoryLoading ? (
              <p className="p-6 text-surface-500">Loading…</p>
            ) : distHistory.length === 0 ? (
              <p className="p-6 text-surface-500">No distribution history yet. Use List distribution to download or send lists; events will appear here.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-50 border-b border-surface-200">
                    <tr>
                      <th className="text-left p-3 font-medium text-surface-700">Date</th>
                      <th className="text-left p-3 font-medium text-surface-700">List type</th>
                      <th className="text-left p-3 font-medium text-surface-700">Format</th>
                      <th className="text-left p-3 font-medium text-surface-700">Channel</th>
                      <th className="text-left p-3 font-medium text-surface-700">Recipient</th>
                      <th className="text-left p-3 font-medium text-surface-700">Created by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distHistory.map((h) => (
                      <tr key={h.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                        <td className="p-3 whitespace-nowrap">{formatDateTime(h.created_at)}</td>
                        <td className="p-3 capitalize">{h.list_type}</td>
                        <td className="p-3">{h.format}</td>
                        <td className="p-3 capitalize">{h.channel}</td>
                        <td className="p-3">{h.recipient_email || h.recipient_phone || '—'}</td>
                        <td className="p-3">{h.created_by_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'progress-report-creation' && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-surface-900">Project progress reports</h2>
          <p className="text-sm text-surface-500">Create or edit the project progress report. Rectors will see it under the Progress reports tab. Include project phases, integration status per company (contractor), and conclusion.</p>

          <div className="flex gap-1 border-b border-surface-200">
            <button
              type="button"
              onClick={() => setProgressReportSubTab('creation')}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${progressReportSubTab === 'creation' ? 'border-brand-500 text-brand-700 bg-brand-50' : 'border-transparent text-surface-600 hover:text-surface-800 hover:bg-surface-50'}`}
            >
              Create / Edit
            </button>
            <button
              type="button"
              onClick={() => setProgressReportSubTab('published')}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${progressReportSubTab === 'published' ? 'border-brand-500 text-brand-700 bg-brand-50' : 'border-transparent text-surface-600 hover:text-surface-800 hover:bg-surface-50'}`}
            >
              Published reports
            </button>
          </div>

          {progressReportSubTab === 'published' && (
            <div className="bg-white rounded-xl border border-surface-200 p-6">
              <h3 className="text-base font-semibold text-surface-800 mb-4">Published reports</h3>
              {progressReportsListLoading ? (
                <p className="text-surface-500">Loading…</p>
              ) : progressReportsList.length === 0 ? (
                <p className="text-surface-500">No reports yet. Create one in the Create / Edit tab.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-surface-200 bg-surface-50">
                        <th className="text-left p-3 font-medium text-surface-700">Title</th>
                        <th className="text-left p-3 font-medium text-surface-700">Report date</th>
                        <th className="text-left p-3 font-medium text-surface-700">Reporting status</th>
                        <th className="text-left p-3 font-medium text-surface-700">Routes</th>
                        <th className="p-3 font-medium text-surface-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {progressReportsList.map((r) => (
                        <tr key={r.id} className="border-b border-surface-100 hover:bg-surface-50">
                          <td className="p-3 text-surface-800">{r.title || 'Untitled report'}</td>
                          <td className="p-3 text-surface-600">{r.report_date ? formatDate(r.report_date) : '—'}</td>
                          <td className="p-3 text-surface-600">{r.reporting_status || '—'}</td>
                          <td className="p-3 text-surface-600">
                            {Array.isArray(r.route_ids) && r.route_ids.length > 0
                              ? r.route_ids.map((id) => routeNameById[String(id)] || 'Unknown route').join(', ')
                              : 'All routes'}
                          </td>
                          <td className="p-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => openShareEmailModal(r)}
                              className="text-surface-600 hover:text-brand-600 text-sm font-medium"
                            >
                              Share via email
                            </button>
                            <span className="text-surface-300">|</span>
                            <button
                              type="button"
                              onClick={() => {
                                setProgressReportSubTab('creation');
                                setEditingProgressReportId(r.id);
                                progressReportsApi.get(r.id).then((res) => {
                                  const rep = res.report || {};
                                  setProgressReportForm({
                                    title: rep.title || '',
                                    report_date: rep.report_date ? rep.report_date.slice(0, 10) : todayYmd(),
                                    reporting_status: rep.reporting_status || '',
                                    route_ids: normalizeIds(rep.route_ids || []),
                                    narrative_updates: rep.narrative_updates || '',
                                    phases: Array.isArray(rep.phases) && rep.phases.length ? rep.phases.map((p) => ({ name: p.name || '', description: p.description || '' })) : [{ name: '', description: '' }],
                                    contractor_status: Array.isArray(rep.contractor_status) && rep.contractor_status.length ? rep.contractor_status.map((c) => ({
                                      contractor_name: c.contractor_name || c.haulier || '',
                                      operational_total: c.operational_total ?? '',
                                      integrated_count_1: c.integrated_count_1 ?? '',
                                      integrated_date_1: c.integrated_date_1 || '',
                                      integrated_count_2: c.integrated_count_2 ?? '',
                                      integrated_date_2: c.integrated_date_2 || '',
                                      percent_increase: c.percent_increase ?? '',
                                      narrative: c.narrative || c.note || '',
                                    })) : [{ contractor_name: '', operational_total: '', integrated_count_1: '', integrated_date_1: '', integrated_count_2: '', integrated_date_2: '', percent_increase: '', narrative: '' }],
                                    conclusion_text: rep.conclusion_text || '',
                                  });
                                }).catch(() => setError('Failed to load report'));
                              }}
                              className="text-brand-600 hover:text-brand-800 text-sm font-medium"
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Share via email modal */}
              {shareEmailOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !shareEmailSending && setShareEmailOpen(false)} role="dialog" aria-modal="true" aria-labelledby="share-email-title">
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="shrink-0 px-6 py-4 border-b border-surface-200">
                      <h3 id="share-email-title" className="text-lg font-semibold text-surface-900">Share report via email</h3>
                      <p className="text-sm text-surface-500 mt-1">Select recipients and add an optional message. The report PDF will be attached.</p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                      {shareEmailError && (
                        <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2">{shareEmailError}</div>
                      )}
                      {!shareEmailReport && (
                        <p className="text-sm text-surface-500">Loading report…</p>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-2">To (select one or more)</label>
                        <div className="border border-surface-200 rounded-lg max-h-40 overflow-y-auto p-2 space-y-1.5">
                          {shareEmailRecipients.length === 0 ? (
                            <p className="text-sm text-surface-500 py-2">Loading users…</p>
                          ) : (
                            shareEmailRecipients.map((u) => (
                              <label key={u.id} className="flex items-center gap-2 cursor-pointer hover:bg-surface-50 rounded px-2 py-1.5">
                                <input type="checkbox" checked={shareEmailToIds.includes(u.id)} onChange={(e) => setShareEmailToIds((prev) => e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id))} className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
                                <span className="text-sm text-surface-800">{u.full_name || '—'}</span>
                                <span className="text-xs text-surface-500 truncate">{u.email}</span>
                              </label>
                            ))
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-2">CC (optional – select users or type emails)</label>
                        <div className="border border-surface-200 rounded-lg max-h-32 overflow-y-auto p-2 space-y-1.5 mb-2">
                          {shareEmailRecipients.length === 0 ? (
                            <p className="text-sm text-surface-500 py-2">Loading users…</p>
                          ) : (
                            shareEmailRecipients.map((u) => (
                              <label key={u.id} className="flex items-center gap-2 cursor-pointer hover:bg-surface-50 rounded px-2 py-1.5">
                                <input type="checkbox" checked={shareEmailCcIds.includes(u.id)} onChange={(e) => setShareEmailCcIds((prev) => e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id))} className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
                                <span className="text-sm text-surface-800">{u.full_name || '—'}</span>
                                <span className="text-xs text-surface-500 truncate">{u.email}</span>
                              </label>
                            ))
                          )}
                        </div>
                        <input type="text" value={shareEmailCc} onChange={(e) => setShareEmailCc(e.target.value)} placeholder="Or add other emails: email@example.com, another@example.com" className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm" />
                        <p className="text-xs text-surface-500 mt-1">Separate multiple emails with commas or spaces.</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-1">Message (optional)</label>
                        <textarea value={shareEmailMessage} onChange={(e) => setShareEmailMessage(e.target.value)} rows={3} placeholder="Add a short note to include in the email…" className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm resize-y" />
                      </div>
                    </div>
                    <div className="shrink-0 flex justify-end gap-2 px-6 py-4 border-t border-surface-200 bg-surface-50">
                      <button type="button" onClick={() => setShareEmailOpen(false)} disabled={shareEmailSending} className="px-4 py-2 rounded-lg border border-surface-200 text-surface-700 text-sm font-medium hover:bg-surface-100 disabled:opacity-50">Cancel</button>
                      <button type="button" onClick={sendProgressReportEmail} disabled={shareEmailSending || shareEmailToIds.length === 0 || !shareEmailReport} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                        {shareEmailSending ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
                        {shareEmailSending ? 'Sending…' : 'Send email'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {progressReportSubTab === 'creation' && (
            <>
          {progressReportsListLoading ? (
            <p className="text-surface-500">Loading…</p>
          ) : (
            <>
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={() => {
                  setEditingProgressReportId(null);
                  setProgressReportForm({
                    title: '',
                    report_date: todayYmd(),
                    reporting_status: '',
                    route_ids: [],
                    narrative_updates: '',
                    phases: [{ name: '', description: '' }],
                    contractor_status: [{ contractor_name: '', operational_total: '', integrated_count_1: '', integrated_date_1: '', integrated_count_2: '', integrated_date_2: '', percent_increase: '', narrative: '' }],
                    conclusion_text: '',
                  });
                }}
                className="px-3 py-2 rounded-lg border border-surface-200 text-surface-700 text-sm font-medium hover:bg-surface-50"
              >
                New report
              </button>
              <span className="text-sm text-surface-500 self-center">To edit an existing report, go to the Published reports tab and click Edit.</span>
            </div>

          <div className="bg-white rounded-xl border border-surface-200 p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Report title *</label>
              <input type="text" value={progressReportForm.title} onChange={(e) => setProgressReportForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Ntshovelo Fleet Monitoring Project: Updated Progress Summary Report" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Report date *</label>
                <input type="date" value={progressReportForm.report_date} onChange={(e) => setProgressReportForm((f) => ({ ...f, report_date: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Reporting status (e.g. Phase 4 & Phase 5)</label>
                <input type="text" value={progressReportForm.reporting_status} onChange={(e) => setProgressReportForm((f) => ({ ...f, reporting_status: e.target.value }))} placeholder="Phase 4 (Continuous Monitoring) & Phase 5 (Feedback)" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Applicable route(s) for rector visibility</label>
              <RouteChecklist
                routes={routes}
                selectedIds={progressReportForm.route_ids}
                onToggle={(routeId) =>
                  setProgressReportForm((f) => {
                    const next = new Set((f.route_ids || []).map((id) => String(id)));
                    if (next.has(routeId)) next.delete(routeId);
                    else next.add(routeId);
                    return { ...f, route_ids: Array.from(next) };
                  })
                }
              />
              <p className="text-xs text-surface-500 mt-1">
                Leave empty to publish to all rectors. {progressReportForm.route_ids?.length ? `${progressReportForm.route_ids.length} selected.` : ''}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Executive Summary</label>
              <textarea value={progressReportForm.narrative_updates} onChange={(e) => setProgressReportForm((f) => ({ ...f, narrative_updates: e.target.value }))} rows={4} placeholder="Per-haulier updates, standard procedure notes…" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>

            <div>
              <h4 className="text-sm font-semibold text-surface-800 mb-2">Project phases</h4>
              <p className="text-xs text-surface-500 mb-3">Add phase name and a full description (paragraphs supported).</p>
              {progressReportForm.phases.map((p, i) => (
                <div key={i} className="mb-5 p-4 rounded-xl bg-surface-50 border border-surface-200 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-surface-500 uppercase tracking-wider">Phase {i + 1}</label>
                    {progressReportForm.phases.length > 1 && (
                      <button type="button" onClick={() => setProgressReportForm((f) => ({ ...f, phases: f.phases.filter((_, j) => j !== i) }))} className="text-red-600 text-sm hover:underline">Remove phase</button>
                    )}
                  </div>
                  <input type="text" value={p.name} onChange={(e) => setProgressReportForm((f) => ({ ...f, phases: f.phases.map((ph, j) => j === i ? { ...ph, name: e.target.value } : ph) }))} placeholder="Phase name (e.g. Phase 4: Continuous Monitoring)" className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm font-medium" />
                  <textarea value={p.description} onChange={(e) => setProgressReportForm((f) => ({ ...f, phases: f.phases.map((ph, j) => j === i ? { ...ph, description: e.target.value } : ph) }))} placeholder="Full description (you can type one or more paragraphs here)…" rows={6} className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm resize-y min-h-[120px]" />
                </div>
              ))}
              <button type="button" onClick={() => setProgressReportForm((f) => ({ ...f, phases: [...f.phases, { name: '', description: '' }] }))} className="text-sm text-brand-600 font-medium">+ Add phase</button>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-surface-800 mb-2">Integration status per company (contractor)</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-surface-200 bg-surface-50">
                      <th className="text-left p-2 font-medium">Haulier / Company</th>
                      <th className="text-left p-2 font-medium">Oper. total</th>
                      <th className="text-left p-2 font-medium">Integrated 1</th>
                      <th className="text-left p-2 font-medium">Date 1</th>
                      <th className="text-left p-2 font-medium">Integrated 2</th>
                      <th className="text-left p-2 font-medium">Date 2</th>
                      <th className="text-left p-2 font-medium">% Increase</th>
                      <th className="text-left p-2 font-medium">Narrative / note</th>
                      <th className="p-2 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {progressReportForm.contractor_status.map((c, i) => (
                      <tr key={i} className="border-b border-surface-100">
                        <td className="p-2"><input type="text" value={c.contractor_name} onChange={(e) => setProgressReportForm((f) => ({ ...f, contractor_status: f.contractor_status.map((cs, j) => j === i ? { ...cs, contractor_name: e.target.value } : cs) }))} placeholder="Company name" className="w-full rounded border px-2 py-1 text-sm" /></td>
                        <td className="p-2"><input type="text" value={c.operational_total} onChange={(e) => setProgressReportForm((f) => ({ ...f, contractor_status: f.contractor_status.map((cs, j) => j === i ? { ...cs, operational_total: e.target.value } : cs) }))} placeholder="e.g. 141" className="w-16 rounded border px-2 py-1 text-sm" /></td>
                        <td className="p-2"><input type="text" value={c.integrated_count_1} onChange={(e) => setProgressReportForm((f) => ({ ...f, contractor_status: f.contractor_status.map((cs, j) => j === i ? { ...cs, integrated_count_1: e.target.value } : cs) }))} placeholder="124" className="w-14 rounded border px-2 py-1 text-sm" /></td>
                        <td className="p-2"><input type="text" value={c.integrated_date_1} onChange={(e) => setProgressReportForm((f) => ({ ...f, contractor_status: f.contractor_status.map((cs, j) => j === i ? { ...cs, integrated_date_1: e.target.value } : cs) }))} placeholder="Feb 23" className="w-20 rounded border px-2 py-1 text-sm" /></td>
                        <td className="p-2"><input type="text" value={c.integrated_count_2} onChange={(e) => setProgressReportForm((f) => ({ ...f, contractor_status: f.contractor_status.map((cs, j) => j === i ? { ...cs, integrated_count_2: e.target.value } : cs) }))} placeholder="126" className="w-14 rounded border px-2 py-1 text-sm" /></td>
                        <td className="p-2"><input type="text" value={c.integrated_date_2} onChange={(e) => setProgressReportForm((f) => ({ ...f, contractor_status: f.contractor_status.map((cs, j) => j === i ? { ...cs, integrated_date_2: e.target.value } : cs) }))} placeholder="Mar 2" className="w-20 rounded border px-2 py-1 text-sm" /></td>
                        <td className="p-2"><input type="text" value={c.percent_increase} onChange={(e) => setProgressReportForm((f) => ({ ...f, contractor_status: f.contractor_status.map((cs, j) => j === i ? { ...cs, percent_increase: e.target.value } : cs) }))} placeholder="+1.61%" className="w-20 rounded border px-2 py-1 text-sm" /></td>
                        <td className="p-2"><input type="text" value={c.narrative} onChange={(e) => setProgressReportForm((f) => ({ ...f, contractor_status: f.contractor_status.map((cs, j) => j === i ? { ...cs, narrative: e.target.value } : cs) }))} placeholder="Note" className="min-w-[120px] rounded border px-2 py-1 text-sm" /></td>
                        <td className="p-2">{progressReportForm.contractor_status.length > 1 ? <button type="button" onClick={() => setProgressReportForm((f) => ({ ...f, contractor_status: f.contractor_status.filter((_, j) => j !== i) }))} className="text-red-600 text-xs">Remove</button> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={() => setProgressReportForm((f) => ({ ...f, contractor_status: [...f.contractor_status, { contractor_name: '', operational_total: '', integrated_count_1: '', integrated_date_1: '', integrated_count_2: '', integrated_date_2: '', percent_increase: '', narrative: '' }] }))} className="mt-2 text-sm text-brand-600 font-medium">+ Add row</button>
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1">Conclusion</label>
              <textarea value={progressReportForm.conclusion_text} onChange={(e) => setProgressReportForm((f) => ({ ...f, conclusion_text: e.target.value }))} rows={4} placeholder="The project has reached a turning point…" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={!progressReportForm.title.trim() || progressReportSaving}
                onClick={() => {
                  setProgressReportSaving(true);
                  const payload = {
                    title: progressReportForm.title.trim(),
                    report_date: progressReportForm.report_date,
                    reporting_status: progressReportForm.reporting_status.trim() || null,
                    narrative_updates: progressReportForm.narrative_updates.trim() || null,
                    phases: progressReportForm.phases.filter((p) => p.name || p.description).map((p) => ({ name: p.name || '', description: p.description || '' })),
                    contractor_status: progressReportForm.contractor_status.map((c) => ({
                      contractor_name: c.contractor_name || '',
                      operational_total: c.operational_total,
                      integrated_count_1: c.integrated_count_1,
                      integrated_date_1: c.integrated_date_1 || null,
                      integrated_count_2: c.integrated_count_2,
                      integrated_date_2: c.integrated_date_2 || null,
                      percent_increase: c.percent_increase,
                      narrative: c.narrative || null,
                    })),
                    route_ids: normalizeIds(progressReportForm.route_ids),
                    conclusion_text: progressReportForm.conclusion_text.trim() || null,
                  };
                  (editingProgressReportId ? progressReportsApi.update(editingProgressReportId, payload) : progressReportsApi.create(payload))
                    .then((res) => {
                      setEditingProgressReportId(res.report?.id || editingProgressReportId);
                      return progressReportsApi.list();
                    })
                    .then((r) => setProgressReportsList(r.reports || []))
                    .catch((e) => setError(e?.message || 'Save failed'))
                    .finally(() => setProgressReportSaving(false));
                }}
                className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {progressReportSaving ? 'Saving…' : editingProgressReportId ? 'Update report' : 'Create report'}
              </button>
            </div>
          </div>
            </>)}
            </>
          )}
        </div>
      )}

      {activeTab === 'action-plan-timelines' && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-surface-900">Action plan and Project timelines</h2>
          <p className="text-sm text-surface-500">Plan how you will execute the project: phases, start and due dates, action descriptions, participants, and status. Rectors can view these under &quot;View Project timelines and action plan&quot;.</p>

          <div className="flex gap-1 border-b border-surface-200">
            <button
              type="button"
              onClick={() => setActionPlanSubTab('creation')}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${actionPlanSubTab === 'creation' ? 'border-brand-500 text-brand-700 bg-brand-50' : 'border-transparent text-surface-600 hover:text-surface-800 hover:bg-surface-50'}`}
            >
              Create / Edit
            </button>
            <button
              type="button"
              onClick={() => setActionPlanSubTab('published')}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${actionPlanSubTab === 'published' ? 'border-brand-500 text-brand-700 bg-brand-50' : 'border-transparent text-surface-600 hover:text-surface-800 hover:bg-surface-50'}`}
            >
              Published plans
            </button>
          </div>

          {actionPlanSubTab === 'published' && (
            <div className="bg-white rounded-xl border border-surface-200 p-6">
              <h3 className="text-base font-semibold text-surface-800 mb-4">Published action plans</h3>
              {actionPlansListLoading ? (
                <p className="text-surface-500">Loading…</p>
              ) : actionPlansList.length === 0 ? (
                <p className="text-surface-500">No action plans yet. Create one in the Create / Edit tab.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-surface-200 bg-surface-50">
                        <th className="text-left p-3 font-medium text-surface-700">Title</th>
                        <th className="text-left p-3 font-medium text-surface-700">Project name</th>
                        <th className="text-left p-3 font-medium text-surface-700">Document date</th>
                        <th className="text-left p-3 font-medium text-surface-700">Document ID</th>
                        <th className="text-left p-3 font-medium text-surface-700">Routes</th>
                        <th className="p-3 font-medium text-surface-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {actionPlansList.map((p) => (
                        <tr key={p.id} className="border-b border-surface-100 hover:bg-surface-50">
                          <td className="p-3 text-surface-800">{p.title || 'Action Plan'}</td>
                          <td className="p-3 text-surface-600">{p.project_name || '—'}</td>
                          <td className="p-3 text-surface-600">{p.document_date ? formatDate(p.document_date) : '—'}</td>
                          <td className="p-3 text-surface-600">{p.document_id || '—'}</td>
                          <td className="p-3 text-surface-600">
                            {Array.isArray(p.route_ids) && p.route_ids.length > 0
                              ? p.route_ids.map((id) => routeNameById[String(id)] || 'Unknown route').join(', ')
                              : 'All routes'}
                          </td>
                          <td className="p-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => openShareActionPlanEmailModal(p)}
                              className="text-surface-600 hover:text-brand-600 text-sm font-medium"
                            >
                              Share via email
                            </button>
                            <span className="text-surface-300">|</span>
                            <button
                              type="button"
                              onClick={() => {
                                setActionPlanSubTab('creation');
                                setEditingActionPlanId(p.id);
                                actionPlansApi.get(p.id).then((res) => {
                                  const plan = res.plan || {};
                                  setActionPlanForm({
                                    title: plan.title || 'Action Plan',
                                    project_name: plan.project_name || '',
                                    document_date: plan.document_date ? plan.document_date.slice(0, 10) : todayYmd(),
                                    document_id: plan.document_id || '',
                                    route_ids: normalizeIds(plan.route_ids || []),
                                    items: Array.isArray(plan.items) && plan.items.length
                                      ? plan.items.map((it) => ({
                                          phase: it.phase ?? '',
                                          start_date: it.start_date ? (typeof it.start_date === 'string' ? it.start_date.slice(0, 10) : '') : '',
                                          action_description: it.action_description ?? '',
                                          participants: it.participants ?? '',
                                          due_date: it.due_date ? (typeof it.due_date === 'string' ? it.due_date.slice(0, 10) : '') : '',
                                          status: it.status ?? 'not started',
                                        }))
                                      : [{ phase: '', start_date: '', action_description: '', participants: '', due_date: '', status: 'not started' }],
                                  });
                                }).catch(() => setError('Failed to load action plan'));
                              }}
                              className="text-brand-600 hover:text-brand-800 text-sm font-medium"
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Share action plan via email modal */}
              {shareActionPlanEmailOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !shareActionPlanEmailSending && setShareActionPlanEmailOpen(false)} role="dialog" aria-modal="true" aria-labelledby="share-action-plan-email-title">
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="shrink-0 px-6 py-4 border-b border-surface-200">
                      <h3 id="share-action-plan-email-title" className="text-lg font-semibold text-surface-900">Share action plan via email</h3>
                      <p className="text-sm text-surface-500 mt-1">Select recipients and add an optional message. The action plan PDF will be attached.</p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                      {shareActionPlanEmailError && (
                        <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2">{shareActionPlanEmailError}</div>
                      )}
                      {!shareActionPlanEmailPlan && (
                        <p className="text-sm text-surface-500">Loading action plan…</p>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-2">To (select one or more)</label>
                        <div className="border border-surface-200 rounded-lg max-h-40 overflow-y-auto p-2 space-y-1.5">
                          {shareActionPlanEmailRecipients.length === 0 ? (
                            <p className="text-sm text-surface-500 py-2">Loading users…</p>
                          ) : (
                            shareActionPlanEmailRecipients.map((u) => (
                              <label key={u.id} className="flex items-center gap-2 cursor-pointer hover:bg-surface-50 rounded px-2 py-1.5">
                                <input type="checkbox" checked={shareActionPlanEmailToIds.includes(u.id)} onChange={(e) => setShareActionPlanEmailToIds((prev) => e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id))} className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
                                <span className="text-sm text-surface-800">{u.full_name || '—'}</span>
                                <span className="text-xs text-surface-500 truncate">{u.email}</span>
                              </label>
                            ))
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-2">CC (optional – select users or type emails)</label>
                        <div className="border border-surface-200 rounded-lg max-h-32 overflow-y-auto p-2 space-y-1.5 mb-2">
                          {shareActionPlanEmailRecipients.length === 0 ? (
                            <p className="text-sm text-surface-500 py-2">Loading users…</p>
                          ) : (
                            shareActionPlanEmailRecipients.map((u) => (
                              <label key={u.id} className="flex items-center gap-2 cursor-pointer hover:bg-surface-50 rounded px-2 py-1.5">
                                <input type="checkbox" checked={shareActionPlanEmailCcIds.includes(u.id)} onChange={(e) => setShareActionPlanEmailCcIds((prev) => e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id))} className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
                                <span className="text-sm text-surface-800">{u.full_name || '—'}</span>
                                <span className="text-xs text-surface-500 truncate">{u.email}</span>
                              </label>
                            ))
                          )}
                        </div>
                        <input type="text" value={shareActionPlanEmailCc} onChange={(e) => setShareActionPlanEmailCc(e.target.value)} placeholder="Or add other emails: email@example.com, another@example.com" className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm" />
                        <p className="text-xs text-surface-500 mt-1">Separate multiple emails with commas or spaces.</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-1">Message (optional)</label>
                        <textarea value={shareActionPlanEmailMessage} onChange={(e) => setShareActionPlanEmailMessage(e.target.value)} rows={3} placeholder="Add a short note to include in the email…" className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm resize-y" />
                      </div>
                    </div>
                    <div className="shrink-0 flex justify-end gap-2 px-6 py-4 border-t border-surface-200 bg-surface-50">
                      <button type="button" onClick={() => setShareActionPlanEmailOpen(false)} disabled={shareActionPlanEmailSending} className="px-4 py-2 rounded-lg border border-surface-200 text-surface-700 text-sm font-medium hover:bg-surface-100 disabled:opacity-50">Cancel</button>
                      <button type="button" onClick={sendActionPlanEmail} disabled={shareActionPlanEmailSending || shareActionPlanEmailToIds.length === 0 || !shareActionPlanEmailPlan} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                        {shareActionPlanEmailSending ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
                        {shareActionPlanEmailSending ? 'Sending…' : 'Send email'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {actionPlanSubTab === 'creation' && (
            <>
              {actionPlansListLoading ? (
                <p className="text-surface-500">Loading…</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingActionPlanId(null);
                        setActionPlanForm({
                          title: 'Action Plan',
                          project_name: '',
                          document_date: todayYmd(),
                          document_id: '',
                          route_ids: [],
                          items: [{ phase: '', start_date: '', action_description: '', participants: '', due_date: '', status: 'not started' }],
                        });
                      }}
                      className="px-3 py-2 rounded-lg border border-surface-200 text-surface-700 text-sm font-medium hover:bg-surface-50"
                    >
                      New plan
                    </button>
                    <span className="text-sm text-surface-500 self-center">To edit an existing plan, go to Published plans and click Edit.</span>
                  </div>

                  <div className="bg-white rounded-xl border border-surface-200 p-6 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-1">Title *</label>
                        <input type="text" value={actionPlanForm.title} onChange={(e) => setActionPlanForm((f) => ({ ...f, title: e.target.value }))} placeholder="Action Plan" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-1">Project name *</label>
                        <input type="text" value={actionPlanForm.project_name} onChange={(e) => setActionPlanForm((f) => ({ ...f, project_name: e.target.value }))} placeholder="e.g. Ntshovelo Colliery Fleet Monitoring Project" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-1">Document date</label>
                        <input type="date" value={actionPlanForm.document_date} onChange={(e) => setActionPlanForm((f) => ({ ...f, document_date: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-1">Document ID</label>
                        <input type="text" value={actionPlanForm.document_id} onChange={(e) => setActionPlanForm((f) => ({ ...f, document_id: e.target.value }))} placeholder="e.g. Doc-ASOP0024" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-surface-700 mb-1">Applicable route(s) for rector visibility</label>
                      <RouteChecklist
                        routes={routes}
                        selectedIds={actionPlanForm.route_ids}
                        onToggle={(routeId) =>
                          setActionPlanForm((f) => {
                            const next = new Set((f.route_ids || []).map((id) => String(id)));
                            if (next.has(routeId)) next.delete(routeId);
                            else next.add(routeId);
                            return { ...f, route_ids: Array.from(next) };
                          })
                        }
                      />
                      <p className="text-xs text-surface-500 mt-1">
                        Leave empty to publish to all rectors. {actionPlanForm.route_ids?.length ? `${actionPlanForm.route_ids.length} selected.` : ''}
                      </p>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-surface-800 mb-2">Action plan structure</h4>
                      <p className="text-xs text-surface-500 mb-3">Add phases with start date, action description, participants, due date, and status.</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="border-b border-surface-200 bg-surface-50">
                              <th className="text-left p-2 font-medium text-surface-700">Phase</th>
                              <th className="text-left p-2 font-medium text-surface-700">Start date</th>
                              <th className="text-left p-2 font-medium text-surface-700">Action type/description</th>
                              <th className="text-left p-2 font-medium text-surface-700">Participants</th>
                              <th className="text-left p-2 font-medium text-surface-700">Due date</th>
                              <th className="text-left p-2 font-medium text-surface-700">Action status</th>
                              <th className="p-2 w-16"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {actionPlanForm.items.map((it, i) => (
                              <tr key={i} className="border-b border-surface-100">
                                <td className="p-2"><input type="text" value={it.phase} onChange={(e) => setActionPlanForm((f) => ({ ...f, items: f.items.map((item, j) => j === i ? { ...item, phase: e.target.value } : item) }))} placeholder="1" className="w-14 rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="date" value={it.start_date} onChange={(e) => setActionPlanForm((f) => ({ ...f, items: f.items.map((item, j) => j === i ? { ...item, start_date: e.target.value } : item) }))} className="rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={it.action_description} onChange={(e) => setActionPlanForm((f) => ({ ...f, items: f.items.map((item, j) => j === i ? { ...item, action_description: e.target.value } : item) }))} placeholder="Work scope discussion; Communication channels…" className="min-w-[180px] rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={it.participants} onChange={(e) => setActionPlanForm((f) => ({ ...f, items: f.items.map((item, j) => j === i ? { ...item, participants: e.target.value } : item) }))} placeholder="Ntshovelo and Thinkers" className="min-w-[120px] rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="date" value={it.due_date} onChange={(e) => setActionPlanForm((f) => ({ ...f, items: f.items.map((item, j) => j === i ? { ...item, due_date: e.target.value } : item) }))} className="rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2">
                                  <select value={it.status} onChange={(e) => setActionPlanForm((f) => ({ ...f, items: f.items.map((item, j) => j === i ? { ...item, status: e.target.value } : item) }))} className="rounded border border-surface-200 px-2 py-1 text-sm">
                                    <option value="not started">not started</option>
                                    <option value="in progress">in progress</option>
                                    <option value="completed">completed</option>
                                  </select>
                                </td>
                                <td className="p-2">{actionPlanForm.items.length > 1 ? <button type="button" onClick={() => setActionPlanForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))} className="text-red-600 text-xs">Remove</button> : null}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button type="button" onClick={() => setActionPlanForm((f) => ({ ...f, items: [...f.items, { phase: '', start_date: '', action_description: '', participants: '', due_date: '', status: 'not started' }] }))} className="mt-2 text-sm text-brand-600 font-medium">+ Add row</button>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        disabled={!actionPlanForm.title.trim() || !actionPlanForm.project_name.trim() || actionPlanSaving}
                        onClick={() => {
                          setActionPlanSaving(true);
                          const payload = {
                            title: actionPlanForm.title.trim(),
                            project_name: actionPlanForm.project_name.trim(),
                            document_date: actionPlanForm.document_date || todayYmd(),
                            document_id: actionPlanForm.document_id.trim() || null,
                            route_ids: normalizeIds(actionPlanForm.route_ids),
                            items: actionPlanForm.items.map((it) => ({
                              phase: (it.phase || '').toString().trim(),
                              start_date: it.start_date || null,
                              action_description: (it.action_description || '').toString().trim(),
                              participants: (it.participants || '').toString().trim(),
                              due_date: it.due_date || null,
                              status: (it.status || 'not started').toString().trim(),
                            })),
                          };
                          (editingActionPlanId ? actionPlansApi.update(editingActionPlanId, payload) : actionPlansApi.create(payload))
                            .then((res) => {
                              setEditingActionPlanId(res.plan?.id ?? editingActionPlanId);
                              return actionPlansApi.list();
                            })
                            .then((r) => setActionPlansList(r.plans || []))
                            .catch((e) => setError(e?.message || 'Save failed'))
                            .finally(() => setActionPlanSaving(false));
                        }}
                        className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                      >
                        {actionPlanSaving ? 'Saving…' : editingActionPlanId ? 'Update plan' : 'Create plan'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'monthly-performance-reports' && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-surface-900">Monthly performance reports</h2>
          <p className="text-sm text-surface-500">Compose monthly performance reports (e.g. Anthra Performance Report). Include executive summary, key metrics, sections, breakdowns, and fleet performance. Rectors can view them under Monthly Performance reports.</p>

          <div className="flex gap-1 border-b border-surface-200">
            <button type="button" onClick={() => setMonthlyPerfSubTab('creation')} className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${monthlyPerfSubTab === 'creation' ? 'border-brand-500 text-brand-700 bg-brand-50' : 'border-transparent text-surface-600 hover:text-surface-800 hover:bg-surface-50'}`}>Create / Edit</button>
            <button type="button" onClick={() => setMonthlyPerfSubTab('published')} className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${monthlyPerfSubTab === 'published' ? 'border-brand-500 text-brand-700 bg-brand-50' : 'border-transparent text-surface-600 hover:text-surface-800 hover:bg-surface-50'}`}>Published reports</button>
          </div>

          {monthlyPerfSubTab === 'published' && (
            <div className="bg-white rounded-xl border border-surface-200 p-6">
              <h3 className="text-base font-semibold text-surface-800 mb-4">Published monthly performance reports</h3>
              {monthlyPerfListLoading ? <p className="text-surface-500">Loading…</p> : monthlyPerfList.length === 0 ? <p className="text-surface-500">No reports yet. Create one in the Create / Edit tab.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-surface-200 bg-surface-50">
                        <th className="text-left p-3 font-medium text-surface-700">Title</th>
                        <th className="text-left p-3 font-medium text-surface-700">Reporting period</th>
                        <th className="text-left p-3 font-medium text-surface-700">Submitted</th>
                        <th className="text-left p-3 font-medium text-surface-700">Routes</th>
                        <th className="p-3 font-medium text-surface-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyPerfList.map((r) => (
                        <tr key={r.id} className="border-b border-surface-100 hover:bg-surface-50">
                          <td className="p-3 text-surface-800">{r.title || 'Monthly Performance Report'}</td>
                          <td className="p-3 text-surface-600">{r.reporting_period_start && r.reporting_period_end ? `${formatDate(r.reporting_period_start)} – ${formatDate(r.reporting_period_end)}` : '—'}</td>
                          <td className="p-3 text-surface-600">{r.submitted_date ? formatDate(r.submitted_date) : '—'}</td>
                          <td className="p-3 text-surface-600">
                            {Array.isArray(r.route_ids) && r.route_ids.length > 0
                              ? r.route_ids.map((id) => routeNameById[String(id)] || 'Unknown route').join(', ')
                              : 'All routes'}
                          </td>
                          <td className="p-3">
                            <button type="button" onClick={() => { setMonthlyPerfSubTab('creation'); setEditingMonthlyPerfId(r.id); monthlyPerformanceReportsApi.get(r.id).then((res) => { const rep = res.report || {}; setMonthlyPerfForm({ title: rep.title || '', reporting_period_start: rep.reporting_period_start ? rep.reporting_period_start.slice(0, 10) : '', reporting_period_end: rep.reporting_period_end ? rep.reporting_period_end.slice(0, 10) : '', submitted_date: rep.submitted_date ? rep.submitted_date.slice(0, 10) : todayYmd(), prepared_by: rep.prepared_by || '', route_ids: normalizeIds(rep.route_ids || []), executive_summary: rep.executive_summary || '', key_metrics: Array.isArray(rep.key_metrics) && rep.key_metrics.length ? rep.key_metrics.map((m) => ({ metric: m.metric ?? '', value: m.value ?? '', commentary: m.commentary ?? '' })) : [{ metric: '', value: '', commentary: '' }], sections: normalizeSectionsForForm(rep.sections || []), breakdowns: Array.isArray(rep.breakdowns) && rep.breakdowns.length ? rep.breakdowns.map((b) => ({ date: b.date ?? '', time: b.time ?? '', route: b.route ?? '', truck_reg: b.truck_reg ?? '', description: b.description ?? '', company: b.company ?? '' })) : [{ date: '', time: '', route: '', truck_reg: '', description: '', company: '' }], fleet_performance: Array.isArray(rep.fleet_performance) && rep.fleet_performance.length ? rep.fleet_performance.map((f) => ({ haulier: f.haulier ?? '', trips: f.trips ?? '', pct_trips: f.pct_trips ?? '', tonnage: f.tonnage ?? '', pct_tonnage: f.pct_tonnage ?? '', avg_t_per_trip: f.avg_t_per_trip ?? '', trucks_deployed: f.trucks_deployed ?? '' })) : [{ haulier: '', trips: '', pct_trips: '', tonnage: '', pct_tonnage: '', avg_t_per_trip: '', trucks_deployed: '' }], }); }).catch(() => setError('Failed to load report')); }} className="text-brand-600 hover:text-brand-800 text-sm font-medium">Edit</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {monthlyPerfSubTab === 'creation' && (
            <>
              {monthlyPerfListLoading ? <p className="text-surface-500">Loading…</p> : (
                <>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <button type="button" onClick={() => { setEditingMonthlyPerfId(null); setMonthlyPerfForm({ title: '', reporting_period_start: '', reporting_period_end: '', submitted_date: todayYmd(), prepared_by: 'Tihlo (Thinkers Afrika)', route_ids: [], executive_summary: '', key_metrics: [{ metric: '', value: '', commentary: '' }], sections: [{ heading: '', subsections: [{ subheading: '', blocks: [{ type: 'text', text: '' }] }] }], breakdowns: [{ date: '', time: '', route: '', truck_reg: '', description: '', company: '' }], fleet_performance: [{ haulier: '', trips: '', pct_trips: '', tonnage: '', pct_tonnage: '', avg_t_per_trip: '', trucks_deployed: '' }], }); }} className="px-3 py-2 rounded-lg border border-surface-200 text-surface-700 text-sm font-medium hover:bg-surface-50">New report</button>
                    <span className="text-sm text-surface-500 self-center">To edit an existing report, go to Published reports and click Edit.</span>
                  </div>

                  <div className="bg-white rounded-xl border border-surface-200 p-6 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-surface-700 mb-1">Report title *</label>
                        <input type="text" value={monthlyPerfForm.title} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Anthra Performance Report" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-1">Reporting period start *</label>
                        <input type="date" value={monthlyPerfForm.reporting_period_start} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, reporting_period_start: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-1">Reporting period end *</label>
                        <input type="date" value={monthlyPerfForm.reporting_period_end} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, reporting_period_end: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-1">Submitted date *</label>
                        <input type="date" value={monthlyPerfForm.submitted_date} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, submitted_date: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-1">Prepared by</label>
                        <input type="text" value={monthlyPerfForm.prepared_by} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, prepared_by: e.target.value }))} placeholder="e.g. Tihlo (Thinkers Afrika)" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-surface-700 mb-1">Applicable route(s) for rector visibility</label>
                      <RouteChecklist
                        routes={routes}
                        selectedIds={monthlyPerfForm.route_ids}
                        onToggle={(routeId) =>
                          setMonthlyPerfForm((f) => {
                            const next = new Set((f.route_ids || []).map((id) => String(id)));
                            if (next.has(routeId)) next.delete(routeId);
                            else next.add(routeId);
                            return { ...f, route_ids: Array.from(next) };
                          })
                        }
                      />
                      <p className="text-xs text-surface-500 mt-1">
                        Leave empty to publish to all rectors. {monthlyPerfForm.route_ids?.length ? `${monthlyPerfForm.route_ids.length} selected.` : ''}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-surface-700 mb-1">Executive summary</label>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <span className="text-xs text-surface-500 self-center">Format:</span>
                        <button type="button" onClick={() => insertAtFocusedMonthlyPerfText('- ')} className="px-3 py-1.5 rounded-lg border border-surface-200 text-sm font-medium text-surface-700 hover:bg-surface-50" title="Insert bullet">• Bullet</button>
                        <button type="button" onClick={() => insertAtFocusedMonthlyPerfText('1. ')} className="px-3 py-1.5 rounded-lg border border-surface-200 text-sm font-medium text-surface-700 hover:bg-surface-50" title="Insert number">1. Number</button>
                      </div>
                      <textarea
                        ref={monthlyPerfExecSummaryRef}
                        onFocus={(e) => { const t = e.target; setMonthlyPerfCursor({ type: 'executive', start: t.selectionStart, end: t.selectionEnd }); }}
                        onBlur={(e) => setMonthlyPerfCursor({ type: 'executive', start: e.target.selectionStart, end: e.target.selectionEnd })}
                        value={monthlyPerfForm.executive_summary}
                        onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, executive_summary: e.target.value }))}
                        rows={24}
                        placeholder={'Comprehensive analysis of operations for the period… Use the Bullet / Number buttons or type "- " for bullets, "1. " for numbered lists.'}
                        className="w-full min-h-[420px] rounded-lg border border-surface-300 px-3 py-2 text-sm resize-y"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <h4 className="text-sm font-semibold text-surface-800">Key performance metrics</h4>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => navigator.clipboard.readText().then((t) => { const rows = parseTsvFromClipboard(t); if (rows.length) setMonthlyPerfForm((f) => ({ ...f, key_metrics: tsvToKeyMetrics(rows) })); }).catch(() => setError('Paste failed. Allow clipboard access or copy from Excel first.'))} className="text-xs text-brand-600 hover:text-brand-800 font-medium">Paste from Excel</button>
                          <label className="text-xs text-brand-600 hover:text-brand-800 font-medium cursor-pointer">Import CSV<input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const r = new FileReader(); r.onload = () => { const rows = parseTsvFromClipboard(r.result); if (rows.length) setMonthlyPerfForm((f) => ({ ...f, key_metrics: tsvToKeyMetrics(rows) })); }; r.readAsText(file); e.target.value = ''; }} /></label>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="border-b border-surface-200 bg-surface-50">
                              <th className="text-left p-2 font-medium text-surface-700">Metric</th>
                              <th className="text-left p-2 font-medium text-surface-700">Value</th>
                              <th className="text-left p-2 font-medium text-surface-700">Commentary</th>
                              <th className="p-2 w-16"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthlyPerfForm.key_metrics.map((m, i) => (
                              <tr key={i} className="border-b border-surface-100">
                                <td className="p-2"><input type="text" value={m.metric} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, key_metrics: f.key_metrics.map((km, j) => j === i ? { ...km, metric: e.target.value } : km) }))} placeholder="e.g. Total Loads Delivered" className="w-full rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={m.value} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, key_metrics: f.key_metrics.map((km, j) => j === i ? { ...km, value: e.target.value } : km) }))} placeholder="240" className="w-24 rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={m.commentary} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, key_metrics: f.key_metrics.map((km, j) => j === i ? { ...km, commentary: e.target.value } : km) }))} placeholder="Commentary" className="min-w-[160px] rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2">{monthlyPerfForm.key_metrics.length > 1 ? <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, key_metrics: f.key_metrics.filter((_, j) => j !== i) }))} className="text-red-600 text-xs">Remove</button> : null}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, key_metrics: [...f.key_metrics, { metric: '', value: '', commentary: '' }] }))} className="mt-2 text-sm text-brand-600 font-medium">+ Add row</button>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-surface-800 mb-2">Additional sections</h4>
                      <p className="text-xs text-surface-500 mb-2">Sections with subheadings. Each subsection can have text, images (paste or upload), or tables (paste from Excel). Content appears in form and in PDF.</p>
                      {monthlyPerfForm.sections.map((sec, i) => (
                        <div key={i} className="mb-6 p-4 rounded-xl bg-surface-50 border border-surface-200 space-y-4">
                          <div className="flex justify-between items-center">
                            <label className="text-xs font-medium text-surface-500">Section {i + 1}</label>
                            {monthlyPerfForm.sections.length > 1 && <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, sections: f.sections.filter((_, j) => j !== i) }))} className="text-red-600 text-sm">Remove section</button>}
                          </div>
                          <input type="text" value={sec.heading} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, sections: f.sections.map((s, j) => j === i ? { ...s, heading: e.target.value } : s) }))} placeholder="Section heading" className="w-full rounded-lg border border-surface-200 px-3 py-2 text-sm font-medium" />
                          {(sec.subsections || []).map((sub, subIdx) => (
                            <div key={subIdx} className="pl-4 border-l-2 border-brand-200 space-y-3">
                              <input type="text" value={sub.subheading} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, sections: f.sections.map((s, j) => j === i ? { ...s, subsections: (s.subsections || []).map((sb, k) => k === subIdx ? { ...sb, subheading: e.target.value } : sb) } : s) }))} placeholder="Subheading (optional)" className="w-full rounded-lg border border-surface-200 px-3 py-1.5 text-sm" />
                              <div
                                tabIndex={0}
                                role="button"
                                onPaste={(e) => {
                                  const file = e.clipboardData?.files?.[0] || Array.from(e.clipboardData?.items || []).find((item) => item.type.startsWith('image/'))?.getAsFile?.();
                                  if (file && file.type.startsWith('image/')) {
                                    e.preventDefault();
                                    const reader = new FileReader();
                                    reader.onload = () => setMonthlyPerfForm((f) => ({
                                      ...f, sections: f.sections.map((s, j) => j === i ? { ...s, subsections: (s.subsections || []).map((sb, k) => k === subIdx ? { ...sb, blocks: [...(sb.blocks || []), { type: 'image', base64: (reader.result || '').replace(/^data:[^;]+;base64,/, ''), alt: '' }] } : sb) } : s)
                                    }));
                                    reader.readAsDataURL(file);
                                  }
                                }}
                                className="rounded border border-dashed border-surface-300 bg-surface-50/50 px-3 py-2 text-xs text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-400"
                              >
                                Paste image (Ctrl+V) here to add a graph or picture
                              </div>
                              {(sub.blocks || []).map((block, blockIdx) => (
                                <div key={blockIdx} className="rounded-lg border border-surface-200 bg-white p-3">
                                  {block.type === 'text' && (
                                    <>
                                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                        <div className="flex flex-wrap gap-2">
                                          <button type="button" onClick={() => insertAtFocusedMonthlyPerfText('- ')} className="px-2 py-1 rounded border border-surface-200 text-xs font-medium text-surface-700 hover:bg-surface-50" title="Insert bullet">• Bullet</button>
                                          <button type="button" onClick={() => insertAtFocusedMonthlyPerfText('1. ')} className="px-2 py-1 rounded border border-surface-200 text-xs font-medium text-surface-700 hover:bg-surface-50" title="Insert number">1. Number</button>
                                          <span className="text-xs text-surface-500 self-center">Paste image (Ctrl+V) or Excel table here to add below</span>
                                        </div>
                                        <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, sections: f.sections.map((s, j) => j === i ? { ...s, subsections: (s.subsections || []).map((sb, k) => k === subIdx ? { ...sb, blocks: (sb.blocks || []).filter((_, b) => b !== blockIdx) } : sb) } : s) }))} className="text-red-600 text-xs">Remove block</button>
                                      </div>
                                      <textarea
                                        ref={(el) => { monthlyPerfBlockRefs.current[`${i}-${subIdx}-${blockIdx}`] = el; }}
                                        onFocus={(e) => { const t = e.target; setMonthlyPerfCursor({ type: 'block', sectionIdx: i, subIdx, blockIdx, start: t.selectionStart, end: t.selectionEnd }); }}
                                        onBlur={(e) => setMonthlyPerfCursor({ type: 'block', sectionIdx: i, subIdx, blockIdx, start: e.target.selectionStart, end: e.target.selectionEnd })}
                                        value={block.text}
                                        onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, sections: f.sections.map((s, j) => j === i ? { ...s, subsections: (s.subsections || []).map((sb, k) => k === subIdx ? { ...sb, blocks: (sb.blocks || []).map((b, bi) => bi === blockIdx ? { ...b, text: e.target.value } : b) } : sb) } : s) }))}
                                        onPaste={(e) => {
                                          const pastedText = (e.clipboardData?.getData?.('text/plain') || '').trim();
                                          if (pastedText) {
                                            if (pastedText.includes('\t') || (pastedText.includes(',') && pastedText.includes('\n'))) {
                                              const rows = parseTsvFromClipboard(pastedText);
                                              if (rows.length > 0) {
                                                e.preventDefault();
                                                setMonthlyPerfForm((f) => ({
                                                  ...f,
                                                  sections: f.sections.map((s, j) => j === i ? { ...s, subsections: (s.subsections || []).map((sb, k) => k === subIdx ? { ...sb, blocks: [...(sb.blocks || []).slice(0, blockIdx + 1), { type: 'table', rows }, ...(sb.blocks || []).slice(blockIdx + 1)] } : sb) } : s)
                                                }));
                                              }
                                            }
                                            return;
                                          }
                                          const file = e.clipboardData?.files?.[0] || Array.from(e.clipboardData?.items || []).find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile?.();
                                          if (file && file.type.startsWith('image/')) {
                                            e.preventDefault();
                                            const reader = new FileReader();
                                            reader.onload = () => {
                                              const base64 = (reader.result || '').replace(/^data:[^;]+;base64,/, '');
                                              setMonthlyPerfForm((f) => ({
                                                ...f,
                                                sections: f.sections.map((s, j) => j === i ? { ...s, subsections: (s.subsections || []).map((sb, k) => k === subIdx ? { ...sb, blocks: [...(sb.blocks || []).slice(0, blockIdx + 1), { type: 'image', base64, alt: '' }, ...(sb.blocks || []).slice(blockIdx + 1)] } : sb) } : s)
                                              }));
                                            };
                                            reader.readAsDataURL(file);
                                          }
                                        }}
                                        rows={14}
                                        placeholder="Type or paste text. Use Bullet/Number for lists. Paste an image or Excel/CSV table to insert a new block below."
                                        className="w-full min-h-[280px] rounded border border-surface-200 px-2 py-1 text-sm resize-y"
                                      />
                                      <p className="text-xs text-surface-500 mt-1">Preview:</p>
                                      <div className="mt-1 p-2 bg-surface-50 rounded text-sm text-surface-700 whitespace-pre-wrap min-h-[2rem] max-h-32 overflow-y-auto">{block.text || '—'}</div>
                                    </>
                                  )}
                                  {block.type === 'image' && (
                                    <>
                                      <div className="flex justify-end"><button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, sections: f.sections.map((s, j) => j === i ? { ...s, subsections: (s.subsections || []).map((sb, k) => k === subIdx ? { ...sb, blocks: (sb.blocks || []).filter((_, b) => b !== blockIdx) } : sb) } : s) }))} className="text-red-600 text-xs">Remove image</button></div>
                                      {block.base64 ? <img src={block.base64.startsWith('data:') ? block.base64 : `data:image/png;base64,${block.base64}`} alt={block.alt || ''} className="max-w-full max-h-48 object-contain rounded border border-surface-200" /> : (
                                        <div className="flex flex-wrap gap-2 items-center">
                                          <label className="px-3 py-2 rounded-lg border border-surface-200 text-sm font-medium text-surface-700 hover:bg-surface-50 cursor-pointer">Upload image</label>
                                          <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(ev) => {
                                              const file = ev.target.files?.[0];
                                              if (!file) return;
                                              const reader = new FileReader();
                                              reader.onload = () => {
                                                const dataUrl = reader.result;
                                                const base64 = (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) ? dataUrl.replace(/^data:[^;]+;base64,/, '') : '';
                                                setMonthlyPerfForm((f) => ({
                                                  ...f,
                                                  sections: f.sections.map((s, j) => j === i ? {
                                                    ...s,
                                                    subsections: (s.subsections || []).map((sb, k) => k === subIdx ? {
                                                      ...sb,
                                                      blocks: (sb.blocks || []).map((b, bi) => bi === blockIdx ? { ...b, base64 } : b),
                                                    } : sb),
                                                  } : s),
                                                }));
                                              };
                                              reader.readAsDataURL(file);
                                              ev.target.value = '';
                                            }}
                                          />
                                          <span className="text-xs text-surface-500">or paste image (Ctrl+V) in the subsection area</span>
                                        </div>
                                      )}
                                    </>
                                  )}
                                  {block.type === 'table' && (
                                    <>
                                      <div className="flex justify-end gap-2">
                                        <button type="button" onClick={() => navigator.clipboard.readText().then((t) => { const rows = parseTsvFromClipboard(t); if (rows.length) setMonthlyPerfForm((f) => ({ ...f, sections: f.sections.map((s, j) => j === i ? { ...s, subsections: (s.subsections || []).map((sb, k) => k === subIdx ? { ...sb, blocks: (sb.blocks || []).map((b, bi) => bi === blockIdx ? { ...b, rows } : b) } : sb) } : s) })); }).catch(() => {})} className="text-brand-600 text-xs">Paste from Excel</button>
                                        <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, sections: f.sections.map((s, j) => j === i ? { ...s, subsections: (s.subsections || []).map((sb, k) => k === subIdx ? { ...sb, blocks: (sb.blocks || []).filter((_, b) => b !== blockIdx) } : sb) } : s) }))} className="text-red-600 text-xs">Remove table</button>
                                      </div>
                                      <div className="overflow-x-auto mt-2 rounded border border-surface-200">
                                        <table className="w-full text-sm border-collapse">
                                          <tbody>
                                            {(block.rows || [['']]).map((row, ri) => (
                                              <tr key={ri}>
                                                {((row || ['']).length ? row : ['']).map((cell, ci) => (
                                                  <td key={ci} className="border border-surface-200 p-1">
                                                    <input type="text" value={cell} onChange={(e) => setMonthlyPerfForm((f) => ({
                                                      ...f, sections: f.sections.map((s, j) => j === i ? { ...s, subsections: (s.subsections || []).map((sb, k) => k === subIdx ? { ...sb, blocks: (sb.blocks || []).map((b, bi) => bi === blockIdx ? { ...b, rows: (b.rows || []).map((r, rj) => rj === ri ? ((Array.isArray(r) && r.length ? r : ['']).map((c, cj) => cj === ci ? e.target.value : c)) : r) } : b) } : sb) } : s)
                                                    }))} className="w-full min-w-[60px] rounded px-1 py-0.5 text-sm" />
                                                  </td>
                                                ))}
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </>
                                  )}
                                </div>
                              ))}
                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, sections: f.sections.map((s, j) => j === i ? { ...s, subsections: (s.subsections || []).map((sb, k) => k === subIdx ? { ...sb, blocks: [...(sb.blocks || []), { type: 'text', text: '' }] } : sb) } : s) }))} className="text-xs text-brand-600 font-medium">+ Text</button>
                                <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, sections: f.sections.map((s, j) => j === i ? { ...s, subsections: (s.subsections || []).map((sb, k) => k === subIdx ? { ...sb, blocks: [...(sb.blocks || []), { type: 'image', base64: '', alt: '' }] } : sb) } : s) }))} className="text-xs text-brand-600 font-medium">+ Image</button>
                                <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, sections: f.sections.map((s, j) => j === i ? { ...s, subsections: (s.subsections || []).map((sb, k) => k === subIdx ? { ...sb, blocks: [...(sb.blocks || []), { type: 'table', rows: [['']] }] } : sb) } : s) }))} className="text-xs text-brand-600 font-medium">+ Table (paste from Excel)</button>
                              </div>
                            </div>
                          ))}
                              <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, sections: f.sections.map((s, j) => j === i ? { ...s, subsections: [...(s.subsections || []), { subheading: '', blocks: [{ type: 'text', text: '' }] }] } : s) }))} className="text-sm text-brand-600 font-medium">+ Add subsection</button>
                        </div>
                      ))}
                      <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, sections: [...f.sections, { heading: '', subsections: [{ subheading: '', blocks: [{ type: 'text', text: '' }] }] }] }))} className="text-sm text-brand-600 font-medium">+ Add section</button>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <h4 className="text-sm font-semibold text-surface-800">Breakdowns (incidents)</h4>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => navigator.clipboard.readText().then((t) => { const rows = parseTsvFromClipboard(t); if (rows.length) setMonthlyPerfForm((f) => ({ ...f, breakdowns: tsvToBreakdowns(rows) })); }).catch(() => setError('Paste failed. Allow clipboard access or copy from Excel first.'))} className="text-xs text-brand-600 hover:text-brand-800 font-medium">Paste from Excel</button>
                          <label className="text-xs text-brand-600 hover:text-brand-800 font-medium cursor-pointer">Import CSV<input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const r = new FileReader(); r.onload = () => { const rows = parseTsvFromClipboard(r.result); if (rows.length) setMonthlyPerfForm((f) => ({ ...f, breakdowns: tsvToBreakdowns(rows) })); }; r.readAsText(file); e.target.value = ''; }} /></label>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="border-b border-surface-200 bg-surface-50">
                              <th className="text-left p-2 font-medium text-surface-700">Date</th>
                              <th className="text-left p-2 font-medium text-surface-700">Time</th>
                              <th className="text-left p-2 font-medium text-surface-700">Route</th>
                              <th className="text-left p-2 font-medium text-surface-700">Truck reg</th>
                              <th className="text-left p-2 font-medium text-surface-700">Description</th>
                              <th className="text-left p-2 font-medium text-surface-700">Company</th>
                              <th className="p-2 w-16"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthlyPerfForm.breakdowns.map((b, i) => (
                              <tr key={i} className="border-b border-surface-100">
                                <td className="p-2"><input type="date" value={b.date} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, breakdowns: f.breakdowns.map((br, j) => j === i ? { ...br, date: e.target.value } : br) }))} className="rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={b.time} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, breakdowns: f.breakdowns.map((br, j) => j === i ? { ...br, time: e.target.value } : br) }))} placeholder="15:45" className="w-20 rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={b.route} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, breakdowns: f.breakdowns.map((br, j) => j === i ? { ...br, route: e.target.value } : br) }))} placeholder="Route" className="min-w-[100px] rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={b.truck_reg} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, breakdowns: f.breakdowns.map((br, j) => j === i ? { ...br, truck_reg: e.target.value } : br) }))} placeholder="Reg" className="w-24 rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={b.description} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, breakdowns: f.breakdowns.map((br, j) => j === i ? { ...br, description: e.target.value } : br) }))} placeholder="Description" className="min-w-[120px] rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={b.company} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, breakdowns: f.breakdowns.map((br, j) => j === i ? { ...br, company: e.target.value } : br) }))} placeholder="Company" className="w-28 rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2">{monthlyPerfForm.breakdowns.length > 1 ? <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, breakdowns: f.breakdowns.filter((_, j) => j !== i) }))} className="text-red-600 text-xs">Remove</button> : null}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, breakdowns: [...f.breakdowns, { date: '', time: '', route: '', truck_reg: '', description: '', company: '' }] }))} className="mt-2 text-sm text-brand-600 font-medium">+ Add row</button>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <h4 className="text-sm font-semibold text-surface-800">Fleet performance by haulier</h4>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => navigator.clipboard.readText().then((t) => { const rows = parseTsvFromClipboard(t); if (rows.length) setMonthlyPerfForm((f) => ({ ...f, fleet_performance: tsvToFleetPerformance(rows) })); }).catch(() => setError('Paste failed. Allow clipboard access or copy from Excel first.'))} className="text-xs text-brand-600 hover:text-brand-800 font-medium">Paste from Excel</button>
                          <label className="text-xs text-brand-600 hover:text-brand-800 font-medium cursor-pointer">Import CSV<input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const r = new FileReader(); r.onload = () => { const rows = parseTsvFromClipboard(r.result); if (rows.length) setMonthlyPerfForm((f) => ({ ...f, fleet_performance: tsvToFleetPerformance(rows) })); }; r.readAsText(file); e.target.value = ''; }} /></label>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="border-b border-surface-200 bg-surface-50">
                              <th className="text-left p-2 font-medium text-surface-700">Haulier</th>
                              <th className="text-left p-2 font-medium text-surface-700">Trips</th>
                              <th className="text-left p-2 font-medium text-surface-700">% Trips</th>
                              <th className="text-left p-2 font-medium text-surface-700">Tonnage</th>
                              <th className="text-left p-2 font-medium text-surface-700">% Tonnage</th>
                              <th className="text-left p-2 font-medium text-surface-700">Avg t/Trip</th>
                              <th className="text-left p-2 font-medium text-surface-700">Trucks</th>
                              <th className="p-2 w-16"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthlyPerfForm.fleet_performance.map((fp, i) => (
                              <tr key={i} className="border-b border-surface-100">
                                <td className="p-2"><input type="text" value={fp.haulier} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, fleet_performance: f.fleet_performance.map((x, j) => j === i ? { ...x, haulier: e.target.value } : x) }))} placeholder="Haulier" className="min-w-[100px] rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={fp.trips} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, fleet_performance: f.fleet_performance.map((x, j) => j === i ? { ...x, trips: e.target.value } : x) }))} className="w-16 rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={fp.pct_trips} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, fleet_performance: f.fleet_performance.map((x, j) => j === i ? { ...x, pct_trips: e.target.value } : x) }))} placeholder="%" className="w-16 rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={fp.tonnage} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, fleet_performance: f.fleet_performance.map((x, j) => j === i ? { ...x, tonnage: e.target.value } : x) }))} className="w-20 rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={fp.pct_tonnage} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, fleet_performance: f.fleet_performance.map((x, j) => j === i ? { ...x, pct_tonnage: e.target.value } : x) }))} placeholder="%" className="w-16 rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={fp.avg_t_per_trip} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, fleet_performance: f.fleet_performance.map((x, j) => j === i ? { ...x, avg_t_per_trip: e.target.value } : x) }))} placeholder="t" className="w-16 rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2"><input type="text" value={fp.trucks_deployed} onChange={(e) => setMonthlyPerfForm((f) => ({ ...f, fleet_performance: f.fleet_performance.map((x, j) => j === i ? { ...x, trucks_deployed: e.target.value } : x) }))} className="w-16 rounded border border-surface-200 px-2 py-1 text-sm" /></td>
                                <td className="p-2">{monthlyPerfForm.fleet_performance.length > 1 ? <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, fleet_performance: f.fleet_performance.filter((_, j) => j !== i) }))} className="text-red-600 text-xs">Remove</button> : null}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button type="button" onClick={() => setMonthlyPerfForm((f) => ({ ...f, fleet_performance: [...f.fleet_performance, { haulier: '', trips: '', pct_trips: '', tonnage: '', pct_tonnage: '', avg_t_per_trip: '', trucks_deployed: '' }] }))} className="mt-2 text-sm text-brand-600 font-medium">+ Add row</button>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        disabled={!monthlyPerfForm.title.trim() || !monthlyPerfForm.reporting_period_start || !monthlyPerfForm.reporting_period_end || !monthlyPerfForm.submitted_date || monthlyPerfSaving}
                        onClick={() => {
                          setMonthlyPerfSaving(true);
                          const payload = {
                            title: monthlyPerfForm.title.trim(),
                            reporting_period_start: monthlyPerfForm.reporting_period_start,
                            reporting_period_end: monthlyPerfForm.reporting_period_end,
                            submitted_date: monthlyPerfForm.submitted_date,
                            prepared_by: monthlyPerfForm.prepared_by.trim() || null,
                            route_ids: normalizeIds(monthlyPerfForm.route_ids),
                            executive_summary: monthlyPerfForm.executive_summary.trim() || null,
                            key_metrics: monthlyPerfForm.key_metrics.map((m) => ({ metric: (m.metric || '').toString().trim(), value: (m.value || '').toString().trim(), commentary: (m.commentary || '').toString().trim() })),
                            sections: serializeSectionsForApi(monthlyPerfForm.sections),
                            breakdowns: monthlyPerfForm.breakdowns.map((b) => ({ date: b.date || null, time: (b.time || '').toString().trim(), route: (b.route || '').toString().trim(), truck_reg: (b.truck_reg || '').toString().trim(), description: (b.description || '').toString().trim(), company: (b.company || '').toString().trim() })),
                            fleet_performance: monthlyPerfForm.fleet_performance.map((f) => ({ haulier: (f.haulier || '').toString().trim(), trips: (f.trips || '').toString().trim(), pct_trips: (f.pct_trips || '').toString().trim(), tonnage: (f.tonnage || '').toString().trim(), pct_tonnage: (f.pct_tonnage || '').toString().trim(), avg_t_per_trip: (f.avg_t_per_trip || '').toString().trim(), trucks_deployed: (f.trucks_deployed || '').toString().trim() })),
                          };
                          (editingMonthlyPerfId ? monthlyPerformanceReportsApi.update(editingMonthlyPerfId, payload) : monthlyPerformanceReportsApi.create(payload))
                            .then((res) => { setEditingMonthlyPerfId(res.report?.id ?? editingMonthlyPerfId); return monthlyPerformanceReportsApi.list(); })
                            .then((r) => setMonthlyPerfList(r.reports || []))
                            .catch((e) => setError(e?.message || 'Save failed'))
                            .finally(() => setMonthlyPerfSaving(false));
                        }}
                        className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                      >
                        {monthlyPerfSaving ? 'Saving…' : editingMonthlyPerfId ? 'Update report' : 'Create report'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
