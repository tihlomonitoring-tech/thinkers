import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { contractor as contractorApi, commandCentre as ccApi, tenants as tenantsApi, progressReports as progressReportsApi, actionPlans as actionPlansApi, monthlyPerformanceReports as monthlyPerformanceReportsApi } from './api';
import { generateShiftReportPdf } from './lib/shiftReportPdf.js';
import { generateInvestigationReportPdf } from './lib/investigationReportPdf.js';
import { generateProgressReportPdf } from './lib/progressReportPdf.js';
import { generateActionPlanPdf } from './lib/actionPlanPdf.js';
import { generateMonthlyPerformanceReportPdf } from './lib/monthlyPerformanceReportPdf.js';
import { jsPDF } from 'jspdf';

const TABS = [
  { id: 'fleet', label: 'Approved fleet & drivers', icon: 'truck', section: 'Data' },
  { id: 'contractors-details', label: 'Contractors details and features', icon: 'building', section: 'Data' },
  { id: 'incidents', label: 'Breakdowns & incidents', icon: 'alert', section: 'Data' },
  { id: 'suspensions', label: 'Suspensions', icon: 'ban', section: 'Data' },
  { id: 'compliance', label: 'Compliance inspections', icon: 'shield', section: 'Data' },
  { id: 'progress-reports', label: 'Progress reports', icon: 'chart', section: 'Reports' },
  { id: 'action-plan-timelines', label: 'View Project timelines and action plan', icon: 'calendar', section: 'Reports' },
  { id: 'monthly-performance-reports', label: 'Monthly Performance reports', icon: 'chart', section: 'Reports' },
  { id: 'shift-reports', label: 'Shift reports', icon: 'file', section: 'Reports' },
  { id: 'investigation-reports', label: 'Investigation reports', icon: 'search', section: 'Reports' },
];
const SECTIONS = [...new Set(TABS.map((t) => t.section))];
const INCIDENT_TYPES = ['breakdown', 'accident', 'load_spill', 'delay', 'other'];

