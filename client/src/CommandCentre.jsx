import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import ExcelJS from 'exceljs';
import { useAuth } from './AuthContext';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { commandCentre as ccApi, contractor as contractorApi, users as usersApi, tenants as tenantsApi, openAttachmentWithAuth } from './api';
import { generateShiftReportPdf } from './lib/shiftReportPdf.js';
import { generateInvestigationReportPdf } from './lib/investigationReportPdf.js';
import { generateBreakdownPdf } from './lib/breakdownPdfReport.js';

/** Column definitions for Fleet & driver applications Excel export. getValue(app, { formatDate }) returns cell value. */
const FLEET_APP_EXPORT_COLUMNS = [
  { id: 'contractor', label: 'Contractor', getValue: (app) => app.contractorName || '' },
  { id: 'type', label: 'Type', getValue: (app) => (app.entityType === 'truck' ? 'Truck' : 'Driver') },
  { id: 'name_registration', label: 'Name / Registration', getValue: (app) => (app.entityType === 'truck' ? (app.truckRegistration || '') : (app.driverName || '')) },
  { id: 'source', label: 'Source', getValue: (app) => ((app.source || 'manual') === 'import' ? 'Import' : 'Manual') },
  { id: 'submitted', label: 'Submitted', getValue: (app, { formatDate }) => (app.createdAt ? (formatDate ? formatDate(app.createdAt) : app.createdAt) : '') },
  { id: 'status', label: 'Status', getValue: (app) => app.status || '' },
  { id: 'reviewed_at', label: 'Reviewed at', getValue: (app, { formatDate }) => (app.reviewedAt ? (formatDate ? formatDate(app.reviewedAt) : app.reviewedAt) : '') },
  { id: 'decline_reason', label: 'Decline reason', getValue: (app) => app.declineReason || '' },
  { id: 'truck_registration', label: 'Truck registration', getValue: (app) => (app.entityType === 'truck' ? (app.truckRegistration || '') : '') },
  { id: 'truck_make_model', label: 'Truck make / model', getValue: (app) => (app.entityType === 'truck' ? (app.truckMakeModel || '') : '') },
  { id: 'truck_year_model', label: 'Truck year model', getValue: (app) => (app.entityType === 'truck' ? (app.truckYearModel || '') : '') },
  { id: 'truck_main_contractor', label: 'Truck main contractor', getValue: (app) => (app.entityType === 'truck' ? (app.truckMainContractor || '') : '') },
  { id: 'truck_sub_contractor', label: 'Truck sub contractor', getValue: (app) => (app.entityType === 'truck' ? (app.truckSubContractor || '') : '') },
  { id: 'truck_ownership', label: 'Truck ownership', getValue: (app) => (app.entityType === 'truck' ? (app.truckOwnershipDesc || '') : '') },
  { id: 'truck_fleet_no', label: 'Truck fleet no', getValue: (app) => (app.entityType === 'truck' ? (app.truckFleetNo || '') : '') },
  { id: 'truck_trailer_1', label: 'Truck trailer 1 reg', getValue: (app) => (app.entityType === 'truck' ? (app.truckTrailer1RegNo || '') : '') },
  { id: 'truck_trailer_2', label: 'Truck trailer 2 reg', getValue: (app) => (app.entityType === 'truck' ? (app.truckTrailer2RegNo || '') : '') },
  { id: 'truck_tracking_provider', label: 'Tracking provider (tracker name)', getValue: (app) => (app.entityType === 'truck' ? (app.truckTrackingProvider || '') : '') },
  { id: 'truck_tracking_username', label: 'Tracking username', getValue: (app) => (app.entityType === 'truck' ? (app.truckTrackingUsername || '') : '') },
  { id: 'truck_tracking_password', label: 'Tracking password', getValue: (app) => (app.entityType === 'truck' ? (app.truckTrackingPassword || '') : '') },
  { id: 'truck_commodity', label: 'Truck commodity type', getValue: (app) => (app.entityType === 'truck' ? (app.truckCommodityType || '') : '') },
  { id: 'truck_capacity', label: 'Truck capacity (tonnes)', getValue: (app) => (app.entityType === 'truck' ? (app.truckCapacityTonnes != null ? String(app.truckCapacityTonnes) : '') : '') },
  { id: 'truck_status', label: 'Truck status', getValue: (app) => (app.entityType === 'truck' ? (app.truckStatus || '') : '') },
  { id: 'driver_name', label: 'Driver name', getValue: (app) => (app.entityType === 'driver' ? (app.driverName || '') : '') },
  { id: 'driver_surname', label: 'Driver surname', getValue: (app) => (app.entityType === 'driver' ? (app.driverSurname || '') : '') },
  { id: 'driver_id_number', label: 'Driver ID number', getValue: (app) => (app.entityType === 'driver' ? (app.driverIdNumber || '') : '') },
  { id: 'driver_license_number', label: 'Driver licence number', getValue: (app) => (app.entityType === 'driver' ? (app.driverLicenseNumber || '') : '') },
  { id: 'driver_license_expiry', label: 'Driver licence expiry', getValue: (app, { formatDate }) => (app.entityType === 'driver' && app.driverLicenseExpiry ? (formatDate ? formatDate(app.driverLicenseExpiry) : app.driverLicenseExpiry) : '') },
  { id: 'driver_phone', label: 'Driver phone', getValue: (app) => (app.entityType === 'driver' ? (app.driverPhone || '') : '') },
  { id: 'driver_email', label: 'Driver email', getValue: (app) => (app.entityType === 'driver' ? (app.driverEmail || '') : '') },
];

/** Columns for Fleet Integration Excel export (fleets with linked drivers). getValue(row, { formatDate }) */
const FLEET_INTEGRATION_EXPORT_COLUMNS = [
  { id: 'contractor', label: 'Contractor', getValue: (row) => row.contractorName || '' },
  { id: 'name_registration', label: 'Name / Registration', getValue: (row) => row.nameOrRegistration || row.truckRegistration || '' },
  { id: 'truck_registration', label: 'Truck registration', getValue: (row) => row.truckRegistration || '' },
  { id: 'truck_year_model', label: 'Truck year model', getValue: (row) => row.truckYearModel || '' },
  { id: 'truck_sub_contractor', label: 'Truck sub contractor', getValue: (row) => row.truckSubContractor || '' },
  { id: 'truck_ownership', label: 'Truck ownership', getValue: (row) => row.truckOwnershipDesc || '' },
  { id: 'truck_fleet_no', label: 'Truck fleet no', getValue: (row) => row.truckFleetNo || '' },
  { id: 'truck_trailer_1', label: 'Truck trailer 1 reg', getValue: (row) => row.truckTrailer1RegNo || '' },
  { id: 'truck_trailer_2', label: 'Truck trailer 2 reg', getValue: (row) => row.truckTrailer2RegNo || '' },
  { id: 'truck_tracking_provider', label: 'Tracking provider (tracker name)', getValue: (row) => row.truckTrackingProvider || '' },
  { id: 'truck_tracking_username', label: 'Tracking username', getValue: (row) => row.truckTrackingUsername || '' },
  { id: 'truck_tracking_password', label: 'Tracking password', getValue: (row) => row.truckTrackingPassword || '' },
  { id: 'truck_commodity_type', label: 'Truck commodity type', getValue: (row) => row.truckCommodityType || '' },
  { id: 'truck_make_model', label: 'Truck make / model', getValue: (row) => row.truckMakeModel || '' },
  { id: 'truck_capacity', label: 'Truck capacity (tonnes)', getValue: (row) => (row.truckCapacityTonnes != null ? String(row.truckCapacityTonnes) : '') },
  { id: 'truck_status', label: 'Truck status', getValue: (row) => row.truckStatus || '' },
  { id: 'driver_name', label: 'Linked driver name', getValue: (row) => [row.driverFullName, row.driverSurname].filter(Boolean).join(' ').trim() || '' },
  { id: 'driver_id_number', label: 'Linked driver ID number', getValue: (row) => row.driverIdNumber || '' },
  { id: 'driver_license_number', label: 'Linked driver licence number', getValue: (row) => row.driverLicenseNumber || '' },
  { id: 'driver_license_expiry', label: 'Linked driver licence expiry', getValue: (row, opts) => (row.driverLicenseExpiry && opts?.formatDate ? opts.formatDate(row.driverLicenseExpiry) : (row.driverLicenseExpiry || '')) },
  { id: 'driver_phone', label: 'Linked driver phone', getValue: (row) => row.driverPhone || '' },
  { id: 'driver_email', label: 'Linked driver email', getValue: (row) => row.driverEmail || '' },
];

const CC_TABS = [
  { id: 'dashboard', label: 'Main dashboard', icon: 'dashboard', section: 'Overview' },
  { id: 'reports', label: 'Report composition', icon: 'file', section: 'Operations' },
  { id: 'saved_reports', label: 'View saved shift reports', icon: 'folder', section: 'Operations' },
  { id: 'trends', label: 'Trends', icon: 'chart', section: 'Analytics' },
  { id: 'shift_items', label: 'Shift by route', icon: 'route', section: 'Operations' },
  { id: 'shift_report_exports', label: 'Export sections', icon: 'download', section: 'Operations' },
  { id: 'requests', label: 'Requests', icon: 'inbox', section: 'Operations' },
  { id: 'library', label: 'Library', icon: 'library', section: 'Operations' },
  { id: 'compliance', label: 'Fleet and driver compliance', icon: 'shield', section: 'Operations' },
  { id: 'inspected', label: 'Inspected trucks & drivers', icon: 'clipboard', section: 'Operations' },
  { id: 'inspection_records', label: 'Truck inspection records', icon: 'list', section: 'Operations' },
  { id: 'contractor_block', label: 'Contractor block', icon: 'ban', section: 'Operations' },
  { id: 'applications', label: 'Fleet & driver applications', icon: 'tick', section: 'Operations' },
  { id: 'delivery', label: 'Delivery management', icon: 'truck', section: 'Operations' },
  { id: 'contractors_details', label: 'Contractors details', icon: 'building', section: 'Operations' },
  { id: 'breakdowns', label: 'Reported breakdowns', icon: 'alert', section: 'Operations' },
  { id: 'delete_fleet_drivers', label: 'Delete contractors fleets/drivers', icon: 'trash', section: 'Operations' },
];

function CCIcon({ name, className }) {
  const c = className || 'w-5 h-5';
  const path = (d) => <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d} />;
  switch (name) {
    case 'dashboard':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z')}</svg>;
    case 'chart':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16')}</svg>;
    case 'route':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7')}</svg>;
    case 'download':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4')}</svg>;
    case 'file':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z')}</svg>;
    case 'library':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z')}</svg>;
    case 'shield':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z')}</svg>;
    case 'ban':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636')}</svg>;
    case 'tick':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z')}</svg>;
    case 'truck':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M8 17h8m0 0a2 2 0 104 0 2 2 0 00-4 0m-4 0a2 2 0 104 0 2 2 0 00-4 0m0-6h.01M12 16h.01M5 8h14l1.921 2.876c.075.113.129.24.16.373a2 2 0 01-.16 1.751L20 14v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2l-.921-1.376a2 2 0 01-.16-1.751 1.006 1.006 0 01.16-.373L5 8z')}</svg>;
    case 'folder':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z')}</svg>;
    case 'inbox':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4')}</svg>;
    case 'clipboard':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4')}</svg>;
    case 'list':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M4 6h16M4 10h16M4 14h16M4 18h16')}</svg>;
    case 'building':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4')}</svg>;
    case 'alert':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z')}</svg>;
    case 'trash':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16')}</svg>;
    case 'settings':
      return <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor">{path('M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z')}</svg>;
    default:
      return <span className={c} />;
  }
}

const CC_STORAGE_KEY_INSPECTIONS = 'cc_inspections';

function loadStoredInspections() {
  try {
    const raw = localStorage.getItem(CC_STORAGE_KEY_INSPECTIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function CommandCentre() {
  const { user } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('command-centre');
  const [allowedTabs, setAllowedTabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [permissions, setPermissions] = useState(null);
  const [users, setUsers] = useState([]);
  const [inspections, setInspections] = useState(() => loadStoredInspections());
  const [contractorsDetailsList, setContractorsDetailsList] = useState([]);
  const [contractorsDetailsLoading, setContractorsDetailsLoading] = useState(false);
  const isSuperAdmin = user?.role === 'super_admin';

  useEffect(() => {
    try {
      localStorage.setItem(CC_STORAGE_KEY_INSPECTIONS, JSON.stringify(inspections));
    } catch (_) {}
  }, [inspections]);

  // Load compliance inspections from API so Command Centre can see contractor response (Inspected / Truck inspection records)
  useEffect(() => {
    const needs = ['compliance', 'inspected', 'inspection_records'];
    if (!allowedTabs.some((t) => needs.includes(t))) return;
    let cancelled = false;
    ccApi.complianceInspections.list()
      .then((r) => { if (!cancelled && r.inspections) setInspections(r.inspections); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [allowedTabs]);

  useEffect(() => {
    let cancelled = false;
    ccApi.myTabs()
      .then((r) => { if (!cancelled) setAllowedTabs(r.tabs || []); })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load access'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const report = e.detail?.report ?? e.detail;
      const tenantId = e.detail?.tenantId ?? user?.tenant_id;
      if (!report) return;
      const runPdf = (logoDataUrl) => {
        try {
          const doc = generateShiftReportPdf(report, logoDataUrl ? { logoDataUrl } : {});
          doc.save(`shift-report-${report.id || 'download'}.pdf`);
        } catch (err) {
          setError(err?.message || 'Failed to generate PDF');
        }
      };
      const tryDefaultLogo = () => {
        const logoPaths = ['/logos/tihlo-logo.png', '/logos/tihlo-logo.jpg', '/logos/logo.png'];
        let tried = 0;
        const attempt = () => {
          if (tried >= logoPaths.length) { runPdf(null); return; }
          fetch(logoPaths[tried], { credentials: 'include' })
            .then((r) => (r.ok ? r.blob() : null))
            .then((blob) => {
              if (blob) {
                const reader = new FileReader();
                reader.onload = () => runPdf(reader.result);
                reader.onerror = () => { tried++; attempt(); };
                reader.readAsDataURL(blob);
              } else { tried++; attempt(); }
            })
            .catch(() => { tried++; attempt(); });
        };
        attempt();
      };
      if (tenantId) {
        fetch(tenantsApi.logoUrl(tenantId), { credentials: 'include' })
          .then((r) => (r.ok ? r.blob() : null))
          .then((blob) => {
            if (blob) {
              const reader = new FileReader();
              reader.onload = () => runPdf(reader.result);
              reader.onerror = () => tryDefaultLogo();
              reader.readAsDataURL(blob);
            } else {
              tryDefaultLogo();
            }
          })
          .catch(() => tryDefaultLogo());
      } else {
        tryDefaultLogo();
      }
    };
    window.addEventListener('shift-report-download', handler);
    return () => window.removeEventListener('shift-report-download', handler);
  }, [user?.tenant_id]);

  useEffect(() => {
    const handler = (e) => {
      const report = e.detail?.report ?? e.detail;
      if (!report) return;
      try {
        const doc = generateInvestigationReportPdf(report);
        doc.save(`investigation-report-${report.id || report.case_number || 'download'}.pdf`);
      } catch (err) {
        setError(err?.message || 'Failed to generate PDF');
      }
    };
    window.addEventListener('investigation-report-download', handler);
    return () => window.removeEventListener('investigation-report-download', handler);
  }, []);

  // When allowed tabs load, if current tab isn't in the list, switch to first allowed tab so content always shows
  useEffect(() => {
    if (allowedTabs.length === 0) return;
    if (activeTab !== 'manage_access' && !allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0]);
    }
  }, [allowedTabs]);

  useEffect(() => {
    if (activeTab !== 'contractors_details' || !allowedTabs.includes('contractors_details')) return;
    let cancelled = false;
    setContractorsDetailsLoading(true);
    ccApi.contractorsDetails()
      .then((r) => { if (!cancelled) setContractorsDetailsList(r.contractors || []); })
      .catch(() => { if (!cancelled) setContractorsDetailsList([]); })
      .finally(() => { if (!cancelled) setContractorsDetailsLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, allowedTabs]);

  const navTabs = CC_TABS.filter((t) => allowedTabs.includes(t.id));
  const sections = [...new Set(navTabs.map((t) => t.section))];
  const canSeeTab = (id) => allowedTabs.includes(id);
  const hasAccess = allowedTabs.length > 0 || isSuperAdmin;

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <p className="text-surface-500">Loading Command Centre…</p>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h2 className="font-semibold text-lg">Command Centre</h2>
          <p className="mt-2 text-sm">You don’t have access to any Command Centre tabs. Contact your administrator or a super admin to request access.</p>
          <Link to="/contractor" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">Go to Contractor page</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-0 flex-1 min-h-0 overflow-hidden">
      <nav className={`shrink-0 border-r border-surface-200 bg-white flex flex-col min-h-0 transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`} aria-hidden={navHidden}>
        <div className="p-4 border-b border-surface-100 shrink-0 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-surface-900">Command Centre</h2>
            <p className="text-xs text-surface-500 mt-0.5">Controllers & operations</p>
            <Link to="/contractor" className="mt-2 inline-block text-xs text-brand-600 hover:text-brand-700">← Contractor page</Link>
          </div>
          <button type="button" onClick={() => setNavHidden(true)} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Hide navigation" title="Hide navigation">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 scrollbar-thin min-h-0 w-72">
          {sections.map((section) => (
            <div key={section} className="mb-4">
              <p className="px-4 py-1.5 text-xs font-medium text-surface-400 uppercase tracking-wider">{section}</p>
              <ul className="space-y-0.5">
                {navTabs.filter((t) => t.section === section).map((tab) => (
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
                      <CCIcon name={tab.icon} className="w-5 h-5 shrink-0 text-inherit opacity-90" />
                      <span className="min-w-0 break-words">{tab.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {isSuperAdmin && (
            <div className="mb-4">
              <p className="px-4 py-1.5 text-xs font-medium text-surface-400 uppercase tracking-wider">Admin</p>
              <ul className="space-y-0.5">
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveTab('manage_access')}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                        activeTab === 'manage_access'
                        ? 'bg-amber-50 text-amber-800 border-l-2 border-l-amber-500 font-medium'
                        : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent'
                    }`}
                  >
                    <CCIcon name="settings" className="w-5 h-5 shrink-0 text-inherit opacity-90" />
                    <span className="min-w-0 break-words">Manage tab access</span>
                  </button>
                </li>
              </ul>
            </div>
          )}
        </div>
      </nav>

      <div className="flex-1 min-w-0 min-h-0 overflow-auto p-4 sm:p-6 scrollbar-thin flex flex-col">
        {navHidden && (
          <button type="button" onClick={() => setNavHidden(false)} className="self-start flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-surface-50 text-sm font-medium shadow-sm" aria-label="Show navigation">
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            Show navigation
          </button>
        )}
        <div className="w-full max-w-7xl mx-auto min-h-full flex-1">
          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between items-center">
              {error}
              <button type="button" onClick={() => setError('')}>Dismiss</button>
            </div>
          )}

          {activeTab === 'manage_access' && (
            <ManageTabAccess
              isSuperAdmin={isSuperAdmin}
              permissions={permissions}
              setPermissions={setPermissions}
              users={users}
              setUsers={setUsers}
              allTabIds={CC_TABS.map((t) => t.id)}
            />
          )}

          {activeTab === 'dashboard' && canSeeTab('dashboard') && <TabDashboard setActiveTab={setActiveTab} canSeeTab={canSeeTab} />}
          {activeTab === 'reports' && canSeeTab('reports') && <TabReports />}
          {activeTab === 'saved_reports' && canSeeTab('saved_reports') && <TabSavedReports />}
          {activeTab === 'trends' && canSeeTab('trends') && <TabTrends />}
          {activeTab === 'shift_items' && canSeeTab('shift_items') && <TabShiftItems setActiveTab={setActiveTab} />}
          {activeTab === 'shift_report_exports' && canSeeTab('shift_report_exports') && <TabShiftReportExports />}
          {activeTab === 'requests' && canSeeTab('requests') && <TabRequests />}
          {activeTab === 'library' && canSeeTab('library') && <TabLibrary />}
          {activeTab === 'compliance' && canSeeTab('compliance') && <TabCompliance user={user} inspections={inspections} setInspections={setInspections} />}
          {activeTab === 'inspected' && canSeeTab('inspected') && <TabInspected inspections={inspections} setInspections={setInspections} />}
          {activeTab === 'inspection_records' && canSeeTab('inspection_records') && <TabInspectionRecords inspections={inspections} setInspections={setInspections} />}
          {activeTab === 'contractor_block' && canSeeTab('contractor_block') && <TabContractorBlock />}
          {activeTab === 'applications' && canSeeTab('applications') && <TabApplications />}
          {activeTab === 'delivery' && canSeeTab('delivery') && <TabDelivery />}
          {activeTab === 'contractors_details' && canSeeTab('contractors_details') && (
            <TabContractorsDetails list={contractorsDetailsList} loading={contractorsDetailsLoading} />
          )}
          {activeTab === 'breakdowns' && canSeeTab('breakdowns') && <TabBreakdowns />}
          {activeTab === 'delete_fleet_drivers' && canSeeTab('delete_fleet_drivers') && <TabDeleteFleetDrivers />}

          {/* Fallback when no tab content matched (e.g. permission race) */}
          {activeTab !== 'manage_access' && !allowedTabs.includes(activeTab) && (
            <div className="rounded-xl border border-surface-200 bg-surface-50 p-6 text-center text-surface-600">
              <p>Select a tab from the left, or you may not have access to this tab.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabDashboard({ setActiveTab, canSeeTab }) {
  const [loading, setLoading] = useState(true);
  const [pendingApplications, setPendingApplications] = useState(0);
  const [unresolvedBreakdowns, setUnresolvedBreakdowns] = useState([]);
  const [recentBreakdowns, setRecentBreakdowns] = useState([]);
  const [underAppealCount, setUnderAppealCount] = useState(0);
  const [inspections, setInspections] = useState([]);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const promises = [];
    if (canSeeTab?.('applications')) {
      promises.push(ccApi.fleetApplications.list('pending').then((r) => ({ applications: (r.applications || []).length })).catch(() => ({ applications: 0 })));
    } else {
      promises.push(Promise.resolve({ applications: 0 }));
    }
    promises.push(ccApi.breakdowns.list({ resolved: 'false' }).then((r) => ({ breakdowns: r.breakdowns || [] })).catch(() => ({ breakdowns: [] })));
    promises.push(ccApi.suspensions.list('under_appeal').then((r) => ({ underAppeal: (r.suspensions || []).length })).catch(() => ({ underAppeal: 0 })));
    promises.push(ccApi.complianceInspections.list().then((r) => ({ inspections: r.inspections || [] })).catch(() => ({ inspections: [] })));
    promises.push(ccApi.shiftReports.list(true).then((r) => ({ requests: (r.reports || []).length })).catch(() => ({ requests: 0 })));

    Promise.all(promises).then((results) => {
      if (cancelled) return;
      let appCount = 0;
      let breakdownsList = [];
      let appealCount = 0;
      let inspList = [];
      let reqCount = 0;
      results.forEach((r) => {
        if (r.applications !== undefined) appCount = r.applications;
        if (r.breakdowns) breakdownsList = r.breakdowns;
        if (r.underAppeal !== undefined) appealCount = r.underAppeal;
        if (r.inspections) inspList = r.inspections;
        if (r.requests !== undefined) reqCount = r.requests;
      });
      setPendingApplications(appCount);
      setUnresolvedBreakdowns(breakdownsList);
      setRecentBreakdowns(breakdownsList.slice(0, 5));
      setUnderAppealCount(appealCount);
      setInspections(inspList);
      setPendingRequestsCount(reqCount);
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canSeeTab]);

  const pendingCompliance = inspections.filter((i) => i.status === 'pending_response' || i.status === 'auto_suspended').length;
  const formatDashboardTime = (d) => d ? new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—';

  const kpiCards = [
    canSeeTab?.('applications') && { label: 'Pending applications', value: pendingApplications, sub: 'Fleet & driver', tab: 'applications', icon: 'tick', color: 'amber', bg: 'bg-amber-500/10', border: 'border-amber-200', text: 'text-amber-700' },
    { label: 'Unresolved breakdowns', value: unresolvedBreakdowns.length, sub: 'Reported incidents', tab: 'breakdowns', icon: 'alert', color: 'red', bg: 'bg-red-500/10', border: 'border-red-200', text: 'text-red-700' },
    { label: 'Under appeal', value: underAppealCount, sub: 'Reinstatement requests', tab: 'contractor_block', icon: 'ban', color: 'violet', bg: 'bg-violet-500/10', border: 'border-violet-200', text: 'text-violet-700' },
    { label: 'Compliance pending', value: pendingCompliance, sub: 'Inspections / response due', tab: 'compliance', icon: 'shield', color: 'blue', bg: 'bg-blue-500/10', border: 'border-blue-200', text: 'text-blue-700' },
    { label: 'Report requests', value: pendingRequestsCount, sub: 'Awaiting approval', tab: 'requests', icon: 'inbox', color: 'emerald', bg: 'bg-emerald-500/10', border: 'border-emerald-200', text: 'text-emerald-700' },
  ].filter(Boolean);

  const quickActions = [
    canSeeTab?.('reports') && { label: 'Report composition', tab: 'reports', desc: 'Create shift reports' },
    canSeeTab?.('saved_reports') && { label: 'Saved shift reports', tab: 'saved_reports', desc: 'View and approve reports' },
    canSeeTab?.('compliance') && { label: 'Fleet & driver compliance', tab: 'compliance', desc: 'Run inspections' },
    canSeeTab?.('inspected') && { label: 'Inspected trucks & drivers', tab: 'inspected', desc: 'Review inspection records' },
    canSeeTab?.('breakdowns') && { label: 'Reported breakdowns', tab: 'breakdowns', desc: 'Incidents and resolutions' },
    canSeeTab?.('applications') && { label: 'Fleet & driver applications', tab: 'applications', desc: 'Approve or decline' },
    canSeeTab?.('contractor_block') && { label: 'Contractor block', tab: 'contractor_block', desc: 'Suspend / reinstate' },
    canSeeTab?.('trends') && { label: 'Trends', tab: 'trends', desc: 'Analytics' },
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-surface-900">Main dashboard</h1>

      <div className="space-y-6">
        {/* KPI cards */}
        <section>
          <h2 className="text-sm font-semibold text-surface-500 uppercase tracking-wider mb-3">Live metrics</h2>
          {loading ? (
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="bg-white rounded-xl border border-surface-200 p-5 h-28 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
              {kpiCards.map((k) => (
                <button
                  key={k.tab}
                  type="button"
                  onClick={() => setActiveTab?.(k.tab)}
                  className={`text-left bg-white rounded-xl border ${k.border} p-5 shadow-sm hover:shadow-md hover:border-surface-300 transition-all duration-200 group`}
                >
                  <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">{k.label}</p>
                  <p className="mt-2 text-3xl font-bold text-surface-900 tabular-nums">{k.value}</p>
                  <p className="text-sm text-surface-500 mt-0.5">{k.sub}</p>
                  <span className="inline-block mt-2 text-xs font-medium text-brand-600 group-hover:text-brand-700">View →</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Quick actions */}
        <section>
          <h2 className="text-sm font-semibold text-surface-500 uppercase tracking-wider mb-3">Quick actions</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {quickActions.map((a) => (
              <button
                key={a.tab}
                type="button"
                onClick={() => setActiveTab?.(a.tab)}
                className="flex items-center gap-4 bg-white rounded-xl border border-surface-200 p-4 text-left shadow-sm hover:shadow-md hover:border-brand-200 hover:bg-brand-50/30 transition-all duration-200 group"
              >
                <div className="w-10 h-10 rounded-lg bg-brand-100 text-brand-600 flex items-center justify-center shrink-0 group-hover:bg-brand-200">
                  <CCIcon name={a.tab === 'reports' ? 'file' : a.tab === 'saved_reports' ? 'folder' : a.tab === 'compliance' ? 'shield' : a.tab === 'inspected' ? 'clipboard' : a.tab === 'breakdowns' ? 'alert' : a.tab === 'applications' ? 'tick' : a.tab === 'contractor_block' ? 'ban' : 'chart'} className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-surface-900 group-hover:text-brand-700">{a.label}</p>
                  <p className="text-xs text-surface-500 truncate">{a.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Two-column: Recent breakdowns + Activity */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Recent unresolved breakdowns */}
          <section className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-100 bg-surface-50/80 flex items-center justify-between">
              <h2 className="font-semibold text-surface-900">Recent unresolved breakdowns</h2>
              {recentBreakdowns.length > 0 && (
                <button type="button" onClick={() => setActiveTab?.('breakdowns')} className="text-sm font-medium text-brand-600 hover:text-brand-700">View all</button>
              )}
            </div>
            <div className="divide-y divide-surface-100">
              {loading ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-surface-100 rounded animate-pulse" />)}
                </div>
              ) : recentBreakdowns.length === 0 ? (
                <div className="p-8 text-center text-surface-500 text-sm">No unresolved breakdowns</div>
              ) : (
                recentBreakdowns.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setActiveTab?.('breakdowns')}
                    className="w-full px-4 py-3 text-left hover:bg-surface-50/80 transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-surface-900 truncate">{b.title || b.type || 'Breakdown'}</p>
                      <p className="text-xs text-surface-500">{b.truck_registration || b.driver_name || '—'} · {formatDashboardTime(b.reported_at)}</p>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${(b.severity || '').toLowerCase() === 'critical' ? 'bg-red-100 text-red-800' : (b.severity || '').toLowerCase() === 'high' ? 'bg-amber-100 text-amber-800' : 'bg-surface-100 text-surface-600'}`}>
                      {b.severity || '—'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          {/* Compliance & alerts */}
          <section className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-100 bg-surface-50/80 flex items-center justify-between">
              <h2 className="font-semibold text-surface-900">Compliance & alerts</h2>
              {pendingCompliance > 0 && (
                <button type="button" onClick={() => setActiveTab?.('compliance')} className="text-sm font-medium text-brand-600 hover:text-brand-700">Open compliance</button>
              )}
            </div>
            <div className="p-4 space-y-3">
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-surface-100 rounded-lg animate-pulse" />)}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-lg bg-surface-50 border border-surface-100 p-3">
                    <span className="text-sm font-medium text-surface-700">Inspections needing response</span>
                    <span className="text-lg font-bold text-surface-900 tabular-nums">{pendingCompliance}</span>
                  </div>
                  {underAppealCount > 0 && (
                    <div className="flex items-center justify-between rounded-lg bg-violet-50 border border-violet-100 p-3">
                      <span className="text-sm font-medium text-violet-800">Reinstatement requests</span>
                      <span className="text-lg font-bold text-violet-900 tabular-nums">{underAppealCount}</span>
                    </div>
                  )}
                  {pendingRequestsCount > 0 && (
                    <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-100 p-3">
                      <span className="text-sm font-medium text-amber-800">Shift report requests</span>
                      <span className="text-lg font-bold text-amber-900 tabular-nums">{pendingRequestsCount}</span>
                    </div>
                  )}
                  {pendingApplications > 0 && canSeeTab?.('applications') && (
                    <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-100 p-3">
                      <span className="text-sm font-medium text-emerald-800">Fleet & driver applications</span>
                      <span className="text-lg font-bold text-emerald-900 tabular-nums">{pendingApplications}</span>
                    </div>
                  )}
                  {!loading && pendingCompliance === 0 && underAppealCount === 0 && pendingRequestsCount === 0 && (pendingApplications === 0 || !canSeeTab?.('applications')) && (
                    <p className="text-sm text-surface-500 py-2">No pending alerts</p>
                  )}
                </>
              )}
            </div>
          </section>
        </div>

        {/* Unresolved breakdowns by severity */}
        {!loading && unresolvedBreakdowns.length > 0 && (
          <section className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-100 bg-surface-50/80">
              <h2 className="font-semibold text-surface-900">Unresolved breakdowns by severity</h2>
            </div>
            <div className="p-4 flex flex-wrap gap-4 items-center">
              {['Critical', 'High', 'Medium', 'Low'].map((sev) => {
                const count = unresolvedBreakdowns.filter((b) => (b.severity || '').trim().toLowerCase() === sev.toLowerCase()).length;
                const total = unresolvedBreakdowns.length;
                const pct = total ? Math.round((count / total) * 100) : 0;
                const bg = sev === 'Critical' ? 'bg-red-500' : sev === 'High' ? 'bg-amber-500' : sev === 'Medium' ? 'bg-blue-500' : 'bg-surface-300';
                return (
                  <div key={sev} className="flex items-center gap-3 min-w-[140px]">
                    <div className="flex-1 h-2 bg-surface-100 rounded-full overflow-hidden">
                      <div className={`h-full ${bg} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-sm font-medium text-surface-700 tabular-nums">{count}</span>
                    <span className="text-xs text-surface-500">{sev}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* System status strip */}
        <div className="flex flex-wrap items-center gap-4 py-3 px-4 rounded-xl bg-surface-50 border border-surface-100 text-sm">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-surface-600">Command Centre online</span>
          </span>
          <span className="text-surface-400">|</span>
          <span className="text-surface-600">Breakdowns: {unresolvedBreakdowns.length} unresolved</span>
          <span className="text-surface-400">|</span>
          <span className="text-surface-600">Inspections: {inspections.length} total</span>
        </div>
      </div>
    </div>
  );
}

function formatDateShort(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

const INCIDENT_ATTACHMENT_LABELS = [
  { type: 'loading_slip', label: 'Loading slip', pathKey: 'loading_slip_path' },
  { type: 'seal_1', label: 'Seal 1', pathKey: 'seal_1_path' },
  { type: 'seal_2', label: 'Seal 2', pathKey: 'seal_2_path' },
  { type: 'picture_problem', label: 'Picture of the problem', pathKey: 'picture_problem_path' },
];

const BREAKDOWN_TYPES = ['Breakdown', 'Accident', 'Load spill', 'Delay', 'Other incident'];
const BREAKDOWN_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];

function breakdownRef(id) {
  return 'INC-' + String(id).replace(/-/g, '').slice(0, 8).toUpperCase();
}

function breakdownTypeLabel(type) {
  if (!type) return 'Incident';
  const n = String(type).trim().toLowerCase().replace(/\s+/g, '_');
  const found = BREAKDOWN_TYPES.find((t) => t.toLowerCase().replace(/\s+/g, '_') === n);
  return found || type.replace(/_/g, ' ');
}

function TabBreakdowns() {
  const [breakdowns, setBreakdowns] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterResolved, setFilterResolved] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterTenantId, setFilterTenantId] = useState('');
  const [selectedBreakdown, setSelectedBreakdown] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resolveModal, setResolveModal] = useState(null);
  const [notifyRectorModal, setNotifyRectorModal] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const buildParams = () => {
    const p = {};
    if (filterResolved !== '') p.resolved = filterResolved;
    if (filterDateFrom) p.dateFrom = filterDateFrom;
    if (filterDateTo) p.dateTo = filterDateTo;
    if (filterType) p.type = filterType;
    if (filterSeverity) p.severity = filterSeverity;
    if (filterTenantId) p.tenantId = filterTenantId;
    return p;
  };

  const loadList = () => {
    setLoading(true);
    setError('');
    ccApi.breakdowns
      .list(buildParams())
      .then((r) => setBreakdowns(r.breakdowns || []))
      .catch((e) => setError(e?.message || 'Failed to load breakdowns'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    ccApi.breakdowns.tenants().then((r) => setTenants(r.tenants || [])).catch(() => setTenants([])).finally(() => setTenantsLoading(false));
  }, []);

  useEffect(() => loadList(), [filterResolved, filterDateFrom, filterDateTo, filterType, filterSeverity, filterTenantId]);

  const openView = (b) => {
    setSelectedBreakdown(null);
    setDetailLoading(true);
    ccApi.breakdowns
      .get(b.id)
      .then((r) => setSelectedBreakdown(r.breakdown))
      .catch((e) => setError(e?.message || 'Failed to load breakdown'))
      .finally(() => setDetailLoading(false));
  };

  const viewAttachment = (type) => {
    if (!selectedBreakdown?.id) return;
    openAttachmentWithAuth(ccApi.breakdowns.attachmentUrl(selectedBreakdown.id, type)).catch((e) => window.alert(e?.message || 'Could not open attachment'));
  };

  const handleResolveSubmit = () => {
    if (!resolveModal?.breakdown?.id || !(resolveModal.resolutionNote || '').trim()) return;
    const note = resolveModal.resolutionNote.trim();
    ccApi.breakdowns
      .resolve(resolveModal.breakdown.id, note)
      .then(() => {
        setResolveModal(null);
        loadList();
        if (selectedBreakdown?.id === resolveModal.breakdown.id) {
          ccApi.breakdowns.get(resolveModal.breakdown.id).then((r) => setSelectedBreakdown(r.breakdown));
        }
      })
      .catch((e) => setError(e?.message || 'Failed to resolve'));
  };

  const openNotifyRectorModal = () => {
    if (!selectedBreakdown?.id) return;
    setNotifyRectorModal({ breakdown: selectedBreakdown, rectors: [], selectedIds: new Set(), loading: true, submitting: false });
    ccApi.rectorsWithRoutes()
      .then((r) => setNotifyRectorModal((m) => ({ ...m, rectors: r.rectors || [], loading: false })))
      .catch((e) => {
        setError(e?.message || 'Failed to load rectors');
        setNotifyRectorModal((m) => (m ? { ...m, loading: false } : null));
      });
  };

  const toggleNotifyRectorSelection = (userId) => {
    setNotifyRectorModal((m) => {
      if (!m) return m;
      const next = new Set(m.selectedIds);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return { ...m, selectedIds: next };
    });
  };

  const handleNotifyRectorSubmit = () => {
    if (!notifyRectorModal?.breakdown?.id || notifyRectorModal.selectedIds.size === 0) return;
    const breakdownId = notifyRectorModal.breakdown.id;
    const rectorIds = Array.from(notifyRectorModal.selectedIds);
    setNotifyRectorModal((m) => (m ? { ...m, submitting: true } : m));
    ccApi.breakdowns
      .notifyRector(breakdownId, rectorIds)
      .then(() => {
        setNotifyRectorModal(null);
        return ccApi.breakdowns.get(breakdownId).then((r) => setSelectedBreakdown(r.breakdown));
      })
      .catch((e) => setError(e?.message || 'Failed to notify rector'))
      .finally(() => setNotifyRectorModal((m) => (m ? { ...m, submitting: false } : null)));
  };

  const downloadPdf = async (b) => {
    setDownloadingPdf(true);
    setError('');
    try {
      const detail = b.id === selectedBreakdown?.id ? selectedBreakdown : await ccApi.breakdowns.get(b.id).then((r) => r.breakdown);
      const ref = breakdownRef(b.id);
      const truckName = detail.truck_registration || '—';
      const driverName = detail.driver_name || '—';
      const routeName = detail.route_name || null;
      const typeLabel = breakdownTypeLabel(detail.type);
      const attachmentLabels = INCIDENT_ATTACHMENT_LABELS.filter((a) => detail[a.pathKey]).map((a) => a.label);
      if (detail.offloading_slip_path) attachmentLabels.push('Offloading slip');
      const tenantId = detail.tenant_id;
      let logoDataUrl = null;
      try {
        if (tenantId) {
          const blob = await fetch(tenantsApi.logoUrl(tenantId), { credentials: 'include' }).then((r) => (r.ok ? r.blob() : null));
          if (blob) logoDataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
        }
        if (!logoDataUrl) {
          const blob = await fetch('/logos/tihlo-logo.png', { credentials: 'include' }).then((r) => (r.ok ? r.blob() : null));
          if (blob) logoDataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
        }
      } catch (_) {}
      const attachmentImages = [];
      for (const { type, pathKey } of INCIDENT_ATTACHMENT_LABELS) {
        if (!detail[pathKey]) continue;
        try {
          const blob = await fetch(ccApi.breakdowns.attachmentUrl(b.id, type), { credentials: 'include' }).then((r) => (r.ok ? r.blob() : null));
          if (blob && blob.type && blob.type.startsWith('image/')) {
            const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
            attachmentImages.push({ label: INCIDENT_ATTACHMENT_LABELS.find((a) => a.type === type)?.label || type, dataUrl });
          }
        } catch (_) {}
      }
      const doc = generateBreakdownPdf({
        incident: detail,
        ref,
        truckName,
        driverName,
        typeLabel,
        routeName,
        attachmentLabels,
        attachmentImages,
        formatDateTime,
        formatDate: formatDateShort,
        logoDataUrl: logoDataUrl || undefined,
      });
      doc.save(`${ref}-report.pdf`);
    } catch (e) {
      setError(e?.message || 'Failed to generate PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const getDetailPath = (row, pathKey) => {
    if (!row) return null;
    const v = row[pathKey] ?? row[pathKey.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
    return v != null && v !== '' ? v : null;
  };

  return (
    <div className="space-y-4">
      {/* Sticky: page heading + filters (do not move when user scrolls) */}
      <div className="sticky top-0 z-10 bg-surface-50 -mx-4 -mt-4 px-4 pt-4 pb-4 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6 sm:pb-4 border-b border-surface-200 space-y-4">
        <div>
          <h2 className="text-xl font-bold text-surface-900 tracking-tight">Reported breakdowns</h2>
          <p className="text-sm text-surface-600 mt-0.5">View all reported breakdowns. Click a row to open details in the side panel. Resolve with resolution notes; rector, driver and contractor are notified by email.</p>
        </div>
        {error && <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 px-4 py-2 text-sm">{error}</div>}

        <div className="rounded-xl border border-surface-200 bg-white p-4">
          <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3">Filters</p>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Status</label>
              <select value={filterResolved} onChange={(e) => setFilterResolved(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[100px]">
                <option value="">All</option>
                <option value="0">Open</option>
                <option value="1">Resolved</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Date from</label>
              <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Date to</label>
              <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Type</label>
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[140px]">
                <option value="">All types</option>
                {BREAKDOWN_TYPES.map((t) => (
                  <option key={t} value={t.toLowerCase().replace(/\s+/g, '_')}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Severity</label>
              <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[100px]">
                <option value="">All</option>
                {BREAKDOWN_SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Contractor</label>
              <select value={filterTenantId} onChange={(e) => setFilterTenantId(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[160px]" disabled={tenantsLoading}>
                <option value="">All contractors</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name || t.id}</option>
                ))}
              </select>
            </div>
            <button type="button" onClick={() => { setFilterResolved(''); setFilterDateFrom(''); setFilterDateTo(''); setFilterType(''); setFilterSeverity(''); setFilterTenantId(''); }} className="text-sm text-surface-600 hover:text-surface-900 py-2">Clear filters</button>
          </div>
        </div>
      </div>

      {/* List (Contractor-style: clickable rows) – scrolls under sticky header */}
      <div className="rounded-xl border border-surface-200 bg-white p-4">
        <p className="text-xs text-surface-500 mb-2">Click a breakdown to view full details and attachments in the side panel.</p>
        {loading ? (
          <p className="text-surface-500 py-4">Loading…</p>
        ) : !breakdowns?.length ? (
          <div className="py-8 text-center text-surface-500">No breakdowns found.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {breakdowns.map((b) => (
              <li
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => openView(b)}
                onKeyDown={(e) => e.key === 'Enter' && openView(b)}
                className={`py-2.5 px-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedBreakdown?.id === b.id ? 'border-brand-300 bg-brand-50' : 'border-transparent hover:bg-surface-50'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-surface-500">{breakdownRef(b.id)}</span>
                  <span className="font-medium text-surface-900">{b.title || breakdownTypeLabel(b.type)}</span>
                  {b.type && <span className="text-xs px-1.5 py-0.5 rounded bg-surface-200 text-surface-600">{breakdownTypeLabel(b.type)}</span>}
                  {b.severity && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{b.severity}</span>}
                  {b.resolved_at ? <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800">Resolved</span> : <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Open</span>}
                </div>
                <p className="text-surface-500 text-xs mt-1">
                  {formatDateTime(b.reported_at)}
                  {b.tenant_name && ` · ${b.tenant_name}`}
                  {b.truck_registration && ` · ${b.truck_registration}`}
                  {b.driver_name && ` · ${b.driver_name}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Side panel (Contractor-style: slides from right, full detail + attachments) */}
      {selectedBreakdown && (
        <div className="fixed inset-0 z-50 flex items-stretch" aria-modal="true" role="dialog" aria-label="Breakdown details">
          <button type="button" onClick={() => setSelectedBreakdown(null)} className="absolute inset-0 bg-black/40" aria-label="Close" />
          <div className="relative w-full max-w-xl ml-auto bg-white shadow-xl flex flex-col max-h-full overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200">
              <h3 className="font-semibold text-surface-900">Breakdown details <span className="font-mono text-surface-500 font-normal">({breakdownRef(selectedBreakdown.id)})</span></h3>
              <button type="button" onClick={() => setSelectedBreakdown(null)} className="p-2 rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Close">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {detailLoading ? (
                <div className="flex items-center justify-center py-12 text-surface-500">
                  <span className="inline-block w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mr-2" aria-hidden /> Loading…
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Title</p>
                    <p className="text-surface-900 font-medium mt-0.5">{selectedBreakdown.title || '—'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center px-2 py-1 rounded-md bg-surface-100 text-surface-700 text-xs font-medium">{breakdownTypeLabel(selectedBreakdown.type)}</span>
                    {selectedBreakdown.severity && <span className="inline-flex items-center px-2 py-1 rounded-md bg-amber-100 text-amber-800 text-xs font-medium">{selectedBreakdown.severity}</span>}
                    {selectedBreakdown.resolved_at ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-md bg-green-100 text-green-800 text-xs font-medium">Resolved {formatDateShort(selectedBreakdown.resolved_at)}</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-md bg-amber-100 text-amber-800 text-xs font-medium">Open</span>
                    )}
                  </div>
                  <div><p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Reported</p><p className="text-surface-700 text-sm mt-0.5">{formatDateTime(selectedBreakdown.reported_at)}</p></div>
                  <div><p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Contractor</p><p className="text-surface-700 text-sm mt-0.5">{selectedBreakdown.tenant_name || '—'}</p></div>
                  <div><p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Truck</p><p className="text-surface-700 text-sm mt-0.5">{selectedBreakdown.truck_registration || '—'}</p></div>
                  <div><p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Driver</p><p className="text-surface-700 text-sm mt-0.5">{selectedBreakdown.driver_name || '—'}</p></div>
                  <div><p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Route</p><p className="text-surface-700 text-sm mt-0.5">{selectedBreakdown.route_name || '—'}</p></div>
                  <div><p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Location</p><p className="text-surface-700 text-sm mt-0.5">{selectedBreakdown.location || '—'}</p></div>
                  <div><p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Description</p><p className="text-surface-700 text-sm mt-0.5 whitespace-pre-wrap">{selectedBreakdown.description || '—'}</p></div>
                  <div><p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Actions taken</p><p className="text-surface-700 text-sm mt-0.5 whitespace-pre-wrap">{selectedBreakdown.actions_taken || '—'}</p></div>

                  {(selectedBreakdown.rector_was_notified === false || !selectedBreakdown.route_id) && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 space-y-2">
                      <p className="text-sm font-medium text-amber-800">
                        {selectedBreakdown.route_id ? 'The rector was not notified' : 'No route linked to this breakdown'}
                      </p>
                      <p className="text-xs text-amber-700">
                        {selectedBreakdown.route_id
                          ? 'Only rectors for this route are notified when reporting or resolving. Would you like to notify the rector? Select the correct rector below and send them the breakdown report by email.'
                          : 'Rectors are only notified when a breakdown is linked to a route. Select the relevant rector(s) below to send them the breakdown report by email.'}
                      </p>
                      <button type="button" onClick={openNotifyRectorModal} className="mt-1 px-3 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700">Notify rector</button>
                    </div>
                  )}

                  {selectedBreakdown.resolved_at && (
                    <div className="rounded-lg border border-green-200 bg-green-50/50 p-3 space-y-2">
                      <p className="text-xs font-medium text-surface-600 uppercase tracking-wider">Resolution</p>
                      <p className="text-surface-600 text-xs">Resolved at {formatDateTime(selectedBreakdown.resolved_at)}</p>
                      <p className="text-surface-700 text-sm whitespace-pre-wrap">{selectedBreakdown.resolution_note || '—'}</p>
                      {getDetailPath(selectedBreakdown, 'offloading_slip_path') && (
                        <div className="flex items-center justify-between gap-2 pt-2">
                          <span className="text-sm text-surface-700">Offloading slip</span>
                          <button type="button" onClick={() => viewAttachment('offloading_slip')} className="text-xs px-2.5 py-1.5 rounded-md border border-surface-200 text-surface-700 hover:bg-surface-100">View</button>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">Attachments</p>
                    <div className="space-y-2">
                      {INCIDENT_ATTACHMENT_LABELS.map(({ type, label, pathKey }) =>
                        getDetailPath(selectedBreakdown, pathKey) ? (
                          <div key={type} className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-surface-50 border border-surface-100">
                            <span className="text-sm text-surface-700">{label}</span>
                            <button type="button" onClick={() => viewAttachment(type)} className="text-xs px-2.5 py-1.5 rounded-md border border-surface-200 text-surface-700 hover:bg-surface-100">View</button>
                          </div>
                        ) : (
                          <div key={type} className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-50 border border-surface-100">
                            <span className="text-sm text-surface-500">{label}</span>
                            <span className="text-xs text-surface-400">Not uploaded</span>
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 pt-2 border-t border-surface-200">
                    {!selectedBreakdown.resolved_at && (
                      <button type="button" onClick={() => { setResolveModal({ breakdown: selectedBreakdown, resolutionNote: '' }); }} className="w-full py-2.5 px-4 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700">Resolve</button>
                    )}
                    <button type="button" onClick={() => downloadPdf(selectedBreakdown)} disabled={downloadingPdf} className="w-full py-2.5 px-4 text-sm font-medium rounded-lg border border-brand-200 text-brand-700 hover:bg-brand-50 disabled:opacity-50">Download PDF report</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Resolve modal */}
      {resolveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setResolveModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-surface-900 mb-2">Resolve breakdown</h3>
            <p className="text-sm text-surface-600 mb-3">{breakdownRef(resolveModal.breakdown?.id)} – {resolveModal.breakdown?.title || 'Incident'}. Resolution notes are required. Only rectors for this breakdown’s route (if any), plus driver and contractor, will be notified by email. If no route is linked, use “Notify rector” after saving to select who to notify.</p>
            <label className="block text-sm font-medium text-surface-700 mb-1">Resolution notes *</label>
            <textarea value={resolveModal.resolutionNote} onChange={(e) => setResolveModal((m) => ({ ...m, resolutionNote: e.target.value }))} placeholder="Enter resolution details…" rows={4} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setResolveModal(null)} className="px-3 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm font-medium hover:bg-surface-50">Cancel</button>
              <button type="button" onClick={handleResolveSubmit} disabled={!(resolveModal.resolutionNote || '').trim()} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">Save & notify</button>
            </div>
          </div>
        </div>
      )}

      {/* Notify rector modal – when rector was not notified at report time */}
      {notifyRectorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !notifyRectorModal.submitting && setNotifyRectorModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-surface-200">
              <h3 className="font-semibold text-surface-900">Notify rector about this breakdown</h3>
              <p className="text-sm text-surface-600 mt-1">{breakdownRef(notifyRectorModal.breakdown?.id)} – {notifyRectorModal.breakdown?.title || 'Breakdown'}. Select the rector(s) to receive the same breakdown report by email.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {notifyRectorModal.loading ? (
                <div className="flex items-center justify-center py-8 text-surface-500"><span className="inline-block w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mr-2" aria-hidden /> Loading rectors…</div>
              ) : notifyRectorModal.rectors.length === 0 ? (
                <p className="text-sm text-surface-500 py-4">No rectors (route contacts) are set up. Add rectors in Access Management → Route factors.</p>
              ) : (
                <div className="space-y-3">
                  {notifyRectorModal.rectors.map((r) => (
                    <label key={r.id} className="flex items-start gap-3 p-3 rounded-lg border border-surface-200 hover:bg-surface-50 cursor-pointer">
                      <input type="checkbox" checked={notifyRectorModal.selectedIds.has(r.id)} onChange={() => toggleNotifyRectorSelection(r.id)} className="mt-1 rounded border-surface-300" />
                      <div className="min-w-0">
                        <span className="font-medium text-surface-900">{r.full_name || r.email || r.id}</span>
                        {r.route_name && <span className="block text-xs text-surface-500">Route: {r.route_name}</span>}
                        {r.email && <span className="block text-xs text-surface-500 truncate">{r.email}</span>}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-surface-200 flex gap-2 justify-end">
              <button type="button" onClick={() => setNotifyRectorModal(null)} disabled={notifyRectorModal.submitting} className="px-3 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm font-medium hover:bg-surface-50 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={handleNotifyRectorSubmit} disabled={notifyRectorModal.selectedIds.size === 0 || notifyRectorModal.submitting} className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50">
                {notifyRectorModal.submitting ? 'Sending…' : `Send email to ${notifyRectorModal.selectedIds.size} rector${notifyRectorModal.selectedIds.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabContractorsDetails({ list, loading }) {
  const [search, setSearch] = useState('');
  const [hasSubcontractorsFilter, setHasSubcontractorsFilter] = useState('all'); // 'all' | 'yes' | 'no'
  const [selectedContractor, setSelectedContractor] = useState(null); // full contractor object
  const [selectedSubcontractor, setSelectedSubcontractor] = useState(null); // subcontractor row when viewing from detail panel

  const filtered = (list || []).filter((c) => {
    const q = (search || '').toLowerCase().trim();
    if (q) {
      const tenantName = (c.tenantName || '').toLowerCase();
      const company = (c.info?.companyName || '').toLowerCase();
      const cipc = (c.info?.cipcRegistrationNumber || '').toLowerCase();
      const admin = (c.info?.adminName || '').toLowerCase();
      if (!tenantName.includes(q) && !company.includes(q) && !cipc.includes(q) && !admin.includes(q)) return false;
    }
    if (hasSubcontractorsFilter === 'yes' && (!c.subcontractors || c.subcontractors.length === 0)) return false;
    if (hasSubcontractorsFilter === 'no' && c.subcontractors && c.subcontractors.length > 0) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Sticky: page heading + filters */}
      <div className="sticky top-0 z-10 bg-surface-50 -mx-4 -mt-4 px-4 pt-4 pb-4 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6 sm:pb-4 border-b border-surface-200 space-y-4">
        <div>
          <h2 className="text-xl font-bold text-surface-900 tracking-tight">Contractors details</h2>
          <p className="text-sm text-surface-600 mt-0.5">Click a row to open full details.</p>
        </div>
        {!loading && list.length > 0 && (
          <div className="flex flex-wrap gap-3 items-center">
            <input
              type="text"
              placeholder="Search tenant, company, CIPC, admin…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-72 max-w-full"
            />
            <select
              value={hasSubcontractorsFilter}
              onChange={(e) => setHasSubcontractorsFilter(e.target.value)}
              className="rounded-lg border border-surface-300 px-3 py-2 text-sm"
            >
              <option value="all">All contractors</option>
              <option value="yes">Has subcontractors</option>
              <option value="no">No subcontractors</option>
            </select>
            {(search || hasSubcontractorsFilter !== 'all') && (
              <button type="button" onClick={() => { setSearch(''); setHasSubcontractorsFilter('all'); }} className="text-sm text-surface-600 hover:text-surface-900">Clear filters</button>
            )}
            <span className="text-surface-500 text-sm ml-auto">{filtered.length} of {list.length} contractor(s)</span>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-surface-500">Loading…</p>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-surface-200 bg-surface-50 p-6 text-center text-surface-600">
          <p>No contractor data on file. Contractors appear here once they have added trucks or filled in contractor details.</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-surface-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-50 border-b border-surface-200">
                  <tr className="text-left text-surface-600">
                    <th className="p-3 font-medium">Tenant / Company</th>
                    <th className="p-3 font-medium">Company name</th>
                    <th className="p-3 font-medium">CIPC</th>
                    <th className="p-3 font-medium">Administrator</th>
                    <th className="p-3 font-medium">Subcontractors</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr
                      key={c.tenantId}
                      onClick={() => { setSelectedContractor(c); setSelectedSubcontractor(null); }}
                      className="border-b border-surface-100 hover:bg-brand-50 cursor-pointer"
                    >
                      <td className="p-3 font-medium">{c.tenantName || `ID ${c.tenantId}`}</td>
                      <td className="p-3">{c.info?.companyName || '—'}</td>
                      <td className="p-3">{c.info?.cipcRegistrationNumber || '—'}</td>
                      <td className="p-3">{c.info?.adminName || '—'}</td>
                      <td className="p-3">{(c.subcontractors || []).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {selectedContractor && (
            <div className="fixed inset-0 z-50 flex justify-end">
              <div className="absolute inset-0 bg-black/30" onClick={() => { setSelectedContractor(null); setSelectedSubcontractor(null); }} aria-hidden />
              <div className="relative w-full max-w-xl bg-white shadow-xl overflow-y-auto flex flex-col max-h-full">
                <div className="sticky top-0 px-4 py-3 border-b border-surface-200 bg-white flex items-center justify-between">
                  <h4 className="font-semibold text-surface-900">{selectedContractor.tenantName || `Contractor ${selectedContractor.tenantId}`}</h4>
                  <button type="button" onClick={() => { setSelectedContractor(null); setSelectedSubcontractor(null); }} className="p-2 text-surface-500 hover:text-surface-800 rounded">✕</button>
                </div>
                <div className="p-4 text-sm space-y-6">
                  <div>
                    <h5 className="font-medium text-surface-800 mb-2">Contractor (company) details</h5>
                    {!selectedContractor.info ? (
                      <p className="text-surface-500">No details on file.</p>
                    ) : (
                      <div className="grid gap-3">
                        <div><span className="text-surface-500 block text-xs">Company</span><p className="font-medium">{selectedContractor.info.companyName || '—'}</p></div>
                        <div><span className="text-surface-500 block text-xs">CIPC number / date</span><p className="font-medium">{selectedContractor.info.cipcRegistrationNumber || '—'} {selectedContractor.info.cipcRegistrationDate ? ` · ${formatDateShort(selectedContractor.info.cipcRegistrationDate)}` : ''}</p></div>
                        <div><span className="text-surface-500 block text-xs">Administrator</span><p className="font-medium">{selectedContractor.info.adminName || '—'}</p><p className="text-surface-600">{selectedContractor.info.adminEmail || ''} {selectedContractor.info.adminPhone ? ` · ${selectedContractor.info.adminPhone}` : ''}</p></div>
                        <div><span className="text-surface-500 block text-xs">Control room</span><p className="font-medium">{selectedContractor.info.controlRoomContact || '—'}</p><p className="text-surface-600">{selectedContractor.info.controlRoomPhone || ''} {selectedContractor.info.controlRoomEmail ? ` · ${selectedContractor.info.controlRoomEmail}` : ''}</p></div>
                        <div><span className="text-surface-500 block text-xs">Mechanic</span><p className="font-medium">{selectedContractor.info.mechanicName || '—'}</p><p className="text-surface-600">{selectedContractor.info.mechanicPhone || ''} {selectedContractor.info.mechanicEmail ? ` · ${selectedContractor.info.mechanicEmail}` : ''}</p></div>
                        <div><span className="text-surface-500 block text-xs">Emergency 1</span><p className="font-medium">{selectedContractor.info.emergencyContact1Name || '—'} {selectedContractor.info.emergencyContact1Phone ? ` · ${selectedContractor.info.emergencyContact1Phone}` : ''}</p></div>
                        <div><span className="text-surface-500 block text-xs">Emergency 2</span><p className="font-medium">{selectedContractor.info.emergencyContact2Name || '—'} {selectedContractor.info.emergencyContact2Phone ? ` · ${selectedContractor.info.emergencyContact2Phone}` : ''}</p></div>
                        <div><span className="text-surface-500 block text-xs">Emergency 3</span><p className="font-medium">{selectedContractor.info.emergencyContact3Name || '—'} {selectedContractor.info.emergencyContact3Phone ? ` · ${selectedContractor.info.emergencyContact3Phone}` : ''}</p></div>
                      </div>
                    )}
                  </div>
                  <div>
                    <h5 className="font-medium text-surface-800 mb-2">Subcontractors (click row for full details)</h5>
                    {!selectedContractor.subcontractors || selectedContractor.subcontractors.length === 0 ? (
                      <p className="text-surface-500">None on file.</p>
                    ) : (
                      <div className="overflow-x-auto border border-surface-200 rounded-lg">
                        <table className="w-full text-sm">
                          <thead><tr className="text-left text-surface-600 bg-surface-50 border-b"><th className="p-2">Company</th><th className="p-2">Contact</th></tr></thead>
                          <tbody>
                            {(selectedContractor.subcontractors || []).map((s) => (
                              <tr
                                key={s.id}
                                onClick={(e) => { e.stopPropagation(); setSelectedSubcontractor(selectedSubcontractor?.id === s.id ? null : s); }}
                                className={`border-b border-surface-100 cursor-pointer ${selectedSubcontractor?.id === s.id ? 'bg-brand-50' : 'hover:bg-surface-50'}`}
                              >
                                <td className="p-2 font-medium">{s.company_name || '—'}</td>
                                <td className="p-2">{s.contact_person || '—'} {s.contact_phone ? ` · ${s.contact_phone}` : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                  {selectedSubcontractor && (
                    <div className="p-3 rounded-lg border border-surface-200 bg-surface-50">
                      <h6 className="font-medium text-surface-800 mb-2">Subcontractor: {selectedSubcontractor.company_name || '—'}</h6>
                      <div className="grid gap-2 text-sm">
                        <p><span className="text-surface-500">Contact:</span> {selectedSubcontractor.contact_person || '—'} {selectedSubcontractor.contact_phone ? ` · ${selectedSubcontractor.contact_phone}` : ''} {selectedSubcontractor.contact_email ? ` · ${selectedSubcontractor.contact_email}` : ''}</p>
                        <p><span className="text-surface-500">Control room:</span> {selectedSubcontractor.control_room_contact || '—'} {selectedSubcontractor.control_room_phone ? ` · ${selectedSubcontractor.control_room_phone}` : ''}</p>
                        <p><span className="text-surface-500">Mechanic:</span> {selectedSubcontractor.mechanic_name || '—'} {selectedSubcontractor.mechanic_phone ? ` · ${selectedSubcontractor.mechanic_phone}` : ''}</p>
                        <p><span className="text-surface-500">Emergency:</span> {selectedSubcontractor.emergency_contact_name || '—'} {selectedSubcontractor.emergency_contact_phone ? ` · ${selectedSubcontractor.emergency_contact_phone}` : ''}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TabReports() {
  const { user } = useAuth();
  const [reportType, setReportType] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [openSection, setOpenSection] = useState('info');

  const reportTypes = [
    { id: 'shift', label: 'Shift report', description: 'Official controller shift documentation for fleet monitoring & logistics' },
    { id: 'investigation', label: 'Investigation report', description: 'Record investigation findings and actions taken' },
    { id: 'performance', label: 'Performance report', description: 'Performance metrics and operational summary' },
  ];

  useEffect(() => {
    if (reportType === 'investigation') setOpenSection('inv_case');
  }, [reportType]);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-900">Report composition</h2>
      <p className="text-sm text-surface-600">Document shifts, investigations and performance. Fleet monitoring & logistics industry standard.</p>
      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        {!reportType ? (
          <div className="p-6 grid gap-4 sm:grid-cols-3">
            {reportTypes.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setReportType(r.id)}
                className="p-5 rounded-xl border-2 border-surface-200 text-left hover:bg-brand-50 hover:border-brand-300 transition-all shadow-sm"
              >
                <span className="font-semibold text-surface-900 block">{r.label}</span>
                <p className="text-sm text-surface-500 mt-1">{r.description}</p>
              </button>
            ))}
          </div>
        ) : reportType === 'shift' ? (
          <ShiftReportForm
            user={user}
            onBack={() => { setReportType(null); setMessage(''); }}
            onSaved={() => { setMessage('Shift report saved. Go to View saved shift reports to submit for approval.'); setReportType(null); }}
            saving={saving}
            setSaving={setSaving}
            message={message}
            setMessage={setMessage}
            openSection={openSection}
            setOpenSection={setOpenSection}
          />
        ) : reportType === 'investigation' ? (
          <InvestigationReportForm
            user={user}
            onBack={() => { setReportType(null); setMessage(''); }}
            onSaved={() => { setMessage('Investigation report saved. Go to View saved shift reports or Library to approve and add to Library.'); setReportType(null); }}
            saving={saving}
            setSaving={setSaving}
            message={message}
            setMessage={setMessage}
            openSection={openSection}
            setOpenSection={setOpenSection}
          />
        ) : (
          <GenericReportForm
            reportType={reportType}
            reportTypes={reportTypes}
            onBack={() => { setReportType(null); setMessage(''); }}
            saving={saving}
            setSaving={setSaving}
            message={message}
            setMessage={setMessage}
          />
        )}
      </div>
    </div>
  );
}

function TabSavedReports() {
  const { user } = useAuth();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [report, setReport] = useState(null);
  const [comments, setComments] = useState([]);
  const [error, setError] = useState('');
  const [submitModal, setSubmitModal] = useState(false);
  const [approvers, setApprovers] = useState([]);
  const [submittingTo, setSubmittingTo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [forceEditMode, setForceEditMode] = useState(false);

  const loadList = () => {
    setLoading(true);
    ccApi.shiftReports.list(false)
      .then((r) => { setReports(r.reports || []); setError(''); })
      .catch((err) => setError(err?.message || 'Failed to load reports'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadList(); }, []);

  useEffect(() => {
    setForceEditMode(false);
    if (!selectedId) { setReport(null); setComments([]); return; }
    ccApi.shiftReports.get(selectedId)
      .then((r) => { setReport(r.report); setComments(r.comments || []); setError(''); })
      .catch((err) => { setError(err?.message || 'Failed to load report'); setReport(null); });
  }, [selectedId]);

  const openSubmitModal = () => {
    setSubmittingTo('');
    ccApi.approvers().then((r) => setApprovers(r.users || [])).catch(() => setApprovers([]));
    setSubmitModal(true);
  };

  const handleSubmitForApproval = () => {
    if (!submittingTo || !selectedId) return;
    setSubmitting(true);
    ccApi.shiftReports.submit(selectedId, submittingTo)
      .then((r) => { setReport(r.report); setSubmitModal(false); setSubmittingTo(''); loadList(); })
      .catch((err) => setError(err?.message || 'Submit failed'))
      .finally(() => setSubmitting(false));
  };

  const normId = (v) => (v != null ? String(v).toLowerCase().trim() : '');
  const isCreator = report && user && (
    (report.created_by_user_id != null && user.id != null && normId(report.created_by_user_id) === normId(user.id)) ||
    (report.created_by_email != null && user.email != null && String(report.created_by_email).toLowerCase().trim() === String(user.email).toLowerCase().trim())
  );
  const canEdit = report && isCreator && ['draft', 'provisional', 'rejected'].includes(String(report.status || '').toLowerCase().trim());
  const canSubmit = report && isCreator && (report.status === 'draft' || report.status === 'rejected');
  const canDownload = report && report.status === 'approved';
  const isApprover = report && user && report.approved_by_user_id != null && normId(report.approved_by_user_id) === normId(user.id);
  const canRevokeApproval = report && report.status === 'approved' && isApprover;
  const showCommentsToCreator = report && isCreator && (report.status === 'provisional' || report.status === 'pending_approval');
  const canMarkAddressed = report && isCreator && report.status === 'provisional';
  const statusAllowsEdit = report && ['draft', 'provisional', 'rejected'].includes(String(report.status || '').toLowerCase().trim());
  const actuallyReadOnly = !statusAllowsEdit;

  if (selectedId && report && String(report.id) === String(selectedId)) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button type="button" onClick={() => { setSelectedId(null); setReport(null); setForceEditMode(false); }} className="text-sm text-surface-600 hover:text-surface-900 font-medium">← Back to list</button>
          <span className="text-xs font-semibold text-surface-500 uppercase">Status: {report.status}</span>
          <div className="flex gap-2">
            {statusAllowsEdit && actuallyReadOnly && (
              <button type="button" onClick={() => setForceEditMode(true)} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700">Edit report</button>
            )}
            {canDownload && (
              <a href="#" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('shift-report-download', { detail: { report, tenantId: user?.tenant_id } })); }} className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700">Download</a>
            )}
            {canRevokeApproval && (
              <button type="button" onClick={() => { setSavingReport(true); ccApi.shiftReports.revokeApproval(selectedId).then((r) => { setReport(r.report); loadList(); setSavingReport(false); }).catch((err) => { setError(err?.message || 'Revoke failed'); setSavingReport(false); }); }} disabled={savingReport} className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">Revoke approval</button>
            )}
            {canSubmit && (
              <button type="button" onClick={openSubmitModal} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700">Submit for approval</button>
            )}
          </div>
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</div>}
        <ShiftReportForm
          key={`${report.id}-${report.updated_at || report.created_at || ''}`}
          user={user}
          initialData={report}
          reportId={report.id}
          readOnly={actuallyReadOnly}
          onBack={() => { setSelectedId(null); setReport(null); }}
          onSaved={(updated) => { setReport(updated); loadList(); setSavingReport(false); setSaveMessage('Saved.'); }}
          onCommentAddressed={() => { ccApi.shiftReports.get(selectedId).then((r) => { setReport(r.report); setComments(r.comments || []); }); loadList(); }}
          saving={savingReport}
          setSaving={setSavingReport}
          message={saveMessage}
          setMessage={setSaveMessage}
          openSection={undefined}
          setOpenSection={undefined}
          comments={comments}
          setComments={setComments}
          showComments={showCommentsToCreator}
          canMarkAddressed={canMarkAddressed}
        />
        {submitModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !submitting && setSubmitModal(false)}>
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-semibold text-surface-900 mb-2">Submit for approval</h3>
              <p className="text-sm text-surface-600 mb-4">Select the controller who will approve this report.</p>
              <select value={submittingTo} onChange={(e) => setSubmittingTo(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-4">
                <option value="">Select controller…</option>
                {approvers.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
              </select>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => !submitting && setSubmitModal(false)} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700">Cancel</button>
                <button type="button" onClick={handleSubmitForApproval} disabled={!submittingTo || submitting} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">{submitting ? 'Submitting…' : 'Submit'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-900">View saved shift reports</h2>
      <p className="text-sm text-surface-600">Open a report to view, edit, submit for approval, or download (when approved).</p>
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</div>}
      {loading ? (
        <p className="text-surface-500">Loading…</p>
      ) : reports.length === 0 ? (
        <div className="rounded-xl border border-surface-200 bg-surface-50 p-8 text-center text-surface-600">No shift reports yet. Create one from Report composition.</div>
      ) : (
        <div className="rounded-xl border border-surface-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-50 border-b border-surface-200">
                <th className="text-left font-semibold text-surface-700 px-4 py-3">Saved date</th>
                <th className="text-left font-semibold text-surface-700 px-4 py-3">Time</th>
                <th className="text-left font-semibold text-surface-700 px-4 py-3">Controller(s)</th>
                <th className="text-left font-semibold text-surface-700 px-4 py-3">Route / Report</th>
                <th className="text-left font-semibold text-surface-700 px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const savedAt = r.created_at ? new Date(r.created_at) : null;
                const dateStr = savedAt ? savedAt.toLocaleDateString() : '—';
                const timeStr = savedAt ? savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
                const controllers = [r.controller1_name, r.controller2_name].filter(Boolean).join(', ') || '—';
                return (
                  <tr key={r.id} className="border-b border-surface-100 last:border-0 hover:bg-surface-50">
                    <td className="px-4 py-3 text-surface-700">{dateStr}</td>
                    <td className="px-4 py-3 text-surface-700">{timeStr}</td>
                    <td className="px-4 py-3 text-surface-700">{controllers}</td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => setSelectedId(r.id)} className="font-medium text-brand-600 hover:text-brand-700 text-left">
                        {r.route || 'Shift report'}
                        {r.report_date ? ` · ${new Date(r.report_date).toLocaleDateString()}` : ''}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'approved' ? 'bg-green-100 text-green-800' : r.status === 'rejected' ? 'bg-red-100 text-red-800' : r.status === 'provisional' ? 'bg-amber-100 text-amber-800' : r.status === 'pending_approval' ? 'bg-blue-100 text-blue-800' : 'bg-surface-100 text-surface-600'}`}>{r.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TabTrends() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [route, setRoute] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [routeOptions, setRouteOptions] = useState([]);

  const loadTrends = () => {
    setLoading(true);
    setError('');
    ccApi.trends({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, route: route || undefined })
      .then((r) => {
        setData(r);
        if (r?.byRoute?.length) setRouteOptions(r.byRoute.map((x) => x.route));
      })
      .catch((e) => { setError(e?.message || 'Failed to load trends'); setData(null); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTrends(); }, [dateFrom, dateTo, route]);

  const summary = data?.summary || {};
  const timeSeries = data?.timeSeries || [];
  const byRoute = data?.byRoute || [];
  const insights = data?.insights || [];
  const maxDelivered = Math.max(1, ...timeSeries.map((d) => d.loads_delivered || 0));
  const maxReports = Math.max(1, ...byRoute.map((r) => r.report_count));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-surface-900 tracking-tight">Shift report trends</h2>
        <p className="text-sm text-surface-600 mt-1">Analytics and insights from approved shift reports. Study what is happening across shifts without opening every report. Data updates as new reports are approved.</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Route</label>
          <select value={route} onChange={(e) => setRoute(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[160px]">
            <option value="">All routes</option>
            {routeOptions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={loadTrends} disabled={loading} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Apply</button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 flex justify-between items-center">
          {error}
          <button type="button" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      {loading ? (
        <p className="text-surface-500 py-8">Loading trends…</p>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Shift reports</p>
              <p className="text-2xl font-bold text-surface-900 mt-1">{summary.report_count ?? 0}</p>
            </div>
            <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Loads delivered</p>
              <p className="text-2xl font-bold text-surface-900 mt-1">{summary.total_loads_delivered ?? 0}</p>
            </div>
            <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Incidents</p>
              <p className="text-2xl font-bold text-surface-900 mt-1">{summary.total_incidents ?? 0}</p>
            </div>
            <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Avg loads/report</p>
              <p className="text-2xl font-bold text-surface-900 mt-1">{summary.avg_loads_delivered_per_report ?? 0}</p>
            </div>
          </div>

          {timeSeries.length > 0 && (
            <section className="rounded-2xl border border-surface-200 bg-white p-6 shadow-sm">
              <h3 className="font-semibold text-surface-900 mb-4">Loads delivered over time</h3>
              <div className="flex items-end gap-1 h-48">
                {timeSeries.map((d) => (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.loads_delivered || 0}`}>
                    <div className="w-full flex flex-col justify-end flex-1 min-h-[4px]">
                      <div className="w-full bg-brand-600 rounded-t transition-all" style={{ height: `${Math.max(4, ((d.loads_delivered || 0) / maxDelivered) * 100)}%` }} />
                    </div>
                    <span className="text-xs text-surface-500 truncate max-w-full rotate-0 sm:-rotate-45 origin-top-left">{d.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {byRoute.length > 0 && (
            <section className="rounded-2xl border border-surface-200 bg-white p-6 shadow-sm">
              <h3 className="font-semibold text-surface-900 mb-4">Reports by route</h3>
              <div className="space-y-2">
                {byRoute.slice(0, 10).map((r) => (
                  <div key={r.route} className="flex items-center gap-3">
                    <span className="text-sm font-medium text-surface-700 w-40 truncate" title={r.route}>{r.route}</span>
                    <div className="flex-1 h-6 bg-surface-100 rounded overflow-hidden">
                      <div className="h-full bg-brand-500 rounded" style={{ width: `${Math.max(5, (r.report_count / maxReports) * 100)}%` }} />
                    </div>
                    <span className="text-sm text-surface-600 w-16 text-right">{r.report_count} report(s) · {r.loads_delivered ?? 0} loads</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-surface-100 bg-gradient-to-r from-surface-50 to-brand-50">
              <h3 className="font-semibold text-surface-900 flex items-center gap-2">
                <span className="text-lg">Insights</span>
                <span className="text-xs font-normal text-surface-500 bg-surface-200 px-2 py-0.5 rounded-full">Analytics & pattern detection</span>
              </h3>
              <p className="text-sm text-surface-600 mt-0.5">AI-powered analysis of shift report data to help managers spot trends and anomalies without opening every report.</p>
            </div>
            <div className="p-6 space-y-3">
              {insights.length === 0 ? (
                <p className="text-surface-500 text-sm">No insights for the selected period. Add and approve more shift reports to see pattern detection and recommendations.</p>
              ) : (
                insights.map((item, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 rounded-xl p-4 text-sm ${
                      item.type === 'positive' ? 'bg-green-50 border border-green-100 text-green-900' :
                      item.type === 'attention' ? 'bg-amber-50 border border-amber-100 text-amber-900' :
                      'bg-surface-50 border border-surface-100 text-surface-800'
                    }`}
                  >
                    <span className="shrink-0 mt-0.5">
                      {item.type === 'positive' ? '✓' : item.type === 'attention' ? '!' : '●'}
                    </span>
                    <span>{item.text}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function TabShiftItems({ setActiveTab }) {
  const [days, setDays] = useState(7);
  const [routeFilter, setRouteFilter] = useState('');
  const [viewMode, setViewMode] = useState('route'); // 'route' | 'date'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchRoute, setSearchRoute] = useState('');
  const [selectedReportId, setSelectedReportId] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    ccApi.shiftItems({ days, route: routeFilter || undefined })
      .then((r) => setData(r))
      .catch((e) => { setError(e?.message || 'Failed to load shift items'); setData(null); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [days, routeFilter]);

  const reports = data?.reports || [];
  const byRoute = data?.byRoute || [];
  const byDate = data?.byDate || [];
  const summary = data?.summary || {};
  const routeOptions = [...new Set(byRoute.map((x) => x.route))].filter(Boolean).sort();

  const filteredByRoute = searchRoute.trim()
    ? byRoute.filter((r) => r.route.toLowerCase().includes(searchRoute.trim().toLowerCase()))
    : byRoute;

  const statusBadge = (status) => {
    const c = status === 'approved' ? 'bg-emerald-100 text-emerald-800' : status === 'rejected' ? 'bg-red-100 text-red-800' : status === 'pending_approval' ? 'bg-sky-100 text-sky-800' : status === 'provisional' ? 'bg-amber-100 text-amber-800' : 'bg-surface-100 text-surface-600';
    return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c}`}>{status}</span>;
  };

  const reportItemCard = (r) => {
    const reportDate = (r.report_date || r.shift_date || r.created_at) ? new Date(r.report_date || r.shift_date || r.created_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const controllers = [r.controller1_name, r.controller2_name].filter(Boolean).join(', ') || '—';
    const delivered = r.total_loads_delivered != null && r.total_loads_delivered !== '' ? r.total_loads_delivered : '—';
    const incidentCount = Array.isArray(r.incidents) ? r.incidents.length : 0;
    return (
      <div
        key={r.id}
        role="button"
        tabIndex={0}
        onClick={() => setSelectedReportId(r.id)}
        onKeyDown={(e) => e.key === 'Enter' && setSelectedReportId(r.id)}
        className={`group rounded-xl border p-4 text-left transition-all hover:shadow-md hover:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${selectedReportId === r.id ? 'border-brand-500 bg-brand-50/50 shadow-sm' : 'border-surface-200 bg-white'}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-surface-900">{reportDate}</span>
          {statusBadge(r.status)}
        </div>
        <p className="text-sm text-surface-600 mt-1 truncate" title={controllers}>Controllers: {controllers}</p>
        <div className="flex flex-wrap gap-3 mt-3 text-xs text-surface-500">
          <span>Delivered: <strong className="text-surface-700">{delivered}</strong></span>
          {incidentCount > 0 && <span className="text-amber-600 font-medium">{incidentCount} incident(s)</span>}
        </div>
        <p className="text-xs text-brand-600 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">Open report →</p>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-surface-900 tracking-tight">Shift by route</h2>
        <p className="text-sm text-surface-600 mt-1">View shift reports per route for the past 1–30 days. See what happened on each shift without opening every report.</p>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Period</label>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-xl border border-surface-300 bg-white px-4 py-2.5 text-sm font-medium text-surface-800 shadow-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500">
            {[1, 3, 7, 14, 21, 30].map((d) => (
              <option key={d} value={d}>{d} day{d !== 1 ? 's' : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Route</label>
          <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)} className="rounded-xl border border-surface-300 bg-white px-4 py-2.5 text-sm font-medium text-surface-800 shadow-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 min-w-[180px]">
            <option value="">All routes</option>
            {routeOptions.map((ro) => (
              <option key={ro} value={ro}>{ro}</option>
            ))}
          </select>
        </div>
        <div className="flex rounded-xl overflow-hidden border border-surface-200 shadow-sm">
          <button type="button" onClick={() => setViewMode('route')} className={`px-4 py-2.5 text-sm font-medium ${viewMode === 'route' ? 'bg-brand-600 text-white' : 'bg-white text-surface-600 hover:bg-surface-50'}`}>By route</button>
          <button type="button" onClick={() => setViewMode('date')} className={`px-4 py-2.5 text-sm font-medium ${viewMode === 'date' ? 'bg-brand-600 text-white' : 'bg-white text-surface-600 hover:bg-surface-50'}`}>By date</button>
        </div>
        {viewMode === 'route' && routeOptions.length > 0 && (
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Search route</label>
            <input type="text" value={searchRoute} onChange={(e) => setSearchRoute(e.target.value)} placeholder="Filter by route name…" className="w-full rounded-xl border border-surface-300 px-4 py-2.5 text-sm placeholder-surface-400 focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
          </div>
        )}
        <button type="button" onClick={load} disabled={loading} className="px-5 py-2.5 rounded-xl bg-brand-600 text-white font-medium text-sm hover:bg-brand-700 disabled:opacity-50 shadow-sm">Refresh</button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 flex justify-between items-center">
          {error}
          <button type="button" onClick={() => setError('')} className="text-red-600 hover:underline">Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 rounded-2xl border border-surface-200 bg-surface-50">
          <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-surface-500 mt-3">Loading shift items…</p>
        </div>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-surface-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Reports</p>
              <p className="text-2xl font-bold text-surface-900 mt-1">{summary.report_count ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-surface-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Routes</p>
              <p className="text-2xl font-bold text-surface-900 mt-1">{summary.route_count ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-surface-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider">From</p>
              <p className="text-lg font-semibold text-surface-900 mt-1">{data.dateFrom || '—'}</p>
            </div>
            <div className="rounded-2xl border border-surface-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider">To</p>
              <p className="text-lg font-semibold text-surface-900 mt-1">{data.dateTo || '—'}</p>
            </div>
          </div>

          {reports.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-surface-200 bg-surface-50 p-12 text-center">
              <p className="text-surface-600 font-medium">No shift reports in this period</p>
              <p className="text-sm text-surface-500 mt-1">Try a longer period or check that reports exist for your account.</p>
            </div>
          ) : viewMode === 'route' ? (
            <div className="space-y-6">
              {filteredByRoute.map(({ route, reports: routeReports }) => (
                <section key={route} className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
                  <div className="px-6 py-4 bg-gradient-to-r from-surface-50 to-brand-50 border-b border-surface-100">
                    <h3 className="font-bold text-surface-900 flex items-center gap-2">
                      <span className="text-brand-600">{route}</span>
                      <span className="text-sm font-normal text-surface-500">({routeReports.length} report{routeReports.length !== 1 ? 's' : ''})</span>
                    </h3>
                  </div>
                  <div className="p-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {routeReports.map((r) => reportItemCard(r))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {byDate.map(({ date, reports: dateReports }) => (
                <section key={date} className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
                  <div className="px-6 py-4 bg-gradient-to-r from-surface-50 to-brand-50 border-b border-surface-100">
                    <h3 className="font-bold text-surface-900 flex items-center gap-2">
                      <span>{new Date(date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
                      <span className="text-sm font-normal text-surface-500">({dateReports.length} report{dateReports.length !== 1 ? 's' : ''})</span>
                    </h3>
                  </div>
                  <div className="p-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {dateReports.map((r) => reportItemCard(r))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {selectedReportId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setSelectedReportId(null)}>
              <div className="rounded-2xl bg-white shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="px-6 py-4 border-b border-surface-100 flex justify-between items-center">
                  <h3 className="font-semibold text-surface-900">Open shift report</h3>
                  <button type="button" onClick={() => setSelectedReportId(null)} className="p-2 rounded-lg hover:bg-surface-100 text-surface-500">✕</button>
                </div>
                <div className="p-6">
                  <p className="text-sm text-surface-600 mb-4">Go to View saved shift reports to open and edit this report, or use the link below.</p>
                  <button type="button" onClick={() => { if (setActiveTab) setActiveTab('saved_reports'); setSelectedReportId(null); }} className="px-4 py-2 rounded-xl bg-brand-600 text-white font-medium text-sm hover:bg-brand-700">Go to saved reports</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

async function buildShiftExportWorkbook(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Command Centre';
  workbook.created = new Date();

  const thinBorder = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  };
  const headerFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2C3E50' },
  };
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  const titleFont = { bold: true, size: 12, color: { argb: 'FF2C3E50' } };

  const addSheet = (sheetName, headers, rows, titleText) => {
    const ws = workbook.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: titleText ? 2 : 1 }],
      properties: { defaultColWidth: 14 },
    });
    let rowNum = 1;
    if (titleText) {
      ws.mergeCells(1, 1, 1, headers.length);
      const titleRow = ws.getRow(1);
      titleRow.getCell(1).value = titleText;
      titleRow.getCell(1).font = titleFont;
      titleRow.height = 22;
      rowNum = 2;
    }
    const headerRow = ws.getRow(rowNum);
    headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
    headerRow.font = headerFont;
    headerRow.fill = headerFill;
    headerRow.alignment = { vertical: 'middle', wrapText: true, horizontal: 'left' };
    headerRow.height = 24;
    headerRow.eachCell((cell) => { cell.border = thinBorder; });
    rowNum += 1;
    rows.forEach((rowValues) => {
      const row = ws.getRow(rowNum);
      rowValues.forEach((v, i) => { row.getCell(i + 1).value = v != null ? String(v) : ''; });
      row.alignment = { vertical: 'middle', wrapText: true };
      row.eachCell((cell) => { cell.border = thinBorder; });
      rowNum += 1;
    });
    const colWidths = headers.map((_, i) => {
      const maxLen = Math.max(
        (headers[i] || '').length,
        ...rows.map((r) => (r[i] != null ? String(r[i]).length : 0))
      );
      return Math.min(Math.max(maxLen + 2, 12), 50);
    });
    ws.columns.forEach((col, i) => { if (colWidths[i] != null) col.width = colWidths[i]; });
  };

  const generated = `Generated: ${new Date().toLocaleString()}.`;
  const filterNote = [data.dateFrom && `From ${data.dateFrom}`, data.dateTo && `To ${data.dateTo}`, data.route && `Route: ${data.route}`].filter(Boolean).join('; ') || 'No date/route filter';

  const exportOrder = ['report_summary', 'truck_updates', 'incidents', 'non_compliance', 'investigations', 'communication_log', 'handover'];
  for (const key of exportOrder) {
    const sheet = data.exports[key];
    if (!sheet) continue;
    const title = `Shift Report Export – ${sheet.sheetName} · ${generated} ${filterNote}`;
    addSheet(sheet.sheetName, sheet.headers, sheet.rows, title);
  }

  return workbook;
}

function TabShiftReportExports() {
  const [section, setSection] = useState('incidents_non_compliance');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [route, setRoute] = useState('');
  const [routeOptions, setRouteOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    ccApi.shiftItems({ days: 90 })
      .then((r) => {
        const routes = (r?.byRoute || []).map((x) => x.route).filter(Boolean);
        setRouteOptions([...new Set(routes)].sort());
      })
      .catch(() => {});
  }, []);

  const handleDownload = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await ccApi.shiftReportExport({
        section,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        route: route || undefined,
      });
      const workbook = await buildShiftExportWorkbook(data);
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const base = section === 'all' ? 'shift-report-all-sections' : `shift-report-${section.replace(/_/g, '-')}`;
      const name = `${base}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e?.message || 'Export failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-surface-900 tracking-tight">Export shift report sections</h2>
        <p className="text-sm text-surface-600 mt-1">Download selected sections from shift reports as professional Excel files. Use filters to limit by date range and route.</p>
      </div>

      <div className="rounded-2xl border border-surface-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-100 bg-surface-50">
          <h3 className="font-semibold text-surface-900">Choose section and filters</h3>
          <p className="text-sm text-surface-600 mt-0.5">Data is taken from shift reports you created or are assigned to.</p>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Section to export</label>
              <select value={section} onChange={(e) => setSection(e.target.value)} className="w-full rounded-xl border border-surface-300 px-4 py-2.5 text-sm font-medium text-surface-800 focus:ring-2 focus:ring-brand-500 focus:border-brand-500">
                <option value="all">All sections</option>
                <option value="report_summary">Report summary</option>
                <option value="truck_updates">Truck updates &amp; logistics</option>
                <option value="incidents_non_compliance">Incidents &amp; Non-Compliance</option>
                <option value="investigations">Investigations</option>
                <option value="communication_log">Communication log</option>
                <option value="handover">Handover</option>
              </select>
              <p className="text-xs text-surface-500 mt-1">
                {section === 'all' && 'One workbook with all sheets: Report summary, Truck updates, Incidents, Non-compliance, Investigations, Communication log, Handover.'}
                {section === 'report_summary' && 'One row per shift report: date, route, controllers, loads, performance, highlights.'}
                {section === 'truck_updates' && 'Truck updates & logistics flow entries with report context.'}
                {section === 'incidents_non_compliance' && 'Two sheets: Incidents and Non-compliance.'}
                {section === 'investigations' && 'Investigations (findings & action taken).'}
                {section === 'communication_log' && 'Communication log entries with report context.'}
                {section === 'handover' && 'Outstanding issues and handover key info per report.'}
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Date from (optional)</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full rounded-xl border border-surface-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Date to (optional)</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full rounded-xl border border-surface-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Route (optional)</label>
              <select value={route} onChange={(e) => setRoute(e.target.value)} className="w-full rounded-xl border border-surface-300 px-4 py-2.5 text-sm font-medium text-surface-800 focus:ring-2 focus:ring-brand-500 focus:border-brand-500">
                <option value="">All routes</option>
                {routeOptions.map((ro) => <option key={ro} value={ro}>{ro}</option>)}
              </select>
            </div>
          </div>
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 flex justify-between items-center">
              {error}
              <button type="button" onClick={() => setError('')} className="text-red-600 hover:underline">Dismiss</button>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button type="button" onClick={handleDownload} disabled={loading} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-600 text-white font-semibold shadow-md hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? (
                <>
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Preparing Excel…
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Download Excel
                </>
              )}
            </button>
            <p className="text-sm text-surface-500">Professional layout with headers, borders, and column widths. Each row is linked to its shift report via Report date, Route, and Report status.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const CONTROLLER_EVALUATION_QUESTIONS = [
  { id: 'q1', label: 'Was the shift concluded by 6:00 AM / 6:00 PM as required?' },
  { id: 'q2', label: 'Was the shift report submitted for approval before 18:30?' },
  { id: 'q3', label: 'Was the shift report completed correctly and accurately?' },
  { id: 'q4', label: 'Are all report sections properly completed and accounted for?' },
  { id: 'q5', label: 'Did the controller go the extra mile to resolve and manage situations or issues?' },
  { id: 'q6', label: 'Was the controller able to answer all questions related to his/her shift?' },
  { id: 'q7', label: 'Did the controllers work effectively as a team?' },
  { id: 'q8', label: 'Did the controller apply critical thinking in resolving issues?' },
  { id: 'q9', label: 'Did the controller follow up on matters and outstanding issues?' },
  { id: 'q10', label: "Was the controller's shift report presentation detailed, insightful, and helpful?" },
  { id: 'q11', label: 'Was the office space left clean in accordance with company policy?' },
];

function ControllerEvaluationForm({ reportId, existingEvaluation, onSaved, saving, setSaving, error, setError }) {
  const [answers, setAnswers] = useState(() => {
    const init = {};
    CONTROLLER_EVALUATION_QUESTIONS.forEach((q) => { init[q.id] = { value: '', comment: '' }; });
    if (existingEvaluation?.answers) {
      try {
        const parsed = typeof existingEvaluation.answers === 'string' ? JSON.parse(existingEvaluation.answers) : existingEvaluation.answers;
        CONTROLLER_EVALUATION_QUESTIONS.forEach((q) => {
          if (parsed[q.id]) init[q.id] = { value: parsed[q.id].value || '', comment: parsed[q.id].comment || '' };
        });
      } catch (_) {}
    }
    return init;
  });
  const [overallComment, setOverallComment] = useState(existingEvaluation?.overall_comment || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    const out = {};
    let valid = true;
    CONTROLLER_EVALUATION_QUESTIONS.forEach((q) => {
      const a = answers[q.id] || {};
      if (a.value !== 'yes' && a.value !== 'no') valid = false;
      if (!String(a.comment || '').trim()) valid = false;
      out[q.id] = { value: a.value, comment: String(a.comment || '').trim() };
    });
    if (!valid) { setError('Answer Yes or No and provide a comment for every question.'); return; }
    if (!String(overallComment).trim()) { setError('Overall comment is required.'); return; }
    setError('');
    setSaving(true);
    ccApi.shiftReports.submitEvaluation(reportId, { answers: out, overall_comment: overallComment.trim() })
      .then(() => { onSaved?.(); })
      .catch((err) => setError(err?.message || 'Failed to save evaluation'))
      .finally(() => setSaving(false));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <p className="text-sm text-surface-600">Evaluate how the controllers ran their shift. Every question requires Yes or No and a comment. Your evaluation is required before you can approve, reject, or grant provisional approval.</p>
      {CONTROLLER_EVALUATION_QUESTIONS.map((q, idx) => (
        <div key={q.id} className="rounded-xl border border-surface-200 bg-white p-4">
          <p className="font-medium text-surface-900 mb-2">{idx + 1}. {q.label}</p>
          <div className="flex flex-wrap gap-4 mb-3">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="radio" name={q.id} checked={(answers[q.id]?.value) === 'yes'} onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: { ...prev[q.id], value: 'yes' } }))} className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-sm font-medium text-surface-700">Yes</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="radio" name={q.id} checked={(answers[q.id]?.value) === 'no'} onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: { ...prev[q.id], value: 'no' } }))} className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-sm font-medium text-surface-700">No</span>
            </label>
          </div>
          <textarea
            value={answers[q.id]?.comment ?? ''}
            onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: { ...prev[q.id], comment: e.target.value } }))}
            placeholder="Comment (required)"
            rows={2}
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            required
          />
        </div>
      ))}
      <div>
        <label className="block font-medium text-surface-900 mb-2">Overall comment (required)</label>
        <textarea value={overallComment} onChange={(e) => setOverallComment(e.target.value)} placeholder="Summarise your evaluation and any recommendations…" rows={4} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500" required />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : existingEvaluation ? 'Update evaluation' : 'Submit evaluation'}
        </button>
      </div>
    </form>
  );
}

function TabRequests() {
  const { user } = useAuth();
  const [reports, setReports] = useState([]);
  const [decidedByMe, setDecidedByMe] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [report, setReport] = useState(null);
  const [comments, setComments] = useState([]);
  const [evaluation, setEvaluation] = useState(null);
  const [error, setError] = useState('');
  const [newComment, setNewComment] = useState('');
  const [addingComment, setAddingComment] = useState(false);
  const [acting, setActing] = useState(false);
  const [savingEval, setSavingEval] = useState(false);
  const [overrideRequested, setOverrideRequested] = useState(false);
  const [overrideCode, setOverrideCode] = useState('');
  const [requestingOverride, setRequestingOverride] = useState(false);

  const loadList = () => {
    setLoading(true);
    Promise.all([ccApi.shiftReports.list(true), ccApi.shiftReports.listDecidedByMe()])
      .then(([r, d]) => { setReports(r.reports || []); setDecidedByMe(d.reports || []); setError(''); })
      .catch((err) => setError(err?.message || 'Failed to load requests'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadList(); }, []);

  useEffect(() => {
    if (!selectedId) { setReport(null); setComments([]); setEvaluation(null); setOverrideRequested(false); setOverrideCode(''); return; }
    setOverrideRequested(false);
    setOverrideCode('');
    ccApi.shiftReports.get(selectedId)
      .then((r) => { setReport(r.report); setComments(r.comments || []); setEvaluation(r.evaluation || null); setError(''); })
      .catch((err) => { setError(err?.message || 'Failed to load report'); setReport(null); setEvaluation(null); });
  }, [selectedId]);

  const addComment = () => {
    if (!newComment.trim() || !selectedId) return;
    setAddingComment(true);
    ccApi.shiftReports.addComment(selectedId, newComment.trim())
      .then((c) => { setComments((prev) => [...prev, { ...c.comment, user_name: user?.full_name }]); setNewComment(''); })
      .catch((err) => setError(err?.message || 'Failed to add comment'))
      .finally(() => setAddingComment(false));
  };

  const isSuperAdmin = user?.role === 'super_admin';
  const isAssignedApprover = report?.submitted_to_user_id != null && user?.id != null && String(report.submitted_to_user_id) === String(user.id);
  const withOverride = () => (report?.status === 'approved' || report?.status === 'rejected') && (isAssignedApprover || isSuperAdmin);
  const needsOverrideToAct = withOverride();
  const effectiveOverride = needsOverrideToAct ? overrideCode.trim() : null;

  const approve = () => {
    if (!selectedId) return;
    setActing(true);
    ccApi.shiftReports.approve(selectedId, effectiveOverride || undefined)
      .then((r) => { setReport(r.report); setEvaluation(r.evaluation); loadList(); setOverrideCode(''); })
      .catch((err) => setError(err?.message || 'Failed to approve'))
      .finally(() => setActing(false));
  };

  const reject = () => {
    if (!selectedId) return;
    setActing(true);
    ccApi.shiftReports.reject(selectedId, effectiveOverride || undefined)
      .then((r) => { setReport(r.report); loadList(); setOverrideCode(''); })
      .catch((err) => setError(err?.message || 'Failed to reject'))
      .finally(() => setActing(false));
  };

  const provisional = () => {
    if (!selectedId) return;
    setActing(true);
    ccApi.shiftReports.provisional(selectedId, effectiveOverride || undefined)
      .then((r) => { setReport(r.report); loadList(); setOverrideCode(''); })
      .catch((err) => setError(err?.message || 'Failed to set provisional'))
      .finally(() => setActing(false));
  };

  const requestOverride = () => {
    if (!selectedId) return;
    setRequestingOverride(true);
    ccApi.shiftReports.requestOverride(selectedId)
      .then(() => { setOverrideRequested(true); setError(''); })
      .catch((err) => setError(err?.message || 'Failed to request override'))
      .finally(() => setRequestingOverride(false));
  };

  const canAct = report && (report.status === 'pending_approval' || report.status === 'provisional' || needsOverrideToAct) && (isAssignedApprover || isSuperAdmin);
  const canShowActions = canAct && (evaluation || needsOverrideToAct);
  const showEvalForm = canAct && !needsOverrideToAct;

  if (selectedId && report) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button type="button" onClick={() => { setSelectedId(null); setReport(null); }} className="text-sm text-surface-600 hover:text-surface-900 font-medium">← Back to list</button>
          <span className="text-xs font-semibold text-surface-500 uppercase">Status: {report.status}</span>
          {report.status === 'approved' && (
            <a href="#" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('shift-report-download', { detail: { report, tenantId: user?.tenant_id } })); }} className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700">Download</a>
          )}
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</div>}
        <ShiftReportReadOnlyView report={report} />

        {/* Controller evaluation (required before first decision) */}
        {showEvalForm && (
          <div className="rounded-xl border-2 border-brand-200 bg-brand-50/30 p-6">
            <h3 className="font-semibold text-surface-900 mb-2 text-lg">Controller evaluation</h3>
            <ControllerEvaluationForm
              reportId={selectedId}
              existingEvaluation={evaluation}
              onSaved={() => ccApi.shiftReports.get(selectedId).then((r) => { setReport(r.report); setEvaluation(r.evaluation || null); })}
              saving={savingEval}
              setSaving={setSavingEval}
              error={error}
              setError={setError}
            />
          </div>
        )}

        {/* Override: already evaluated and need to change decision (red) */}
        {canAct && needsOverrideToAct && (
          <div className="rounded-xl border-2 border-red-300 bg-red-50 p-6 shadow-sm">
            <h3 className="font-semibold text-red-900 mb-2 text-lg">Override required</h3>
            <p className="text-sm text-red-800 mb-4">You have already evaluated and taken an action on this report. To change your decision (approve, reject, or provisional approval), request an override code from Access Management.</p>
            {!overrideRequested ? (
              <button type="button" onClick={requestOverride} disabled={requestingOverride} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {requestingOverride ? 'Sending…' : 'Request override code'}
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-red-800">Check your email for the override code (it was sent to you and to Access Management). Enter it below to proceed.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="text" value={overrideCode} onChange={(e) => setOverrideCode(e.target.value)} placeholder="Enter override code" maxLength={10} className="rounded-lg border-2 border-red-200 px-3 py-2 text-sm font-mono w-40" />
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button type="button" onClick={approve} disabled={acting || !overrideCode.trim()} className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">Approve</button>
                  <button type="button" onClick={reject} disabled={acting || !overrideCode.trim()} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">Reject</button>
                  <button type="button" onClick={provisional} disabled={acting || !overrideCode.trim()} className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">Provisional approval</button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl border-2 border-surface-200 bg-surface-50 p-5">
          <h3 className="font-semibold text-surface-900 mb-3 text-base">Reviewer / approver comments</h3>
          {comments.length === 0 ? (
            <p className="text-surface-500 text-sm py-2">No comments yet.</p>
          ) : (
            <div className="space-y-3">
              {comments.map((c) => (
                <div key={c.id} className={`rounded-lg border p-4 ${c.addressed ? 'bg-green-50/50 border-green-200' : 'bg-white border-surface-200 shadow-sm'}`}>
                  <p className="text-base text-surface-900 leading-snug whitespace-pre-wrap">{c.comment_text}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-surface-600">— {c.user_name}</span>
                    {c.created_at && <span className="text-xs text-surface-500">{new Date(c.created_at).toLocaleString()}</span>}
                    {c.addressed ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-200 text-green-800">Addressed</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          {canAct && !needsOverrideToAct && (
            <div className="mt-4 pt-4 border-t-2 border-surface-200">
              <label className="block text-sm font-semibold text-surface-700 mb-2">Add your comment</label>
              <div className="flex gap-2">
                <textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Type your comment for the report submitter…" rows={3} className="flex-1 rounded-lg border-2 border-surface-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
                <button type="button" onClick={addComment} disabled={addingComment || !newComment.trim()} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 self-end shrink-0">Add comment</button>
              </div>
            </div>
          )}
          {canShowActions && !needsOverrideToAct && (
            <div className="mt-4 pt-4 border-t border-surface-200 flex flex-wrap gap-2">
              <p className="text-xs text-surface-500 w-full">Complete the controller evaluation above, then choose an action.</p>
              <button type="button" onClick={approve} disabled={acting || !evaluation} className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">Approve</button>
              <button type="button" onClick={reject} disabled={acting || !evaluation} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">Reject</button>
              <button type="button" onClick={provisional} disabled={acting || !evaluation} className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">Provisional approval</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-900">Requests</h2>
      <p className="text-sm text-surface-600">Shift reports submitted to you for approval. Complete the controller evaluation, then approve, reject, or grant provisional approval. To change a decision you already made, open the report under “Recently decided by you” and request an override code.</p>
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</div>}
      {loading ? (
        <p className="text-surface-500">Loading…</p>
      ) : (
        <>
          {reports.length === 0 ? (
            <div className="rounded-xl border border-surface-200 bg-surface-50 p-8 text-center text-surface-600">No pending requests.</div>
          ) : (
            <div className="rounded-xl border border-surface-200 overflow-hidden">
              <h3 className="px-4 py-2 text-sm font-semibold text-surface-600 bg-surface-50 border-b border-surface-100">Pending your review</h3>
              <ul className="divide-y divide-surface-100">
                {reports.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setSelectedId(r.id)} className="w-full text-left px-4 py-3 hover:bg-surface-50 flex items-center justify-between gap-4">
                      <span className="font-medium text-surface-900">{r.route || 'Shift report'} — from {r.created_by_name} · {r.report_date ? new Date(r.report_date).toLocaleDateString() : ''}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'provisional' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>{r.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {decidedByMe.length > 0 && (
            <div className="rounded-xl border border-surface-200 overflow-hidden">
              <h3 className="px-4 py-2 text-sm font-semibold text-surface-600 bg-surface-50 border-b border-surface-100">Recently decided by you</h3>
              <p className="px-4 py-2 text-xs text-surface-500">Open a report to request an override code and change your decision.</p>
              <ul className="divide-y divide-surface-100">
                {decidedByMe.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setSelectedId(r.id)} className="w-full text-left px-4 py-3 hover:bg-surface-50 flex items-center justify-between gap-4">
                      <span className="font-medium text-surface-900">{r.route || 'Shift report'} — {r.report_date ? new Date(r.report_date).toLocaleDateString() : ''}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{r.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ShiftReportReadOnlyView({ report }) {
  const r = report || {};
  const sections = [
    { id: 'info', label: 'Report information' },
    { id: 'summary', label: 'Shift summary & overview' },
    { id: 'truck_updates', label: 'Truck updates & logistics flow' },
    { id: 'incidents', label: 'Incidents/breakdowns & non-compliance' },
    { id: 'comms', label: 'Communication log' },
    { id: 'handover', label: 'Handover' },
    { id: 'declaration', label: 'Controller declaration' },
  ];
  const [openSection, setOpenSection] = useState('info');
  const truckUpdates = Array.isArray(r.truck_updates) ? r.truck_updates : [];
  const incidents = Array.isArray(r.incidents) ? r.incidents : [];
  const nonCompliance = Array.isArray(r.non_compliance_calls) ? r.non_compliance_calls : [];
  const investigations = Array.isArray(r.investigations) ? r.investigations : [];
  const commsLog = Array.isArray(r.communication_log) ? r.communication_log : [];

  return (
    <div className="rounded-xl border border-surface-200 overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-surface-100 bg-surface-50">
        {sections.map((s) => (
          <button key={s.id} type="button" onClick={() => setOpenSection((p) => (p === s.id ? null : s.id))} className={`text-xs px-3 py-1.5 rounded-full font-medium ${openSection === s.id ? 'bg-brand-600 text-white' : 'bg-surface-200 text-surface-600'}`}>{s.label}</button>
        ))}
      </div>
      <div className="p-6 space-y-6">
        {openSection === 'info' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div><span className="text-xs text-surface-500">Route</span><p className="font-medium">{r.route || '—'}</p></div>
            <div><span className="text-xs text-surface-500">Report date</span><p className="font-medium">{r.report_date ? new Date(r.report_date).toLocaleDateString() : '—'}</p></div>
            <div><span className="text-xs text-surface-500">Shift date</span><p className="font-medium">{r.shift_date ? new Date(r.shift_date).toLocaleDateString() : '—'}</p></div>
            <div><span className="text-xs text-surface-500">Shift start / end</span><p className="font-medium">{r.shift_start || '—'} / {r.shift_end || '—'}</p></div>
            <div><span className="text-xs text-surface-500">Controller 1</span><p className="font-medium">{r.controller1_name || '—'} {r.controller1_email ? `(${r.controller1_email})` : ''}</p></div>
            <div><span className="text-xs text-surface-500">Controller 2</span><p className="font-medium">{r.controller2_name || '—'} {r.controller2_email ? `(${r.controller2_email})` : ''}</p></div>
          </div>
        )}
        {openSection === 'summary' && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div><span className="text-xs text-surface-500">Total trucks scheduled</span><p className="font-medium">{r.total_trucks_scheduled ?? '—'}</p></div>
              <div><span className="text-xs text-surface-500">Balance brought down</span><p className="font-medium">{r.balance_brought_down ?? '—'}</p></div>
              <div><span className="text-xs text-surface-500">Total loads dispatched</span><p className="font-medium">{r.total_loads_dispatched ?? '—'}</p></div>
              <div><span className="text-xs text-surface-500">Total pending deliveries</span><p className="font-medium">{r.total_pending_deliveries ?? '—'}</p></div>
              <div><span className="text-xs text-surface-500">Total loads delivered</span><p className="font-medium">{r.total_loads_delivered ?? '—'}</p></div>
            </div>
            <div><span className="text-xs text-surface-500">Overall performance</span><p className="font-medium whitespace-pre-wrap">{r.overall_performance || '—'}</p></div>
            <div><span className="text-xs text-surface-500">Key highlights</span><p className="font-medium whitespace-pre-wrap">{r.key_highlights || '—'}</p></div>
          </div>
        )}
        {openSection === 'truck_updates' && (truckUpdates.length ? truckUpdates.map((u, i) => <div key={i} className="p-3 bg-surface-50 rounded-lg"><p>{u.time} — {u.summary}</p>{u.delays ? <p className="text-surface-500 text-sm">{u.delays}</p> : null}</div>) : <p className="text-surface-500">None</p>)}
        {openSection === 'incidents' && (
          <div className="space-y-4">
            <p className="text-xs font-semibold text-surface-500">Incidents</p>
            {incidents.length ? incidents.map((i, idx) => <div key={idx} className="p-3 bg-surface-50 rounded-lg"><p>{i.truck_reg} · {i.driver_name} · {i.issue} — {i.status}</p></div>) : <p className="text-surface-500">None</p>}
            <p className="text-xs font-semibold text-surface-500 mt-4">Non-compliance</p>
            {nonCompliance.length ? nonCompliance.map((n, idx) => <div key={idx} className="p-3 bg-amber-50 rounded-lg"><p>{n.driver_name} · {n.truck_reg} · {n.rule_violated}</p><p className="text-sm">{n.summary}</p></div>) : <p className="text-surface-500">None</p>}
            <p className="text-xs font-semibold text-surface-500 mt-4">Investigations</p>
            {investigations.length ? investigations.map((inv, idx) => <div key={idx} className="p-3 bg-surface-50 rounded-lg"><p>{inv.truck_reg} · {inv.issue_identified}</p><p className="text-sm">{inv.findings}</p></div>) : <p className="text-surface-500">None</p>}
          </div>
        )}
        {openSection === 'comms' && (commsLog.length ? commsLog.map((c, i) => <div key={i} className="p-3 bg-surface-50 rounded-lg"><p>{c.time} — {c.recipient} · {c.subject} ({c.method})</p></div>) : <p className="text-surface-500">None</p>)}
        {openSection === 'handover' && (
          <div className="space-y-3">
            <div><span className="text-xs text-surface-500">Outstanding issues</span><p className="font-medium whitespace-pre-wrap">{r.outstanding_issues || '—'}</p></div>
            <div><span className="text-xs text-surface-500">Key information</span><p className="font-medium whitespace-pre-wrap">{r.handover_key_info || '—'}</p></div>
          </div>
        )}
        {openSection === 'declaration' && (
          <div className="space-y-2">
            <div><span className="text-xs text-surface-500">Declaration</span><p className="font-medium whitespace-pre-wrap">{r.declaration || '—'}</p></div>
            <div><span className="text-xs text-surface-500">Shift conclusion time</span><p className="font-medium">{r.shift_conclusion_time || '—'}</p></div>
          </div>
        )}
      </div>
    </div>
  );
}

function TruckSearchSelect({ value, onChange, placeholder = 'Search or type truck reg…', trucksList, id }) {
  const [search, setSearch] = useState(value || '');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    setSearch(value || '');
  }, [value]);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const q = (search || '').trim().toLowerCase();
  const options = (trucksList || []).filter((t) => {
    const reg = (t.registration || '').trim();
    const main = (t.main_contractor || t.mainContractor || '').trim();
    const fleet = (t.fleet_no || t.fleetNo || '').trim();
    if (!q) return true;
    return reg.toLowerCase().includes(q) || main.toLowerCase().includes(q) || fleet.toLowerCase().includes(q);
  }).slice(0, 15).map((t) => {
    const reg = (t.registration || '').trim();
    const main = (t.main_contractor || t.mainContractor || '').trim();
    return { value: reg, label: main ? `${reg} · ${main}` : reg };
  });
  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm"
        autoComplete="off"
        id={id}
      />
      {open && (options.length > 0 || search) && (
        <ul className="absolute z-20 mt-0.5 left-0 right-0 max-h-40 overflow-auto rounded-lg border border-surface-200 bg-white shadow-lg py-1 text-sm">
          {options.length === 0 ? <li className="px-2 py-1.5 text-surface-500">No match. You can type a reg number.</li> : options.map((opt, idx) => (
            <li key={`${opt.value}-${idx}`} role="button" tabIndex={0} onClick={() => { onChange(opt.value); setSearch(opt.value); setOpen(false); }} onKeyDown={(e) => e.key === 'Enter' && (onChange(opt.value), setSearch(opt.value), setOpen(false))} className="px-2 py-1.5 hover:bg-surface-100 cursor-pointer truncate">{opt.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DriverSearchSelect({ value, onChange, placeholder = 'Search or type driver…', driversList, id }) {
  const [search, setSearch] = useState(value || '');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    setSearch(value || '');
  }, [value]);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const q = (search || '').trim().toLowerCase();
  const options = (driversList || []).filter((d) => {
    const name = (d.full_name || [d.name, d.surname].filter(Boolean).join(' ')).trim();
    const idNum = (d.id_number || d.idNumber || '').trim();
    const lic = (d.license_number || d.licenseNumber || '').trim();
    if (!q) return true;
    return name.toLowerCase().includes(q) || idNum.toLowerCase().includes(q) || lic.toLowerCase().includes(q);
  }).slice(0, 15).map((d) => {
    const name = (d.full_name || [d.name, d.surname].filter(Boolean).join(' ')).trim() || '—';
    const idNum = (d.id_number || d.idNumber || '').trim();
    const label = idNum ? `${name} · ${idNum}` : name;
    return { value: name, label };
  });
  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-surface-300 px-2 py-1.5 text-sm"
        autoComplete="off"
        id={id}
      />
      {open && (options.length > 0 || search) && (
        <ul className="absolute z-20 mt-0.5 left-0 right-0 max-h-40 overflow-auto rounded-lg border border-surface-200 bg-white shadow-lg py-1 text-sm">
          {options.length === 0 ? <li className="px-2 py-1.5 text-surface-500">No match. You can type a name.</li> : options.map((opt, idx) => (
            <li key={`${opt.value}-${idx}`} role="button" tabIndex={0} onClick={() => { onChange(opt.value); setSearch(opt.value); setOpen(false); }} onKeyDown={(e) => e.key === 'Enter' && (onChange(opt.value), setSearch(opt.value), setOpen(false))} className="px-2 py-1.5 hover:bg-surface-100 cursor-pointer truncate">{opt.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ShiftReportForm({ user, onBack, onSaved, saving, setSaving, message, setMessage, openSection: openSectionProp, setOpenSection: setOpenSectionProp, initialData, reportId, readOnly, comments, setComments, showComments, canMarkAddressed, onCommentAddressed }) {
  const [internalOpen, setInternalOpen] = useState('info');
  const parentControlsSection = openSectionProp != null && typeof setOpenSectionProp === 'function';
  const openSection = parentControlsSection ? openSectionProp : internalOpen;
  const setOpenSection = parentControlsSection ? setOpenSectionProp : setInternalOpen;

  const emptyTruck = { time: '', summary: '', delays: '' };
  const emptyIncident = { truck_reg: '', time_reported: '', driver_name: '', issue: '', status: '' };
  const emptyNonComp = { driver_name: '', truck_reg: '', rule_violated: '', time_of_call: '', summary: '', driver_response: '' };
  const emptyInv = { truck_reg: '', time: '', location: '', issue_identified: '', findings: '', action_taken: '' };
  const emptyComm = { time: '', recipient: '', subject: '', method: '', action_required: '' };

  const toDateVal = (v) => {
    if (v == null || v === '') return '';
    const s = String(v);
    if (s.indexOf('T') >= 0) return s.slice(0, 10);
    return s.slice(0, 10);
  };
  const toTimeVal = (v) => {
    if (v == null || v === '') return '';
    const s = String(v);
    if (s.indexOf('T') >= 0) return s.slice(11, 16);
    return s.length >= 5 ? s.slice(0, 5) : s;
  };
  const get = (d, key) => {
    if (!d || typeof d !== 'object') return undefined;
    const k = Object.keys(d).find((kk) => kk.toLowerCase() === key.toLowerCase());
    return k ? d[k] : undefined;
  };
  const initFormFields = (d) => {
    const str = (v) => (v == null || v === '' ? '' : String(v));
    return {
      route: str(get(d, 'route')),
      report_date: toDateVal(get(d, 'report_date')),
      shift_date: toDateVal(get(d, 'shift_date')),
      shift_start: toTimeVal(get(d, 'shift_start')),
      shift_end: toTimeVal(get(d, 'shift_end')),
      controller1_name: str(get(d, 'controller1_name') || user?.full_name),
      controller1_email: str(get(d, 'controller1_email') || user?.email),
      controller2_name: str(get(d, 'controller2_name')),
      controller2_email: str(get(d, 'controller2_email')),
      total_trucks_scheduled: str(get(d, 'total_trucks_scheduled')),
      balance_brought_down: str(get(d, 'balance_brought_down')),
      total_loads_dispatched: str(get(d, 'total_loads_dispatched')),
      total_pending_deliveries: str(get(d, 'total_pending_deliveries')),
      total_loads_delivered: str(get(d, 'total_loads_delivered')),
      overall_performance: str(get(d, 'overall_performance')),
      key_highlights: str(get(d, 'key_highlights')),
      outstanding_issues: str(get(d, 'outstanding_issues')),
      handover_key_info: str(get(d, 'handover_key_info')),
      declaration: str(get(d, 'declaration')),
      shift_conclusion_time: toTimeVal(get(d, 'shift_conclusion_time')),
    };
  };

  const [formFields, setFormFields] = useState(() => initFormFields(initialData));
  const [truckUpdates, setTruckUpdates] = useState(() => (Array.isArray(initialData?.truck_updates) && initialData.truck_updates.length) ? initialData.truck_updates : [emptyTruck]);
  const [incidents, setIncidents] = useState(() => (Array.isArray(initialData?.incidents) && initialData.incidents.length) ? initialData.incidents : [emptyIncident]);
  const [nonComplianceCalls, setNonComplianceCalls] = useState(() => (Array.isArray(initialData?.non_compliance_calls) && initialData.non_compliance_calls.length) ? initialData.non_compliance_calls : [emptyNonComp]);
  const [investigations, setInvestigations] = useState(() => (Array.isArray(initialData?.investigations) && initialData.investigations.length) ? initialData.investigations : [emptyInv]);
  const [commsLog, setCommsLog] = useState(() => (Array.isArray(initialData?.communication_log) && initialData.communication_log.length) ? initialData.communication_log : [emptyComm]);
  const [trucksList, setTrucksList] = useState([]);
  const [driversList, setDriversList] = useState([]);
  const [routeList, setRouteList] = useState([]);
  const [fleetLoadError, setFleetLoadError] = useState('');
  const [markingAddressed, setMarkingAddressed] = useState(null);

  useEffect(() => {
    if (reportId && initialData && String(initialData.id) === String(reportId)) setFormFields(initFormFields(initialData));
  }, [reportId, initialData]);

  useEffect(() => {
    let cancelled = false;
    setFleetLoadError('');
    Promise.all([contractorApi.trucks.list().then((r) => r.trucks || []), contractorApi.drivers.list().then((r) => r.drivers || [])])
      .then(([trucks, drivers]) => { if (!cancelled) { setTrucksList(trucks); setDriversList(drivers); } })
      .catch((err) => { if (!cancelled) setFleetLoadError(err?.message || 'Could not load fleet/drivers. You can still type manually.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    contractorApi.routes.list()
      .then((r) => setRouteList(r.routes || []))
      .catch(() => setRouteList([]));
  }, []);

  const addRow = (setter, empty) => setter((prev) => [...prev, { ...empty }]);
  const updateRow = (setter, index, field, value) => setter((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  const removeRow = (setter, index) => setter((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const sections = [
    { id: 'info', label: 'Report information' },
    { id: 'summary', label: 'Shift summary & overview' },
    { id: 'truck_updates', label: 'Truck updates & logistics flow' },
    { id: 'incidents', label: 'Incidents/breakdowns & non-compliance' },
    { id: 'comms', label: 'Communication log' },
    { id: 'handover', label: 'Handover for incoming controller' },
    { id: 'declaration', label: 'Controller declaration' },
  ];

  if (readOnly && initialData) {
    return (
      <>
        <ShiftReportReadOnlyView report={initialData} />
        {showComments && comments && comments.length > 0 && (
          <div className="mt-4 rounded-xl border-2 border-amber-200 bg-amber-50/50 p-5">
            <h3 className="font-semibold text-surface-900 mb-3 text-base">{canMarkAddressed ? 'Reviewer comments – address to complete approval' : 'Reviewer comments'}</h3>
            <div className="space-y-3">
              {(comments || []).map((c) => (
                <div key={c.id} className={`rounded-lg border p-4 ${c.addressed ? 'bg-green-50/80 border-green-300' : 'bg-white border-surface-200 shadow-sm'}`}>
                  <p className="text-base text-surface-900 leading-snug whitespace-pre-wrap">{c.comment_text}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-surface-600">— {c.user_name}</span>
                    {c.created_at && <span className="text-xs text-surface-500">{new Date(c.created_at).toLocaleString()}</span>}
                    {c.addressed ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-200 text-green-800">Addressed</span> : null}
                    {!c.addressed && reportId && canMarkAddressed && (
                      <button type="button" disabled={markingAddressed === c.id} onClick={() => { setMarkingAddressed(c.id); ccApi.shiftReports.markCommentAddressed(reportId, c.id).then((r) => { if (setComments && r.comments) setComments(r.comments); onCommentAddressed?.(); }).finally(() => setMarkingAddressed(null)); }} className="ml-auto text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Mark as addressed</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    const filteredTruckUpdates = truckUpdates.filter((u) => u.time || u.summary || u.delays);
    const filteredIncidents = incidents.filter((i) => i.truck_reg || i.driver_name || i.issue);
    const filteredNonCompliance = nonComplianceCalls.filter((n) => n.driver_name || n.truck_reg || n.rule_violated);
    const filteredInvestigations = investigations.filter((inv) => inv.truck_reg || inv.issue_identified || inv.findings);
    const filteredComms = commsLog.filter((c) => c.recipient || c.subject);
    const payload = {
      ...formFields,
      truck_updates: filteredTruckUpdates,
      incidents: filteredIncidents,
      non_compliance_calls: filteredNonCompliance,
      investigations: filteredInvestigations,
      communication_log: filteredComms,
    };
    if (reportId) {
      ccApi.shiftReports.update(reportId, payload)
        .then((r) => { onSaved(r.report); setMessage?.('Saved.'); })
        .catch((err) => setMessage?.(err?.message || 'Save failed'))
        .finally(() => setSaving(false));
    } else {
      ccApi.shiftReports.create(payload)
        .then((r) => { onSaved(r.report); setMessage?.('Saved. Go to View saved shift reports to submit for approval.'); })
        .catch((err) => setMessage?.(err?.message || 'Save failed'))
        .finally(() => setSaving(false));
    }
  };

  const set = (key) => (e) => setFormFields((f) => ({ ...f, [key]: e.target.value }));
  return (
    <>
    <form onSubmit={handleSubmit} className="divide-y divide-surface-100">
      <div className="p-4 bg-surface-50 border-b border-surface-200 flex items-center justify-between flex-wrap gap-2">
        <button type="button" onClick={onBack} className="text-sm text-surface-600 hover:text-surface-900 font-medium">
          {reportId ? '← Back to list' : '← Back to report types'}
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpenSection(null)} className="text-xs px-3 py-1.5 rounded-lg border border-surface-300 text-surface-600 hover:bg-surface-100">Collapse all</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save shift report'}
          </button>
        </div>
      </div>

      {message && <div className="px-6 py-3 bg-green-50 text-green-800 text-sm">{message}</div>}
      {fleetLoadError && <div className="px-6 py-2 bg-amber-50 text-amber-800 text-sm">{fleetLoadError}</div>}
      {trucksList.length > 0 || driversList.length > 0 ? (
        <p className="px-6 py-1 text-xs text-surface-500">Trucks and drivers loaded from Contractor portal fleet and driver register. Use search to select.</p>
      ) : null}

      {/* Section nav (sticky on scroll could be added) */}
      <div className="px-6 py-3 flex flex-wrap gap-2 border-b border-surface-100">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setOpenSection((prev) => (prev === s.id ? null : s.id))}
            className={`text-xs px-3 py-1.5 rounded-full font-medium ${openSection === s.id ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="p-6 space-y-8">
        {/* 1. Report information */}
        <SectionBlock title="Report information" open={openSection === 'info'} onToggle={() => setOpenSection((p) => (p === 'info' ? null : 'info'))}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Route</label>
              {routeList.length > 0 ? (
                <>
                  <select
                    name="route"
                    value={routeList.some((r) => (r.name || '').trim() === (formFields.route || '').trim()) ? formFields.route : '__other__'}
                    onChange={(e) => setFormFields((f) => ({ ...f, route: e.target.value === '__other__' ? f.route : e.target.value }))}
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select route</option>
                    {routeList.map((r) => (
                      <option key={r.id} value={r.name || ''}>{r.name || '—'}</option>
                    ))}
                    <option value="__other__">Other (specify below)</option>
                  </select>
                  {!routeList.some((r) => (r.name || '').trim() === (formFields.route || '').trim()) && (
                    <input
                      type="text"
                      placeholder="e.g. Ntshovelo Colliery"
                      value={formFields.route || ''}
                      onChange={(e) => setFormFields((f) => ({ ...f, route: e.target.value }))}
                      className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mt-2"
                    />
                  )}
                </>
              ) : (
                <input name="route" type="text" placeholder="e.g. Ntshovelo Colliery (or add routes in Access Management)" value={formFields.route} onChange={set('route')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Report date</label>
              <input name="report_date" type="date" value={formFields.report_date} onChange={set('report_date')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Shift date</label>
              <input name="shift_date" type="date" value={formFields.shift_date} onChange={set('shift_date')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Shift start</label>
              <input name="shift_start" type="time" value={formFields.shift_start} onChange={set('shift_start')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Shift end</label>
              <input name="shift_end" type="time" value={formFields.shift_end} onChange={set('shift_end')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2 lg:col-span-1" />
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Controller 1</label>
              <input name="controller1_name" type="text" value={formFields.controller1_name} onChange={set('controller1_name')} placeholder="Full name" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-1" />
              <input name="controller1_email" type="email" value={formFields.controller1_email} onChange={set('controller1_email')} placeholder="Email" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Controller 2 (optional)</label>
              <input name="controller2_name" type="text" value={formFields.controller2_name} onChange={set('controller2_name')} placeholder="Full name" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-1" />
              <input name="controller2_email" type="email" value={formFields.controller2_email} onChange={set('controller2_email')} placeholder="Email" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
          </div>
        </SectionBlock>

        {/* 2. Shift summary & overview */}
        <SectionBlock title="Shift summary & overview" open={openSection === 'summary'} onToggle={() => setOpenSection((p) => (p === 'summary' ? null : 'summary'))}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Total trucks scheduled</label>
              <input name="total_trucks_scheduled" type="number" min="0" placeholder="e.g. 295" value={formFields.total_trucks_scheduled} onChange={set('total_trucks_scheduled')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Balance brought down</label>
              <input name="balance_brought_down" type="number" min="0" placeholder="0" value={formFields.balance_brought_down} onChange={set('balance_brought_down')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Total loads dispatched</label>
              <input name="total_loads_dispatched" type="number" min="0" value={formFields.total_loads_dispatched} onChange={set('total_loads_dispatched')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Total pending deliveries</label>
              <input name="total_pending_deliveries" type="number" min="0" value={formFields.total_pending_deliveries} onChange={set('total_pending_deliveries')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Total loads delivered</label>
              <input name="total_loads_delivered" type="number" min="0" value={formFields.total_loads_delivered} onChange={set('total_loads_delivered')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Overall performance</label>
            <textarea name="overall_performance" rows={4} placeholder="Summarise shift operations, loading/offloading flow, any bottlenecks or issues..." value={formFields.overall_performance} onChange={set('overall_performance')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </div>
          <div className="mt-4">
            <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Key highlights</label>
            <textarea name="key_highlights" rows={2} placeholder="Brief bullet-style highlights (e.g. Majuba operations stable, backlog cleared)" value={formFields.key_highlights} onChange={set('key_highlights')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </div>
        </SectionBlock>

        {/* 3. Truck updates & logistics flow */}
        <SectionBlock title="Truck updates & logistics flow" open={openSection === 'truck_updates'} onToggle={() => setOpenSection((p) => (p === 'truck_updates' ? null : 'truck_updates'))}>
          <p className="text-xs text-surface-500 mb-3">Time-based snapshot of truck positions (parked, en route, queuing, loading, offloading) and delays.</p>
          {truckUpdates.map((row, i) => (
            <div key={i} className="flex flex-wrap gap-3 items-start p-3 rounded-lg bg-surface-50 border border-surface-100 mb-2">
              <input type="time" value={row.time} onChange={(e) => updateRow(setTruckUpdates, i, 'time', e.target.value)} placeholder="Time" className="w-28 rounded-lg border border-surface-300 px-2 py-2 text-sm" />
              <div className="flex-1 min-w-[200px]">
                <input type="text" value={row.summary} onChange={(e) => updateRow(setTruckUpdates, i, 'summary', e.target.value)} placeholder="Summary (e.g. 1 truck parked Bethal, 4 en route Majuba, 12 queuing)" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              </div>
              <input type="text" value={row.delays} onChange={(e) => updateRow(setTruckUpdates, i, 'delays', e.target.value)} placeholder="Delays" className="w-48 rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              <button type="button" onClick={() => removeRow(setTruckUpdates, i)} className="text-surface-400 hover:text-red-600 p-2" aria-label="Remove row">×</button>
            </div>
          ))}
          <button type="button" onClick={() => addRow(setTruckUpdates, { time: '', summary: '', delays: '' })} className="text-sm text-brand-600 hover:text-brand-700 font-medium">
            + Add truck update
          </button>
        </SectionBlock>

        {/* 4. Incidents/breakdowns & non-compliance */}
        <SectionBlock title="Incidents/breakdowns & non-compliance" open={openSection === 'incidents'} onToggle={() => setOpenSection((p) => (p === 'incidents' ? null : 'incidents'))}>
          <p className="text-xs font-semibold text-surface-600 mb-2">Incidents/breakdowns</p>
          {incidents.map((row, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 rounded-lg bg-surface-50 border border-surface-100 mb-2">
              <div className="relative">
                <TruckSearchSelect value={row.truck_reg} onChange={(v) => updateRow(setIncidents, i, 'truck_reg', v)} trucksList={trucksList} placeholder="Search truck…" id={`incident-truck-${i}`} />
              </div>
              <input type="time" value={row.time_reported} onChange={(e) => updateRow(setIncidents, i, 'time_reported', e.target.value)} placeholder="Time" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <div className="relative">
                <DriverSearchSelect value={row.driver_name} onChange={(v) => updateRow(setIncidents, i, 'driver_name', v)} driversList={driversList} placeholder="Search driver…" id={`incident-driver-${i}`} />
              </div>
              <input type="text" value={row.issue} onChange={(e) => updateRow(setIncidents, i, 'issue', e.target.value)} placeholder="Issue" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <input type="text" value={row.status} onChange={(e) => updateRow(setIncidents, i, 'status', e.target.value)} placeholder="Status" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <button type="button" onClick={() => removeRow(setIncidents, i)} className="col-span-2 sm:col-span-1 text-surface-400 hover:text-red-600 text-sm">Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => addRow(setIncidents, { truck_reg: '', time_reported: '', driver_name: '', issue: '', status: '' })} className="text-sm text-brand-600 hover:text-brand-700 font-medium mb-4">+ Add incident</button>

          <p className="text-xs font-semibold text-surface-600 mb-2 mt-6">Non-compliance calls</p>
          {nonComplianceCalls.map((row, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-6 gap-2 p-3 rounded-lg bg-amber-50/50 border border-amber-100 mb-2">
              <div className="relative">
                <DriverSearchSelect value={row.driver_name} onChange={(v) => updateRow(setNonComplianceCalls, i, 'driver_name', v)} driversList={driversList} placeholder="Search driver…" id={`nocomp-driver-${i}`} />
              </div>
              <div className="relative">
                <TruckSearchSelect value={row.truck_reg} onChange={(v) => updateRow(setNonComplianceCalls, i, 'truck_reg', v)} trucksList={trucksList} placeholder="Search truck…" id={`nocomp-truck-${i}`} />
              </div>
              <input type="text" value={row.rule_violated} onChange={(e) => updateRow(setNonComplianceCalls, i, 'rule_violated', e.target.value)} placeholder="Rule violated" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <input type="text" value={row.time_of_call} onChange={(e) => updateRow(setNonComplianceCalls, i, 'time_of_call', e.target.value)} placeholder="Time" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <input type="text" value={row.summary} onChange={(e) => updateRow(setNonComplianceCalls, i, 'summary', e.target.value)} placeholder="Summary" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm col-span-2" />
              <input type="text" value={row.driver_response} onChange={(e) => updateRow(setNonComplianceCalls, i, 'driver_response', e.target.value)} placeholder="Driver response" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm col-span-2" />
              <button type="button" onClick={() => removeRow(setNonComplianceCalls, i)} className="text-sm text-surface-400 hover:text-red-600">Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => addRow(setNonComplianceCalls, { driver_name: '', truck_reg: '', rule_violated: '', time_of_call: '', summary: '', driver_response: '' })} className="text-sm text-brand-600 hover:text-brand-700 font-medium mb-4">+ Add non-compliance call</button>

          <p className="text-xs font-semibold text-surface-600 mb-2 mt-6">Investigations (findings & action taken)</p>
          {investigations.map((row, i) => (
            <div key={i} className="p-3 rounded-lg bg-surface-50 border border-surface-100 mb-2 space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="relative">
                  <TruckSearchSelect value={row.truck_reg} onChange={(v) => updateRow(setInvestigations, i, 'truck_reg', v)} trucksList={trucksList} placeholder="Search truck…" id={`inv-truck-${i}`} />
                </div>
                <input type="text" value={row.time} onChange={(e) => updateRow(setInvestigations, i, 'time', e.target.value)} placeholder="Time" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                <input type="text" value={row.location} onChange={(e) => updateRow(setInvestigations, i, 'location', e.target.value)} placeholder="Location" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm sm:col-span-2" />
              </div>
              <input type="text" value={row.issue_identified} onChange={(e) => updateRow(setInvestigations, i, 'issue_identified', e.target.value)} placeholder="Issue identified (e.g. Overspeeding, unscheduled stop)" className="w-full rounded-lg border border-surface-300 px-3 py-1.5 text-sm" />
              <textarea value={row.findings} onChange={(e) => updateRow(setInvestigations, i, 'findings', e.target.value)} placeholder="Findings" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-1.5 text-sm" />
              <textarea value={row.action_taken} onChange={(e) => updateRow(setInvestigations, i, 'action_taken', e.target.value)} placeholder="Action taken (e.g. Warning issued. Transporter notified.)" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-1.5 text-sm" />
              <button type="button" onClick={() => removeRow(setInvestigations, i)} className="text-sm text-surface-400 hover:text-red-600">Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => addRow(setInvestigations, { truck_reg: '', time: '', location: '', issue_identified: '', findings: '', action_taken: '' })} className="text-sm text-brand-600 hover:text-brand-700 font-medium">+ Add investigation</button>
        </SectionBlock>

        {/* 5. Communication log */}
        <SectionBlock title="Communication log" open={openSection === 'comms'} onToggle={() => setOpenSection((p) => (p === 'comms' ? null : 'comms'))}>
          {commsLog.map((row, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 rounded-lg bg-surface-50 border border-surface-100 mb-2">
              <input type="time" value={row.time} onChange={(e) => updateRow(setCommsLog, i, 'time', e.target.value)} placeholder="Time" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <input type="text" value={row.recipient} onChange={(e) => updateRow(setCommsLog, i, 'recipient', e.target.value)} placeholder="Recipient" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <input type="text" value={row.subject} onChange={(e) => updateRow(setCommsLog, i, 'subject', e.target.value)} placeholder="Subject" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <input type="text" value={row.method} onChange={(e) => updateRow(setCommsLog, i, 'method', e.target.value)} placeholder="Method (e.g. WhatsApp/Call)" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <input type="text" value={row.action_required} onChange={(e) => updateRow(setCommsLog, i, 'action_required', e.target.value)} placeholder="Action required" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <button type="button" onClick={() => removeRow(setCommsLog, i)} className="col-span-2 sm:col-span-1 text-surface-400 hover:text-red-600 text-sm">Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => addRow(setCommsLog, { time: '', recipient: '', subject: '', method: '', action_required: '' })} className="text-sm text-brand-600 hover:text-brand-700 font-medium">+ Add communication</button>
        </SectionBlock>

        {/* 6. Handover */}
        <SectionBlock title="Handover information for incoming controller" open={openSection === 'handover'} onToggle={() => setOpenSection((p) => (p === 'handover' ? null : 'handover'))}>
          <div>
            <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Outstanding issues</label>
            <textarea name="outstanding_issues" rows={2} placeholder="e.g. Ensure all fleet lists are up to date and accurate" value={formFields.outstanding_issues} onChange={set('outstanding_issues')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </div>
          <div className="mt-4">
            <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Key information</label>
            <textarea name="handover_key_info" rows={2} placeholder="e.g. Loading expected to resume today, please follow up for update" value={formFields.handover_key_info} onChange={set('handover_key_info')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </div>
        </SectionBlock>

        {/* 7. Controller declaration */}
        <SectionBlock title="Controller declaration" open={openSection === 'declaration'} onToggle={() => setOpenSection((p) => (p === 'declaration' ? null : 'declaration'))}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Declaration</label>
              <textarea name="declaration" rows={3} placeholder="As the controller(s) on duty, I/we certify that the information in this shift report is accurate and complete to the best of my/our knowledge." value={formFields.declaration} onChange={set('declaration')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Shift conclusion time</label>
              <input name="shift_conclusion_time" type="time" value={formFields.shift_conclusion_time} onChange={set('shift_conclusion_time')} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
          </div>
        </SectionBlock>
      </div>

      <div className="p-4 bg-surface-50 border-t border-surface-200 flex justify-end gap-2">
        <button type="button" onClick={onBack} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-100">Cancel</button>
        <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save shift report'}
        </button>
      </div>
    </form>
    {showComments && reportId && comments && comments.length > 0 && (
      <div className="mt-4 rounded-xl border-2 border-amber-200 bg-amber-50/50 p-5">
        <h3 className="font-semibold text-surface-900 mb-3 text-base">Reviewer comments – address to complete approval</h3>
        <div className="space-y-3">
          {(comments || []).map((c) => (
            <div key={c.id} className={`rounded-lg border p-4 ${c.addressed ? 'bg-green-50/80 border-green-300' : 'bg-white border-surface-200 shadow-sm'}`}>
              <p className="text-base text-surface-900 leading-snug whitespace-pre-wrap">{c.comment_text}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-surface-600">— {c.user_name}</span>
                {c.created_at && <span className="text-xs text-surface-500">{new Date(c.created_at).toLocaleString()}</span>}
                {c.addressed ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-200 text-green-800">Addressed</span> : null}
                {!c.addressed && canMarkAddressed && (
                  <button type="button" disabled={markingAddressed === c.id} onClick={() => { setMarkingAddressed(c.id); ccApi.shiftReports.markCommentAddressed(reportId, c.id).then((r) => { if (setComments && r.comments) setComments(r.comments); onCommentAddressed?.(); }).finally(() => setMarkingAddressed(null)); }} className="ml-auto text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Mark as addressed</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
    </>
  );
}

function InvestigationReportForm({ user, onBack, onSaved, saving, setSaving, message, setMessage, openSection, setOpenSection }) {
  const [transactions, setTransactions] = useState([{ ref: '', date: '', location: '', type: 'Receiving', transporter: '', truck_reg: '', tonnage: '' }]);
  const [parties, setParties] = useState([{ name: '', role: '', contact: '', statement: '' }]);
  const [recommendations, setRecommendations] = useState(['']);

  const addRow = (setter, empty) => setter((prev) => [...prev, typeof empty === 'object' ? { ...empty } : empty]);
  const updateRow = (setter, index, field, value) => setter((prev) => prev.map((r, i) => (i === index ? (typeof r === 'object' ? { ...r, [field]: value } : value) : r)));
  const removeRow = (setter, index) => setter((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const invSections = [
    { id: 'inv_case', label: 'Case information' },
    { id: 'inv_investigator', label: 'Investigator' },
    { id: 'inv_reported', label: 'Reported by' },
    { id: 'inv_incident', label: 'Incident description & transactions' },
    { id: 'inv_parties', label: 'Involved parties' },
    { id: 'inv_evidence', label: 'Evidence' },
    { id: 'inv_findings', label: 'Findings' },
    { id: 'inv_recommendations', label: 'Recommendations' },
    { id: 'inv_notes', label: 'Additional notes' },
  ];

  const handleSubmit = (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    const form = e.target;
    const payload = {
      case_number: form.case_number?.value?.trim() || '',
      type: form.case_type?.value?.trim() || 'DEVIATION',
      status: form.status?.value?.trim() || 'OPEN',
      priority: form.priority?.value?.trim() || 'MEDIUM',
      date_occurred: form.date_occurred?.value || '',
      date_reported: form.date_reported?.value || '',
      location: form.location?.value?.trim() || '',
      investigator_name: form.investigator_name?.value?.trim() || user?.full_name || '',
      badge_number: form.badge_number?.value?.trim() || '',
      rank: form.rank?.value?.trim() || '',
      reported_by_name: form.reported_by_name?.value?.trim() || '',
      reported_by_position: form.reported_by_position?.value?.trim() || '',
      description: form.description?.value?.trim() || '',
      transactions: transactions.filter((t) => t.ref || t.truck_reg || t.tonnage),
      parties: parties.filter((p) => p.name || p.statement),
      evidence_notes: form.evidence_notes?.value?.trim() || '',
      finding_summary: form.finding_summary?.value?.trim() || '',
      finding_operational_trigger: form.finding_operational_trigger?.value?.trim() || '',
      finding_incident: form.finding_incident?.value?.trim() || '',
      finding_workaround: form.finding_workaround?.value?.trim() || '',
      finding_system_integrity: form.finding_system_integrity?.value?.trim() || '',
      finding_resolution: form.finding_resolution?.value?.trim() || '',
      recommendations: recommendations.filter(Boolean),
      additional_notes: form.additional_notes?.value?.trim() || '',
    };
    ccApi.investigationReports.create(payload)
      .then((r) => { onSaved(r.report); setMessage?.('Saved. Approve this report from Report composition or saved list to add it to the Library.'); })
      .catch((err) => setMessage?.(err?.message || 'Save failed'))
      .finally(() => setSaving(false));
  };

  return (
    <form onSubmit={handleSubmit} className="divide-y divide-surface-100">
      <div className="p-4 bg-surface-50 border-b border-surface-200 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="text-sm text-surface-600 hover:text-surface-900 font-medium">← Back to report types</button>
          <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Investigation report</span>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpenSection(null)} className="text-xs px-3 py-1.5 rounded-lg border border-surface-300 text-surface-600 hover:bg-surface-100">Collapse all</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save investigation report'}
          </button>
        </div>
      </div>
      {message && <div className="px-6 py-3 bg-green-50 text-green-800 text-sm">{message}</div>}

      <div className="px-6 py-3 flex flex-wrap gap-2 border-b border-surface-100">
        {invSections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setOpenSection((p) => (p === s.id ? null : s.id))}
            className={`text-xs px-3 py-1.5 rounded-full font-medium ${openSection === s.id ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="p-6 space-y-8">
        {/* Case information */}
        <SectionBlock title="Case information" open={openSection === 'inv_case'} onToggle={() => setOpenSection((p) => (p === 'inv_case' ? null : 'inv_case'))}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Case number</label>
              <input name="case_number" type="text" placeholder="e.g. DEV-1770975099130-00H8" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Type</label>
              <select name="case_type" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="DEVIATION">DEVIATION</option>
                <option value="INCIDENT">INCIDENT</option>
                <option value="COMPLIANCE">COMPLIANCE</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Status</label>
              <select name="status" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="OPEN">OPEN</option>
                <option value="CLOSED">CLOSED</option>
                <option value="PENDING">PENDING</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Priority</label>
              <select name="priority" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Date occurred</label>
              <input name="date_occurred" type="date" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Date reported</label>
              <input name="date_reported" type="date" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Location</label>
              <input name="location" type="text" placeholder="e.g. Mavungwani colliery" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
          </div>
        </SectionBlock>

        {/* Investigator */}
        <SectionBlock title="Investigator" open={openSection === 'inv_investigator'} onToggle={() => setOpenSection((p) => (p === 'inv_investigator' ? null : 'inv_investigator'))}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Investigator name</label>
              <input name="investigator_name" type="text" defaultValue={user?.full_name} placeholder="Full name" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Badge number</label>
              <input name="badge_number" type="text" placeholder="e.g. TA005" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Rank</label>
              <input name="rank" type="text" placeholder="e.g. Operations Management" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
          </div>
        </SectionBlock>

        {/* Reported by */}
        <SectionBlock title="Reported by" open={openSection === 'inv_reported'} onToggle={() => setOpenSection((p) => (p === 'inv_reported' ? null : 'inv_reported'))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Name</label>
              <input name="reported_by_name" type="text" placeholder="e.g. Humphrey Mohlahlo" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Position</label>
              <input name="reported_by_position" type="text" placeholder="e.g. Engineering Manager" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
          </div>
        </SectionBlock>

        {/* Incident description & transactions */}
        <SectionBlock title="Incident description & transaction details" open={openSection === 'inv_incident'} onToggle={() => setOpenSection((p) => (p === 'inv_incident' ? null : 'inv_incident'))}>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Description (summary)</label>
            <textarea name="description" rows={4} placeholder="An investigation was launched following an inquiry regarding... State the objective (e.g. verify delivery validity, ensure no fraudulent manual slips)." className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          </div>
          <p className="text-xs font-semibold text-surface-600 mb-2">Transaction details under review</p>
          {transactions.map((row, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-7 gap-2 p-3 rounded-lg bg-surface-50 border border-surface-100 mb-2">
              <input type="text" value={row.ref} onChange={(e) => updateRow(setTransactions, i, 'ref', e.target.value)} placeholder="Ref (e.g. M11754)" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <input type="date" value={row.date} onChange={(e) => updateRow(setTransactions, i, 'date', e.target.value)} placeholder="Date" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <input type="text" value={row.location} onChange={(e) => updateRow(setTransactions, i, 'location', e.target.value)} placeholder="Location" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <input type="text" value={row.type} onChange={(e) => updateRow(setTransactions, i, 'type', e.target.value)} placeholder="Type" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <input type="text" value={row.transporter} onChange={(e) => updateRow(setTransactions, i, 'transporter', e.target.value)} placeholder="Transporter" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <input type="text" value={row.truck_reg} onChange={(e) => updateRow(setTransactions, i, 'truck_reg', e.target.value)} placeholder="Truck reg" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <input type="text" value={row.tonnage} onChange={(e) => updateRow(setTransactions, i, 'tonnage', e.target.value)} placeholder="Tonnage" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              <button type="button" onClick={() => removeRow(setTransactions, i)} className="col-span-2 sm:col-span-1 text-surface-400 hover:text-red-600 text-sm">Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => addRow(setTransactions, { ref: '', date: '', location: '', type: 'Receiving', transporter: '', truck_reg: '', tonnage: '' })} className="text-sm text-brand-600 hover:text-brand-700 font-medium">+ Add transaction</button>
        </SectionBlock>

        {/* Involved parties */}
        <SectionBlock title="Involved parties" open={openSection === 'inv_parties'} onToggle={() => setOpenSection((p) => (p === 'inv_parties' ? null : 'inv_parties'))}>
          <p className="text-xs text-surface-500 mb-3">Name, role, contact and statement for each party (transporter, driver, clerk, control room, etc.).</p>
          {parties.map((row, i) => (
            <div key={i} className="p-3 rounded-lg bg-surface-50 border border-surface-100 mb-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                <input type="text" value={row.name} onChange={(e) => updateRow(setParties, i, 'name', e.target.value)} placeholder="Name (e.g. Dineo Mahlangu, Marazo logistics)" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                <input type="text" value={row.role} onChange={(e) => updateRow(setParties, i, 'role', e.target.value)} placeholder="Role (Transporter / Driver / Clerk)" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
                <input type="text" value={row.contact} onChange={(e) => updateRow(setParties, i, 'contact', e.target.value)} placeholder="Contact" className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm" />
              </div>
              <textarea value={row.statement} onChange={(e) => updateRow(setParties, i, 'statement', e.target.value)} placeholder="Statement" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-1.5 text-sm" />
              <button type="button" onClick={() => removeRow(setParties, i)} className="mt-1 text-sm text-surface-400 hover:text-red-600">Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => addRow(setParties, { name: '', role: '', contact: '', statement: '' })} className="text-sm text-brand-600 hover:text-brand-700 font-medium">+ Add party</button>
        </SectionBlock>

        {/* Evidence */}
        <SectionBlock title="Evidence" open={openSection === 'inv_evidence'} onToggle={() => setOpenSection((p) => (p === 'inv_evidence' ? null : 'inv_evidence'))}>
          <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Evidence notes / attachments</label>
          <textarea name="evidence_notes" rows={3} placeholder="List or describe evidence (e.g. delivery note scans, screenshots, weighbridge reports). File upload can be added when backend is ready." className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
        </SectionBlock>

        {/* Findings */}
        <SectionBlock title="Findings" open={openSection === 'inv_findings'} onToggle={() => setOpenSection((p) => (p === 'inv_findings' ? null : 'inv_findings'))}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Summary</label>
              <textarea name="finding_summary" rows={2} placeholder="Investigation confirmed... (e.g. two legitimate deliveries manually captured due to operational delays and driver impatience)" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Operational trigger</label>
              <textarea name="finding_operational_trigger" rows={2} placeholder="e.g. 50-minute delay (11:30–12:20) due to stockpile linking issues at Pit 6, leading to truck queue" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">The incident</label>
              <textarea name="finding_incident" rows={2} placeholder="What happened (e.g. drivers exited weighbridge prematurely, preventing automated system from locking weight)" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">The workaround</label>
              <textarea name="finding_workaround" rows={2} placeholder="e.g. Clerk issued manual slips and recorded tonnage in local admin report to maintain data integrity" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">System integrity</label>
              <textarea name="finding_system_integrity" rows={2} placeholder="e.g. Event tracking reports for the shift showed zero deviations; trucks remained on route and delivered as reported" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wider mb-1">Resolution of conflicting statements</label>
              <textarea name="finding_resolution" rows={3} placeholder="Address any conflicting statements (e.g. regarding transporter knowledge, system gap explanation)" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </div>
          </div>
        </SectionBlock>

        {/* Recommendations */}
        <SectionBlock title="Recommendations" open={openSection === 'inv_recommendations'} onToggle={() => setOpenSection((p) => (p === 'inv_recommendations' ? null : 'inv_recommendations'))}>
          {recommendations.map((rec, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input type="text" value={rec} onChange={(e) => setRecommendations((prev) => prev.map((r, j) => (j === i ? e.target.value : r)))} placeholder="e.g. Data reconciliation: clerk to input records into primary Weighbridge System" className="flex-1 rounded-lg border border-surface-300 px-3 py-2 text-sm" />
              <button type="button" onClick={() => removeRow(setRecommendations, i)} className="text-surface-400 hover:text-red-600 shrink-0 p-2">×</button>
            </div>
          ))}
          <button type="button" onClick={() => addRow(setRecommendations, '')} className="text-sm text-brand-600 hover:text-brand-700 font-medium">+ Add recommendation</button>
        </SectionBlock>

        {/* Additional notes */}
        <SectionBlock title="Additional notes" open={openSection === 'inv_notes'} onToggle={() => setOpenSection((p) => (p === 'inv_notes' ? null : 'inv_notes'))}>
          <textarea name="additional_notes" rows={2} placeholder="e.g. The loads are real and accounted for." className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
        </SectionBlock>
      </div>

      <div className="p-4 bg-surface-50 border-t border-surface-200 flex justify-end gap-2">
        <button type="button" onClick={onBack} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-100">Cancel</button>
        <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save investigation report'}
        </button>
      </div>
    </form>
  );
}

function SectionBlock({ title, open, onToggle, children }) {
  const isOpen = open !== false;
  return (
    <div className="border border-surface-200 rounded-xl overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 bg-surface-50 hover:bg-surface-100 text-left">
        <span className="font-semibold text-surface-900">{title}</span>
        <span className="text-surface-500">{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && <div className="p-4 pt-2 bg-white">{children}</div>}
    </div>
  );
}

function GenericReportForm({ reportType, reportTypes, onBack, saving, setSaving, message, setMessage }) {
  const handleSubmit = (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    const form = e.target;
    if (!form.title?.value?.trim()) { setMessage('Please enter a title.'); setSaving(false); return; }
    setTimeout(() => {
      setMessage('Report saved. (Backend integration pending.)');
      form.reset();
      onBack();
      setSaving(false);
    }, 500);
  };
  const label = reportTypes.find((r) => r.id === reportType)?.label || 'Report';
  return (
    <div className="p-6">
      <button type="button" onClick={onBack} className="text-sm text-surface-500 hover:text-surface-700 mb-4">← Back to report types</button>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
        <h3 className="font-semibold text-surface-900">{label}</h3>
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Title</label>
          <input name="title" type="text" required placeholder="Report title" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1">Content</label>
          <textarea name="body" rows={6} placeholder="Document findings or metrics..." className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
        </div>
        {message && <p className="text-sm text-green-600">{message}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save report'}</button>
          <button type="button" onClick={onBack} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
        </div>
      </form>
    </div>
  );
}

const API_BASE = (typeof import.meta.env?.VITE_API_BASE === 'string' && import.meta.env.VITE_API_BASE) || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
function TabLibrary() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [shiftReports, setShiftReports] = useState([]);
  const [investigationReports, setInvestigationReports] = useState([]);
  const [draftInvestigations, setDraftInvestigations] = useState([]);
  const [approvingId, setApprovingId] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      ccApi.library().then((r) => ({ shiftReports: r.shiftReports || [], investigationReports: r.investigationReports || [], documents: r.documents || [] })),
      ccApi.investigationReports.list(false).then((r) => r.reports || []),
    ])
      .then(([lib, drafts]) => {
        if (cancelled) return;
        setShiftReports(lib.shiftReports);
        setInvestigationReports(lib.investigationReports);
        setDocuments(lib.documents);
        setDraftInvestigations((drafts || []).filter((d) => (d.status || '').toLowerCase() !== 'approved'));
      })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load library'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleUpload = (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploading(true);
    ccApi.libraryDocuments.upload(file)
      .then((r) => { setDocuments((prev) => [r.document, ...prev]); if (fileInputRef.current) fileInputRef.current.value = ''; })
      .catch((err) => setUploadError(err?.message || 'Upload failed'))
      .finally(() => setUploading(false));
  };

  const downloadUploadedFile = (id, fileName) => {
    fetch(`${API_BASE}/command-centre/library/documents/${id}/download`, { credentials: 'include' })
      .then((res) => { if (!res.ok) throw new Error('Download failed'); return res.blob(); })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName || 'document';
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((err) => setError(err?.message || 'Download failed'));
  };

  const approveInvestigation = (id) => {
    setApprovingId(id);
    ccApi.investigationReports.approve(id)
      .then(() => {
        setDraftInvestigations((prev) => prev.filter((r) => r.id !== id));
        return ccApi.library();
      })
      .then((r) => {
        setShiftReports(r.shiftReports || []);
        setInvestigationReports(r.investigationReports || []);
        setDocuments(r.documents || []);
      })
      .catch((err) => setError(err?.message || 'Approve failed'))
      .finally(() => setApprovingId(null));
  };

  const filterBySearch = (items, getLabel) => items.filter((item) => !search || getLabel(item).toLowerCase().includes(search.toLowerCase()));
  const filteredShift = filterBySearch(shiftReports, (r) => [r.route, r.controller1_name, r.report_date].filter(Boolean).join(' '));
  const filteredInv = filterBySearch(investigationReports, (r) => [r.case_number, r.type, r.description].filter(Boolean).join(' '));

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-surface-900">Library</h2>
        <p className="text-surface-500">Loading library…</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-surface-900 tracking-tight">Library</h2>
        <p className="text-sm text-surface-600 mt-1">Approved reports and uploads shared by your company. Download PDFs and files.</p>
      </div>
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3 flex justify-between items-center"><span>{error}</span><button type="button" onClick={() => setError('')} className="text-red-700 font-medium">Dismiss</button></div>}
      <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by route, case number, controller…" className="w-full pl-10 pr-4 py-3 rounded-xl border border-surface-200 bg-white text-surface-900 placeholder:text-surface-400 focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
        </div>
        <div className="flex gap-2 items-center">
          <input ref={fileInputRef} type="file" onChange={handleUpload} disabled={uploading} className="hidden" id="library-file-upload" />
          <label htmlFor="library-file-upload" className={`cursor-pointer px-4 py-3 rounded-xl border-2 border-dashed border-surface-300 bg-surface-50/50 text-surface-700 hover:bg-surface-100 hover:border-brand-400 font-medium text-sm flex items-center gap-2 ${uploading ? 'pointer-events-none opacity-70' : ''}`}>
            <svg className="w-5 h-5 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            {uploading ? 'Uploading…' : 'Upload file'}
          </label>
        </div>
      </div>
      {uploadError && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{uploadError}</div>}

      {/* Approved Shift Reports */}
      <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-4 bg-gradient-to-r from-surface-50 to-white border-b border-surface-100">
          <h3 className="font-semibold text-surface-900 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-brand-100 text-brand-600 flex items-center justify-center text-sm font-bold">S</span>
            Shift reports
          </h3>
          <p className="text-sm text-surface-500 mt-0.5">Approved shift reports. Download as PDF.</p>
        </div>
        <div className="p-6">
          {filteredShift.length === 0 ? (
            <p className="text-surface-500 text-sm py-4">No approved shift reports in the library yet.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredShift.map((r) => {
                const approvedAt = r.approved_at ? new Date(r.approved_at) : null;
                const dateStr = approvedAt ? approvedAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                return (
                  <div key={r.id} className="rounded-xl border border-surface-200 bg-surface-50/50 p-4 hover:border-brand-200 hover:shadow-md transition-all">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-surface-900 truncate">{r.route || 'Shift report'}</p>
                        <p className="text-xs text-surface-500 mt-0.5">{dateStr} · {r.controller1_name || '—'}</p>
                      </div>
                      <a href="#" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('shift-report-download', { detail: { report: r, tenantId: user?.tenant_id } })); }} className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700">Download</a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Approved Investigation Reports */}
      <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-4 bg-gradient-to-r from-surface-50 to-white border-b border-surface-100">
          <h3 className="font-semibold text-surface-900 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-bold">I</span>
            Investigation reports
          </h3>
          <p className="text-sm text-surface-500 mt-0.5">Approved investigation reports.</p>
        </div>
        <div className="p-6">
          {filteredInv.length === 0 ? (
            <p className="text-surface-500 text-sm py-4">No approved investigation reports yet.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredInv.map((r) => {
                const approvedAt = r.approved_at ? new Date(r.approved_at) : null;
                const dateStr = approvedAt ? approvedAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                return (
                  <div key={r.id} className="rounded-xl border border-surface-200 bg-surface-50/50 p-4 hover:border-amber-200 hover:shadow-md transition-all">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-surface-900 truncate">{r.case_number || r.type || 'Investigation report'}</p>
                        <p className="text-xs text-surface-500 mt-0.5">{dateStr} · {r.created_by_name || '—'}</p>
                        {r.description ? <p className="text-sm text-surface-600 mt-2 line-clamp-2">{r.description}</p> : null}
                      </div>
                      <a href="#" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('investigation-report-download', { detail: { report: r } })); }} className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700">Download</a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Uploaded files */}
      <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-4 bg-gradient-to-r from-surface-50 to-white border-b border-surface-100">
          <h3 className="font-semibold text-surface-900 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold">F</span>
            Uploaded files
          </h3>
          <p className="text-sm text-surface-500 mt-0.5">Files uploaded by anyone in your company. Download anytime.</p>
        </div>
        <div className="p-6">
          {documents.length === 0 ? (
            <p className="text-surface-500 text-sm py-4">No files in the company library yet. Use &quot;Upload file&quot; above to add documents.</p>
          ) : (
            <ul className="space-y-2">
              {documents.map((doc) => {
                const created = doc.created_at ? new Date(doc.created_at) : null;
                const dateStr = created ? created.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
                const sizeStr = doc.file_size != null ? (doc.file_size < 1024 ? `${doc.file_size} B` : doc.file_size < 1024 * 1024 ? `${(doc.file_size / 1024).toFixed(1)} KB` : `${(doc.file_size / (1024 * 1024)).toFixed(1)} MB`) : '';
                return (
                  <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-200 bg-surface-50/50 px-4 py-3 hover:border-emerald-200 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-surface-900 truncate">{doc.file_name}</p>
                      <p className="text-xs text-surface-500">{dateStr}{sizeStr ? ` · ${sizeStr}` : ''}{doc.uploaded_by_name ? ` · ${doc.uploaded_by_name}` : ''}</p>
                    </div>
                    <button type="button" onClick={() => downloadUploadedFile(doc.id, doc.file_name)} className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Download</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Draft investigation reports – approve to add to library */}
      {draftInvestigations.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/30 overflow-hidden">
          <div className="px-6 py-4 border-b border-amber-200/50">
            <h3 className="font-semibold text-surface-900">Draft investigation reports</h3>
            <p className="text-sm text-surface-600 mt-0.5">Approve to add them to the Library.</p>
          </div>
          <div className="p-6">
            <ul className="space-y-3">
              {draftInvestigations.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200/50 bg-white px-4 py-3">
                  <span className="font-medium text-surface-900">{r.case_number || r.type || 'Investigation'}</span>
                  <button type="button" disabled={approvingId === r.id} onClick={() => approveInvestigation(r.id)} className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">{approvingId === r.id ? 'Approving…' : 'Approve & add to Library'}</button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

const DRIVER_ROAD_SAFETY_ITEMS = [
  { id: 'licence', label: 'Valid driver licence (current, correct class)' },
  { id: 'ppe', label: 'PPE worn (helmet, high-vis, safety boots as required)' },
  { id: 'sober', label: 'Sober / no alcohol or drug impairment' },
  { id: 'speed', label: 'Speed and road rules compliance' },
  { id: 'behaviour', label: 'Roadworthy behaviour and attitude' },
  { id: 'documentation', label: 'Documentation on hand (licence, permits)' },
];

const INSPECTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function formatInspectedDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function getInspectionCountdown(lastInspectedAt) {
  if (!lastInspectedAt) return null;
  const last = new Date(lastInspectedAt).getTime();
  const nextDue = last + INSPECTION_INTERVAL_MS;
  const now = Date.now();
  const diff = nextDue - now;
  const diffAbs = Math.abs(diff);
  const hours = Math.floor(diffAbs / (60 * 60 * 1000));
  const mins = Math.floor((diffAbs % (60 * 60 * 1000)) / (60 * 1000));
  const h = `${hours}h`;
  const m = mins > 0 ? ` ${mins}m` : '';
  if (diff >= 0) return { status: 'due_in', text: `Next due in ${h}${m}`, overdue: false };
  return { status: 'overdue', text: `Overdue by ${h}${m}`, overdue: true };
}

function InspectionCountdown({ lastInspectedAt }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60 * 1000);
    return () => clearInterval(id);
  }, []);
  if (!lastInspectedAt) return null;
  const countdown = getInspectionCountdown(lastInspectedAt);
  if (!countdown) return null;
  return (
    <span className={countdown.overdue ? 'text-red-700 font-medium' : 'text-surface-600'}>
      {formatInspectedDateTime(lastInspectedAt)} · {countdown.text}
    </span>
  );
}

function lastInspectedForTruck(inspections, truckId) {
  const found = inspections.filter((i) => i.truckId === truckId).sort((a, b) => new Date(b.inspectedAt) - new Date(a.inspectedAt))[0];
  return found ? found.inspectedAt : null;
}

function lastInspectedForDriver(inspections, driverId) {
  const found = inspections.filter((i) => i.driverId === driverId).sort((a, b) => new Date(b.inspectedAt) - new Date(a.inspectedAt))[0];
  return found ? found.inspectedAt : null;
}

function TabCompliance({ user, inspections = [], setInspections }) {
  const [trucks, setTrucks] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [truckSearch, setTruckSearch] = useState('');
  const [selectedTruck, setSelectedTruck] = useState(null);
  const [inspectionStarted, setInspectionStarted] = useState(false);
  const [truckSectionComplete, setTruckSectionComplete] = useState(false);
  const [driverSearch, setDriverSearch] = useState('');
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [driversError, setDriversError] = useState(null);
  const [driversRetry, setDriversRetry] = useState(0);

  const [gpsStatus, setGpsStatus] = useState('');
  const [gpsComment, setGpsComment] = useState('');
  const [cameraStatus, setCameraStatus] = useState('');
  const [cameraComment, setCameraComment] = useState('');
  const [cameraVisibility, setCameraVisibility] = useState('');
  const [cameraVisibilityComment, setCameraVisibilityComment] = useState('');

  const [driverItems, setDriverItems] = useState(() => DRIVER_ROAD_SAFETY_ITEMS.map((item) => ({ id: item.id, status: '', comment: '' })));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDriversError(null);
    const trucksPromise = contractorApi.trucks.list()
      .then((r) => r.trucks || [])
      .catch(() => []);
    const driversPromise = contractorApi.drivers.list()
      .then((r) => r.drivers || [])
      .catch((err) => {
        if (!cancelled) setDriversError(err?.message || 'Failed to load drivers');
        return [];
      });
    Promise.all([trucksPromise, driversPromise]).then(([truckList, driverList]) => {
      if (!cancelled) {
        setTrucks(truckList);
        setDrivers(driverList);
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [driversRetry]);

  const filteredTrucks = trucks.filter((t) => !truckSearch.trim() || (t.registration || '').toLowerCase().includes(truckSearch.toLowerCase().trim()));
  const filteredDrivers = drivers.filter((d) => !driverSearch.trim() || [d.full_name, d.id_number, d.license_number].some((v) => (v || '').toLowerCase().includes(driverSearch.toLowerCase().trim())));

  const truckFailCount = [gpsStatus === 'bad', cameraStatus === 'bad' || cameraStatus === 'no_cameras', cameraVisibility === 'bad'].filter(Boolean).length;
  const recommendSuspendTruck = truckFailCount >= 1;
  const driverFailing = driverItems.some((d) => d.status === 'bad');
  const recommendSuspendDriver = driverFailing;

  const truckFormComplete = gpsStatus && cameraStatus && cameraVisibility;
  const markTruckSectionComplete = () => {
    if (truckFormComplete) setTruckSectionComplete(true);
  };

  const updateDriverItem = (index, field, value) => {
    setDriverItems((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  const [suspending, setSuspending] = useState(false);
  const [suspendPermanent, setSuspendPermanent] = useState(true);
  const [suspendDurationDays, setSuspendDurationDays] = useState(7);

  const suspendTruckNow = async () => {
    if (!selectedTruck) return;
    setSuspending(true);
    setSubmitError('');
    setSubmitSuccess('');
    try {
      await ccApi.suspendTruck(selectedTruck.id, suspendReason.trim() || undefined, {
        permanent: suspendPermanent,
        duration_days: suspendPermanent ? undefined : suspendDurationDays,
      });
      setSubmitSuccess(suspendPermanent
        ? 'Truck suspended permanently. It will show as Suspended on Inspected trucks & drivers until reinstatement.'
        : `Truck suspended for ${suspendDurationDays} days. It will show as Suspended on Inspected trucks & drivers until then or reinstatement.`);
      setSuspendReason('');
      const r = await ccApi.complianceInspections.list();
      if (r.inspections) setInspections(r.inspections);
    } catch (e) {
      setSubmitError(e?.message || 'Failed to suspend truck');
    } finally {
      setSuspending(false);
    }
  };

  const completeInspection = () => {
    if (!selectedTruck || !selectedDriver) return;
    setSubmitError('');
    setSubmitSuccess('');
    const inspectedAt = new Date().toISOString();
    const record = {
      id: `ins-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      truckId: selectedTruck.id,
      truckRegistration: selectedTruck.registration || '',
      truckMakeModel: selectedTruck.make_model || '',
      driverId: selectedDriver.id,
      driverName: selectedDriver.full_name || '',
      driverIdNumber: selectedDriver.id_number || '',
      licenseNumber: selectedDriver.license_number || '',
      gpsStatus,
      gpsComment,
      cameraStatus,
      cameraComment,
      cameraVisibility,
      cameraVisibilityComment,
      driverItems: driverItems.map((d) => ({ id: d.id, status: d.status, comment: d.comment })),
      recommendSuspendTruck,
      recommendSuspendDriver,
      inspectedAt,
    };
    ccApi.complianceInspections.create({
      truckId: selectedTruck.id,
      driverId: selectedDriver.id,
      truckRegistration: record.truckRegistration,
      truckMakeModel: record.truckMakeModel,
      driverName: record.driverName,
      driverIdNumber: record.driverIdNumber,
      licenseNumber: record.licenseNumber,
      gpsStatus,
      gpsComment,
      cameraStatus,
      cameraComment,
      cameraVisibility,
      cameraVisibilityComment,
      driverItems: record.driverItems,
      recommendSuspendTruck,
      recommendSuspendDriver,
    })
      .then((res) => {
        setInspections((prev) => [...prev, { ...record, responseDueAt: res.inspection?.responseDueAt }]);
        setSubmitSuccess('Inspection saved. The contractor must respond within 8 hours or the truck/driver will be automatically suspended; they can then submit an appeal under Suspensions and appeals on the Contractor page.');
        resetInspection();
        setTimeout(() => setSubmitSuccess(''), 8000);
      })
      .catch((err) => {
        setSubmitError(err?.message || 'Failed to save inspection. Added to local list only.');
        setInspections((prev) => [...prev, record]);
        resetInspection();
      });
  };

  const resetInspection = () => {
    setSelectedTruck(null);
    setInspectionStarted(false);
    setTruckSectionComplete(false);
    setSelectedDriver(null);
    setGpsStatus('');
    setGpsComment('');
    setCameraStatus('');
    setCameraComment('');
    setCameraVisibility('');
    setCameraVisibilityComment('');
    setDriverItems(DRIVER_ROAD_SAFETY_ITEMS.map((item) => ({ id: item.id, status: '', comment: '' })));
  };

  const formatInspectedDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { dateStyle: 'short' });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-surface-900 tracking-tight">Fleet and driver compliance</h2>
        {user?.tenant_name && <p className="text-sm font-medium text-surface-700 mt-1">Contractor: {user.tenant_name}</p>}
        <p className="text-sm text-surface-600 mt-1">Select a truck, complete the truck inspection, then select the driver and complete the driver inspection. The contractor must respond within 8 hours or the truck/driver will be auto-suspended; they can submit an appeal from the Contractor page.</p>
      </div>

      {submitSuccess && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 flex justify-between items-start gap-2">
          <span>{submitSuccess}</span>
          <button type="button" onClick={() => setSubmitSuccess('')} className="shrink-0 text-green-600 hover:text-green-900">Dismiss</button>
        </div>
      )}
      {submitError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex justify-between items-start gap-2">
          <span>{submitError}</span>
          <button type="button" onClick={() => setSubmitError('')} className="shrink-0 text-amber-600 hover:text-amber-900">Dismiss</button>
        </div>
      )}

      {/* Step 1: Search and select truck */}
      <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-surface-100 bg-surface-50">
          <h3 className="font-semibold text-surface-900">1. Select truck</h3>
          <p className="text-sm text-surface-500 mt-0.5">Search by registration and click a truck. You must complete the truck inspection before selecting a driver.</p>
        </div>
        <div className="p-6">
          {loading ? (
            <p className="text-surface-500 text-sm">Loading fleet…</p>
          ) : (
            <>
              <input type="text" value={truckSearch} onChange={(e) => setTruckSearch(e.target.value)} placeholder="Search by registration…" className="mb-4 w-full max-w-md rounded-xl border border-surface-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
              {selectedTruck && !inspectionStarted ? (
                <div className="rounded-xl border-2 border-brand-200 bg-brand-50/50 p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold text-surface-900">{selectedTruck.registration || '—'}</span>
                    <span className="text-sm text-surface-600">{selectedTruck.make_model || ''}</span>
                    <button type="button" onClick={() => setInspectionStarted(true)} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700">Start inspection</button>
                    <button type="button" onClick={() => { setSelectedTruck(null); }} className="text-sm text-surface-500 hover:text-surface-700">Change truck</button>
                  </div>
                  {lastInspectedForTruck(inspections, selectedTruck.id) && (
                    <p className="text-xs text-surface-600">Last inspected: <InspectionCountdown lastInspectedAt={lastInspectedForTruck(inspections, selectedTruck.id)} /></p>
                  )}
                  <div className="border-t border-brand-200 pt-3 mt-2">
                    <p className="text-xs font-medium text-surface-700 mb-1.5">Suspend truck immediately</p>
                    <p className="text-xs text-surface-500 mb-2">Suspended trucks show status on Inspected trucks &amp; drivers; inspection does not expire until reinstatement.</p>
                    <div className="flex flex-wrap gap-4 mb-2">
                      <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input type="radio" name="suspend_type" checked={suspendPermanent} onChange={() => setSuspendPermanent(true)} className="rounded-full" />
                        <span>Permanent</span>
                      </label>
                      <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input type="radio" name="suspend_type" checked={!suspendPermanent} onChange={() => setSuspendPermanent(false)} className="rounded-full" />
                        <span>For a period</span>
                      </label>
                      {!suspendPermanent && (
                        <select value={suspendDurationDays} onChange={(e) => setSuspendDurationDays(Number(e.target.value))} className="rounded-lg border border-surface-300 px-2 py-1 text-sm">
                          <option value={1}>1 day</option>
                          <option value={7}>7 days</option>
                          <option value={14}>14 days</option>
                          <option value={30}>30 days</option>
                          <option value={90}>90 days</option>
                          <option value={180}>180 days</option>
                          <option value={365}>1 year</option>
                        </select>
                      )}
                    </div>
                    <textarea value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="Reason (optional)" rows={2} className="w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2" />
                    <button type="button" disabled={suspending} onClick={suspendTruckNow} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">Suspend truck immediately</button>
                  </div>
                </div>
              ) : selectedTruck ? null : (
                <ul className="space-y-1 max-h-64 overflow-auto rounded-xl border border-surface-200">
                  {filteredTrucks.length === 0 ? <li className="px-4 py-4 text-surface-500 text-sm">No trucks found. Try a different search.</li> : filteredTrucks.slice(0, 100).map((t) => {
                    const inspected = lastInspectedForTruck(inspections, t.id);
                    const countdown = inspected ? getInspectionCountdown(inspected) : null;
                    return (
                      <li key={t.id}>
                        <button type="button" onClick={() => setSelectedTruck(t)} className="w-full text-left px-4 py-3 hover:bg-surface-50 border-b border-surface-100 last:border-0 flex flex-col gap-0.5">
                          <div className="flex justify-between items-center gap-2">
                            <span className="font-medium text-surface-900">{t.registration || '—'}</span>
                            <span className="text-sm text-surface-500 shrink">{t.make_model || '—'}</span>
                          </div>
                          {inspected && (
                            <div className="text-xs text-surface-600">
                              {formatInspectedDateTime(inspected)}
                              {countdown && <span className={countdown.overdue ? ' text-red-700 font-medium' : ''}> · {countdown.text}</span>}
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </section>

      {/* Step 2: Truck inspection (driver cannot be selected until truck section is complete) */}
      {inspectionStarted && selectedTruck && (
        <>
          <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-surface-100 bg-surface-50">
              <h3 className="font-semibold text-surface-900">2. Truck inspection</h3>
              <p className="text-sm text-surface-500 mt-0.5">Vehicle: {selectedTruck.registration} — {selectedTruck.make_model || '—'}. Complete all fields, then click &quot;Truck section complete — select driver&quot;.</p>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl border border-surface-200 p-4">
                  <label className="block font-medium text-surface-900 text-sm mb-2">GPS signal status</label>
                  <select value={gpsStatus} onChange={(e) => setGpsStatus(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2">
                    <option value="">Select…</option>
                    <option value="good">Good</option>
                    <option value="bad">Bad</option>
                  </select>
                  <input type="text" value={gpsComment} onChange={(e) => setGpsComment(e.target.value)} placeholder="Comment (optional)" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                </div>
                <div className="rounded-xl border border-surface-200 p-4">
                  <label className="block font-medium text-surface-900 text-sm mb-2">Camera status</label>
                  <select value={cameraStatus} onChange={(e) => setCameraStatus(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2">
                    <option value="">Select…</option>
                    <option value="good">Good</option>
                    <option value="bad">Bad</option>
                    <option value="no_cameras">No cameras</option>
                  </select>
                  <input type="text" value={cameraComment} onChange={(e) => setCameraComment(e.target.value)} placeholder="Comment (optional)" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                </div>
                <div className="rounded-xl border border-surface-200 p-4">
                  <label className="block font-medium text-surface-900 text-sm mb-2">Camera visibility</label>
                  <select value={cameraVisibility} onChange={(e) => setCameraVisibility(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2">
                    <option value="">Select…</option>
                    <option value="good">Good</option>
                    <option value="bad">Bad</option>
                  </select>
                  <input type="text" value={cameraVisibilityComment} onChange={(e) => setCameraVisibilityComment(e.target.value)} placeholder="Comment (optional)" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                </div>
              </div>
              <div className={`rounded-xl border-2 p-4 ${recommendSuspendTruck ? 'border-red-300 bg-red-50' : 'border-green-200 bg-green-50/50'}`}>
                <h4 className="font-semibold text-surface-900 text-sm mb-1">Truck rating & recommendation</h4>
                <p className="text-sm text-surface-700">
                  {recommendSuspendTruck ? (
                    <span className="font-medium text-red-800">Recommend suspension: one or more truck inspection items are bad or missing (GPS, camera status, or camera visibility).</span>
                  ) : (
                    <span className="text-green-800">No suspension recommended for this truck based on current inspection.</span>
                  )}
                </p>
              </div>
              {!truckSectionComplete && (
                <button type="button" onClick={markTruckSectionComplete} disabled={!truckFormComplete} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  Truck section complete — select driver
                </button>
              )}
            </div>
          </section>

          {/* Step 3: Select driver (only after truck section complete) */}
          {truckSectionComplete && (
            <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-surface-100 bg-surface-50">
                <h3 className="font-semibold text-surface-900">3. Select driver</h3>
                <p className="text-sm text-surface-500 mt-0.5">Search and click the driver you are inspecting for this truck.</p>
              </div>
              <div className="p-6">
                <input type="text" value={driverSearch} onChange={(e) => setDriverSearch(e.target.value)} placeholder="Search by name, ID or licence…" className="mb-4 w-full max-w-md rounded-xl border border-surface-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
                {selectedDriver ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-brand-200 bg-brand-50/50 p-4">
                    <span className="font-semibold text-surface-900">{selectedDriver.full_name || '—'}</span>
                    <span className="text-sm text-surface-600">{selectedDriver.id_number || '—'}</span>
                    {lastInspectedForDriver(inspections, selectedDriver.id) && (
                      <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-800">Inspected {formatInspectedDate(lastInspectedForDriver(inspections, selectedDriver.id))}</span>
                    )}
                    <button type="button" onClick={() => setSelectedDriver(null)} className="text-sm text-surface-500 hover:text-surface-700">Change driver</button>
                  </div>
                ) : (
                  <ul className="space-y-1 max-h-64 overflow-auto rounded-xl border border-surface-200">
                    {loading ? (
                      <li className="px-4 py-6 text-surface-500 text-sm text-center">Loading drivers…</li>
                    ) : driversError ? (
                      <li className="px-4 py-6 text-red-600 text-sm flex flex-col gap-2">
                        <span>{driversError}</span>
                        <button type="button" onClick={() => setDriversRetry((n) => n + 1)} className="text-sm font-medium text-brand-600 hover:underline self-start">Retry loading drivers</button>
                      </li>
                    ) : filteredDrivers.length === 0 ? (
                      <li className="px-4 py-6 text-surface-500 text-sm">
                        {drivers.length === 0 ? (
                          <>No drivers in the register. Add drivers on the <Link to="/contractor" className="text-brand-600 hover:underline">Contractor page</Link> first.</>
                        ) : (
                          'No drivers found. Try a different search.'
                        )}
                      </li>
                    ) : filteredDrivers.slice(0, 100).map((d) => {
                      const inspected = lastInspectedForDriver(inspections, d.id);
                      return (
                        <li key={d.id}>
                          <button type="button" onClick={() => setSelectedDriver(d)} className="w-full text-left px-4 py-3 hover:bg-surface-50 border-b border-surface-100 last:border-0 flex justify-between items-center gap-2">
                            <span className="font-medium text-surface-900">{d.full_name || '—'}</span>
                            <span className="text-sm text-surface-500">{d.license_number || d.id_number || '—'}</span>
                            {inspected && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 shrink-0">Inspected {formatInspectedDate(inspected)}</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          )}

          {/* Step 4: Driver road safety (only when driver selected) */}
          {truckSectionComplete && selectedDriver && (
            <>
              <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-surface-100 bg-surface-50">
                  <h3 className="font-semibold text-surface-900">4. Driver — road safety</h3>
                  <p className="text-sm text-surface-500 mt-0.5">Driver: {selectedDriver.full_name || '—'}. If any item fails, the system will recommend driver suspension.</p>
                </div>
                <div className="p-6 space-y-4">
                  {DRIVER_ROAD_SAFETY_ITEMS.map((item, index) => (
                    <div key={item.id} className="rounded-xl border border-surface-200 p-4 flex flex-wrap items-center gap-4">
                      <span className="font-medium text-surface-900 text-sm w-48 shrink-0">{item.label}</span>
                      <select value={driverItems[index]?.status || ''} onChange={(e) => updateDriverItem(index, 'status', e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-32">
                        <option value="">Select…</option>
                        <option value="good">Good</option>
                        <option value="bad">Bad / Fail</option>
                      </select>
                      <input type="text" value={driverItems[index]?.comment || ''} onChange={(e) => updateDriverItem(index, 'comment', e.target.value)} placeholder="Comment (optional)" className="flex-1 min-w-[180px] rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    </div>
                  ))}
                  <div className={`rounded-xl border-2 p-4 ${recommendSuspendDriver ? 'border-red-300 bg-red-50' : 'border-green-200 bg-green-50/50'}`}>
                    <h4 className="font-semibold text-surface-900 text-sm mb-1">Driver recommendation</h4>
                    <p className="text-sm text-surface-700">
                      {recommendSuspendDriver ? (
                        <span className="font-medium text-red-800">Recommend driver suspension: one or more road safety items failed.</span>
                      ) : (
                        <span className="text-green-800">No suspension recommended for the driver based on current inspection.</span>
                      )}
                    </p>
                  </div>
                </div>
              </section>

              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={completeInspection} className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700">Complete inspection</button>
                <button type="button" onClick={resetInspection} className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel / New inspection</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function TabInspected({ inspections = [], setInspections }) {
  const [activeSubTab, setActiveSubTab] = useState('trucks'); // 'trucks' | 'drivers'
  const [truckFilterReg, setTruckFilterReg] = useState('');
  const [truckFilterFrom, setTruckFilterFrom] = useState('');
  const [truckFilterTo, setTruckFilterTo] = useState('');
  const [truckFilterRec, setTruckFilterRec] = useState(''); // '' | 'ok' | 'suspend'
  const [truckFilterStatus, setTruckFilterStatus] = useState(''); // '' | 'active' | 'suspended'
  const [driverFilterName, setDriverFilterName] = useState('');
  const [driverFilterFrom, setDriverFilterFrom] = useState('');
  const [driverFilterTo, setDriverFilterTo] = useState('');
  const [driverFilterRec, setDriverFilterRec] = useState(''); // '' | 'ok' | 'suspend'
  const [sidePanelRecord, setSidePanelRecord] = useState(null); // inspection record to show
  const [sidePanelHistory, setSidePanelHistory] = useState([]); // other inspections for same truck/driver
  const [sidePanelViewIndex, setSidePanelViewIndex] = useState(0); // which of [record, ...history] we're viewing
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [suspendTruckRecord, setSuspendTruckRecord] = useState(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendPermanent, setSuspendPermanent] = useState(true);
  const [suspendDurationDays, setSuspendDurationDays] = useState(7);
  const [suspending, setSuspending] = useState(false);
  const [suspendError, setSuspendError] = useState('');
  const [suspendSuccess, setSuspendSuccess] = useState('');

  const truckMap = new Map();
  inspections.forEach((i) => {
    const existing = truckMap.get(i.truckId);
    if (!existing || new Date(i.inspectedAt) > new Date(existing.inspectedAt)) {
      truckMap.set(i.truckId, i);
    }
  });
  const driverMap = new Map();
  inspections.forEach((i) => {
    const existing = driverMap.get(i.driverId);
    if (!existing || new Date(i.inspectedAt) > new Date(existing.inspectedAt)) {
      driverMap.set(i.driverId, i);
    }
  });
  let inspectedTrucks = [...truckMap.values()].sort((a, b) => new Date(b.inspectedAt) - new Date(a.inspectedAt));
  let inspectedDrivers = [...driverMap.values()].sort((a, b) => new Date(b.inspectedAt) - new Date(a.inspectedAt));

  if (truckFilterReg.trim()) {
    const q = truckFilterReg.trim().toLowerCase();
    inspectedTrucks = inspectedTrucks.filter((i) => (i.truckRegistration || '').toLowerCase().includes(q) || (i.truckMakeModel || '').toLowerCase().includes(q));
  }
  if (truckFilterFrom) {
    const from = new Date(truckFilterFrom).setHours(0, 0, 0, 0);
    inspectedTrucks = inspectedTrucks.filter((i) => new Date(i.inspectedAt).getTime() >= from);
  }
  if (truckFilterTo) {
    const to = new Date(truckFilterTo).setHours(23, 59, 59, 999);
    inspectedTrucks = inspectedTrucks.filter((i) => new Date(i.inspectedAt).getTime() <= to);
  }
  if (truckFilterRec === 'ok') inspectedTrucks = inspectedTrucks.filter((i) => !i.recommendSuspendTruck);
  if (truckFilterRec === 'suspend') inspectedTrucks = inspectedTrucks.filter((i) => i.recommendSuspendTruck);
  if (truckFilterStatus === 'active') inspectedTrucks = inspectedTrucks.filter((i) => !i.truckSuspended);
  if (truckFilterStatus === 'suspended') inspectedTrucks = inspectedTrucks.filter((i) => i.truckSuspended);

  if (driverFilterName.trim()) {
    const q = driverFilterName.trim().toLowerCase();
    inspectedDrivers = inspectedDrivers.filter((i) => (i.driverName || '').toLowerCase().includes(q) || (i.driverIdNumber || '').toLowerCase().includes(q) || (i.licenseNumber || '').toLowerCase().includes(q));
  }
  if (driverFilterFrom) {
    const from = new Date(driverFilterFrom).setHours(0, 0, 0, 0);
    inspectedDrivers = inspectedDrivers.filter((i) => new Date(i.inspectedAt).getTime() >= from);
  }
  if (driverFilterTo) {
    const to = new Date(driverFilterTo).setHours(23, 59, 59, 999);
    inspectedDrivers = inspectedDrivers.filter((i) => new Date(i.inspectedAt).getTime() <= to);
  }
  if (driverFilterRec === 'ok') inspectedDrivers = inspectedDrivers.filter((i) => !i.recommendSuspendDriver);
  if (driverFilterRec === 'suspend') inspectedDrivers = inspectedDrivers.filter((i) => i.recommendSuspendDriver);

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  };

  const openTruckRecord = (inspection) => {
    const history = inspections.filter((i) => i.truckId === inspection.truckId && i.id !== inspection.id).sort((a, b) => new Date(b.inspectedAt) - new Date(a.inspectedAt));
    setSidePanelRecord(inspection);
    setSidePanelHistory(history);
    setSidePanelViewIndex(0);
  };

  const openDriverRecord = (inspection) => {
    const history = inspections.filter((i) => i.driverId === inspection.driverId && i.id !== inspection.id).sort((a, b) => new Date(b.inspectedAt) - new Date(a.inspectedAt));
    setSidePanelRecord(inspection);
    setSidePanelHistory(history);
    setSidePanelViewIndex(0);
  };

  const displayRecords = sidePanelRecord ? [sidePanelRecord, ...sidePanelHistory] : [];
  const viewingRecord = displayRecords[sidePanelViewIndex] || null;

  const runSuspendTruck = async () => {
    if (!suspendTruckRecord) return;
    setSuspending(true);
    setSuspendError('');
    setSuspendSuccess('');
    try {
      await ccApi.suspendTruck(suspendTruckRecord.truckId, suspendReason.trim() || undefined, {
        permanent: suspendPermanent,
        duration_days: suspendPermanent ? undefined : suspendDurationDays,
      });
      setSuspendSuccess(suspendPermanent
        ? 'Truck suspended permanently. It will show as Suspended here until reinstatement.'
        : `Truck suspended for ${suspendDurationDays} days.`);
      const r = await ccApi.complianceInspections.list();
      if (r.inspections) setInspections(r.inspections);
      setSuspendReason('');
      setTimeout(() => { setSuspendTruckRecord(null); setSuspendSuccess(''); }, 1500);
    } catch (e) {
      setSuspendError(e?.message || 'Failed to suspend truck');
    } finally {
      setSuspending(false);
    }
  };

  return (
    <div className="flex gap-0">
      <div className="space-y-4 flex-1 min-w-0">
        <div>
          <h2 className="text-xl font-bold text-surface-900 tracking-tight">Inspected trucks &amp; drivers</h2>
          <p className="text-sm text-surface-600 mt-1">Switch between trucks and drivers. Use filters and click a row to open the full record in the side panel.</p>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-surface-200">
          <button
            type="button"
            onClick={() => setActiveSubTab('trucks')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeSubTab === 'trucks' ? 'border-brand-500 text-brand-700 bg-brand-50/50' : 'border-transparent text-surface-600 hover:text-surface-900 hover:bg-surface-50'}`}
          >
            Inspected trucks
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('drivers')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${activeSubTab === 'drivers' ? 'border-brand-500 text-brand-700 bg-brand-50/50' : 'border-transparent text-surface-600 hover:text-surface-900 hover:bg-surface-50'}`}
          >
            Inspected drivers
          </button>
        </div>

        {activeSubTab === 'trucks' && (
          <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-surface-100 bg-surface-50">
              <h3 className="font-semibold text-surface-900">Inspected trucks</h3>
              <p className="text-sm text-surface-500 mt-0.5">One row per truck (latest inspection).</p>
              <div className="mt-3 flex flex-wrap gap-3 items-center">
                <input type="text" value={truckFilterReg} onChange={(e) => setTruckFilterReg(e.target.value)} placeholder="Search registration or make/model" className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm w-56" />
                <input type="date" value={truckFilterFrom} onChange={(e) => setTruckFilterFrom(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm" />
                <span className="text-surface-500 text-sm">to</span>
                <input type="date" value={truckFilterTo} onChange={(e) => setTruckFilterTo(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm" />
                <select value={truckFilterRec} onChange={(e) => setTruckFilterRec(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm">
                  <option value="">All recommendations</option>
                  <option value="ok">OK only</option>
                  <option value="suspend">Recommend suspension only</option>
                </select>
                <select value={truckFilterStatus} onChange={(e) => setTruckFilterStatus(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm">
                  <option value="">All statuses</option>
                  <option value="active">Active only</option>
                  <option value="suspended">Suspended only</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-50 border-b border-surface-200">
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Contractor</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Registration</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Make / model</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Status</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Last inspected</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Next due (24h)</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Recommendation</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Contractor response</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inspectedTrucks.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-6 text-surface-500 text-center">No trucks match the filters.</td></tr>
                  ) : (
                    inspectedTrucks.map((i) => {
                      const countdown = i.truckSuspended ? null : getInspectionCountdown(i.inspectedAt);
                      return (
                        <tr key={i.truckId} onClick={() => openTruckRecord(i)} className="border-b border-surface-100 last:border-0 hover:bg-brand-50 cursor-pointer">
                          <td className="px-4 py-2 text-surface-700">{i.contractorName || '—'}</td>
                          <td className="px-4 py-2 font-medium text-surface-900">{i.truckRegistration || '—'}</td>
                          <td className="px-4 py-2 text-surface-600">{i.truckMakeModel || '—'}</td>
                          <td className="px-4 py-2">
                            {i.truckSuspended ? (
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800" title={i.truckSuspensionPermanent ? 'Permanent' : i.truckSuspensionEndsAt ? `Until ${formatDate(i.truckSuspensionEndsAt)}` : ''}>
                                {i.truckSuspensionPermanent ? 'Suspended (permanent)' : i.truckSuspensionEndsAt ? `Until ${formatDate(i.truckSuspensionEndsAt)}` : 'Suspended'}
                              </span>
                            ) : <span className="text-surface-500 text-xs">Active</span>}
                          </td>
                          <td className="px-4 py-2 text-surface-600">{formatDate(i.inspectedAt)}</td>
                          <td className="px-4 py-2">
                            {i.truckSuspended ? <span className="text-red-700 font-medium">{i.truckSuspensionPermanent ? 'Suspended (permanent)' : i.truckSuspensionEndsAt ? `Until ${formatDate(i.truckSuspensionEndsAt)}` : 'Suspended'}</span> : countdown ? <span className={countdown.overdue ? 'text-red-700 font-medium' : 'text-surface-600'}>{countdown.text}</span> : '—'}
                          </td>
                          <td className="px-4 py-2">
                            {i.recommendSuspendTruck ? (
                              <span className="text-red-700 font-medium">Recommend suspension</span>
                            ) : (
                              <span className="text-green-700">OK</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {(i.contractorRespondedAt || i.status === 'responded' || ((i.responseAttachments || []).length > 0)) ? <span className="text-emerald-700 font-medium">Responded</span> : <span className="text-surface-500">Pending</span>}
                          </td>
                          <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                            {!i.truckSuspended && (
                              <button
                                type="button"
                                onClick={() => setSuspendTruckRecord(i)}
                                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700"
                              >
                                Suspend
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeSubTab === 'drivers' && (
          <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-surface-100 bg-surface-50">
              <h3 className="font-semibold text-surface-900">Inspected drivers</h3>
              <p className="text-sm text-surface-500 mt-0.5">One row per driver (latest inspection).</p>
              <div className="mt-3 flex flex-wrap gap-3 items-center">
                <input type="text" value={driverFilterName} onChange={(e) => setDriverFilterName(e.target.value)} placeholder="Search name, ID or licence" className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm w-56" />
                <input type="date" value={driverFilterFrom} onChange={(e) => setDriverFilterFrom(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm" />
                <span className="text-surface-500 text-sm">to</span>
                <input type="date" value={driverFilterTo} onChange={(e) => setDriverFilterTo(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm" />
                <select value={driverFilterRec} onChange={(e) => setDriverFilterRec(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm">
                  <option value="">All recommendations</option>
                  <option value="ok">OK only</option>
                  <option value="suspend">Recommend suspension only</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-50 border-b border-surface-200">
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Contractor</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Name</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">ID / Licence</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Last inspected</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Recommendation</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Contractor response</th>
                  </tr>
                </thead>
                <tbody>
                  {inspectedDrivers.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-surface-500 text-center">No drivers match the filters.</td></tr>
                  ) : (
                    inspectedDrivers.map((i) => (
                      <tr key={i.driverId} onClick={() => openDriverRecord(i)} className="border-b border-surface-100 last:border-0 hover:bg-brand-50 cursor-pointer">
                        <td className="px-4 py-2 text-surface-700">{i.contractorName || '—'}</td>
                        <td className="px-4 py-2 font-medium text-surface-900">{i.driverName || '—'}</td>
                        <td className="px-4 py-2 text-surface-600">{i.driverIdNumber || i.licenseNumber || '—'}</td>
                        <td className="px-4 py-2 text-surface-600">{formatDate(i.inspectedAt)}</td>
                        <td className="px-4 py-2">
                          {i.recommendSuspendDriver ? (
                            <span className="text-red-700 font-medium">Recommend suspension</span>
                          ) : (
                            <span className="text-green-700">OK</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {(i.contractorRespondedAt || i.status === 'responded' || ((i.responseAttachments || []).length > 0)) ? <span className="text-emerald-700 font-medium">Responded</span> : <span className="text-surface-500">Pending</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Suspend truck modal (Inspected trucks) */}
        {suspendTruckRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!suspending) { setSuspendTruckRecord(null); setSuspendError(''); } }}>
            <div className="bg-white rounded-xl shadow-lg max-w-md w-full mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 border-b border-surface-200">
                <h3 className="font-semibold text-surface-900">Suspend truck</h3>
                <p className="text-sm text-surface-600 mt-0.5">{suspendTruckRecord.truckRegistration || '—'} {suspendTruckRecord.truckMakeModel ? ` · ${suspendTruckRecord.truckMakeModel}` : ''} ({suspendTruckRecord.contractorName || '—'})</p>
              </div>
              <div className="p-4 space-y-3">
                {suspendSuccess && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{suspendSuccess}</p>}
                {suspendError && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{suspendError}</p>}
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="inspected_suspend_type" checked={suspendPermanent} onChange={() => setSuspendPermanent(true)} className="rounded-full" />
                    <span>Permanent</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="inspected_suspend_type" checked={!suspendPermanent} onChange={() => setSuspendPermanent(false)} className="rounded-full" />
                    <span>For a period</span>
                  </label>
                  {!suspendPermanent && (
                    <select value={suspendDurationDays} onChange={(e) => setSuspendDurationDays(Number(e.target.value))} className="rounded-lg border border-surface-300 px-2 py-1 text-sm">
                      <option value={1}>1 day</option>
                      <option value={7}>7 days</option>
                      <option value={14}>14 days</option>
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                      <option value={180}>180 days</option>
                      <option value={365}>1 year</option>
                    </select>
                  )}
                </div>
                <textarea value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="Reason (optional)" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                <div className="flex gap-2 justify-end pt-2">
                  <button type="button" disabled={suspending} onClick={() => { setSuspendTruckRecord(null); setSuspendError(''); }} className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50 disabled:opacity-50">Cancel</button>
                  <button type="button" disabled={suspending} onClick={runSuspendTruck} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{suspending ? 'Suspending…' : 'Suspend truck'}</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Side panel: full inspection record */}
      {viewingRecord && (
        <div className="w-full max-w-md shrink-0 border-l border-surface-200 bg-white shadow-lg overflow-hidden flex flex-col">
          <div className="p-4 border-b border-surface-100 flex justify-between items-center">
            <h3 className="font-semibold text-surface-900">Inspection record</h3>
            <button type="button" onClick={() => { setSidePanelRecord(null); setSidePanelHistory([]); }} className="text-surface-500 hover:text-surface-700 p-1" aria-label="Close">×</button>
          </div>
          {displayRecords.length > 1 && (
            <div className="px-4 py-2 border-b border-surface-100 flex gap-2 flex-wrap">
              {displayRecords.map((r, idx) => (
                <button key={r.id} type="button" onClick={() => setSidePanelViewIndex(idx)} className={`text-xs px-2 py-1 rounded ${sidePanelViewIndex === idx ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}>
                  {idx === 0 ? 'Latest' : formatDate(r.inspectedAt)}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
            <div>
              <p className="font-medium text-surface-900">Date &amp; time</p>
              <p className="text-surface-600">{formatDate(viewingRecord.inspectedAt)}</p>
            </div>
            <div>
              <p className="font-medium text-surface-900">Contractor</p>
              <p className="text-surface-600">{viewingRecord.contractorName || '—'}</p>
            </div>
            <div>
              <p className="font-medium text-surface-900">Truck</p>
              <p className="text-surface-600">{viewingRecord.truckRegistration || '—'} {viewingRecord.truckMakeModel ? ` · ${viewingRecord.truckMakeModel}` : ''}</p>
              {viewingRecord.truckSuspended && <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">{viewingRecord.truckSuspensionPermanent ? 'Suspended (permanent)' : viewingRecord.truckSuspensionEndsAt ? `Suspended until ${formatDate(viewingRecord.truckSuspensionEndsAt)}` : 'Suspended'}</span>}
            </div>
            <div>
              <p className="font-medium text-surface-900">Driver</p>
              <p className="text-surface-600">{viewingRecord.driverName || '—'}</p>
              {(viewingRecord.driverIdNumber || viewingRecord.licenseNumber) && <p className="text-surface-500 text-xs mt-0.5">ID: {viewingRecord.driverIdNumber || '—'} · Licence: {viewingRecord.licenseNumber || '—'}</p>}
            </div>
            <div className="border-t border-surface-200 pt-3">
              <p className="font-medium text-surface-900 mb-2">Truck inspection</p>
              <ul className="space-y-1 text-surface-600">
                <li>GPS: {viewingRecord.gpsStatus || '—'} {viewingRecord.gpsComment && `— ${viewingRecord.gpsComment}`}</li>
                <li>Camera: {viewingRecord.cameraStatus || '—'} {viewingRecord.cameraComment && `— ${viewingRecord.cameraComment}`}</li>
                <li>Visibility: {viewingRecord.cameraVisibility || '—'} {viewingRecord.cameraVisibilityComment && `— ${viewingRecord.cameraVisibilityComment}`}</li>
              </ul>
              <p className="mt-2">{viewingRecord.recommendSuspendTruck ? <span className="text-red-700 font-medium">Recommend suspension</span> : <span className="text-green-700">OK</span>}</p>
            </div>
            <div className="border-t border-surface-200 pt-3">
              <p className="font-medium text-surface-900 mb-2">Driver road safety</p>
              <ul className="space-y-1 text-surface-600">
                {(viewingRecord.driverItems || []).map((d) => {
                  const label = DRIVER_ROAD_SAFETY_ITEMS.find((x) => x.id === d.id)?.label || d.id;
                  return <li key={d.id}>{label}: {d.status || '—'} {d.comment ? `— ${d.comment}` : ''}</li>;
                })}
              </ul>
              <p className="mt-2">{viewingRecord.recommendSuspendDriver ? <span className="text-red-700 font-medium">Recommend suspension</span> : <span className="text-green-700">OK</span>}</p>
            </div>
            <div className="border-t border-surface-200 pt-3">
              <p className="font-medium text-surface-900 mb-1">Next due (24h)</p>
              <p className="text-surface-600">{viewingRecord.truckSuspended ? (viewingRecord.truckSuspensionPermanent ? 'Suspended (permanent)' : viewingRecord.truckSuspensionEndsAt ? `Suspended until ${formatDate(viewingRecord.truckSuspensionEndsAt)}` : 'Suspended (does not expire until reinstatement)') : (getInspectionCountdown(viewingRecord.inspectedAt)?.text || '—')}</p>
            </div>
            {/* Contractor response / feedback — full view including attachments */}
            <div className="border-t border-surface-200 pt-3 mt-3 bg-surface-50 rounded-lg p-3 -mx-1">
              <p className="font-medium text-surface-900 mb-2">Contractor response / feedback</p>
              {(viewingRecord.contractorRespondedAt || viewingRecord.status === 'responded' || ((viewingRecord.responseAttachments || []).length > 0)) ? (
                <>
                  {viewingRecord.contractorRespondedAt && <p className="text-surface-600 text-xs mb-2">Responded: {formatDate(viewingRecord.contractorRespondedAt)}</p>}
                  <div className="bg-white border border-surface-200 rounded-md p-3 mb-3">
                    <p className="text-surface-800 text-sm whitespace-pre-wrap break-words min-h-[2em]">{viewingRecord.contractorResponseText || '—'}</p>
                  </div>
                  {(viewingRecord.responseAttachments || []).length > 0 && (
                    <div className="mt-2">
                      <p className="text-surface-700 text-xs font-medium mb-1.5">Attachments ({viewingRecord.responseAttachments.length})</p>
                      <ul className="space-y-1.5">
                        {(viewingRecord.responseAttachments || []).map((a) => (
                          <li key={a.id} className="flex items-center gap-2 flex-wrap">
                            <span className="text-surface-700 text-sm truncate flex-1 min-w-0" title={a.fileName}>{a.fileName}</span>
                            <button type="button" onClick={() => openAttachmentWithAuth(ccApi.complianceInspections.attachmentUrl(viewingRecord.id, a.id)).catch((e) => window.alert(e?.message || 'Could not open'))} className="text-xs font-medium text-brand-600 hover:text-brand-700 shrink-0">View</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-surface-500 text-sm">No response yet. Contractor may respond within 8 hours.</p>
              )}
              {/* Your reply (Command Centre) */}
              {(viewingRecord.inspectorReplyText != null || viewingRecord.inspectorRepliedAt) && (
                <div className="mt-3 pt-3 border-t border-surface-200">
                  <p className="font-medium text-surface-900 text-xs mb-1">Your reply</p>
                  {viewingRecord.inspectorRepliedAt && <p className="text-surface-600 text-xs mb-1">Replied: {formatDate(viewingRecord.inspectorRepliedAt)}</p>}
                  <p className="text-surface-800 text-sm whitespace-pre-wrap break-words">{viewingRecord.inspectorReplyText || '—'}</p>
                </div>
              )}
              {/* Reply to contractor form */}
              {(viewingRecord.contractorRespondedAt || viewingRecord.status === 'responded' || ((viewingRecord.responseAttachments || []).length > 0)) && setInspections && (
                <div className="mt-3 pt-3 border-t border-surface-200">
                  <p className="font-medium text-surface-900 text-xs mb-1.5">Reply to contractor</p>
                  <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Type your reply…" rows={3} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2 resize-y" />
                  <button type="button" disabled={replying} onClick={async () => {
                    const text = replyText.trim();
                    if (!text) return;
                    setReplying(true);
                    try {
                      await ccApi.complianceInspections.reply(viewingRecord.id, text);
                      const at = new Date().toISOString();
                      setInspections((prev) => prev.map((i) => i.id === viewingRecord.id ? { ...i, inspectorReplyText: text, inspectorRepliedAt: at } : i));
                      setSidePanelRecord((prev) => prev?.id === viewingRecord.id ? { ...prev, inspectorReplyText: text, inspectorRepliedAt: at } : prev);
                      setSidePanelHistory((prev) => prev.map((r) => r.id === viewingRecord.id ? { ...r, inspectorReplyText: text, inspectorRepliedAt: at } : r));
                      setReplyText('');
                    } catch (e) {
                      window.alert(e?.message || 'Failed to send reply');
                    } finally {
                      setReplying(false);
                    }
                  }} className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Submit reply</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabInspectionRecords({ inspections = [], setInspections }) {
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const sorted = [...inspections].sort((a, b) => new Date(b.inspectedAt) - new Date(a.inspectedAt));
  const formatDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—');

  return (
    <div className="flex gap-0">
      <div className="space-y-6 flex-1 min-w-0">
        <div>
          <h2 className="text-xl font-bold text-surface-900 tracking-tight">Truck inspection records</h2>
          <p className="text-sm text-surface-600 mt-1">Full trail of all truck inspections. Click a row to view details and contractor response. Trucks must be inspected every 24 hours.</p>
        </div>

        <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-surface-100 bg-surface-50">
            <h3 className="font-semibold text-surface-900">All inspection records</h3>
            <p className="text-sm text-surface-500 mt-0.5">Most recent first. Each row is one inspection (truck + driver at a point in time).</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-50 border-b border-surface-200">
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Contractor</th>
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Date &amp; time</th>
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Truck</th>
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Driver</th>
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Truck result</th>
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Driver result</th>
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Contractor response</th>
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Next due</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-6 text-surface-500 text-center">No inspection records yet. Complete an inspection in Fleet and driver compliance.</td></tr>
                ) : (
                  sorted.map((r) => {
                    const countdown = getInspectionCountdown(r.inspectedAt);
                    return (
                      <tr key={r.id} onClick={() => setSelectedRecord(r)} className="border-b border-surface-100 last:border-0 hover:bg-brand-50 cursor-pointer">
                        <td className="px-4 py-2 text-surface-700">{r.contractorName || '—'}</td>
                        <td className="px-4 py-2 text-surface-700 whitespace-nowrap">{formatInspectedDateTime(r.inspectedAt)}</td>
                        <td className="px-4 py-2">
                          <span className="font-medium text-surface-900">{r.truckRegistration || '—'}</span>
                          {r.truckMakeModel && <span className="text-surface-500 block text-xs">{r.truckMakeModel}</span>}
                        </td>
                        <td className="px-4 py-2 text-surface-700">{r.driverName || '—'}</td>
                        <td className="px-4 py-2">
                          {r.recommendSuspendTruck ? <span className="text-red-700 font-medium">Recommend suspension</span> : <span className="text-green-700">OK</span>}
                        </td>
                        <td className="px-4 py-2">
                          {r.recommendSuspendDriver ? <span className="text-red-700 font-medium">Recommend suspension</span> : <span className="text-green-700">OK</span>}
                        </td>
                        <td className="px-4 py-2">
                          {(r.contractorRespondedAt || r.status === 'responded' || ((r.responseAttachments || []).length > 0)) ? (
                            <span className="text-emerald-700 font-medium" title={r.contractorRespondedAt ? formatDate(r.contractorRespondedAt) : ''}>Responded</span>
                          ) : (
                            <span className="text-surface-500">Pending</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {countdown ? <span className={countdown.overdue ? 'text-red-700 font-medium' : 'text-surface-600'}>{countdown.text}</span> : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Side panel: full record + contractor response */}
      {selectedRecord && (
        <div className="w-full max-w-md shrink-0 border-l border-surface-200 bg-white shadow-lg overflow-hidden flex flex-col">
          <div className="p-4 border-b border-surface-100 flex justify-between items-center">
            <h3 className="font-semibold text-surface-900">Inspection record</h3>
            <button type="button" onClick={() => setSelectedRecord(null)} className="text-surface-500 hover:text-surface-700 p-1" aria-label="Close">×</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
            <div>
              <p className="font-medium text-surface-900">Contractor</p>
              <p className="text-surface-600">{selectedRecord.contractorName || '—'}</p>
            </div>
            <div>
              <p className="font-medium text-surface-900">Date &amp; time</p>
              <p className="text-surface-600">{formatDate(selectedRecord.inspectedAt)}</p>
            </div>
            <div>
              <p className="font-medium text-surface-900">Truck</p>
              <p className="text-surface-600">{selectedRecord.truckRegistration || '—'} {selectedRecord.truckMakeModel ? ` · ${selectedRecord.truckMakeModel}` : ''}</p>
              {selectedRecord.truckSuspended && <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">{selectedRecord.truckSuspensionPermanent ? 'Suspended (permanent)' : selectedRecord.truckSuspensionEndsAt ? `Suspended until ${formatDate(selectedRecord.truckSuspensionEndsAt)}` : 'Suspended'}</span>}
            </div>
            <div>
              <p className="font-medium text-surface-900">Driver</p>
              <p className="text-surface-600">{selectedRecord.driverName || '—'}</p>
            </div>
            <div className="border-t border-surface-200 pt-3">
              <p className="font-medium text-surface-900 mb-2">Truck inspection</p>
              <ul className="space-y-1 text-surface-600">
                <li>GPS: {selectedRecord.gpsStatus || '—'} {selectedRecord.gpsComment && `— ${selectedRecord.gpsComment}`}</li>
                <li>Camera: {selectedRecord.cameraStatus || '—'} {selectedRecord.cameraComment && `— ${selectedRecord.cameraComment}`}</li>
                <li>Visibility: {selectedRecord.cameraVisibility || '—'} {selectedRecord.cameraVisibilityComment && `— ${selectedRecord.cameraVisibilityComment}`}</li>
              </ul>
              <p className="mt-2">{selectedRecord.recommendSuspendTruck ? <span className="text-red-700 font-medium">Recommend suspension</span> : <span className="text-green-700">OK</span>}</p>
            </div>
            <div className="border-t border-surface-200 pt-3">
              <p className="font-medium text-surface-900 mb-2">Driver road safety</p>
              <ul className="space-y-1 text-surface-600">
                {(selectedRecord.driverItems || []).map((d) => {
                  const label = DRIVER_ROAD_SAFETY_ITEMS.find((x) => x.id === d.id)?.label || d.id;
                  return <li key={d.id}>{label}: {d.status || '—'} {d.comment ? `— ${d.comment}` : ''}</li>;
                })}
              </ul>
              <p className="mt-2">{selectedRecord.recommendSuspendDriver ? <span className="text-red-700 font-medium">Recommend suspension</span> : <span className="text-green-700">OK</span>}</p>
            </div>
            <div className="border-t border-surface-200 pt-3">
              <p className="font-medium text-surface-900 mb-1">Next due (24h)</p>
              <p className="text-surface-600">{selectedRecord.truckSuspended ? (selectedRecord.truckSuspensionPermanent ? 'Suspended (permanent)' : selectedRecord.truckSuspensionEndsAt ? `Suspended until ${formatDate(selectedRecord.truckSuspensionEndsAt)}` : 'Suspended (does not expire until reinstatement)') : (getInspectionCountdown(selectedRecord.inspectedAt)?.text || '—')}</p>
            </div>
            {/* Contractor response / feedback — full view including attachments */}
            <div className="border-t border-surface-200 pt-3 mt-3 bg-surface-50 rounded-lg p-3 -mx-1">
              <p className="font-medium text-surface-900 mb-2">Contractor response / feedback</p>
              {(selectedRecord.contractorRespondedAt || selectedRecord.status === 'responded' || ((selectedRecord.responseAttachments || []).length > 0)) ? (
                <>
                  {selectedRecord.contractorRespondedAt && <p className="text-surface-600 text-xs mb-2">Responded: {formatDate(selectedRecord.contractorRespondedAt)}</p>}
                  <div className="bg-white border border-surface-200 rounded-md p-3 mb-3">
                    <p className="text-surface-800 text-sm whitespace-pre-wrap break-words min-h-[2em]">{selectedRecord.contractorResponseText || '—'}</p>
                  </div>
                  {(selectedRecord.responseAttachments || []).length > 0 && (
                    <div className="mt-2">
                      <p className="text-surface-700 text-xs font-medium mb-1.5">Attachments ({selectedRecord.responseAttachments.length})</p>
                      <ul className="space-y-1.5">
                        {(selectedRecord.responseAttachments || []).map((a) => (
                          <li key={a.id} className="flex items-center gap-2 flex-wrap">
                            <span className="text-surface-700 text-sm truncate flex-1 min-w-0" title={a.fileName}>{a.fileName}</span>
                            <button type="button" onClick={() => openAttachmentWithAuth(ccApi.complianceInspections.attachmentUrl(selectedRecord.id, a.id)).catch((e) => window.alert(e?.message || 'Could not open'))} className="text-xs font-medium text-brand-600 hover:text-brand-700 shrink-0">View</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-surface-500 text-sm">No response yet. Contractor may respond within 8 hours.</p>
              )}
              {/* Your reply (Command Centre) */}
              {(selectedRecord.inspectorReplyText != null || selectedRecord.inspectorRepliedAt) && (
                <div className="mt-3 pt-3 border-t border-surface-200">
                  <p className="font-medium text-surface-900 text-xs mb-1">Your reply</p>
                  {selectedRecord.inspectorRepliedAt && <p className="text-surface-600 text-xs mb-1">Replied: {formatDate(selectedRecord.inspectorRepliedAt)}</p>}
                  <p className="text-surface-800 text-sm whitespace-pre-wrap break-words">{selectedRecord.inspectorReplyText || '—'}</p>
                </div>
              )}
              {/* Reply to contractor form */}
              {(selectedRecord.contractorRespondedAt || selectedRecord.status === 'responded' || ((selectedRecord.responseAttachments || []).length > 0)) && setInspections && (
                <div className="mt-3 pt-3 border-t border-surface-200">
                  <p className="font-medium text-surface-900 text-xs mb-1.5">Reply to contractor</p>
                  <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Type your reply…" rows={3} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-2 resize-y" />
                  <button type="button" disabled={replying} onClick={async () => {
                    const text = replyText.trim();
                    if (!text) return;
                    setReplying(true);
                    try {
                      await ccApi.complianceInspections.reply(selectedRecord.id, text);
                      const at = new Date().toISOString();
                      setInspections((prev) => prev.map((i) => i.id === selectedRecord.id ? { ...i, inspectorReplyText: text, inspectorRepliedAt: at } : i));
                      setSelectedRecord((prev) => prev ? { ...prev, inspectorReplyText: text, inspectorRepliedAt: at } : null);
                      setReplyText('');
                    } catch (e) {
                      window.alert(e?.message || 'Failed to send reply');
                    } finally {
                      setReplying(false);
                    }
                  }} className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Submit reply</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabDeleteFleetDrivers() {
  const [tenants, setTenants] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [trucks, setTrucks] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [breakdowns, setBreakdowns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'truck' | 'driver' | 'breakdown'
  const [deletingTruckId, setDeletingTruckId] = useState(null);
  const [deletingDriverId, setDeletingDriverId] = useState(null);
  const [deletingBreakdownId, setDeletingBreakdownId] = useState(null);
  const [selectedTruckIds, setSelectedTruckIds] = useState(new Set());
  const [selectedDriverIds, setSelectedDriverIds] = useState(new Set());
  const [selectedBreakdownIds, setSelectedBreakdownIds] = useState(new Set());
  const [deletingBulk, setDeletingBulk] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    setSelectedTruckIds(new Set());
    setSelectedDriverIds(new Set());
    setSelectedBreakdownIds(new Set());
    const params = {};
    if (tenantId) params.tenant_id = tenantId;
    if (contractorId) params.contractor_id = contractorId;
    if (typeFilter) params.type = typeFilter;
    return ccApi.deleteFleetDrivers.list(params)
      .then((r) => {
        setTenants(r.tenants || []);
        setContractors(r.contractors || []);
        setTrucks(r.trucks || []);
        setDrivers(r.drivers || []);
        setBreakdowns(r.breakdowns || []);
      })
      .catch((e) => { setError(e?.message || 'Failed to load'); setTrucks([]); setDrivers([]); setBreakdowns([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [tenantId, contractorId, typeFilter]);

  const toggleTruck = (id) => {
    setSelectedTruckIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAllTrucks = (checked) => {
    setSelectedTruckIds(checked ? new Set(trucks.map((t) => t.id)) : new Set());
  };
  const toggleDriver = (id) => {
    setSelectedDriverIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAllDrivers = (checked) => {
    setSelectedDriverIds(checked ? new Set(drivers.map((d) => d.id)) : new Set());
  };
  const toggleBreakdown = (id) => {
    setSelectedBreakdownIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAllBreakdowns = (checked) => {
    setSelectedBreakdownIds(checked ? new Set(breakdowns.map((b) => b.id)) : new Set());
  };

  const totalSelected = selectedTruckIds.size + selectedDriverIds.size + selectedBreakdownIds.size;
  const handleDeleteSelected = async () => {
    if (totalSelected === 0) return;
    const truckCount = selectedTruckIds.size;
    const driverCount = selectedDriverIds.size;
    const breakdownCount = selectedBreakdownIds.size;
    const msg = [
      truckCount && `${truckCount} truck${truckCount > 1 ? 's' : ''}`,
      driverCount && `${driverCount} driver${driverCount > 1 ? 's' : ''}`,
      breakdownCount && `${breakdownCount} breakdown${breakdownCount > 1 ? 's' : ''}`,
    ].filter(Boolean).join(', ');
    if (!window.confirm(`Permanently delete ${msg}? This cannot be undone.`)) return;
    setDeletingBulk(true);
    setError('');
    try {
      for (const id of selectedTruckIds) {
        await ccApi.deleteFleetDrivers.deleteTruck(id);
      }
      for (const id of selectedDriverIds) {
        await ccApi.deleteFleetDrivers.deleteDriver(id);
      }
      for (const id of selectedBreakdownIds) {
        await ccApi.deleteFleetDrivers.deleteBreakdown(id);
      }
      await load();
    } catch (e) {
      setError(e?.message || 'Failed to delete some items');
    } finally {
      setDeletingBulk(false);
    }
  };

  const handleDeleteTruck = async (truck) => {
    if (!window.confirm(`Permanently delete truck "${truck.registration || truck.id}" (${truck.contractorName || 'contractor'})? This cannot be undone.`)) return;
    setDeletingTruckId(truck.id);
    setError('');
    try {
      await ccApi.deleteFleetDrivers.deleteTruck(truck.id);
      load();
    } catch (e) {
      setError(e?.message || 'Failed to delete truck');
    } finally {
      setDeletingTruckId(null);
    }
  };

  const handleDeleteDriver = async (driver) => {
    const name = [driver.fullName, driver.surname].filter(Boolean).join(' ').trim() || driver.id;
    if (!window.confirm(`Permanently delete driver "${name}" (${driver.contractorName || 'contractor'})? This cannot be undone.`)) return;
    setDeletingDriverId(driver.id);
    setError('');
    try {
      await ccApi.deleteFleetDrivers.deleteDriver(driver.id);
      load();
    } catch (e) {
      setError(e?.message || 'Failed to delete driver');
    } finally {
      setDeletingDriverId(null);
    }
  };

  const handleDeleteBreakdown = async (b) => {
    const label = (b.title || b.type || 'Breakdown').toString().trim() || b.id;
    if (!window.confirm(`Permanently delete breakdown "${label}"? This cannot be undone.`)) return;
    setDeletingBreakdownId(b.id);
    setError('');
    try {
      await ccApi.deleteFleetDrivers.deleteBreakdown(b.id);
      load();
    } catch (e) {
      setError(e?.message || 'Failed to delete breakdown');
    } finally {
      setDeletingBreakdownId(null);
    }
  };

  const formatBreakdownDate = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—');

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-900">Delete contractors fleets/drivers</h2>
      <p className="text-sm text-surface-600">Permanently remove trucks, drivers, or reported breakdowns (incidents) added by contractors. Use filters to narrow the list, then delete as needed.</p>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex justify-between items-center">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-600 hover:text-red-900 font-medium">Dismiss</button>
        </div>
      )}

      <div className="flex flex-wrap gap-4 items-center">
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium text-surface-700">Tenant</span>
          <select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setContractorId(''); }} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm min-w-[180px]">
            <option value="">All tenants</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium text-surface-700">Contractor</span>
          <select value={contractorId} onChange={(e) => setContractorId(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm min-w-[180px]" disabled={!tenantId}>
            <option value="">All contractors</option>
            {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium text-surface-700">Type</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm">
            <option value="all">Fleet, drivers and breakdowns</option>
            <option value="truck">Fleet only</option>
            <option value="driver">Drivers only</option>
            <option value="breakdown">Breakdowns only</option>
          </select>
        </label>
        <button type="button" onClick={load} className="px-3 py-1.5 text-sm rounded-lg bg-surface-200 text-surface-800 hover:bg-surface-300">Refresh</button>
      </div>

      {!loading && totalSelected > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-red-800">
            {[
              selectedTruckIds.size > 0 && `${selectedTruckIds.size} truck${selectedTruckIds.size > 1 ? 's' : ''}`,
              selectedDriverIds.size > 0 && `${selectedDriverIds.size} driver${selectedDriverIds.size > 1 ? 's' : ''}`,
              selectedBreakdownIds.size > 0 && `${selectedBreakdownIds.size} breakdown${selectedBreakdownIds.size > 1 ? 's' : ''}`,
            ].filter(Boolean).join(', ')} selected
          </span>
          <button type="button" disabled={deletingBulk} onClick={handleDeleteSelected} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{deletingBulk ? 'Deleting…' : 'Delete selected'}</button>
          <button type="button" onClick={() => { setSelectedTruckIds(new Set()); setSelectedDriverIds(new Set()); setSelectedBreakdownIds(new Set()); }} className="px-3 py-1.5 text-sm text-red-700 hover:text-red-900 font-medium">Clear selection</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        {loading ? (
          <p className="p-6 text-surface-500">Loading…</p>
        ) : (
          <div className="divide-y divide-surface-200">
            {(typeFilter === 'all' || typeFilter === 'truck') && (
              <div className="p-4">
                <h3 className="font-medium text-surface-900 mb-3">Fleet (trucks)</h3>
                {trucks.length === 0 ? (
                  <p className="text-sm text-surface-500">No trucks match the filters.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-200">
                        <th className="p-2 w-10">
                          <input type="checkbox" checked={trucks.length > 0 && selectedTruckIds.size === trucks.length} onChange={(e) => toggleAllTrucks(e.target.checked)} className="rounded border-surface-300" aria-label="Select all trucks" />
                        </th>
                        <th className="text-left p-2 font-medium text-surface-700">Registration</th>
                        <th className="text-left p-2 font-medium text-surface-700">Make / model</th>
                        <th className="text-left p-2 font-medium text-surface-700">Tenant</th>
                        <th className="text-left p-2 font-medium text-surface-700">Contractor</th>
                        <th className="text-left p-2 font-medium text-surface-700">Status</th>
                        <th className="p-2 w-24" />
                      </tr>
                    </thead>
                    <tbody>
                      {trucks.map((t) => (
                        <tr key={t.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                          <td className="p-2">
                            <input type="checkbox" checked={selectedTruckIds.has(t.id)} onChange={() => toggleTruck(t.id)} className="rounded border-surface-300" aria-label={`Select ${t.registration || t.id}`} />
                          </td>
                          <td className="p-2 font-medium">{t.registration || '—'}</td>
                          <td className="p-2 text-surface-600">{t.makeModel || '—'}</td>
                          <td className="p-2 text-surface-600">{t.tenantName || '—'}</td>
                          <td className="p-2 text-surface-600">{t.contractorName || '—'}</td>
                          <td className="p-2 text-surface-600">{t.status || '—'}</td>
                          <td className="p-2">
                            <button type="button" disabled={deletingTruckId === t.id} onClick={() => handleDeleteTruck(t)} className="px-2 py-1 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{deletingTruckId === t.id ? 'Deleting…' : 'Delete'}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            {(typeFilter === 'all' || typeFilter === 'driver') && (
              <div className="p-4">
                <h3 className="font-medium text-surface-900 mb-3">Drivers</h3>
                {drivers.length === 0 ? (
                  <p className="text-sm text-surface-500">No drivers match the filters.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-200">
                        <th className="p-2 w-10">
                          <input type="checkbox" checked={drivers.length > 0 && selectedDriverIds.size === drivers.length} onChange={(e) => toggleAllDrivers(e.target.checked)} className="rounded border-surface-300" aria-label="Select all drivers" />
                        </th>
                        <th className="text-left p-2 font-medium text-surface-700">Name</th>
                        <th className="text-left p-2 font-medium text-surface-700">ID / licence</th>
                        <th className="text-left p-2 font-medium text-surface-700">Tenant</th>
                        <th className="text-left p-2 font-medium text-surface-700">Contractor</th>
                        <th className="p-2 w-24" />
                      </tr>
                    </thead>
                    <tbody>
                      {drivers.map((d) => (
                        <tr key={d.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                          <td className="p-2">
                            <input type="checkbox" checked={selectedDriverIds.has(d.id)} onChange={() => toggleDriver(d.id)} className="rounded border-surface-300" aria-label={`Select ${[d.fullName, d.surname].filter(Boolean).join(' ') || d.id}`} />
                          </td>
                          <td className="p-2 font-medium">{[d.fullName, d.surname].filter(Boolean).join(' ') || '—'}</td>
                          <td className="p-2 text-surface-600">{d.idNumber || d.licenseNumber || '—'}</td>
                          <td className="p-2 text-surface-600">{d.tenantName || '—'}</td>
                          <td className="p-2 text-surface-600">{d.contractorName || '—'}</td>
                          <td className="p-2">
                            <button type="button" disabled={deletingDriverId === d.id} onClick={() => handleDeleteDriver(d)} className="px-2 py-1 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{deletingDriverId === d.id ? 'Deleting…' : 'Delete'}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            {(typeFilter === 'all' || typeFilter === 'breakdown') && (
              <div className="p-4">
                <h3 className="font-medium text-surface-900 mb-3">Breakdowns (reported incidents)</h3>
                {breakdowns.length === 0 ? (
                  <p className="text-sm text-surface-500">No breakdowns match the filters.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-200">
                        <th className="p-2 w-10">
                          <input type="checkbox" checked={breakdowns.length > 0 && selectedBreakdownIds.size === breakdowns.length} onChange={(e) => toggleAllBreakdowns(e.target.checked)} className="rounded border-surface-300" aria-label="Select all breakdowns" />
                        </th>
                        <th className="text-left p-2 font-medium text-surface-700">Title / type</th>
                        <th className="text-left p-2 font-medium text-surface-700">Reported</th>
                        <th className="text-left p-2 font-medium text-surface-700">Tenant</th>
                        <th className="text-left p-2 font-medium text-surface-700">Contractor</th>
                        <th className="text-left p-2 font-medium text-surface-700">Status</th>
                        <th className="p-2 w-24" />
                      </tr>
                    </thead>
                    <tbody>
                      {breakdowns.map((b) => (
                        <tr key={b.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                          <td className="p-2">
                            <input type="checkbox" checked={selectedBreakdownIds.has(b.id)} onChange={() => toggleBreakdown(b.id)} className="rounded border-surface-300" aria-label={`Select ${b.title || b.id}`} />
                          </td>
                          <td className="p-2 font-medium">{(b.title || b.type || '—').toString()}</td>
                          <td className="p-2 text-surface-600">{formatBreakdownDate(b.reportedAt)}</td>
                          <td className="p-2 text-surface-600">{b.tenantName || '—'}</td>
                          <td className="p-2 text-surface-600">{b.contractorName || '—'}</td>
                          <td className="p-2 text-surface-600">{b.resolvedAt ? 'Resolved' : 'Open'}</td>
                          <td className="p-2">
                            <button type="button" disabled={deletingBreakdownId === b.id} onClick={() => handleDeleteBreakdown(b)} className="px-2 py-1 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{deletingBreakdownId === b.id ? 'Deleting…' : 'Delete'}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TabContractorBlock() {
  const [suspensions, setSuspensions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(''); // '' | 'under_appeal' | 'suspended'
  const [reinstatingId, setReinstatingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    ccApi.suspensions.list(statusFilter || undefined)
      .then((r) => setSuspensions(r.suspensions || []))
      .catch((e) => { setError(e?.message || 'Failed to load'); setSuspensions([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [statusFilter]);

  const formatDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—');

  const handleReinstate = async (s) => {
    if (!window.confirm(`Reinstate this ${s.entity_type === 'truck' ? 'truck' : 'driver'}? The contractor and rector will be notified.`)) return;
    setReinstatingId(s.id);
    setError('');
    setSuccess('');
    try {
      await ccApi.suspensions.reinstate(s.id);
      setSuccess(`${s.entity_type === 'truck' ? 'Truck' : 'Driver'} reinstated. Contractor and rector have been notified.`);
      load();
    } catch (e) {
      setError(e?.message || 'Failed to reinstate');
    } finally {
      setReinstatingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-900">Contractor block</h2>
      <p className="text-sm text-surface-600">Review suspended and under-appeal fleet/drivers. After the contractor has responded, you can reinstate (unblock) here. Suspensions also end automatically when the suspension period is over.</p>

      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex justify-between items-center">
          <span>{success}</span>
          <button type="button" onClick={() => setSuccess('')} className="text-emerald-600 hover:text-emerald-900 font-medium">Dismiss</button>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex justify-between items-center">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="text-amber-600 hover:text-amber-900 font-medium">Dismiss</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm font-medium text-surface-700">Status:</span>
        <button type="button" onClick={() => setStatusFilter('')} className={`px-3 py-1.5 text-sm rounded-lg ${statusFilter === '' ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-700 hover:bg-surface-200'}`}>All</button>
        <button type="button" onClick={() => setStatusFilter('under_appeal')} className={`px-3 py-1.5 text-sm rounded-lg ${statusFilter === 'under_appeal' ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-700 hover:bg-surface-200'}`}>Under appeal</button>
        <button type="button" onClick={() => setStatusFilter('suspended')} className={`px-3 py-1.5 text-sm rounded-lg ${statusFilter === 'suspended' ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-700 hover:bg-surface-200'}`}>Suspended</button>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        {loading ? (
          <p className="p-6 text-surface-500">Loading…</p>
        ) : suspensions.length === 0 ? (
          <p className="p-6 text-surface-500">No suspensions match the filter.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left p-3 font-medium text-surface-700">Type</th>
                <th className="text-left p-3 font-medium text-surface-700">Fleet / Driver</th>
                <th className="text-left p-3 font-medium text-surface-700">Contractor</th>
                <th className="text-left p-3 font-medium text-surface-700">Status</th>
                <th className="text-left p-3 font-medium text-surface-700">Created</th>
                <th className="text-left p-3 font-medium text-surface-700">Appeal / reason</th>
                <th className="p-3 w-28" />
              </tr>
            </thead>
            <tbody>
              {suspensions.map((s) => (
                <tr key={s.id} className="border-b border-surface-100 hover:bg-surface-50/50">
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.entity_type === 'truck' ? 'bg-blue-100 text-blue-800' : 'bg-violet-100 text-violet-800'}`}>
                      {s.entity_type === 'truck' ? 'Fleet' : 'Driver'}
                    </span>
                  </td>
                  <td className="p-3 font-medium text-surface-900">{s.entity_label || '—'}</td>
                  <td className="p-3 text-surface-600">{s.tenant_name || '—'}</td>
                  <td className="p-3">
                    <span className={s.status === 'under_appeal' ? 'text-amber-700 font-medium' : 'text-red-700 font-medium'}>{s.status === 'under_appeal' ? 'Under appeal' : 'Suspended'}</span>
                  </td>
                  <td className="p-3 text-surface-600">{formatDate(s.created_at)}</td>
                  <td className="p-3 text-surface-600 max-w-xs truncate" title={s.appeal_notes || s.reason}>{s.appeal_notes || s.reason || '—'}</td>
                  <td className="p-3">
                    <button type="button" disabled={reinstatingId === s.id} onClick={() => handleReinstate(s)} className="px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">{reinstatingId === s.id ? 'Reinstating…' : 'Reinstate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TabApplications() {
  const [applicationsSubTab, setApplicationsSubTab] = useState('contract-additions'); // 'contract-additions' | 'integration'
  const [applications, setApplications] = useState([]);
  const [filter, setFilter] = useState('pending'); // 'pending' | 'all'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [decliningId, setDecliningId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [searchContractor, setSearchContractor] = useState('');
  const [filterType, setFilterType] = useState(''); // '' | 'truck' | 'driver'
  const [filterSource, setFilterSource] = useState(''); // '' | 'manual' | 'import'
  const [showExportExcelModal, setShowExportExcelModal] = useState(false);
  const [exportColumnIds, setExportColumnIds] = useState(() => FLEET_APP_EXPORT_COLUMNS.map((c) => c.id));
  const [exportingExcel, setExportingExcel] = useState(false);
  const [rectors, setRectors] = useState([]);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approveModalId, setApproveModalId] = useState(null);
  const [notifyRectors, setNotifyRectors] = useState(false);
  const [selectedRectorIds, setSelectedRectorIds] = useState(new Set());
  const [showBulkApproveModal, setShowBulkApproveModal] = useState(false);

  useEffect(() => {
    ccApi.rectors().then((r) => setRectors(r.rectors || [])).catch(() => setRectors([]));
  }, []);

  const loadList = () => {
    setLoading(true);
    setError('');
    ccApi.fleetApplications.list(filter === 'pending' ? 'pending' : undefined)
      .then((r) => { setApplications(r.applications || []); })
      .catch((e) => { setError(e?.message || 'Failed to load applications'); setApplications([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadList(); }, [filter]);

  const [applicationComments, setApplicationComments] = useState([]);
  const [applicationCommentBody, setApplicationCommentBody] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setApplicationComments([]); return; }
    setDetailLoading(true);
    ccApi.fleetApplications.get(selectedId)
      .then((r) => { setDetail(r.application); })
      .catch(() => { setDetail(null); })
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    setCommentsLoading(true);
    ccApi.fleetApplications.getComments(selectedId)
      .then((r) => { setApplicationComments(r.comments || []); })
      .catch(() => setApplicationComments([]))
      .finally(() => setCommentsLoading(false));
  }, [selectedId]);

  const handleAddApplicationComment = async () => {
    const body = applicationCommentBody.trim();
    if (!body || !selectedId) return;
    setSubmittingComment(true);
    try {
      await ccApi.fleetApplications.addComment(selectedId, body);
      setApplicationCommentBody('');
      const r = await ccApi.fleetApplications.getComments(selectedId);
      setApplicationComments(r.comments || []);
    } catch (e) {
      window.alert(e?.message || 'Failed to add comment');
    } finally {
      setSubmittingComment(false);
    }
  };

  const formatDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—');

  const openApproveModal = (id) => {
    setApproveModalId(id);
    setNotifyRectors(false);
    setSelectedRectorIds(new Set());
    setShowApproveModal(true);
  };

  const handleApproveSubmit = async () => {
    if (!approveModalId) return;
    setActing(true);
    try {
      await ccApi.fleetApplications.approve(approveModalId, {
        notify_rectors: notifyRectors && selectedRectorIds.size > 0,
        rector_user_ids: notifyRectors ? [...selectedRectorIds] : [],
      });
      setShowApproveModal(false);
      setApproveModalId(null);
      loadList();
      if (selectedId === approveModalId) setSelectedId(null);
    } catch (e) {
      window.alert(e?.message || 'Failed to approve');
    } finally {
      setActing(false);
    }
  };

  const toggleRector = (rectorId) => {
    setSelectedRectorIds((prev) => {
      const next = new Set(prev);
      if (next.has(rectorId)) next.delete(rectorId);
      else next.add(rectorId);
      return next;
    });
  };

  const openDeclineModal = (id) => {
    setDecliningId(id);
    setDeclineReason('');
    setShowDeclineModal(true);
  };

  const handleDeclineSubmit = async () => {
    const reason = declineReason.trim();
    if (!reason) {
      window.alert('Please provide a reason for declining so the contractor can understand why the addition was not approved.');
      return;
    }
    if (!decliningId) return;
    setActing(true);
    try {
      await ccApi.fleetApplications.decline(decliningId, reason);
      setShowDeclineModal(false);
      setDecliningId(null);
      setDeclineReason('');
      loadList();
      if (selectedId === decliningId) setSelectedId(null);
    } catch (e) {
      window.alert(e?.message || 'Failed to decline');
    } finally {
      setActing(false);
    }
  };

  const displayName = (app) => app.entityType === 'truck' ? (app.truckRegistration || '—') : (app.driverName || '—');
  const displayType = (app) => app.entityType === 'truck' ? 'Truck' : 'Driver';
  const displaySource = (app) => (app.source || 'manual') === 'import' ? 'Import' : 'Manual';

  const filteredApplications = applications.filter((app) => {
    if (searchContractor.trim() && !(app.contractorName || '').toLowerCase().includes(searchContractor.trim().toLowerCase())) return false;
    if (filterType && app.entityType !== filterType) return false;
    if (filterSource && (app.source || 'manual') !== filterSource) return false;
    return true;
  });
  const pendingInList = filteredApplications.filter((a) => a.status === 'pending');
  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllPending = () => setSelectedIds(new Set(pendingInList.map((a) => a.id)));
  const selectAllFiltered = () => setSelectedIds(new Set(filteredApplications.map((a) => a.id)));
  const clearSelection = () => setSelectedIds(new Set());
  const applicationsToExport = selectedIds.size > 0
    ? filteredApplications.filter((app) => selectedIds.has(app.id))
    : filteredApplications;
  const openBulkApproveModal = () => {
    const ids = [...selectedIds].filter((id) => pendingInList.some((a) => a.id === id));
    if (ids.length === 0) return;
    setNotifyRectors(false);
    setSelectedRectorIds(new Set());
    setShowBulkApproveModal(true);
  };

  const handleBulkApproveSubmit = async () => {
    const ids = [...selectedIds].filter((id) => pendingInList.some((a) => a.id === id));
    if (ids.length === 0) return;
    setActing(true);
    try {
      await ccApi.fleetApplications.bulkApprove(ids, {
        notify_rectors: notifyRectors && selectedRectorIds.size > 0,
        rector_user_ids: notifyRectors ? [...selectedRectorIds] : [],
      });
      setShowBulkApproveModal(false);
      clearSelection();
      loadList();
      setSelectedId(null);
    } catch (e) {
      window.alert(e?.message || 'Failed to approve some applications');
    } finally {
      setActing(false);
    }
  };
  const exportCsv = () => {
    const headers = ['Contractor', 'Type', 'Name / Registration', 'Source', 'Submitted', 'Status'];
    const rows = applicationsToExport.map((app) => [
      app.contractorName || '',
      displayType(app),
      displayName(app),
      displaySource(app),
      app.createdAt ? new Date(app.createdAt).toISOString() : '',
      app.status || '',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fleet-applications-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = async () => {
    const selectedCols = FLEET_APP_EXPORT_COLUMNS.filter((c) => exportColumnIds.includes(c.id));
    if (selectedCols.length === 0) {
      window.alert('Please select at least one column to export.');
      return;
    }
    setExportingExcel(true);
    const opts = { formatDate };
    const headers = selectedCols.map((c) => c.label);
    let enriched;
    try {
      // Enrich each application with full entity (trailers, tracking, etc.) from detail endpoint so Excel has all data
      enriched = await Promise.all(
        applicationsToExport.map(async (app) => {
          try {
            const r = await ccApi.fleetApplications.get(app.id);
            const entity = r?.application?.entity;
            if (!entity) return app;
            const merged = { ...app };
            if (app.entityType === 'truck' && entity) {
              const e = entity;
              merged.truckTrailer1RegNo = merged.truckTrailer1RegNo ?? e.trailer_1_reg_no ?? e.trailer1RegNo ?? '';
              merged.truckTrailer2RegNo = merged.truckTrailer2RegNo ?? e.trailer_2_reg_no ?? e.trailer2RegNo ?? '';
              merged.truckTrackingProvider = merged.truckTrackingProvider ?? e.tracking_provider ?? e.trackingProvider ?? '';
              merged.truckTrackingUsername = merged.truckTrackingUsername ?? e.tracking_username ?? e.trackingUsername ?? '';
              merged.truckTrackingPassword = merged.truckTrackingPassword ?? e.tracking_password ?? e.trackingPassword ?? '';
              merged.truckSubContractor = merged.truckSubContractor ?? e.sub_contractor ?? e.subContractor ?? '';
              merged.truckYearModel = merged.truckYearModel ?? e.year_model ?? e.yearModel ?? '';
              merged.truckOwnershipDesc = merged.truckOwnershipDesc ?? e.ownership_desc ?? e.ownershipDesc ?? '';
              merged.truckFleetNo = merged.truckFleetNo ?? e.fleet_no ?? e.fleetNo ?? '';
              merged.truckCommodityType = merged.truckCommodityType ?? e.commodity_type ?? e.commodityType ?? '';
              merged.truckCapacityTonnes = merged.truckCapacityTonnes ?? e.capacity_tonnes ?? e.capacityTonnes ?? '';
              merged.truckStatus = merged.truckStatus ?? e.status ?? '';
            }
            if (app.entityType === 'driver' && entity) {
              const e = entity;
              merged.driverSurname = merged.driverSurname ?? e.surname ?? '';
              merged.driverLicenseExpiry = merged.driverLicenseExpiry ?? e.license_expiry ?? e.licenseExpiry ?? '';
              merged.driverPhone = merged.driverPhone ?? e.phone ?? '';
              merged.driverEmail = merged.driverEmail ?? e.email ?? '';
            }
            return merged;
          } catch (_) {
            return app;
          }
        })
      );
    } catch (_) {
      enriched = applicationsToExport;
    }
    try {
    const rows = enriched.map((app) =>
      selectedCols.map((col) => {
        const v = col.getValue(app, opts);
        return v != null ? String(v) : '';
      })
    );
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Thinkers Afrika';
    const ws = workbook.addWorksheet('Fleet & driver applications', {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { defaultColWidth: 16 },
    });
    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFB91C1C' },
    };
    headerRow.alignment = { vertical: 'middle', wrapText: true };
    headerRow.height = 22;
    ws.getRow(1).eachCell((cell, colNumber) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });
    rows.forEach((rowValues) => {
      const row = ws.addRow(rowValues);
      row.alignment = { vertical: 'middle', wrapText: true };
      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    });
    const colWidths = headers.map((h, i) => {
      const maxContent = Math.max(h.length, ...rows.map((r) => (r[i] || '').length));
      return Math.min(Math.max(maxContent + 2, 12), 40);
    });
    ws.columns.forEach((col, i) => {
      if (colWidths[i] != null) col.width = colWidths[i];
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fleet-applications-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportExcelModal(false);
    } finally {
      setExportingExcel(false);
    }
  };

  const toggleExportColumn = (id) => {
    setExportColumnIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const selectAllExportColumns = () => setExportColumnIds(FLEET_APP_EXPORT_COLUMNS.map((c) => c.id));
  const clearAllExportColumns = () => setExportColumnIds([]);

  return (
    <div className="space-y-6 flex gap-0">
      <div className="flex-1 min-w-0 space-y-4">
        <div>
          <h2 className="text-xl font-bold text-surface-900 tracking-tight">Fleet & driver applications</h2>
          <p className="text-sm text-surface-600 mt-1">View all contract additions (including imports). Review full details, then approve to grant facility access or decline with a reason so the contractor knows why the addition was not approved.</p>
        </div>

        <div className="flex gap-2 border-b border-surface-200">
          <button
            type="button"
            onClick={() => setApplicationsSubTab('contract-additions')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${applicationsSubTab === 'contract-additions' ? 'border-brand-600 text-brand-600' : 'border-transparent text-surface-600 hover:text-surface-900'}`}
          >
            Contract additions
          </button>
          <button
            type="button"
            onClick={() => setApplicationsSubTab('integration')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${applicationsSubTab === 'integration' ? 'border-brand-600 text-brand-600' : 'border-transparent text-surface-600 hover:text-surface-900'}`}
          >
            Integration
          </button>
        </div>

        {applicationsSubTab === 'integration' && (
          <TabApplicationsIntegration />
        )}

        {applicationsSubTab === 'contract-additions' && (
          <>
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex justify-between items-center">
            {error}
            <button type="button" onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-center">
          <button
            type="button"
            onClick={() => setFilter('pending')}
            className={`px-4 py-2 text-sm font-medium rounded-lg ${filter === 'pending' ? 'bg-brand-600 text-white' : 'border border-surface-300 text-surface-700 hover:bg-surface-50'}`}
          >
            Pending
          </button>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-4 py-2 text-sm font-medium rounded-lg ${filter === 'all' ? 'bg-brand-600 text-white' : 'border border-surface-300 text-surface-700 hover:bg-surface-50'}`}
          >
            All
          </button>
          <input
            type="text"
            value={searchContractor}
            onChange={(e) => setSearchContractor(e.target.value)}
            placeholder="Search contractor…"
            className="rounded-lg border border-surface-300 px-3 py-2 text-sm w-44"
          />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
            <option value="">All types</option>
            <option value="truck">Truck</option>
            <option value="driver">Driver</option>
          </select>
          <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
            <option value="">All sources</option>
            <option value="manual">Manual</option>
            <option value="import">Import</option>
          </select>
          <button type="button" onClick={exportCsv} disabled={applicationsToExport.length === 0} className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50 disabled:opacity-50">
            Export CSV{selectedIds.size > 0 ? ` (${applicationsToExport.length})` : ''}
          </button>
          <button type="button" onClick={() => setShowExportExcelModal(true)} disabled={applicationsToExport.length === 0} className="px-4 py-2 text-sm font-medium rounded-lg bg-red-700 text-white hover:bg-red-800 disabled:opacity-50">
            Export Excel{selectedIds.size > 0 ? ` (${applicationsToExport.length} selected)` : ''}
          </button>
          <button type="button" onClick={selectAllFiltered} className="px-3 py-2 text-sm rounded-lg border border-surface-300 text-surface-600 hover:bg-surface-50">Select all</button>
          {pendingInList.length > 0 && (
            <button type="button" onClick={selectAllPending} className="px-3 py-2 text-sm rounded-lg border border-surface-300 text-surface-600 hover:bg-surface-50">Select all pending</button>
          )}
          <button type="button" onClick={clearSelection} className="px-3 py-2 text-sm rounded-lg border border-surface-300 text-surface-600 hover:bg-surface-50">Clear selection</button>
          {pendingInList.length > 0 && (
            <button type="button" onClick={openBulkApproveModal} disabled={acting || selectedIds.size === 0} className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
              {acting ? 'Approving…' : `Bulk approve (${[...selectedIds].filter((id) => pendingInList.some((a) => a.id === id)).length})`}
            </button>
          )}
        </div>

        <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-surface-100 bg-surface-50">
            <h3 className="font-semibold text-surface-900">Contract additions</h3>
            <p className="text-sm text-surface-500 mt-0.5">Click a row to view full details. Use checkboxes to select applications for export or bulk approve; use filters and Export CSV/Excel.</p>
          </div>
          <div className="overflow-x-auto">
            {loading ? (
              <p className="px-6 py-8 text-surface-500 text-sm">Loading…</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-50 border-b border-surface-200">
                    <th className="text-left font-semibold text-surface-700 px-2 py-2 w-10" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={filteredApplications.length > 0 && selectedIds.size === filteredApplications.length}
                        onChange={() => selectedIds.size === filteredApplications.length ? clearSelection() : selectAllFiltered()}
                        className="rounded border-surface-300"
                        aria-label="Select all"
                      />
                    </th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Contractor</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Type</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Name / Registration</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Source</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Submitted</th>
                    <th className="text-left font-semibold text-surface-700 px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApplications.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-surface-500 text-center">No applications match the filter.</td></tr>
                  ) : (
                    filteredApplications.map((app) => (
                      <tr
                        key={app.id}
                        onClick={() => setSelectedId(app.id)}
                        className={`border-b border-surface-100 last:border-0 hover:bg-brand-50 cursor-pointer ${selectedId === app.id ? 'bg-brand-50' : ''}`}
                      >
                        <td className="px-2 py-2 w-10" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(app.id)}
                            onChange={() => toggleSelect(app.id)}
                            className="rounded border-surface-300"
                            aria-label={`Select ${displayName(app)}`}
                          />
                        </td>
                        <td className="px-4 py-2 text-surface-700">{app.contractorName || '—'}</td>
                        <td className="px-4 py-2">{displayType(app)}</td>
                        <td className="px-4 py-2 font-medium text-surface-900">{displayName(app)}</td>
                        <td className="px-4 py-2 text-surface-600">{displaySource(app)}</td>
                        <td className="px-4 py-2 text-surface-600">{formatDate(app.createdAt)}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${app.status === 'approved' ? 'bg-green-100 text-green-800' : app.status === 'declined' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                            {app.status === 'pending' ? 'Pending' : app.status === 'approved' ? 'Approved' : 'Declined'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Addition details – side panel (like breakdown view) */}
      {selectedId && (
        <div className="fixed inset-0 z-50 flex items-stretch" aria-modal="true" role="dialog" aria-label="Addition details">
          <button type="button" onClick={() => { setSelectedId(null); setDetail(null); }} className="absolute inset-0 bg-black/40" aria-label="Close" />
          <div className="relative w-full max-w-xl ml-auto bg-white shadow-xl flex flex-col max-h-full overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200">
              <h3 className="font-semibold text-surface-900">Addition details</h3>
              <button type="button" onClick={() => { setSelectedId(null); setDetail(null); }} className="p-2 rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Close">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
              {detailLoading ? (
                <p className="text-surface-500">Loading…</p>
              ) : detail ? (
                <>
                  <div>
                    <p className="font-medium text-surface-900">Contractor</p>
                    <p className="text-surface-600">{detail.contractorName || '—'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-surface-900">Type</p>
                    <p className="text-surface-600">{detail.entityType === 'truck' ? 'Truck' : 'Driver'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-surface-900">Source</p>
                    <p className="text-surface-600">{(detail.source || 'manual') === 'import' ? 'Import' : 'Manual'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-surface-900">Submitted</p>
                    <p className="text-surface-600">{formatDate(detail.createdAt)}</p>
                  </div>
                  <div>
                    <p className="font-medium text-surface-900">Status</p>
                    <p className="text-surface-600">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${detail.status === 'approved' ? 'bg-green-100 text-green-800' : detail.status === 'declined' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                        {detail.status === 'pending' ? 'Pending' : detail.status === 'approved' ? 'Approved' : 'Declined'}
                      </span>
                    </p>
                  </div>

                  {detail.entityType === 'truck' && detail.entity && (
                    <div className="border-t border-surface-200 pt-3 space-y-2">
                      <p className="font-medium text-surface-900">Truck details</p>
                      <p className="text-surface-600"><span className="text-surface-500">Registration:</span> {detail.entity.registration || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Make / model:</span> {detail.entity.make_model || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Year model:</span> {detail.entity.year_model || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Ownership:</span> {detail.entity.ownership_desc || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Main contractor:</span> {detail.entity.main_contractor || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Sub contractor:</span> {detail.entity.sub_contractor || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Fleet no:</span> {detail.entity.fleet_no || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Trailer 1 reg:</span> {detail.entity.trailer_1_reg_no || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Trailer 2 reg:</span> {detail.entity.trailer_2_reg_no || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Commodity / capacity:</span> {[detail.entity.commodity_type, detail.entity.capacity_tonnes != null ? `${detail.entity.capacity_tonnes} t` : null].filter(Boolean).join(' · ') || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Status:</span> {detail.entity.status || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Tracking provider (tracker name):</span> {detail.entity.tracking_provider || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Tracking username:</span> {detail.entity.tracking_username || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Tracking password:</span> {detail.entity.tracking_password || '—'}</p>
                    </div>
                  )}
                  {detail.entityType === 'driver' && detail.entity && (
                    <div className="border-t border-surface-200 pt-3 space-y-2">
                      <p className="font-medium text-surface-900">Driver details</p>
                      <p className="text-surface-600"><span className="text-surface-500">Name:</span> {detail.entity.full_name || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Surname:</span> {detail.entity.surname || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">ID number:</span> {detail.entity.id_number || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Licence:</span> {detail.entity.license_number || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Licence expiry:</span> {detail.entity.license_expiry ? new Date(detail.entity.license_expiry).toLocaleDateString() : '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Phone:</span> {detail.entity.phone || '—'}</p>
                      <p className="text-surface-600"><span className="text-surface-500">Email:</span> {detail.entity.email || '—'}</p>
                    </div>
                  )}

                  {detail.status === 'declined' && detail.declineReason && (
                    <div className="border-t border-surface-200 pt-3">
                      <p className="font-medium text-surface-900">Reason declined</p>
                      <p className="text-surface-600 mt-1 whitespace-pre-wrap">{detail.declineReason}</p>
                    </div>
                  )}

                  {detail.status === 'pending' && (
                    <div className="border-t border-surface-200 pt-4 flex flex-wrap gap-3">
                      <button type="button" disabled={acting} onClick={() => openApproveModal(detail.id)} className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                        {acting ? 'Processing…' : 'Approve — grant facility access'}
                      </button>
                      <button type="button" disabled={acting} onClick={() => openDeclineModal(detail.id)} className="px-4 py-2 text-sm font-medium rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50">
                        Decline
                      </button>
                    </div>
                  )}

                  {/* Comments */}
                  <div className="border-t border-surface-200 pt-4">
                    <p className="font-medium text-surface-900 mb-2">Comments</p>
                    {commentsLoading ? (
                      <p className="text-surface-500 text-xs">Loading comments…</p>
                    ) : applicationComments.length === 0 ? (
                      <p className="text-surface-500 text-xs">No comments yet.</p>
                    ) : (
                      <ul className="space-y-2 mb-3">
                        {applicationComments.map((c) => (
                          <li key={c.id} className="rounded-lg bg-surface-50 p-2 text-sm">
                            <p className="text-surface-800 whitespace-pre-wrap">{c.body}</p>
                            <p className="text-xs text-surface-500 mt-1">{c.author_name || 'Someone'} · {c.created_at ? new Date(c.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : ''}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex gap-2">
                      <textarea
                        value={applicationCommentBody}
                        onChange={(e) => setApplicationCommentBody(e.target.value)}
                        placeholder="Add a comment…"
                        rows={2}
                        className="flex-1 rounded-lg border border-surface-300 px-3 py-2 text-sm resize-y"
                      />
                      <button type="button" disabled={submittingComment || !applicationCommentBody.trim()} onClick={handleAddApplicationComment} className="shrink-0 px-3 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                        {submittingComment ? 'Sending…' : 'Add comment'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-surface-500">Could not load details.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Export Excel – choose columns */}
      {showExportExcelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowExportExcelModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-surface-200">
              <h3 className="font-semibold text-surface-900">Export to Excel</h3>
              <p className="text-sm text-surface-600 mt-1">Choose which columns to include. Headings will be shaded red. {selectedIds.size > 0 ? `${applicationsToExport.length} selected application(s) will be exported.` : 'All applications in the current filter will be exported.'}</p>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <div className="flex gap-2 mb-3">
                <button type="button" onClick={selectAllExportColumns} className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Select all</button>
                <button type="button" onClick={clearAllExportColumns} className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Clear all</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FLEET_APP_EXPORT_COLUMNS.map((col) => (
                  <label key={col.id} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={exportColumnIds.includes(col.id)} onChange={() => toggleExportColumn(col.id)} className="rounded border-surface-300 text-red-600 focus:ring-red-500" />
                    <span className="text-sm text-surface-800">{col.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-surface-500 mt-3">{exportColumnIds.length} column(s) selected</p>
            </div>
            <div className="p-4 border-t border-surface-200 flex gap-3 justify-end">
              <button type="button" onClick={() => setShowExportExcelModal(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
              <button type="button" onClick={exportExcel} disabled={exportColumnIds.length === 0 || exportingExcel} className="px-4 py-2 text-sm font-medium rounded-lg bg-red-700 text-white hover:bg-red-800 disabled:opacity-50">{exportingExcel ? 'Preparing…' : 'Download Excel'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Decline reason modal */}
      {showDeclineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => !acting && setShowDeclineModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-surface-900 mb-2">Decline addition</h3>
            <p className="text-sm text-surface-600 mb-3">Provide a reason so the contractor knows why this truck or driver was not approved. They will see this reason on their Fleet or Drivers page.</p>
            <textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="e.g. Incomplete documentation; licence expired; registration not recognised…" rows={4} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-4 resize-y" required />
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => !acting && setShowDeclineModal(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
              <button type="button" disabled={acting || !declineReason.trim()} onClick={handleDeclineSubmit} className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">Submit decline</button>
            </div>
          </div>
        </div>
      )}

      {/* Single approve modal – optional notify rectors */}
      {showApproveModal && approveModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => !acting && setShowApproveModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-surface-900 mb-2">Approve application</h3>
            <p className="text-sm text-surface-600 mb-4">This will grant facility access. The contractor will receive an email. You can optionally notify selected rectors.</p>
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input type="checkbox" checked={notifyRectors} onChange={(e) => setNotifyRectors(e.target.checked)} className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-sm font-medium text-surface-800">Notify rectors</span>
            </label>
            {notifyRectors && (
              <div className="mb-4 pl-6 border-l-2 border-surface-200">
                <p className="text-xs text-surface-500 mb-2">Select which rectors to notify (they will receive an email for awareness):</p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {rectors.length === 0 ? (
                    <p className="text-sm text-surface-500">No rectors found. Add rectors in Access Management (route factors).</p>
                  ) : (
                    rectors.map((r) => (
                      <label key={r.id} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={selectedRectorIds.has(r.id)} onChange={() => toggleRector(r.id)} className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
                        <span className="text-sm text-surface-800">{r.full_name || r.email || r.id}</span>
                        {r.email && r.full_name && <span className="text-xs text-surface-500">({r.email})</span>}
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => !acting && setShowApproveModal(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
              <button type="button" disabled={acting} onClick={handleApproveSubmit} className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">{acting ? 'Processing…' : 'Approve'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk approve modal – optional notify rectors */}
      {showBulkApproveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => !acting && setShowBulkApproveModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-surface-900 mb-2">Bulk approve</h3>
            <p className="text-sm text-surface-600 mb-4">Approve {[...selectedIds].filter((id) => pendingInList.some((a) => a.id === id)).length} application(s)? This will grant facility access. One email will be sent to contractors listing the approved items. You can optionally notify selected rectors.</p>
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input type="checkbox" checked={notifyRectors} onChange={(e) => setNotifyRectors(e.target.checked)} className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
              <span className="text-sm font-medium text-surface-800">Notify rectors</span>
            </label>
            {notifyRectors && (
              <div className="mb-4 pl-6 border-l-2 border-surface-200">
                <p className="text-xs text-surface-500 mb-2">Select which rectors to notify:</p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {rectors.length === 0 ? (
                    <p className="text-sm text-surface-500">No rectors found.</p>
                  ) : (
                    rectors.map((r) => (
                      <label key={r.id} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={selectedRectorIds.has(r.id)} onChange={() => toggleRector(r.id)} className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
                        <span className="text-sm text-surface-800">{r.full_name || r.email || r.id}</span>
                        {r.email && r.full_name && <span className="text-xs text-surface-500">({r.email})</span>}
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => !acting && setShowBulkApproveModal(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
              <button type="button" disabled={acting} onClick={handleBulkApproveSubmit} className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">{acting ? 'Approving…' : 'Approve all'}</button>
            </div>
          </div>
        </div>
      )}
          </>
        )}
      </div>
    </div>
  );
}

function TabApplicationsIntegration() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [contractors, setContractors] = useState([]);
  const [tenantFilter, setTenantFilter] = useState('');
  const [exportColumnIds, setExportColumnIds] = useState(() => FLEET_INTEGRATION_EXPORT_COLUMNS.map((c) => c.id));
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const loadData = () => {
    setLoading(true);
    setError('');
    Promise.all([
      ccApi.contractorsDetails().then((r) => r.contractors || []),
      ccApi.fleetIntegration.list(tenantFilter ? { tenantId: tenantFilter } : {}),
    ])
      .then(([contractorsList, integrationRes]) => {
        setContractors(contractorsList);
        setRows(integrationRes.rows || []);
      })
      .catch((e) => {
        setError(e?.message || 'Failed to load fleet integration data');
        setRows([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, [tenantFilter]);

  const formatDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' }) : '');
  const filteredRows = rows;
  const toggleExportColumn = (id) => {
    setExportColumnIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const selectAllExportColumns = () => setExportColumnIds(FLEET_INTEGRATION_EXPORT_COLUMNS.map((c) => c.id));
  const clearAllExportColumns = () => setExportColumnIds([]);

  const exportExcel = async () => {
    const selectedCols = FLEET_INTEGRATION_EXPORT_COLUMNS.filter((c) => exportColumnIds.includes(c.id));
    if (selectedCols.length === 0) return;
    setExportingExcel(true);
    try {
      const opts = { formatDate };
      const headers = selectedCols.map((c) => c.label);
      const dataRows = filteredRows.map((row) =>
        selectedCols.map((col) => {
          const v = col.getValue(row, opts);
          return v != null ? String(v) : '';
        })
      );
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Thinkers';
      const ws = workbook.addWorksheet('Fleet with linked drivers', {
        views: [{ state: 'frozen', ySplit: 1 }],
        properties: { defaultColWidth: 14 },
      });
      const headerRow = ws.addRow(headers);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB91C1C' } };
      headerRow.alignment = { vertical: 'middle', wrapText: true };
      headerRow.height = 22;
      ws.getRow(1).eachCell((cell) => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
      dataRows.forEach((rowValues) => {
        const row = ws.addRow(rowValues);
        row.alignment = { vertical: 'middle', wrapText: true };
        row.eachCell((cell) => {
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
      });
      const colWidths = headers.map((h, i) => {
        const maxContent = Math.max(h.length, ...dataRows.map((r) => (r[i] || '').length));
        return Math.min(Math.max(maxContent + 2, 12), 40);
      });
      ws.columns.forEach((col, i) => { if (colWidths[i] != null) col.width = colWidths[i]; });
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fleet-integration-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setShowExportModal(false);
    } catch (e) {
      window.alert(e?.message || 'Export failed');
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-surface-600">View fleets with linked drivers. Choose which columns to include and download a professional Excel sheet with red header styling.</p>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex justify-between items-center">
          {error}
          <button type="button" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      <div className="flex flex-wrap gap-3 items-center">
        <label className="text-sm font-medium text-surface-700">Contractor</label>
        <select
          value={tenantFilter}
          onChange={(e) => setTenantFilter(e.target.value)}
          className="rounded-lg border border-surface-300 px-3 py-2 text-sm min-w-[180px]"
        >
          <option value="">All contractors</option>
          {contractors.map((c) => (
            <option key={c.tenantId} value={c.tenantId}>{c.tenantName || c.tenantId}</option>
          ))}
        </select>
        <button type="button" onClick={loadData} className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Refresh</button>
        <button type="button" onClick={() => setShowExportModal(true)} className="px-4 py-2 text-sm font-medium rounded-lg bg-red-700 text-white hover:bg-red-800">
          Choose columns & download Excel
        </button>
      </div>
      <section className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-surface-100 bg-surface-50">
          <h3 className="font-semibold text-surface-900">Fleet with linked drivers</h3>
          <p className="text-sm text-surface-500 mt-0.5">All items are available for export. Use the button above to choose how the download should look (which columns to include). Headings will have a light red shade.</p>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <p className="px-6 py-8 text-surface-500 text-sm">Loading…</p>
          ) : filteredRows.length === 0 ? (
            <p className="px-6 py-8 text-surface-500 text-center">No fleet data. Add trucks and link drivers in the Contractor portal.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-50 border-b border-surface-200">
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Contractor</th>
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Truck registration</th>
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Truck fleet no</th>
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Linked driver</th>
                  <th className="text-left font-semibold text-surface-700 px-4 py-2">Commodity type</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.truckId} className="border-b border-surface-100 last:border-0 hover:bg-surface-50">
                    <td className="px-4 py-2 text-surface-700">{row.contractorName || '—'}</td>
                    <td className="px-4 py-2 font-medium text-surface-900">{row.truckRegistration || '—'}</td>
                    <td className="px-4 py-2 text-surface-600">{row.truckFleetNo || '—'}</td>
                    <td className="px-4 py-2 text-surface-600">
                      {[row.driverFullName, row.driverSurname].filter(Boolean).join(' ').trim() || '—'}
                    </td>
                    <td className="px-4 py-2 text-surface-600">{row.truckCommodityType || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowExportModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-surface-200">
              <h3 className="font-semibold text-surface-900">Download Excel – choose columns</h3>
              <p className="text-sm text-surface-600 mt-1">Select which columns to include. Headings will be in a light red shade; the sheet will look professional. All items are listed above—you decide how the download should look.</p>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <div className="flex gap-2 mb-3">
                <button type="button" onClick={selectAllExportColumns} className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Select all</button>
                <button type="button" onClick={clearAllExportColumns} className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Clear all</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FLEET_INTEGRATION_EXPORT_COLUMNS.map((col) => (
                  <label key={col.id} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={exportColumnIds.includes(col.id)} onChange={() => toggleExportColumn(col.id)} className="rounded border-surface-300 text-red-600 focus:ring-red-500" />
                    <span className="text-sm text-surface-800">{col.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-surface-500 mt-3">{exportColumnIds.length} column(s) selected</p>
            </div>
            <div className="p-4 border-t border-surface-200 flex gap-3 justify-end">
              <button type="button" onClick={() => setShowExportModal(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
              <button type="button" onClick={exportExcel} disabled={exportColumnIds.length === 0 || exportingExcel} className="px-4 py-2 text-sm font-medium rounded-lg bg-red-700 text-white hover:bg-red-800 disabled:opacity-50">{exportingExcel ? 'Preparing…' : 'Download Excel'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabDelivery() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-900">Delivery management</h2>
      <p className="text-sm text-surface-600">Document delivery stats per truck. Import transactions.</p>
      <div className="bg-white rounded-xl border border-surface-200 p-6 space-y-4">
        <div className="flex gap-3">
          <button type="button" className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700">Add delivery record</button>
          <button type="button" className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Import transactions</button>
        </div>
        <p className="text-surface-500 text-sm">Delivery stats per truck and import function for transactions.</p>
      </div>
    </div>
  );
}

function ManageTabAccess({ isSuperAdmin, permissions, setPermissions, users, setUsers, allTabIds }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    setLoading(true);
    Promise.all([ccApi.permissions(), usersApi.list({ limit: 200 })])
      .then(([permRes, usersRes]) => {
        setPermissions(permRes.permissions || []);
        setUsers(usersRes.users || []);
      })
      .catch(() => setPermissions([]))
      .finally(() => setLoading(false));
  }, [isSuperAdmin]);

  const handleGrant = (userId, tabId) => {
    setSaving(`${userId}-${tabId}`);
    ccApi.grantPermission(userId, tabId)
      .then(() => {
        setPermissions((prev) => {
          const next = prev.map((p) => (p.user_id === userId ? { ...p, tabs: [...(p.tabs || []), tabId] } : p));
          if (!next.find((p) => p.user_id === userId)) next.push({ user_id: userId, full_name: '', email: '', tabs: [tabId] });
          return next;
        });
      })
      .finally(() => setSaving(null));
  };

  const handleRevoke = (userId, tabId) => {
    setSaving(`${userId}-${tabId}`);
    ccApi.revokePermission(userId, tabId)
      .then(() => {
        setPermissions((prev) => prev.map((p) => (p.user_id === userId ? { ...p, tabs: (p.tabs || []).filter((t) => t !== tabId) } : p)));
      })
      .finally(() => setSaving(null));
  };

  if (!isSuperAdmin) return null;
  if (loading) return <p className="text-surface-500">Loading permissions…</p>;

  const permByUser = (permissions || []).reduce((acc, p) => { acc[p.user_id] = p; return acc; }, {});

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-surface-900">Manage tab access</h2>
      <p className="text-sm text-surface-600">Grant or revoke Command Centre tab access for users. Only super admins see this.</p>
      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50">
                <th className="px-4 py-3 text-left font-medium text-surface-700">User</th>
                {allTabIds.map((tabId) => (
                  <th key={tabId} className="px-3 py-3 text-left font-medium text-surface-700 whitespace-nowrap">
                    {CC_TABS.find((t) => t.id === tabId)?.label || tabId}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(users || []).map((u) => {
                const grants = permByUser[u.id]?.tabs || [];
                return (
                  <tr key={u.id} className="border-b border-surface-100">
                    <td className="px-4 py-2">
                      <span className="font-medium text-surface-900">{u.full_name || u.email}</span>
                      <span className="text-surface-500 block text-xs">{u.email}</span>
                    </td>
                    {allTabIds.map((tabId) => {
                      const has = grants.includes(tabId);
                      const key = `${u.id}-${tabId}`;
                      return (
                        <td key={key} className="px-3 py-2">
                          {has ? (
                            <button
                              type="button"
                              onClick={() => handleRevoke(u.id, tabId)}
                              disabled={saving === key}
                              className="text-xs px-2 py-1 rounded bg-brand-100 text-brand-800 hover:bg-brand-200 disabled:opacity-50"
                            >
                              {saving === key ? '…' : 'Revoke'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleGrant(u.id, tabId)}
                              disabled={saving === key}
                              className="text-xs px-2 py-1 rounded border border-surface-300 text-surface-600 hover:bg-surface-50 disabled:opacity-50"
                            >
                              {saving === key ? '…' : 'Grant'}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(!users || users.length === 0) && <p className="p-4 text-surface-500 text-sm">No users found.</p>}
      </div>
    </div>
  );
}