function TabIcon({ name, className }) {
  const c = className || 'w-5 h-5';
  const path = (d) => <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d} />;
  switch (name) {
    case 'truck':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M8 17h8m0 0a2 2 0 104 0 2 2 0 00-4 0m-4 0a2 2 0 104 0 2 2 0 00-4 0m0-6h.01M12 16h.01M5 8h14l1.921 2.876c.075.113.129.24.16.373a2 2 0 01-.16 1.751L20 14v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2l-.921-1.376a2 2 0 01-.16-1.751 1.006 1.006 0 01.16-.373L5 8z')}</svg>;
    case 'alert':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z')}</svg>;
    case 'ban':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636')}</svg>;
    case 'shield':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z')}</svg>;
    case 'file':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z')}</svg>;
    case 'search':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z')}</svg>;
    case 'building':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4')}</svg>;
    case 'chart':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z')}</svg>;
    case 'calendar':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z')}</svg>;
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

export default function Rector() {
  const { user, loading: authLoading } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('rector');
  const [activeTab, setActiveTab] = useState('fleet');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contextError, setContextError] = useState(null);

  // Fleet: full trucks/drivers approved + not suspended
  const [trucks, setTrucks] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [approvedTruckIds, setApprovedTruckIds] = useState(new Set());
  const [approvedDriverIds, setApprovedDriverIds] = useState(new Set());
  const [suspensions, setSuspensions] = useState([]);
  const [fleetFilterRoute, setFleetFilterRoute] = useState('');
  const [fleetSearch, setFleetSearch] = useState('');
  const [fleetSubTab, setFleetSubTab] = useState('trucks');
  const [routes, setRoutes] = useState([]);
  const [routeEnrollments, setRouteEnrollments] = useState({}); // routeId -> { trucks: [], drivers: [] }

  // Incidents
  const [incidents, setIncidents] = useState([]);
  const [incidentFilters, setIncidentFilters] = useState({ dateFrom: '', dateTo: '', type: '', resolved: '' });
  const [incidentDetail, setIncidentDetail] = useState(null);
  const [incidentDetailId, setIncidentDetailId] = useState(null);

  // Suspensions
  const [suspensionsList, setSuspensionsList] = useState([]);
  const [suspensionFilters, setSuspensionFilters] = useState({ entity_type: '', status: '' });

  // Compliance
  const [complianceRecords, setComplianceRecords] = useState([]);
  const [complianceFilters, setComplianceFilters] = useState({ status: '' });
  const [complianceDetail, setComplianceDetail] = useState(null);

  // Library (shift + investigation reports)
  const [shiftReports, setShiftReports] = useState([]);
  const [investigationReports, setInvestigationReports] = useState([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const [shiftReportTypeFilter, setShiftReportTypeFilter] = useState('');
  const [pdfDownloading, setPdfDownloading] = useState(null);

  // Contractors details and features (per route)
  const [contractorInfo, setContractorInfo] = useState(null);
  const [contractorSubcontractors, setContractorSubcontractors] = useState([]);
  const [contractorsDetailsLoading, setContractorsDetailsLoading] = useState(false);
  const [contractorsDetailSearch, setContractorsDetailSearch] = useState('');
  const [contractorsDetailTypeFilter, setContractorsDetailTypeFilter] = useState('all'); // 'all' | 'contractor' | 'subcontractors' | 'routes'
  const [contractorsDetailSelected, setContractorsDetailSelected] = useState(null); // { type, data }

  // Progress reports (created in Access Management)
  const [progressReportsList, setProgressReportsList] = useState([]);
  const [progressReportDetail, setProgressReportDetail] = useState(null);
  const [progressReportsLoading, setProgressReportsLoading] = useState(false);
  const [selectedProgressReportId, setSelectedProgressReportId] = useState(null); // clicking a row sets this; modal shows report
  const [progressReportPdfDownloading, setProgressReportPdfDownloading] = useState(false);

  // Action plans / Project timelines (created in Access Management)
  const [actionPlansList, setActionPlansList] = useState([]);
  const [actionPlanDetail, setActionPlanDetail] = useState(null);
  const [actionPlansLoading, setActionPlansLoading] = useState(false);
  const [selectedActionPlanId, setSelectedActionPlanId] = useState(null);
  const [actionPlanPdfDownloading, setActionPlanPdfDownloading] = useState(false);

  // Monthly performance reports
  const [monthlyPerfList, setMonthlyPerfList] = useState([]);
  const [monthlyPerfDetail, setMonthlyPerfDetail] = useState(null);
  const [monthlyPerfLoading, setMonthlyPerfLoading] = useState(false);
  const [selectedMonthlyPerfId, setSelectedMonthlyPerfId] = useState(null);
  const [monthlyPerfPdfDownloading, setMonthlyPerfPdfDownloading] = useState(false);

  const hasTenant = user?.tenant_id;

  // Rector route assignment: when set, user only sees data for these routes
  const [rectorRouteIds, setRectorRouteIds] = useState([]);

  // Load rector my routes first (to know if we're route-scoped)
  useEffect(() => {
    if (!hasTenant) return;
    let cancelled = false;
    contractorApi.rectorMyRoutes()
      .then((r) => { if (!cancelled) setRectorRouteIds(r.routeIds || []); })
      .catch(() => { if (!cancelled) setRectorRouteIds([]); });
    return () => { cancelled = true; };
  }, [hasTenant]);

  // Load context and base data
  useEffect(() => {
    if (!hasTenant) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    contractorApi.context().catch((e) => {
      if (e?.message?.includes('tenant') || e?.message?.includes('403')) setContextError('Your account is not linked to a company.');
      throw e;
    }).then(() => {
      if (cancelled) return;
      return Promise.all([
        contractorApi.trucks.list().then((r) => r.trucks || []),
        contractorApi.drivers.list().then((r) => r.drivers || []),
        contractorApi.enrollment.approvedTrucks().then((r) => r.trucks || []),
        contractorApi.enrollment.approvedDrivers().then((r) => r.drivers || []),
        contractorApi.suspensions.list().then((r) => r.suspensions || []),
        contractorApi.routes.list().then((r) => r.routes || []),
      ]);
    }).then((result) => {
      if (cancelled || !result) return;
      const [trucksList, driversList, approvedTrucks, approvedDrivers, suspList, routesList] = result;
      setTrucks(trucksList);
      setDrivers(driversList);
      setApprovedTruckIds(new Set((approvedTrucks || []).map((t) => t.id)));
      setApprovedDriverIds(new Set((approvedDrivers || []).map((d) => d.id)));
      setSuspensions(suspList || []);
      setRoutes(routesList || []);
    }).catch((e) => { if (!cancelled) setError(e?.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hasTenant]);

  // Route enrollments for fleet filter
  useEffect(() => {
    if (!hasTenant || routes.length === 0) return;
    let cancelled = false;
    const load = async () => {
      const next = {};
      for (const r of routes) {
        try {
          const data = await contractorApi.routes.get(r.id);
          if (!cancelled) next[r.id] = { trucks: data.trucks || [], drivers: data.drivers || [] };
        } catch (_) {}
      }
      if (!cancelled) setRouteEnrollments((prev) => ({ ...prev, ...next }));
    };
    load();
    return () => { cancelled = true; };
  }, [hasTenant, routes]);

  // Incidents with filters
  useEffect(() => {
    if (!hasTenant || activeTab !== 'incidents') return;
    let cancelled = false;
    const params = {};
    if (incidentFilters.dateFrom) params.dateFrom = incidentFilters.dateFrom;
    if (incidentFilters.dateTo) params.dateTo = incidentFilters.dateTo;
    if (incidentFilters.type) params.type = incidentFilters.type;
    if (incidentFilters.resolved !== '') params.resolved = incidentFilters.resolved;
    contractorApi.incidents.list(params)
      .then((r) => { if (!cancelled) setIncidents(r.incidents || []); })
      .catch(() => { if (!cancelled) setIncidents([]); });
    return () => { cancelled = true; };
  }, [hasTenant, activeTab, incidentFilters.dateFrom, incidentFilters.dateTo, incidentFilters.type, incidentFilters.resolved]);

  // Incident detail
  useEffect(() => {
    if (!incidentDetailId) { setIncidentDetail(null); return; }
    let cancelled = false;
    contractorApi.incidents.get(incidentDetailId)
      .then((r) => { if (!cancelled) setIncidentDetail(r.incident); })
      .catch(() => { if (!cancelled) setIncidentDetail(null); });
    return () => { cancelled = true; };
  }, [incidentDetailId]);

  // Suspensions with filters
  useEffect(() => {
    if (!hasTenant || activeTab !== 'suspensions') return;
    let cancelled = false;
    const params = {};
    if (suspensionFilters.entity_type) params.entity_type = suspensionFilters.entity_type;
    if (suspensionFilters.status) params.status = suspensionFilters.status;
    contractorApi.suspensions.list(params)
      .then((r) => { if (!cancelled) setSuspensionsList(r.suspensions || []); })
      .catch(() => { if (!cancelled) setSuspensionsList([]); });
    return () => { cancelled = true; };
  }, [hasTenant, activeTab, suspensionFilters.entity_type, suspensionFilters.status]);

  // Compliance with filters
  useEffect(() => {
    if (!hasTenant || activeTab !== 'compliance') return;
    let cancelled = false;
    const params = {};
    if (complianceFilters.status) params.status = complianceFilters.status;
    contractorApi.complianceRecords.list(params)
      .then((r) => { if (!cancelled) setComplianceRecords(r.records || []); })
      .catch(() => { if (!cancelled) setComplianceRecords([]); });
    return () => { cancelled = true; };
  }, [hasTenant, activeTab, complianceFilters.status]);

  // Compliance detail
  useEffect(() => {
    if (!complianceDetail?.id) return;
    let cancelled = false;
    contractorApi.complianceRecords.get(complianceDetail.id)
      .then((r) => { if (!cancelled) setComplianceDetail(r.record); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [complianceDetail?.id]);

  // Contractors details and features: load contractor info + subcontractors when tab is active
  useEffect(() => {
    if (!hasTenant || activeTab !== 'contractors-details') return;
    let cancelled = false;
    setContractorsDetailsLoading(true);
    Promise.all([
      contractorApi.info.get().then((r) => r?.info ?? null),
      contractorApi.subcontractors.list().then((r) => r?.subcontractors ?? []),
    ])
      .then(([info, subs]) => {
        if (!cancelled) {
          setContractorInfo(info);
          setContractorSubcontractors(subs);
        }
      })
      .catch(() => { if (!cancelled) setContractorInfo(null); setContractorSubcontractors([]); })
      .finally(() => { if (!cancelled) setContractorsDetailsLoading(false); });
    return () => { cancelled = true; };
  }, [hasTenant, activeTab]);

  // Library (shift + investigation reports) - command centre library
  useEffect(() => {
    if (!hasTenant || (activeTab !== 'shift-reports' && activeTab !== 'investigation-reports')) return;
    let cancelled = false;
    ccApi.library()
      .then((r) => {
        if (!cancelled) {
          setShiftReports(r.shiftReports || []);
          setInvestigationReports(r.investigationReports || []);
        }
      })
      .catch(() => { if (!cancelled) setShiftReports([]); setInvestigationReports([]); });
    return () => { cancelled = true; };
  }, [hasTenant, activeTab]);

  useEffect(() => {
    if (!hasTenant || activeTab !== 'progress-reports') return;
    setProgressReportsLoading(true);
    progressReportsApi.list()
      .then((r) => {
        setProgressReportsList(r.reports || []);
      })
      .catch(() => setProgressReportsList([]))
      .finally(() => setProgressReportsLoading(false));
  }, [hasTenant, activeTab]);

  useEffect(() => {
    if (!selectedProgressReportId) { setProgressReportDetail(null); return; }
    progressReportsApi.get(selectedProgressReportId)
      .then((r) => setProgressReportDetail(r.report))
      .catch(() => setProgressReportDetail(null));
  }, [selectedProgressReportId]);

  useEffect(() => {
    if (!hasTenant || activeTab !== 'action-plan-timelines') return;
    setActionPlansLoading(true);
    actionPlansApi.list()
      .then((r) => setActionPlansList(r.plans || []))
      .catch(() => setActionPlansList([]))
      .finally(() => setActionPlansLoading(false));
  }, [hasTenant, activeTab]);

  useEffect(() => {
    if (!selectedActionPlanId) { setActionPlanDetail(null); return; }
    actionPlansApi.get(selectedActionPlanId)
      .then((r) => setActionPlanDetail(r.plan))
      .catch(() => setActionPlanDetail(null));
  }, [selectedActionPlanId]);

  useEffect(() => {
    if (!hasTenant || activeTab !== 'monthly-performance-reports') return;
    setMonthlyPerfLoading(true);
    monthlyPerformanceReportsApi.list()
      .then((r) => setMonthlyPerfList(r.reports || []))
      .catch(() => setMonthlyPerfList([]))
      .finally(() => setMonthlyPerfLoading(false));
  }, [hasTenant, activeTab]);

  useEffect(() => {
    if (!selectedMonthlyPerfId) { setMonthlyPerfDetail(null); return; }
    monthlyPerformanceReportsApi.get(selectedMonthlyPerfId)
      .then((r) => setMonthlyPerfDetail(r.report))
      .catch(() => setMonthlyPerfDetail(null));
  }, [selectedMonthlyPerfId]);

  const downloadMonthlyPerfPdf = (report) => {
    if (!report) return;
    setMonthlyPerfPdfDownloading(true);
    const run = (logoDataUrl) => {
      try {
        const doc = generateMonthlyPerformanceReportPdf(report, logoDataUrl ? { logoDataUrl } : {});
        const name = (report.title || 'monthly-performance-report').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 50);
        doc.save(`${name}-${report.submitted_date || 'report'}.pdf`);
      } catch (e) { setError(e?.message || 'PDF failed'); }
      setMonthlyPerfPdfDownloading(false);
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
  };

  const downloadActionPlanPdf = (plan) => {
    if (!plan) return;
    setActionPlanPdfDownloading(true);
    const run = (logoDataUrl) => {
      try {
        const doc = generateActionPlanPdf(plan, logoDataUrl ? { logoDataUrl } : {});
        const name = (plan.title || 'action-plan').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 50);
        doc.save(`${name}-${plan.document_date || 'plan'}.pdf`);
      } catch (e) { setError(e?.message || 'PDF failed'); }
      setActionPlanPdfDownloading(false);
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
  };

  const suspendedTruckIds = new Set((suspensions || []).filter((s) => String(s.entity_type).toLowerCase() === 'truck').map((s) => String(s.entity_id)));
  const suspendedDriverIds = new Set((suspensions || []).filter((s) => String(s.entity_type).toLowerCase() === 'driver').map((s) => String(s.entity_id)));
  let approvedTrucksFull = trucks.filter((t) => approvedTruckIds.has(t.id) && !suspendedTruckIds.has(String(t.id)));
  let approvedDriversFull = drivers.filter((d) => approvedDriverIds.has(d.id) && !suspendedDriverIds.has(String(d.id)));

  // When user is assigned as rector to specific routes, only show those routes and fleet enrolled on them
  const isRectorScoped = rectorRouteIds.length > 0;
  const routesToShow = isRectorScoped ? routes.filter((r) => rectorRouteIds.includes(r.id)) : routes;
  let rectorRouteTruckIds = new Set();
  let rectorRouteDriverIds = new Set();
  if (isRectorScoped) {
    rectorRouteIds.forEach((rid) => {
      const enroll = routeEnrollments[rid];
      (enroll?.trucks || []).forEach((t) => rectorRouteTruckIds.add(t.truck_id));
      (enroll?.drivers || []).forEach((d) => rectorRouteDriverIds.add(d.driver_id));
    });
    approvedTrucksFull = approvedTrucksFull.filter((t) => rectorRouteTruckIds.has(t.id));
    approvedDriversFull = approvedDriversFull.filter((d) => rectorRouteDriverIds.has(d.id));
  }
  const incidentsToShow = isRectorScoped
    ? incidents.filter((i) => rectorRouteTruckIds.has(i.truck_id) || rectorRouteDriverIds.has(i.driver_id))
    : incidents;
  const suspensionsToShow = isRectorScoped
    ? suspensionsList.filter((s) => {
        const id = s.entity_id;
        if (String(s.entity_type).toLowerCase() === 'truck') return rectorRouteTruckIds.has(id);
        if (String(s.entity_type).toLowerCase() === 'driver') return rectorRouteDriverIds.has(id);
        return false;
      })
    : suspensionsList;
  const complianceToShow = isRectorScoped
    ? complianceRecords.filter((c) => rectorRouteTruckIds.has(c.truck_id) || rectorRouteDriverIds.has(c.driver_id))
    : complianceRecords;

  let fleetTrucks = approvedTrucksFull;
  let fleetDrivers = approvedDriversFull;
  if (fleetFilterRoute) {
    const enroll = routeEnrollments[fleetFilterRoute];
    if (enroll) {
      const routeTruckIds = new Set((enroll.trucks || []).map((t) => t.truck_id));
      const routeDriverIds = new Set((enroll.drivers || []).map((d) => d.driver_id));
      fleetTrucks = approvedTrucksFull.filter((t) => routeTruckIds.has(t.id));
      fleetDrivers = approvedDriversFull.filter((d) => routeDriverIds.has(d.id));
    }
  }
  const fleetFilterRouteOptions = routesToShow;
  if (fleetSearch.trim()) {
    const q = fleetSearch.trim().toLowerCase();
    fleetTrucks = fleetTrucks.filter((t) =>
      [t.registration, t.make_model, t.fleet_no, t.main_contractor, t.sub_contractor].some((v) => v && String(v).toLowerCase().includes(q))
    );
    fleetDrivers = fleetDrivers.filter((d) =>
      [d.full_name, d.license_number, d.phone, d.id_number].some((v) => v && String(v).toLowerCase().includes(q))
    );
  }

  const downloadFleetPdf = () => {
    setPdfDownloading('fleet');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    let y = 20;
    doc.setFontSize(16);
    doc.text('Approved Fleet & Drivers', 20, y);
    y += 10;
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()} | Company: ${user?.tenant_name || '—'}`, 20, y);
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.text('Trucks', 20, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    const truckCols = ['Registration', 'Make/Model', 'Fleet No', 'Trailer 1', 'Trailer 2'];
    doc.text(truckCols.join(' | '), 20, y);
    y += 5;
    fleetTrucks.slice(0, 50).forEach((t) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text([t.registration || '—', t.make_model || '—', t.fleet_no || '—', t.trailer_1_reg_no || '—', t.trailer_2_reg_no || '—'].join(' | '), 20, y);
      y += 5;
    });
    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.text('Drivers', 20, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.text('Name | License | Phone | ID Number', 20, y);
    y += 5;
    fleetDrivers.slice(0, 50).forEach((d) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text([d.full_name || '—', d.license_number || '—', d.phone || '—', d.id_number || '—'].join(' | '), 20, y);
      y += 5;
    });
    doc.save('rector-approved-fleet-drivers.pdf');
    setPdfDownloading(null);
  };

  const downloadIncidentsPdf = () => {
    setPdfDownloading('incidents');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    let y = 20;
    doc.setFontSize(16);
    doc.text('Breakdowns & Incidents', 20, y);
    y += 10;
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, y);
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.text('Ref | Type | Title | Reported | Resolved', 20, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    incidentsToShow.slice(0, 80).forEach((i) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(`${i.id || '—'} | ${i.type || '—'} | ${(i.title || '—').slice(0, 25)} | ${formatDate(i.reported_at)} | ${i.resolved_at ? formatDate(i.resolved_at) : 'Open'}`, 20, y);
      y += 5;
    });
    doc.save('rector-incidents.pdf');
    setPdfDownloading(null);
  };

  const downloadSuspensionsPdf = () => {
    setPdfDownloading('suspensions');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    let y = 20;
    doc.setFontSize(16);
    doc.text('Suspensions', 20, y);
    y += 10;
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, y);
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.text('Entity | Type | Status | Reason | Created', 20, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    suspensionsToShow.slice(0, 80).forEach((s) => {
      if (y > 270) { doc.addPage(); y = 20; }
      const reason = (s.reason || '—').slice(0, 40);
      doc.text(`${s.entity_id || '—'} | ${s.entity_type || '—'} | ${s.status || '—'} | ${reason} | ${formatDate(s.created_at)}`, 20, y);
      y += 5;
    });
    doc.save('rector-suspensions.pdf');
    setPdfDownloading(null);
  };

  const downloadCompliancePdf = () => {
    setPdfDownloading('compliance');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    let y = 20;
    doc.setFontSize(16);
    doc.text('Compliance Inspections', 20, y);
    y += 10;
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, y);
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.text('Truck | Driver | Status | Response due', 20, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    complianceToShow.slice(0, 80).forEach((c) => {
      if (y > 270) { doc.addPage(); y = 20; }
      doc.text(`${c.truckRegistration || '—'} | ${c.driverName || '—'} | ${c.status || '—'} | ${formatDateTime(c.responseDueAt)}`, 20, y);
      y += 5;
    });
    doc.save('rector-compliance-inspections.pdf');
    setPdfDownloading(null);
  };

  const downloadShiftReportPdf = (report) => {
    setPdfDownloading(report.id);
    const run = (logoDataUrl) => {
      try {
        const doc = generateShiftReportPdf(report, logoDataUrl ? { logoDataUrl } : {});
        doc.save(`shift-report-${report.id || 'download'}.pdf`);
      } catch (e) { setError(e?.message || 'PDF failed'); }
      setPdfDownloading(null);
    };
    if (user?.tenant_id) {
      fetch(tenantsApi.logoUrl(user.tenant_id), { credentials: 'include' })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
          if (!blob) { run(null); return; }
          const reader = new FileReader();
          reader.onload = () => run(reader.result);
          reader.onerror = () => run(null);
          reader.readAsDataURL(blob);
        })
        .catch(() => run(null));
    } else run(null);
  };

  const downloadInvestigationReportPdf = (report) => {
    setPdfDownloading(report.id);
    try {
      const doc = generateInvestigationReportPdf(report);
      doc.save(`investigation-report-${report.case_number || report.id || 'download'}.pdf`);
    } catch (e) { setError(e?.message || 'PDF failed'); }
    setPdfDownloading(null);
  };

  const downloadProgressReportPdf = (report) => {
    if (!report) return;
    setProgressReportPdfDownloading(true);
    const run = (logoDataUrl) => {
      try {
        const doc = generateProgressReportPdf(report, logoDataUrl ? { logoDataUrl } : {});
        const name = (report.title || 'progress-report').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 50);
        doc.save(`${name}-${report.report_date || 'download'}.pdf`);
      } catch (e) { setError(e?.message || 'PDF failed'); }
      setProgressReportPdfDownloading(false);
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
  };

  const filteredShiftReports = shiftReports.filter((r) => {
    if (librarySearch.trim()) {
      const q = librarySearch.trim().toLowerCase();
      if (![r.route, r.controller1_name, r.controller2_name].some((v) => v && String(v).toLowerCase().includes(q))) return false;
    }
    if (shiftReportTypeFilter === 'approved') return r.status === 'approved';
    if (shiftReportTypeFilter === 'draft') return r.status === 'draft';
    return true;
  });
  const filteredInvReports = investigationReports.filter((r) => {
    if (librarySearch.trim()) {
      const q = librarySearch.trim().toLowerCase();
      if (![r.case_number, r.type, r.investigator_name].some((v) => v && String(v).toLowerCase().includes(q))) return false;
    }
    return true;
  });

  if (authLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <p className="text-surface-500">Loading…</p>
      </div>
    );
  }

  if (!hasTenant) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h2 className="font-semibold text-lg">Rector</h2>
          <p className="mt-2 text-sm">{contextError || 'Your account is not linked to a company. Rector view is available only for users linked to a company.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-0 min-h-[calc(100vh-8rem)]">
      <nav className={`shrink-0 border-r border-surface-200 bg-white flex flex-col transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`} aria-label="Rector" aria-hidden={navHidden}>
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-surface-900">Rector</h2>
            <p className="text-xs text-surface-500 mt-0.5">Fleet, incidents & reports</p>
            <p className="text-xs text-surface-500 mt-1.5">Data for <strong className="text-surface-700">{user?.tenant_name || 'your company'}</strong></p>
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
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between items-center">
              {error}
              <button type="button" onClick={() => setError('')}>Dismiss</button>
            </div>
          )}

          {isRectorScoped && (
            <div className="mb-4 text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-4 py-2">
              You are viewing data for your assigned route(s) only.
            </div>
          )}

          {activeTab === 'fleet' && (
            <div>
              <div className="flex flex-wrap items-center gap-4 mb-4">
                <h3 className="text-lg font-semibold text-surface-900">Approved fleet & drivers</h3>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="Search fleet or drivers…"
                    value={fleetSearch}
                    onChange={(e) => setFleetSearch(e.target.value)}
                    className="rounded-lg border border-surface-200 px-3 py-1.5 text-sm"
                  />
                  <select
                    value={fleetFilterRoute}
                    onChange={(e) => setFleetFilterRoute(e.target.value)}
                    className="rounded-lg border border-surface-200 px-3 py-1.5 text-sm"
                  >
                    <option value="">All routes</option>
                    {fleetFilterRouteOptions.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={downloadFleetPdf}
                    disabled={pdfDownloading === 'fleet'}
                    className="rounded-lg bg-brand-600 text-white px-3 py-1.5 text-sm hover:bg-brand-700 disabled:opacity-50"
                  >
                    {pdfDownloading === 'fleet' ? 'Generating…' : 'Download PDF'}
                  </button>
                </div>
              </div>
              <div className="mb-3 inline-flex rounded-lg border border-surface-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setFleetSubTab('trucks')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                    fleetSubTab === 'trucks' ? 'bg-brand-600 text-white' : 'text-surface-700 hover:bg-surface-100'
                  }`}
                >
                  Trucks ({fleetTrucks.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFleetSubTab('drivers')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                    fleetSubTab === 'drivers' ? 'bg-brand-600 text-white' : 'text-surface-700 hover:bg-surface-100'
                  }`}
                >
                  Drivers ({fleetDrivers.length})
                </button>
              </div>
              <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
                {fleetSubTab === 'trucks' ? (
                  <>
                    <h4 className="px-4 py-3 bg-surface-50 font-medium text-surface-800 border-b">Trucks ({fleetTrucks.length})</h4>
                    <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-surface-50 sticky top-0">
                          <tr>
                            <th className="text-left p-2">Registration</th>
                            <th className="text-left p-2">Make/Model</th>
                            <th className="text-left p-2">Fleet No</th>
                            <th className="text-left p-2">Trailers</th>
                            <th className="text-left p-2">Capacity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fleetTrucks.map((t) => (
                            <tr key={t.id} className="border-t border-surface-100 hover:bg-surface-50">
                              <td className="p-2 font-medium">{t.registration || '—'}</td>
                              <td className="p-2">{t.make_model || '—'}</td>
                              <td className="p-2">{t.fleet_no || '—'}</td>
                              <td className="p-2">{(t.trailer_1_reg_no || '') + (t.trailer_2_reg_no ? ` / ${t.trailer_2_reg_no}` : '') || '—'}</td>
                              <td className="p-2">{t.capacity_tonnes ?? t.capacity_tonnes ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <>
                    <h4 className="px-4 py-3 bg-surface-50 font-medium text-surface-800 border-b">Drivers ({fleetDrivers.length})</h4>
                    <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-surface-50 sticky top-0">
                          <tr>
                            <th className="text-left p-2">Name</th>
                            <th className="text-left p-2">License</th>
                            <th className="text-left p-2">Phone</th>
                            <th className="text-left p-2">ID Number</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fleetDrivers.map((d) => (
                            <tr key={d.id} className="border-t border-surface-100 hover:bg-surface-50">
                              <td className="p-2 font-medium">{d.full_name || '—'}</td>
                              <td className="p-2">{d.license_number || '—'}</td>
                              <td className="p-2">{d.phone || '—'}</td>
                              <td className="p-2">{d.id_number || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {activeTab === 'contractors-details' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-surface-900">Contractors details and features</h3>
                  <p className="text-sm text-surface-500">Click a row to open full details.</p>
                </div>
              </div>
              {contractorsDetailsLoading ? (
                <p className="text-surface-500">Loading…</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-3 items-center">
                    <input
                      type="text"
                      placeholder="Search company, contact, route…"
                      value={contractorsDetailSearch}
                      onChange={(e) => setContractorsDetailSearch(e.target.value)}
                      className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-64 max-w-full"
                    />
                    <select
                      value={contractorsDetailTypeFilter}
                      onChange={(e) => setContractorsDetailTypeFilter(e.target.value)}
                      className="rounded-lg border border-surface-300 px-3 py-2 text-sm"
                    >
                      <option value="all">All</option>
                      <option value="contractor">Contractor</option>
                      <option value="subcontractors">Subcontractors</option>
                      <option value="routes">Routes</option>
                    </select>
                    {(contractorsDetailSearch || contractorsDetailTypeFilter !== 'all') && (
                      <button type="button" onClick={() => { setContractorsDetailSearch(''); setContractorsDetailTypeFilter('all'); }} className="text-sm text-surface-600 hover:text-surface-900">Clear filters</button>
                    )}
                  </div>
                  <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-surface-50 border-b border-surface-200">
                          <tr className="text-left text-surface-600">
                            <th className="p-3 font-medium">Type</th>
                            <th className="p-3 font-medium">Name / Title</th>
                            <th className="p-3 font-medium">Summary</th>
                          </tr>
                        </thead>
                        <tbody>
                          {contractorsDetailTypeFilter === 'all' || contractorsDetailTypeFilter === 'contractor' ? (
                            contractorInfo && (() => {
                              const q = (contractorsDetailSearch || '').toLowerCase();
                              const name = (contractorInfo.companyName || '').toLowerCase();
                              const admin = (contractorInfo.adminName || '').toLowerCase();
                              const cipc = (contractorInfo.cipcRegistrationNumber || '').toLowerCase();
                              if (q && !name.includes(q) && !admin.includes(q) && !cipc.includes(q)) return null;
                              return (
                                <tr
                                  key="contractor"
                                  onClick={() => setContractorsDetailSelected({ type: 'contractor', data: contractorInfo })}
                                  className="border-b border-surface-100 hover:bg-brand-50 cursor-pointer"
                                >
                                  <td className="p-3"><span className="px-2 py-0.5 rounded text-xs font-medium bg-surface-200 text-surface-700">Contractor</span></td>
                                  <td className="p-3 font-medium">{contractorInfo.companyName || '—'}</td>
                                  <td className="p-3 text-surface-600">CIPC {contractorInfo.cipcRegistrationNumber || '—'} · Admin {contractorInfo.adminName || '—'}</td>
                                </tr>
                              );
                            })()
                          ) : null}
                          {(contractorsDetailTypeFilter === 'all' || contractorsDetailTypeFilter === 'subcontractors') && contractorSubcontractors
                            .filter((s) => {
                              const q = (contractorsDetailSearch || '').toLowerCase();
                              if (!q) return true;
                              const company = (s.company_name || '').toLowerCase();
                              const contact = (s.contact_person || '').toLowerCase();
                              return company.includes(q) || contact.includes(q);
                            })
                            .map((s) => (
                              <tr
                                key={s.id}
                                onClick={() => setContractorsDetailSelected({ type: 'subcontractor', data: s })}
                                className="border-b border-surface-100 hover:bg-brand-50 cursor-pointer"
                              >
                                <td className="p-3"><span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Subcontractor</span></td>
                                <td className="p-3 font-medium">{s.company_name || '—'}</td>
                                <td className="p-3 text-surface-600">{s.contact_person || '—'} {s.contact_phone ? ` · ${s.contact_phone}` : ''}</td>
                              </tr>
                            ))}
                          {(contractorsDetailTypeFilter === 'all' || contractorsDetailTypeFilter === 'routes') && routesToShow
                            .filter((r) => {
                              const q = (contractorsDetailSearch || '').toLowerCase();
                              if (!q) return true;
                              return (r.name || '').toLowerCase().includes(q);
                            })
                            .map((r) => {
                              const enroll = routeEnrollments[r.id];
                              const truckCount = (enroll?.trucks || []).length;
                              const driverCount = (enroll?.drivers || []).length;
                              return (
                                <tr
                                  key={r.id}
                                  onClick={() => setContractorsDetailSelected({ type: 'route', data: { ...r, enroll } })}
                                  className="border-b border-surface-100 hover:bg-brand-50 cursor-pointer"
                                >
                                  <td className="p-3"><span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">Route</span></td>
                                  <td className="p-3 font-medium">{r.name || 'Unnamed route'}</td>
                                  <td className="p-3 text-surface-600">{truckCount} truck(s) · {driverCount} driver(s)</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {contractorsDetailSelected && (
                    <div className="fixed inset-0 z-50 flex justify-end">
                      <div className="absolute inset-0 bg-black/30" onClick={() => setContractorsDetailSelected(null)} aria-hidden />
                      <div className="relative w-full max-w-lg bg-white shadow-xl overflow-y-auto flex flex-col max-h-full">
                        <div className="sticky top-0 px-4 py-3 border-b border-surface-200 bg-white flex items-center justify-between">
                          <h4 className="font-semibold text-surface-900">
                            {contractorsDetailSelected.type === 'contractor' && 'Contractor details'}
                            {contractorsDetailSelected.type === 'subcontractor' && 'Subcontractor details'}
                            {contractorsDetailSelected.type === 'route' && 'Route details'}
                          </h4>
                          <button type="button" onClick={() => setContractorsDetailSelected(null)} className="p-2 text-surface-500 hover:text-surface-800 rounded">✕</button>
                        </div>
                        <div className="p-4 text-sm space-y-4">
                          {contractorsDetailSelected.type === 'contractor' && contractorsDetailSelected.data && (
                            <div className="grid gap-3">
                              <div><span className="text-surface-500 block text-xs">Company</span><p className="font-medium">{contractorsDetailSelected.data.companyName || '—'}</p></div>
                              <div><span className="text-surface-500 block text-xs">CIPC number</span><p className="font-medium">{contractorsDetailSelected.data.cipcRegistrationNumber || '—'}</p></div>
                              <div><span className="text-surface-500 block text-xs">CIPC date</span><p className="font-medium">{contractorsDetailSelected.data.cipcRegistrationDate ? formatDate(contractorsDetailSelected.data.cipcRegistrationDate) : '—'}</p></div>
                              <div><span className="text-surface-500 block text-xs">Administrator</span><p className="font-medium">{contractorsDetailSelected.data.adminName || '—'}</p><p className="text-surface-600">{contractorsDetailSelected.data.adminEmail || ''} {contractorsDetailSelected.data.adminPhone ? ` · ${contractorsDetailSelected.data.adminPhone}` : ''}</p></div>
                              <div><span className="text-surface-500 block text-xs">Control room</span><p className="font-medium">{contractorsDetailSelected.data.controlRoomContact || '—'}</p><p className="text-surface-600">{contractorsDetailSelected.data.controlRoomPhone || ''} {contractorsDetailSelected.data.controlRoomEmail ? ` · ${contractorsDetailSelected.data.controlRoomEmail}` : ''}</p></div>
                              <div><span className="text-surface-500 block text-xs">Mechanic</span><p className="font-medium">{contractorsDetailSelected.data.mechanicName || '—'}</p><p className="text-surface-600">{contractorsDetailSelected.data.mechanicPhone || ''} {contractorsDetailSelected.data.mechanicEmail ? ` · ${contractorsDetailSelected.data.mechanicEmail}` : ''}</p></div>
                              <div><span className="text-surface-500 block text-xs">Emergency 1</span><p className="font-medium">{contractorsDetailSelected.data.emergencyContact1Name || '—'} {contractorsDetailSelected.data.emergencyContact1Phone ? ` · ${contractorsDetailSelected.data.emergencyContact1Phone}` : ''}</p></div>
                              <div><span className="text-surface-500 block text-xs">Emergency 2</span><p className="font-medium">{contractorsDetailSelected.data.emergencyContact2Name || '—'} {contractorsDetailSelected.data.emergencyContact2Phone ? ` · ${contractorsDetailSelected.data.emergencyContact2Phone}` : ''}</p></div>
                              <div><span className="text-surface-500 block text-xs">Emergency 3</span><p className="font-medium">{contractorsDetailSelected.data.emergencyContact3Name || '—'} {contractorsDetailSelected.data.emergencyContact3Phone ? ` · ${contractorsDetailSelected.data.emergencyContact3Phone}` : ''}</p></div>
                            </div>
                          )}
                          {contractorsDetailSelected.type === 'subcontractor' && contractorsDetailSelected.data && (
                            <div className="grid gap-3">
                              <div><span className="text-surface-500 block text-xs">Company</span><p className="font-medium">{contractorsDetailSelected.data.company_name || '—'}</p></div>
                              <div><span className="text-surface-500 block text-xs">Contact person</span><p className="font-medium">{contractorsDetailSelected.data.contact_person || '—'}</p><p className="text-surface-600">{contractorsDetailSelected.data.contact_phone || ''} {contractorsDetailSelected.data.contact_email ? ` · ${contractorsDetailSelected.data.contact_email}` : ''}</p></div>
                              <div><span className="text-surface-500 block text-xs">Control room</span><p className="font-medium">{contractorsDetailSelected.data.control_room_contact || '—'}</p><p className="text-surface-600">{contractorsDetailSelected.data.control_room_phone || ''}</p></div>
                              <div><span className="text-surface-500 block text-xs">Mechanic</span><p className="font-medium">{contractorsDetailSelected.data.mechanic_name || '—'}</p><p className="text-surface-600">{contractorsDetailSelected.data.mechanic_phone || ''}</p></div>
                              <div><span className="text-surface-500 block text-xs">Emergency contact</span><p className="font-medium">{contractorsDetailSelected.data.emergency_contact_name || '—'}</p><p className="text-surface-600">{contractorsDetailSelected.data.emergency_contact_phone || ''}</p></div>
                            </div>
                          )}
                          {contractorsDetailSelected.type === 'route' && contractorsDetailSelected.data && (
                            <div className="space-y-3">
                              <div><span className="text-surface-500 block text-xs">Route</span><p className="font-medium">{contractorsDetailSelected.data.name || 'Unnamed route'}</p></div>
                              <div><span className="text-surface-500 block text-xs">Enrolled</span><p className="font-medium">{(contractorsDetailSelected.data.enroll?.trucks || []).length} truck(s) · {(contractorsDetailSelected.data.enroll?.drivers || []).length} driver(s)</p></div>
                              {((contractorsDetailSelected.data.enroll?.trucks || []).length > 0 || (contractorsDetailSelected.data.enroll?.drivers || []).length > 0) && (
                                <div className="pt-2 border-t border-surface-200">
                                      <p className="text-surface-600 text-xs mb-1">Trucks: {(contractorsDetailSelected.data.enroll?.trucks || []).map((t) => t.registration || t.truck_id).filter(Boolean).join(', ') || '—'}</p>
                                      <p className="text-surface-600 text-xs">Drivers: {(contractorsDetailSelected.data.enroll?.drivers || []).map((d) => d.full_name || d.driver_id).filter(Boolean).join(', ') || '—'}</p>
                                    </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'incidents' && (
            <div>
              <div className="flex flex-wrap items-center gap-4 mb-4">
                <h3 className="text-lg font-semibold text-surface-900">Breakdowns & incidents</h3>
                <div className="flex flex-wrap gap-2 items-center">
                  <input type="date" value={incidentFilters.dateFrom} onChange={(e) => setIncidentFilters((f) => ({ ...f, dateFrom: e.target.value }))} className="rounded border px-2 py-1 text-sm" />
                  <input type="date" value={incidentFilters.dateTo} onChange={(e) => setIncidentFilters((f) => ({ ...f, dateTo: e.target.value }))} className="rounded border px-2 py-1 text-sm" />
                  <select value={incidentFilters.type} onChange={(e) => setIncidentFilters((f) => ({ ...f, type: e.target.value }))} className="rounded border px-2 py-1 text-sm">
                    <option value="">All types</option>
                    {INCIDENT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <select value={incidentFilters.resolved} onChange={(e) => setIncidentFilters((f) => ({ ...f, resolved: e.target.value }))} className="rounded border px-2 py-1 text-sm">
                    <option value="">All</option>
                    <option value="0">Open</option>
                    <option value="1">Resolved</option>
                  </select>
                  <button type="button" onClick={downloadIncidentsPdf} disabled={pdfDownloading === 'incidents'} className="rounded-lg bg-brand-600 text-white px-3 py-1.5 text-sm hover:bg-brand-700 disabled:opacity-50">
                    {pdfDownloading === 'incidents' ? 'Generating…' : 'Download PDF'}
                  </button>
                </div>
              </div>
              <div className="flex gap-4">
                <div className={`rounded-xl border bg-white overflow-hidden flex-1 ${incidentDetailId ? 'max-w-[55%]' : ''}`}>
                  <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-50 sticky top-0">
                        <tr>
                          <th className="text-left p-2">Ref</th>
                          <th className="text-left p-2">Type</th>
                          <th className="text-left p-2">Title</th>
                          <th className="text-left p-2">Reported</th>
                          <th className="text-left p-2">Resolved</th>
                        </tr>
                      </thead>
                      <tbody>
                        {incidentsToShow.map((i) => (
                          <tr
                            key={i.id}
                            className={`border-t border-surface-100 hover:bg-surface-50 cursor-pointer ${incidentDetailId === i.id ? 'bg-brand-50' : ''}`}
                            onClick={() => setIncidentDetailId(incidentDetailId === i.id ? null : i.id)}
                          >
                            <td className="p-2 font-mono text-xs">{String(i.id).slice(0, 8)}</td>
                            <td className="p-2">{i.type || '—'}</td>
                            <td className="p-2">{(i.title || '—').slice(0, 40)}</td>
                            <td className="p-2">{formatDate(i.reported_at)}</td>
                            <td className="p-2">{i.resolved_at ? formatDate(i.resolved_at) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {incidentDetailId && (
                  <div className="rounded-xl border border-surface-200 bg-white p-4 flex-1 overflow-y-auto max-h-[500px]">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-semibold">Incident details</h4>
                      <button type="button" onClick={() => setIncidentDetailId(null)} className="text-surface-500 hover:text-surface-700">Close</button>
                    </div>
                    {incidentDetail ? (
                      <dl className="text-sm space-y-1.5">
                        <dt className="font-medium text-surface-500">ID</dt><dd className="ml-0">{incidentDetail.id}</dd>
                        <dt className="font-medium text-surface-500">Type</dt><dd>{incidentDetail.type || '—'}</dd>
                        <dt className="font-medium text-surface-500">Title</dt><dd>{incidentDetail.title || '—'}</dd>
                        <dt className="font-medium text-surface-500">Description</dt><dd>{incidentDetail.description || '—'}</dd>
                        <dt className="font-medium text-surface-500">Severity</dt><dd>{incidentDetail.severity || '—'}</dd>
                        <dt className="font-medium text-surface-500">Actions taken</dt><dd>{incidentDetail.actions_taken || '—'}</dd>
                        <dt className="font-medium text-surface-500">Reported at</dt><dd>{formatDateTime(incidentDetail.reported_at)}</dd>
                        <dt className="font-medium text-surface-500">Resolved at</dt><dd>{incidentDetail.resolved_at ? formatDateTime(incidentDetail.resolved_at) : '—'}</dd>
                        <dt className="font-medium text-surface-500">Resolution note</dt><dd>{incidentDetail.resolution_note || '—'}</dd>
                      </dl>
                    ) : (
                      <p className="text-surface-500">Loading…</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'suspensions' && (
            <div>
              <div className="flex flex-wrap items-center gap-4 mb-4">
                <h3 className="text-lg font-semibold text-surface-900">Suspensions</h3>
                <div className="flex flex-wrap gap-2">
                  <select value={suspensionFilters.entity_type} onChange={(e) => setSuspensionFilters((f) => ({ ...f, entity_type: e.target.value }))} className="rounded border px-2 py-1 text-sm">
                    <option value="">All entities</option>
                    <option value="truck">Truck</option>
                    <option value="driver">Driver</option>
                    <option value="compliance_inspection">Compliance</option>
                  </select>
                  <select value={suspensionFilters.status} onChange={(e) => setSuspensionFilters((f) => ({ ...f, status: e.target.value }))} className="rounded border px-2 py-1 text-sm">
                    <option value="">All statuses</option>
                    <option value="suspended">Suspended</option>
                    <option value="under_appeal">Under appeal</option>
                    <option value="reversed">Reversed</option>
                  </select>
                  <button type="button" onClick={downloadSuspensionsPdf} disabled={pdfDownloading === 'suspensions'} className="rounded-lg bg-brand-600 text-white px-3 py-1.5 text-sm hover:bg-brand-700 disabled:opacity-50">
                    {pdfDownloading === 'suspensions' ? 'Generating…' : 'Download PDF'}
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Entity ID</th>
                        <th className="text-left p-2">Type</th>
                        <th className="text-left p-2">Status</th>
                        <th className="text-left p-2">Reason</th>
                        <th className="text-left p-2">Created</th>
                        <th className="text-left p-2">Ends</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suspensionsToShow.map((s) => (
                        <tr key={s.id} className="border-t border-surface-100 hover:bg-surface-50">
                          <td className="p-2 font-medium">{s.entity_id || '—'}</td>
                          <td className="p-2">{s.entity_type || '—'}</td>
                          <td className="p-2">{s.status || '—'}</td>
                          <td className="p-2 max-w-xs truncate" title={s.reason}>{(s.reason || '—').slice(0, 60)}</td>
                          <td className="p-2">{formatDate(s.created_at)}</td>
                          <td className="p-2">{s.suspension_ends_at ? formatDate(s.suspension_ends_at) : (s.is_permanent ? 'Permanent' : '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'compliance' && (
            <div>
              <div className="flex flex-wrap items-center gap-4 mb-4">
                <h3 className="text-lg font-semibold text-surface-900">Compliance inspections</h3>
                <div className="flex flex-wrap gap-2">
                  <select value={complianceFilters.status} onChange={(e) => setComplianceFilters((f) => ({ ...f, status: e.target.value }))} className="rounded border px-2 py-1 text-sm">
                    <option value="">All statuses</option>
                    <option value="pending_response">Pending response</option>
                    <option value="responded">Responded</option>
                    <option value="auto_suspended">Auto suspended</option>
                  </select>
                  <button type="button" onClick={downloadCompliancePdf} disabled={pdfDownloading === 'compliance'} className="rounded-lg bg-brand-600 text-white px-3 py-1.5 text-sm hover:bg-brand-700 disabled:opacity-50">
                    {pdfDownloading === 'compliance' ? 'Generating…' : 'Download PDF'}
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Truck</th>
                        <th className="text-left p-2">Driver</th>
                        <th className="text-left p-2">Status</th>
                        <th className="text-left p-2">Response due</th>
                        <th className="text-left p-2">Responded at</th>
                      </tr>
                    </thead>
                    <tbody>
                      {complianceToShow.map((c) => (
                        <tr
                          key={c.id}
                          className="border-t border-surface-100 hover:bg-surface-50 cursor-pointer"
                          onClick={() => setComplianceDetail(c)}
                        >
                          <td className="p-2">{c.truckRegistration || '—'}</td>
                          <td className="p-2">{c.driverName || '—'}</td>
                          <td className="p-2">{c.status || '—'}</td>
                          <td className="p-2">{formatDateTime(c.responseDueAt)}</td>
                          <td className="p-2">{c.contractorRespondedAt ? formatDateTime(c.contractorRespondedAt) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {complianceDetail && (
                <div className="mt-4 rounded-xl border border-surface-200 bg-white p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-semibold">Inspection details</h4>
                    <button type="button" onClick={() => setComplianceDetail(null)} className="text-surface-500 hover:text-surface-700">Close</button>
                  </div>
                  <dl className="text-sm grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <dt className="text-surface-500">Truck</dt><dd>{complianceDetail.truckRegistration || '—'}</dd>
                    <dt className="text-surface-500">Driver</dt><dd>{complianceDetail.driverName || '—'}</dd>
                    <dt className="text-surface-500">Status</dt><dd>{complianceDetail.status || '—'}</dd>
                    <dt className="text-surface-500">Response due</dt><dd>{formatDateTime(complianceDetail.responseDueAt)}</dd>
                    <dt className="text-surface-500">Contractor response</dt><dd className="col-span-2">{complianceDetail.contractorResponseText || '—'}</dd>
                    {complianceDetail.suspension && (
                      <>
                        <dt className="text-surface-500">Suspension status</dt><dd>{complianceDetail.suspension.status}</dd>
                        <dt className="text-surface-500">Appeal notes</dt><dd>{complianceDetail.suspension.appeal_notes || '—'}</dd>
                      </>
                    )}
                  </dl>
                </div>
              )}
            </div>
          )}

          {activeTab === 'progress-reports' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold text-surface-900 tracking-tight">Progress reports</h3>
                  <p className="text-sm text-surface-500 mt-1">Click a row to open the report. Project phases and integration status per company.</p>
                </div>
              </div>

              {progressReportsLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-surface-500">Loading reports…</p>
                  </div>
                </div>
              ) : progressReportsList.length === 0 ? (
                <div className="rounded-2xl border border-surface-200 bg-gradient-to-b from-surface-50 to-white p-12 text-center">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-surface-100 text-surface-400 mb-4">
                    <TabIcon name="chart" className="w-7 h-7" />
                  </div>
                  <p className="text-surface-600 font-medium">No progress reports yet</p>
                  <p className="text-sm text-surface-500 mt-1">Ask Access Management to create one in Project progress report creation.</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-surface-200 bg-surface-50/80">
                          <th className="text-left py-4 px-5 font-semibold text-surface-700">Report</th>
                          <th className="text-left py-4 px-5 font-semibold text-surface-700">Date</th>
                          <th className="text-left py-4 px-5 font-semibold text-surface-700">Status</th>
                          <th className="w-12 py-4 px-5 text-surface-400" aria-hidden="true">
                            <span className="sr-only">View</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {progressReportsList.map((r) => (
                          <tr
                            key={r.id}
                            onClick={() => setSelectedProgressReportId(r.id)}
                            className={`border-b border-surface-100 transition-colors cursor-pointer group hover:bg-brand-50/50 ${selectedProgressReportId === r.id ? 'bg-brand-50/70' : ''}`}
                          >
                            <td className="py-4 px-5">
                              <span className="font-medium text-surface-900 group-hover:text-brand-700">{r.title || 'Untitled report'}</span>
                            </td>
                            <td className="py-4 px-5 text-surface-600">{r.report_date ? formatDate(r.report_date) : '—'}</td>
                            <td className="py-4 px-5 text-surface-600">{r.reporting_status || '—'}</td>
                            <td className="py-4 px-5 text-surface-400 group-hover:text-brand-500">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Report view modal: open when a row is selected */}
              {selectedProgressReportId && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
                  onClick={() => { setSelectedProgressReportId(null); setProgressReportDetail(null); }}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="progress-report-modal-title"
                >
                  <div
                    className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Header with TIHLO logo */}
                    <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-b border-surface-200 bg-gradient-to-r from-surface-50 to-white">
                      <div className="flex items-center gap-4">
                        <img src="/logos/tihlo-logo.png" alt="TIHLO" className="h-10 w-auto object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
                        <div className="h-8 w-px bg-surface-200" />
                        <h2 id="progress-report-modal-title" className="text-lg font-semibold text-surface-900">
                          {progressReportDetail ? (progressReportDetail.title || 'Progress report') : 'Loading…'}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2">
                        {progressReportDetail && (
                          <button
                            type="button"
                            onClick={() => downloadProgressReportPdf(progressReportDetail)}
                            disabled={progressReportPdfDownloading}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-900 text-white text-sm font-medium hover:bg-surface-800 disabled:opacity-60 transition-colors"
                          >
                            {progressReportPdfDownloading ? (
                              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            )}
                            Download PDF
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { setSelectedProgressReportId(null); setProgressReportDetail(null); }}
                          className="p-2 rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700 transition-colors"
                          aria-label="Close"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>

                    {/* Body: loading or report content */}
                    <div className="flex-1 overflow-y-auto min-h-0">
                      {!progressReportDetail ? (
                        <div className="flex items-center justify-center py-20">
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-sm text-surface-500">Loading report…</p>
                          </div>
                        </div>
                      ) : (
                        <div className="p-6 space-y-8">
                          <div className="flex flex-wrap items-baseline gap-3 text-sm text-surface-600">
                            {progressReportDetail.report_date && <span>{formatDate(progressReportDetail.report_date)}</span>}
                            {progressReportDetail.reporting_status && (
                              <>
                                <span className="text-surface-300">·</span>
                                <span className="font-medium text-surface-700">{progressReportDetail.reporting_status}</span>
                              </>
                            )}
                          </div>

                          {progressReportDetail.narrative_updates && (
                            <section>
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-2">Executive Summary</h4>
                              <div className="text-surface-700 whitespace-pre-wrap leading-relaxed">{progressReportDetail.narrative_updates}</div>
                            </section>
                          )}

                          {Array.isArray(progressReportDetail.phases) && progressReportDetail.phases.length > 0 && (
                            <section>
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-3">Project phases</h4>
                              <ul className="space-y-4">
                                {progressReportDetail.phases.map((p, i) => (
                                  <li key={i} className="pl-4 border-l-2 border-brand-200">
                                    <span className="font-semibold text-surface-900">{p.name || `Phase ${i + 1}`}</span>
                                    {p.description && <p className="text-sm text-surface-600 mt-1 leading-relaxed">{p.description}</p>}
                                  </li>
                                ))}
                              </ul>
                            </section>
                          )}

                          {Array.isArray(progressReportDetail.contractor_status) && progressReportDetail.contractor_status.length > 0 && (
                            <section>
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-3">Integration status per company</h4>
                              <div className="rounded-xl border border-surface-200 overflow-hidden">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-surface-50 border-b border-surface-200">
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Haulier / Company</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Oper. total</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Integrated (1)</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Integrated (2)</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">% Increase</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Notes</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {progressReportDetail.contractor_status.map((c, i) => (
                                      <tr key={i} className="border-b border-surface-100 last:border-0">
                                        <td className="py-3 px-4 font-medium text-surface-900">{c.contractor_name || c.haulier || '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{c.operational_total ?? '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{c.integrated_count_1 != null ? `${c.integrated_count_1}${c.integrated_date_1 ? ` (${c.integrated_date_1})` : ''}` : '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{c.integrated_count_2 != null ? `${c.integrated_count_2}${c.integrated_date_2 ? ` (${c.integrated_date_2})` : ''}` : '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{c.percent_increase != null ? `${c.percent_increase}%` : '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{c.narrative || c.note || '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </section>
                          )}

                          {progressReportDetail.conclusion_text && (
                            <section>
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-2">Conclusion</h4>
                              <div className="text-surface-700 whitespace-pre-wrap leading-relaxed">{progressReportDetail.conclusion_text}</div>
                            </section>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

          {activeTab === 'action-plan-timelines' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold text-surface-900 tracking-tight">View Project timelines and action plan</h3>
                  <p className="text-sm text-surface-500 mt-1">Click a row to open the full action plan and project timelines.</p>
                </div>
              </div>

              {actionPlansLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-surface-500">Loading action plans…</p>
                  </div>
                </div>
              ) : actionPlansList.length === 0 ? (
                <div className="rounded-2xl border border-surface-200 bg-gradient-to-b from-surface-50 to-white p-12 text-center">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-surface-100 text-surface-400 mb-4">
                    <TabIcon name="calendar" className="w-7 h-7" />
                  </div>
                  <p className="text-surface-600 font-medium">No action plans yet</p>
                  <p className="text-sm text-surface-500 mt-1">Ask Access Management to create one in Action plan and Project timelines.</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-surface-200 bg-surface-50/80">
                          <th className="text-left py-4 px-5 font-semibold text-surface-700">Title</th>
                          <th className="text-left py-4 px-5 font-semibold text-surface-700">Project</th>
                          <th className="text-left py-4 px-5 font-semibold text-surface-700">Document date</th>
                          <th className="text-left py-4 px-5 font-semibold text-surface-700">Document ID</th>
                          <th className="w-12 py-4 px-5 text-surface-400" aria-hidden="true">
                            <span className="sr-only">View</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {actionPlansList.map((p) => (
                          <tr
                            key={p.id}
                            onClick={() => setSelectedActionPlanId(p.id)}
                            className={`border-b border-surface-100 transition-colors cursor-pointer group hover:bg-brand-50/50 ${selectedActionPlanId === p.id ? 'bg-brand-50/70' : ''}`}
                          >
                            <td className="py-4 px-5">
                              <span className="font-medium text-surface-900 group-hover:text-brand-700">{p.title || 'Action Plan'}</span>
                            </td>
                            <td className="py-4 px-5 text-surface-600">{p.project_name || '—'}</td>
                            <td className="py-4 px-5 text-surface-600">{p.document_date ? formatDate(p.document_date) : '—'}</td>
                            <td className="py-4 px-5 text-surface-600">{p.document_id || '—'}</td>
                            <td className="py-4 px-5 text-surface-400 group-hover:text-brand-500">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Action plan / timelines view modal */}
              {selectedActionPlanId && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
                  onClick={() => { setSelectedActionPlanId(null); setActionPlanDetail(null); }}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="action-plan-modal-title"
                >
                  <div
                    className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-b border-surface-200 bg-gradient-to-r from-surface-50 to-white">
                      <div className="flex items-center gap-4">
                        <img src="/logos/tihlo-logo.png" alt="TIHLO" className="h-10 w-auto object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
                        <div className="h-8 w-px bg-surface-200" />
                        <h2 id="action-plan-modal-title" className="text-lg font-semibold text-surface-900">
                          {actionPlanDetail ? (actionPlanDetail.title || 'Action Plan') : 'Loading…'}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2">
                        {actionPlanDetail && (
                          <button
                            type="button"
                            onClick={() => downloadActionPlanPdf(actionPlanDetail)}
                            disabled={actionPlanPdfDownloading}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-900 text-white text-sm font-medium hover:bg-surface-800 disabled:opacity-60 transition-colors"
                          >
                            {actionPlanPdfDownloading ? (
                              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            )}
                            Download PDF
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { setSelectedActionPlanId(null); setActionPlanDetail(null); }}
                          className="p-2 rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700 transition-colors"
                          aria-label="Close"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0">
                      {!actionPlanDetail ? (
                        <div className="flex items-center justify-center py-20">
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-sm text-surface-500">Loading action plan…</p>
                          </div>
                        </div>
                      ) : (
                        <div className="p-6 space-y-6">
                          <div className="text-center space-y-1">
                            <h3 className="text-xl font-bold text-surface-900">{actionPlanDetail.title || 'Action Plan'}</h3>
                            {actionPlanDetail.project_name && <p className="text-base font-semibold text-surface-700">{actionPlanDetail.project_name}</p>}
                            <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-surface-500">
                              {actionPlanDetail.document_date && <span>{formatDate(actionPlanDetail.document_date)}</span>}
                              {actionPlanDetail.document_id && <><span className="text-surface-300">·</span><span>Doc. {actionPlanDetail.document_id}</span></>}
                            </div>
                          </div>

                          <p className="text-xs text-surface-500 text-center italic border-y border-surface-100 py-3">
                            This document is the exclusive property of Thinkers Afrika (Pty) Ltd. and contains confidential information. It may not be reproduced, shared, or disclosed without express written consent.
                          </p>

                          <section>
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-3">Action plan structure</h4>
                            <div className="rounded-xl border border-surface-200 overflow-hidden">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="bg-surface-50 border-b border-surface-200">
                                    <th className="text-left py-3 px-4 font-semibold text-surface-700">Phase</th>
                                    <th className="text-left py-3 px-4 font-semibold text-surface-700">Start date</th>
                                    <th className="text-left py-3 px-4 font-semibold text-surface-700">Action type/description</th>
                                    <th className="text-left py-3 px-4 font-semibold text-surface-700">Participants</th>
                                    <th className="text-left py-3 px-4 font-semibold text-surface-700">Due date</th>
                                    <th className="text-left py-3 px-4 font-semibold text-surface-700">Action status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Array.isArray(actionPlanDetail.items) && actionPlanDetail.items.length > 0 ? (
                                    actionPlanDetail.items.map((it, i) => (
                                      <tr key={i} className="border-b border-surface-100 last:border-0">
                                        <td className="py-3 px-4 font-medium text-surface-900">{it.phase || '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{it.start_date ? formatDate(it.start_date) : '—'}</td>
                                        <td className="py-3 px-4 text-surface-700">{it.action_description || '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{it.participants || '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{it.due_date ? formatDate(it.due_date) : '—'}</td>
                                        <td className="py-3 px-4">
                                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                            (it.status || '').toLowerCase() === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                                            (it.status || '').toLowerCase() === 'in progress' ? 'bg-amber-100 text-amber-800' :
                                            'bg-surface-100 text-surface-600'
                                          }`}>
                                            {it.status || 'not started'}
                                          </span>
                                        </td>
                                      </tr>
                                    ))
                                  ) : (
                                    <tr><td colSpan={6} className="py-6 px-4 text-center text-surface-500">No action items.</td></tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </section>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'monthly-performance-reports' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold text-surface-900 tracking-tight">Monthly Performance reports</h3>
                  <p className="text-sm text-surface-500 mt-1">Click a row to open the full report.</p>
                </div>
              </div>

              {monthlyPerfLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-surface-500">Loading reports…</p>
                  </div>
                </div>
              ) : monthlyPerfList.length === 0 ? (
                <div className="rounded-2xl border border-surface-200 bg-gradient-to-b from-surface-50 to-white p-12 text-center">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-surface-100 text-surface-400 mb-4">
                    <TabIcon name="chart" className="w-7 h-7" />
                  </div>
                  <p className="text-surface-600 font-medium">No monthly performance reports yet</p>
                  <p className="text-sm text-surface-500 mt-1">Ask Access Management to create one in Monthly performance reports.</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-surface-200 bg-surface-50/80">
                          <th className="text-left py-4 px-5 font-semibold text-surface-700">Report</th>
                          <th className="text-left py-4 px-5 font-semibold text-surface-700">Reporting period</th>
                          <th className="text-left py-4 px-5 font-semibold text-surface-700">Submitted</th>
                          <th className="w-12 py-4 px-5 text-surface-400" aria-hidden="true"><span className="sr-only">View</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyPerfList.map((r) => (
                          <tr
                            key={r.id}
                            onClick={() => setSelectedMonthlyPerfId(r.id)}
                            className={`border-b border-surface-100 transition-colors cursor-pointer group hover:bg-brand-50/50 ${selectedMonthlyPerfId === r.id ? 'bg-brand-50/70' : ''}`}
                          >
                            <td className="py-4 px-5"><span className="font-medium text-surface-900 group-hover:text-brand-700">{r.title || 'Monthly Performance Report'}</span></td>
                            <td className="py-4 px-5 text-surface-600">{r.reporting_period_start && r.reporting_period_end ? `${formatDate(r.reporting_period_start)} – ${formatDate(r.reporting_period_end)}` : '—'}</td>
                            <td className="py-4 px-5 text-surface-600">{r.submitted_date ? formatDate(r.submitted_date) : '—'}</td>
                            <td className="py-4 px-5 text-surface-400 group-hover:text-brand-500">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selectedMonthlyPerfId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => { setSelectedMonthlyPerfId(null); setMonthlyPerfDetail(null); }} role="dialog" aria-modal="true" aria-labelledby="monthly-perf-modal-title">
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-b border-surface-200 bg-gradient-to-r from-surface-50 to-white">
                      <div className="flex items-center gap-4">
                        <img src="/logos/tihlo-logo.png" alt="Tihlo" className="h-10 w-auto object-contain" onError={(e) => { e.target.style.display = 'none'; }} />
                        <h2 id="monthly-perf-modal-title" className="text-lg font-semibold text-surface-900">
                          {monthlyPerfDetail ? (monthlyPerfDetail.title || 'Monthly Performance Report') : 'Loading…'}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2">
                        {monthlyPerfDetail && (
                          <button type="button" onClick={() => downloadMonthlyPerfPdf(monthlyPerfDetail)} disabled={monthlyPerfPdfDownloading} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-900 text-white text-sm font-medium hover:bg-surface-800 disabled:opacity-60">
                            {monthlyPerfPdfDownloading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
                            Download PDF
                          </button>
                        )}
                        <button type="button" onClick={() => { setSelectedMonthlyPerfId(null); setMonthlyPerfDetail(null); }} className="p-2 rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Close">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto min-h-0">
                      {!monthlyPerfDetail ? (
                        <div className="flex items-center justify-center py-20">
                          <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                          <p className="text-sm text-surface-500 ml-3">Loading report…</p>
                        </div>
                      ) : (
                        <div className="p-6 space-y-6">
                          <div className="text-center space-y-1">
                            <h3 className="text-xl font-bold text-surface-900">{monthlyPerfDetail.title || 'Monthly Performance Report'}</h3>
                            {monthlyPerfDetail.prepared_by && <p className="text-sm text-surface-600">Prepared by: {monthlyPerfDetail.prepared_by}</p>}
                            <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-surface-500">
                              {monthlyPerfDetail.reporting_period_start && monthlyPerfDetail.reporting_period_end && <span>Reporting period: {formatDate(monthlyPerfDetail.reporting_period_start)} – {formatDate(monthlyPerfDetail.reporting_period_end)}</span>}
                              {monthlyPerfDetail.submitted_date && <><span className="text-surface-300">·</span><span>Submitted: {formatDate(monthlyPerfDetail.submitted_date)}</span></>}
                            </div>
                          </div>
                          <p className="text-xs text-surface-500 text-center italic border-y border-surface-100 py-3">This report contains proprietary and confidential information intended solely for use by Tihlo and parties duly authorised by Thinkers Afrika. Unauthorised distribution or disclosure is strictly prohibited.</p>

                          {monthlyPerfDetail.executive_summary && (
                            <section>
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-2">1. Executive Summary</h4>
                              <div className="text-surface-700 whitespace-pre-wrap leading-relaxed text-sm">{monthlyPerfDetail.executive_summary}</div>
                            </section>
                          )}

                          {Array.isArray(monthlyPerfDetail.key_metrics) && monthlyPerfDetail.key_metrics.length > 0 && (
                            <section>
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-3">2. Key Performance Metrics</h4>
                              <div className="rounded-xl border border-surface-200 overflow-hidden">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-surface-50 border-b border-surface-200">
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Metric</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Value</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Commentary</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {monthlyPerfDetail.key_metrics.map((m, i) => (
                                      <tr key={i} className="border-b border-surface-100 last:border-0">
                                        <td className="py-3 px-4 font-medium text-surface-900">{m.metric || '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{m.value ?? '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{m.commentary || '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </section>
                          )}

                          {Array.isArray(monthlyPerfDetail.sections) && monthlyPerfDetail.sections.length > 0 && monthlyPerfDetail.sections.map((s, i) => {
                            const hasSubsections = Array.isArray(s.subsections) && s.subsections.length > 0;
                            const legacyBody = !hasSubsections && (s.heading || s.body);
                            if (legacyBody) {
                              return (
                                <section key={i}>
                                  <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-2">{i + 3}. {s.heading || `Section ${i + 1}`}</h4>
                                  <div className="text-surface-700 whitespace-pre-wrap leading-relaxed text-sm">{s.body || '—'}</div>
                                </section>
                              );
                            }
                            if (!hasSubsections) return null;
                            return (
                              <section key={i}>
                                <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-3">{i + 3}. {s.heading || `Section ${i + 1}`}</h4>
                                <div className="space-y-4">
                                  {s.subsections.map((sub, subIdx) => (
                                    <div key={subIdx} className="pl-3 border-l-2 border-surface-200">
                                      {sub.subheading && <h5 className="text-sm font-semibold text-surface-800 mb-2">{sub.subheading}</h5>}
                                      <div className="space-y-3">
                                        {(sub.blocks || []).map((b, bi) => {
                                          if (b.type === 'text') return <div key={bi} className="text-surface-700 whitespace-pre-wrap leading-relaxed text-sm">{b.text || '—'}</div>;
                                          if (b.type === 'image' && b.base64) return <div key={bi} className="my-2"><img src={b.base64.startsWith('data:') ? b.base64 : `data:image/png;base64,${b.base64}`} alt={b.alt || ''} className="max-w-full max-h-80 object-contain rounded-lg border border-surface-200" /></div>;
                                          if (b.type === 'table' && Array.isArray(b.rows) && b.rows.length > 0) return (
                                            <div key={bi} className="rounded-xl border border-surface-200 overflow-hidden my-2">
                                              <table className="w-full text-sm">
                                                <tbody>
                                                  {b.rows.map((row, ri) => (
                                                    <tr key={ri} className="border-b border-surface-100 last:border-0">
                                                      {(Array.isArray(row) ? row : []).map((cell, ci) => (
                                                        <td key={ci} className="py-2 px-3 text-surface-700">{ri === 0 ? <span className="font-semibold text-surface-800">{cell}</span> : cell}</td>
                                                      ))}
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          );
                                          return null;
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </section>
                            );
                          })}

                          {Array.isArray(monthlyPerfDetail.breakdowns) && monthlyPerfDetail.breakdowns.length > 0 && (
                            <section>
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-3">Breakdowns (incidents)</h4>
                              <div className="rounded-xl border border-surface-200 overflow-hidden">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-surface-50 border-b border-surface-200">
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Date</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Time</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Route</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Truck reg</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Description</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Company</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {monthlyPerfDetail.breakdowns.map((b, i) => (
                                      <tr key={i} className="border-b border-surface-100 last:border-0">
                                        <td className="py-3 px-4 text-surface-600">{b.date ? formatDate(b.date) : '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{b.time || '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{b.route || '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{b.truck_reg || '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{b.description || '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{b.company || '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </section>
                          )}

                          {Array.isArray(monthlyPerfDetail.fleet_performance) && monthlyPerfDetail.fleet_performance.length > 0 && (
                            <section>
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-3">Fleet performance by haulier</h4>
                              <div className="rounded-xl border border-surface-200 overflow-hidden">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-surface-50 border-b border-surface-200">
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Haulier</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Trips</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">% Trips</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Tonnage</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">% Tonnage</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Avg t/Trip</th>
                                      <th className="text-left py-3 px-4 font-semibold text-surface-700">Trucks</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {monthlyPerfDetail.fleet_performance.map((f, i) => (
                                      <tr key={i} className="border-b border-surface-100 last:border-0">
                                        <td className="py-3 px-4 font-medium text-surface-900">{f.haulier || '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{f.trips ?? '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{f.pct_trips ?? '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{f.tonnage ?? '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{f.pct_tonnage ?? '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{f.avg_t_per_trip ?? '—'}</td>
                                        <td className="py-3 px-4 text-surface-600">{f.trucks_deployed ?? '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </section>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'shift-reports' && (
            <div>
              <div className="flex flex-wrap items-center gap-4 mb-4">
                <h3 className="text-lg font-semibold text-surface-900">Shift reports</h3>
                <input
                  type="text"
                  placeholder="Search route or controller…"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  className="rounded-lg border border-surface-200 px-3 py-1.5 text-sm"
                />
                <select value={shiftReportTypeFilter} onChange={(e) => setShiftReportTypeFilter(e.target.value)} className="rounded border px-2 py-1 text-sm">
                  <option value="">All</option>
                  <option value="approved">Approved only</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
              <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Route</th>
                        <th className="text-left p-2">Report date</th>
                        <th className="text-left p-2">Controller 1</th>
                        <th className="text-left p-2">Status</th>
                        <th className="text-left p-2">Approved</th>
                        <th className="text-left p-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredShiftReports.map((r) => (
                        <tr key={r.id} className="border-t border-surface-100 hover:bg-surface-50">
                          <td className="p-2">{r.route || '—'}</td>
                          <td className="p-2">{formatDate(r.report_date || r.shift_date)}</td>
                          <td className="p-2">{r.controller1_name || '—'}</td>
                          <td className="p-2">{r.status || '—'}</td>
                          <td className="p-2">{r.approved_at ? formatDate(r.approved_at) : '—'}</td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() => downloadShiftReportPdf(r)}
                              disabled={pdfDownloading === r.id}
                              className="text-brand-600 hover:text-brand-700 text-sm"
                            >
                              {pdfDownloading === r.id ? 'Generating…' : 'Download PDF'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'investigation-reports' && (
            <div>
              <div className="flex flex-wrap items-center gap-4 mb-4">
                <h3 className="text-lg font-semibold text-surface-900">Investigation reports</h3>
                <input
                  type="text"
                  placeholder="Search case number or investigator…"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  className="rounded-lg border border-surface-200 px-3 py-1.5 text-sm"
                />
              </div>
              <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Case number</th>
                        <th className="text-left p-2">Type</th>
                        <th className="text-left p-2">Date occurred</th>
                        <th className="text-left p-2">Investigator</th>
                        <th className="text-left p-2">Status</th>
                        <th className="text-left p-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInvReports.map((r) => (
                        <tr key={r.id} className="border-t border-surface-100 hover:bg-surface-50">
                          <td className="p-2 font-medium">{r.case_number || '—'}</td>
                          <td className="p-2">{r.type || '—'}</td>
                          <td className="p-2">{formatDate(r.date_occurred)}</td>
                          <td className="p-2">{r.investigator_name || '—'}</td>
                          <td className="p-2">{r.status || '—'}</td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() => downloadInvestigationReportPdf(r)}
                              disabled={pdfDownloading === r.id}
                              className="text-brand-600 hover:text-brand-700 text-sm"
                            >
                              {pdfDownloading === r.id ? 'Generating…' : 'Download PDF'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
