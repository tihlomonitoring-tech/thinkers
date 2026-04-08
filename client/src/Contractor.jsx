import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { canAccessPage } from './lib/pageAccess.js';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { contractor as contractorApi, tenants as tenantsApi, openAttachmentWithAuth } from './api';
import { parseExcelFile, downloadTruckTemplate, downloadDriverTemplate, downloadConsolidatedTemplate, parseConsolidatedFile } from './lib/excelImport.js';
import JSZip from 'jszip';
import { generateBreakdownPdf } from './lib/breakdownPdfReport.js';

const CONTRACTOR_NAV = [
  {
    section: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: 'dashboard' }],
  },
  {
    section: 'Fleet',
    items: [
      { id: 'trucks', label: 'Add truck', icon: 'truck' },
      { id: 'fleet', label: 'Fleet', icon: 'list' },
    ],
  },
  {
    section: 'Drivers',
    items: [
      { id: 'drivers', label: 'Add driver', icon: 'user' },
      { id: 'driver-register', label: 'Driver register', icon: 'list' },
    ],
  },
  {
    section: 'Import',
    items: [{ id: 'import-all', label: 'Import all', icon: 'upload' }],
  },
  {
    section: 'Enrollment',
    items: [{ id: 'enrollment', label: 'Fleet and driver enrollment', icon: 'route' }],
  },
  {
    section: 'Contractor Information',
    items: [
      { id: 'contractor-details', label: 'Details of the contractor', icon: 'building' },
      { id: 'subcontract-details', label: 'Subcontract details', icon: 'users' },
      { id: 'library', label: 'Library', icon: 'folder' },
    ],
  },
  {
    section: 'Operations',
    items: [
      { id: 'incidents', label: 'Report breakdown / incidents', icon: 'alert' },
      { id: 'expiries', label: 'Expiries', icon: 'calendar' },
      { id: 'suspensions', label: 'Suspensions and appeals', icon: 'ban' },
      { id: 'messages', label: 'Messages', icon: 'mail' },
    ],
  },
];

const COMMODITY_TYPES = ['Grain', 'Coal', 'Minerals', 'Bulk general', 'Livestock', 'Other'];
const TRACKING_PROVIDERS = ['', 'Fleetcam', 'Cartrack', 'Nest Tar', 'Other'];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const INCIDENT_TYPES = ['Breakdown', 'Accident', 'Load spill', 'Delay', 'Other incident'];

const INCIDENT_ATTACHMENTS = [
  { type: 'loading_slip', label: 'Loading slip', pathKey: 'loading_slip_path' },
  { type: 'seal_1', label: 'Seal 1', pathKey: 'seal_1_path' },
  { type: 'seal_2', label: 'Seal 2', pathKey: 'seal_2_path' },
  { type: 'picture_problem', label: 'Picture of the problem', pathKey: 'picture_problem_path' },
];

const COMPLIANCE_DRIVER_ITEM_LABELS = {
  licence: 'Valid driver licence (current, correct class)',
  ppe: 'PPE worn (helmet, high-vis, safety boots as required)',
  sober: 'Sober / no alcohol or drug impairment',
  speed: 'Speed and road rules compliance',
  behaviour: 'Roadworthy behaviour and attitude',
  documentation: 'Documentation on hand (licence, permits)',
};

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { dateStyle: 'short' });
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function incidentRef(incident) {
  const id = incident?.id ?? '';
  return 'INC-' + String(id).replace(/-/g, '').slice(0, 8).toUpperCase();
}

// Map stored type (e.g. breakdown, load_spill) to display label (e.g. Breakdown, Load spill)
function incidentTypeLabel(type) {
  if (!type || typeof type !== 'string') return 'Incident';
  const normalized = String(type).trim().toLowerCase().replace(/\s+/g, '_');
  const found = INCIDENT_TYPES.find((t) => t.toLowerCase().replace(/\s+/g, '_') === normalized);
  if (found) return found;
  return type.replace(/_/g, ' ');
}

function ContractorNavIcon({ name, className }) {
  const c = className || 'w-5 h-5';
  switch (name) {
    case 'truck':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 17h8m0 0a2 2 0 104 0 2 2 0 00-4 0m-4 0a2 2 0 104 0 2 2 0 00-4 0m0-6h.01M12 16h.01M5 8h14l1.921 2.876c.075.113.129.24.16.373a2 2 0 01-.16 1.751L20 14v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2l-.921-1.376a2 2 0 01-.16-1.751 1.006 1.006 0 01.16-.373L5 8z" />
        </svg>
      );
    case 'list':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
      );
    case 'user':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      );
    case 'upload':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      );
    case 'alert':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      );
    case 'calendar':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case 'ban':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      );
    case 'mail':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
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
    case 'building':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      );
    case 'users':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      );
    case 'folder':
      return (
        <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      );
    default:
      return <span className={c} />;
  }
}

export default function Contractor() {
  const { user, loading: authLoading } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('contractor');
  const [activeTab, setActiveTab] = useState('dashboard');
  const contractorTabIds = CONTRACTOR_NAV.flatMap((s) => s.items.map((i) => i.id));
  const [data, setData] = useState({ trucks: [], drivers: [], incidents: [], expiries: [], suspensions: [], messages: [], complianceRecords: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(null); // { type: 'trucks'|'drivers'|'all', count?: number, trucks?: number, drivers?: number }
  const [trackingProviderIsOther, setTrackingProviderIsOther] = useState(false);
  const truckFileRef = useRef(null);
  const driverFileRef = useRef(null);
  const consolidatedFileRef = useRef(null);
  const [truckSearch, setTruckSearch] = useState('');
  const [selectedTruck, setSelectedTruck] = useState(null);
  const [driverSearch, setDriverSearch] = useState('');
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [truckDropdownOpen, setTruckDropdownOpen] = useState(false);
  const [driverDropdownOpen, setDriverDropdownOpen] = useState(false);
  const [incidentLocation, setIncidentLocation] = useState('');
  const [incidentRoutesForTruck, setIncidentRoutesForTruck] = useState([]);
  const [incidentRouteId, setIncidentRouteId] = useState('');
  const [incidentRoutesLoading, setIncidentRoutesLoading] = useState(false);
  const [contextError, setContextError] = useState(null);
  const [contractorsList, setContractorsList] = useState([]);
  const [selectedContractorId, setSelectedContractorId] = useState(null);
  const loadingSlipRef = useRef(null);
  const seal1Ref = useRef(null);
  const seal2Ref = useRef(null);
  const pictureProblemRef = useRef(null);
  const truckDropdownRef = useRef(null);
  const driverDropdownRef = useRef(null);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [incidentDetail, setIncidentDetail] = useState(null); // full incident from GET (has attachment paths)
  const [incidentDetailLoading, setIncidentDetailLoading] = useState(false);
  const [resolvingIncident, setResolvingIncident] = useState(false);
  const [showResolveForm, setShowResolveForm] = useState(false);
  const resolveFormRef = useRef(null);
  const offloadingSlipRef = useRef(null);
  const [attachmentLoading, setAttachmentLoading] = useState(null); // type being loaded
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [uploadingOffloadingSlip, setUploadingOffloadingSlip] = useState(false);
  const offloadingSlipLaterRef = useRef(null);
  const [selectedFleetTruck, setSelectedFleetTruck] = useState(null);
  const [selectedRegisterDriver, setSelectedRegisterDriver] = useState(null);
  const [driverLinkedTruckSelection, setDriverLinkedTruckSelection] = useState(null);
  const [driverLinkedTruckSearch, setDriverLinkedTruckSearch] = useState('');
  const [driverLinkedTruckDropdownOpen, setDriverLinkedTruckDropdownOpen] = useState(false);
  const driverLinkedTruckDropdownRef = useRef(null);
  const [savingTruck, setSavingTruck] = useState(false);
  const [savingDriver, setSavingDriver] = useState(false);
  const [expiryRefSearch, setExpiryRefSearch] = useState('');
  const [expiryRefDropdownOpen, setExpiryRefDropdownOpen] = useState(false);
  const [expiryItemType, setExpiryItemType] = useState('license');
  const expiryRefDropdownRef = useRef(null);
  const [complianceRespondRecord, setComplianceRespondRecord] = useState(null);
  const [complianceRespondText, setComplianceRespondText] = useState('');
  const [complianceRespondFiles, setComplianceRespondFiles] = useState([]);
  const complianceRespondFileInputRef = useRef(null);
  const [complianceResponding, setComplianceResponding] = useState(false);
  const [complianceAppealRecord, setComplianceAppealRecord] = useState(null);
  const [complianceAppealNotes, setComplianceAppealNotes] = useState('');
  const [complianceAppealing, setComplianceAppealing] = useState(false);
  const [complianceDetailRecord, setComplianceDetailRecord] = useState(null);
  const [complianceDetailLoading, setComplianceDetailLoading] = useState(false);
  const [enrollmentRouteId, setEnrollmentRouteId] = useState(null);
  const [enrollmentRouteDetail, setEnrollmentRouteDetail] = useState(null);
  const [enrollmentApprovedTrucks, setEnrollmentApprovedTrucks] = useState([]);
  const [enrollmentApprovedDrivers, setEnrollmentApprovedDrivers] = useState([]);
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [enrollmentAddTruckOpen, setEnrollmentAddTruckOpen] = useState(false);
  const [enrollmentSelectedTruckIds, setEnrollmentSelectedTruckIds] = useState([]);
  const [enrollmentEnrollingTrucks, setEnrollmentEnrollingTrucks] = useState(false);
  const [enrollmentAddDriverOpen, setEnrollmentAddDriverOpen] = useState(false);
  const [enrollmentSelectedDriverIds, setEnrollmentSelectedDriverIds] = useState([]);
  const [enrollmentEnrollingDrivers, setEnrollmentEnrollingDrivers] = useState(false);
  const [fleetListSearch, setFleetListSearch] = useState('');
  const [driverRegisterSearch, setDriverRegisterSearch] = useState('');
  const [incidentsListSearch, setIncidentsListSearch] = useState('');
  const [enrollmentRouteTruckSearch, setEnrollmentRouteTruckSearch] = useState('');
  const [enrollmentRouteDriverSearch, setEnrollmentRouteDriverSearch] = useState('');
  const [enrollmentApprovedTruckSearch, setEnrollmentApprovedTruckSearch] = useState('');
  const [enrollmentApprovedDriverSearch, setEnrollmentApprovedDriverSearch] = useState('');
  /** Route picker: search first — matches are not shown until user types (privacy). */
  const [enrollmentRoutePickerQuery, setEnrollmentRoutePickerQuery] = useState('');
  // Contractor information tabs
  const [contractorInfo, setContractorInfo] = useState(null);
  const [contractorInfoLoading, setContractorInfoLoading] = useState(false);
  const [contractorInfoSaving, setContractorInfoSaving] = useState(false);
  const [contractorInfoForm, setContractorInfoForm] = useState({});
  const [contractorInfoSuccess, setContractorInfoSuccess] = useState('');
  const [subcontractorsList, setSubcontractorsList] = useState([]);
  const [subcontractorsLoading, setSubcontractorsLoading] = useState(false);
  const [subcontractorEdit, setSubcontractorEdit] = useState(null);
  const [subcontractorForm, setSubcontractorForm] = useState({});
  const [subcontractorCompanySelect, setSubcontractorCompanySelect] = useState(''); // '' | '__NEW__' | company name
  const [subcontractorSaving, setSubcontractorSaving] = useState(false);
  const [libraryDocuments, setLibraryDocuments] = useState([]);
  const [libraryDocumentTypes, setLibraryDocumentTypes] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryUploading, setLibraryUploading] = useState(false);
  const [libraryUploadType, setLibraryUploadType] = useState('other');
  const [libraryLinkKind, setLibraryLinkKind] = useState('none'); // 'none' | 'truck' | 'driver'
  const [libraryLinkTruckId, setLibraryLinkTruckId] = useState('');
  const [libraryLinkDriverId, setLibraryLinkDriverId] = useState('');
  const [libraryEditId, setLibraryEditId] = useState(null);
  const [libraryEditKind, setLibraryEditKind] = useState('none');
  const [libraryEditTruckId, setLibraryEditTruckId] = useState('');
  const [libraryEditDriverId, setLibraryEditDriverId] = useState('');
  const [libraryLinkSavingId, setLibraryLinkSavingId] = useState(null);
  const libraryFileRef = useRef(null);

  const hasTenant = user?.tenant_id;

  useEffect(() => {
    const requested = (() => {
      try { return sessionStorage.getItem('contractor-global-target-tab'); } catch (_) { return null; }
    })();
    if (!requested) return;
    if (contractorTabIds.includes(requested)) setActiveTab(requested);
    try { sessionStorage.removeItem('contractor-global-target-tab'); } catch (_) {}
  }, []);

  /** Query params for contractor-app enrollment only (strict privacy; never tenant-wide for hauliers). */
  const enrollmentContractorQuery = () => ({
    enrollmentPortal: '1',
    ...(selectedContractorId ? { contractor_id: selectedContractorId } : {}),
  });

  // Enrollment tab: approved fleet/drivers for picklists (scoped server-side; optional contractor filter)
  useEffect(() => {
    if (activeTab !== 'enrollment') return;
    let cancelled = false;
    setEnrollmentLoading(true);
    const cOpt = selectedContractorId || undefined;
    const portalOpts = { enrollmentPortal: '1' };
    Promise.all([
      contractorApi.enrollment.approvedTrucks(cOpt, portalOpts).then((r) => r.trucks || []),
      contractorApi.enrollment.approvedDrivers(cOpt, portalOpts).then((r) => r.drivers || []),
    ])
      .then(([trucks, drivers]) => {
        if (!cancelled) {
          setEnrollmentApprovedTrucks(trucks);
          setEnrollmentApprovedDrivers(drivers);
        }
      })
      .catch(() => { if (!cancelled) setEnrollmentApprovedTrucks([]); setEnrollmentApprovedDrivers([]); })
      .finally(() => { if (!cancelled) setEnrollmentLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, selectedContractorId]);

  useEffect(() => {
    if (activeTab !== 'enrollment' || !enrollmentRouteId) {
      setEnrollmentRouteDetail(null);
      return;
    }
    let cancelled = false;
    contractorApi.routes.get(enrollmentRouteId, enrollmentContractorQuery())
      .then((r) => { if (!cancelled) setEnrollmentRouteDetail(r); })
      .catch(() => { if (!cancelled) setEnrollmentRouteDetail(null); });
    return () => { cancelled = true; };
  }, [activeTab, enrollmentRouteId, selectedContractorId]);

  // Contractor info: load when tab is active and sync form from API
  useEffect(() => {
    if (!selectedTruck?.id) {
      setIncidentRoutesForTruck([]);
      setIncidentRouteId('');
      return;
    }
    let cancelled = false;
    setIncidentRoutesLoading(true);
    contractorApi.routes.enrolledByTruck(selectedTruck.id)
      .then((res) => {
        if (cancelled) return;
        const routes = res?.routes || [];
        setIncidentRoutesForTruck(routes);
        setIncidentRouteId(routes.length === 1 ? (routes[0].id ?? '') : '');
      })
      .catch(() => {
        if (!cancelled) setIncidentRoutesForTruck([]);
      })
      .finally(() => {
        if (!cancelled) setIncidentRoutesLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedTruck?.id]);

  useEffect(() => {
    if (activeTab !== 'contractor-details') return;
    let cancelled = false;
    setContractorInfoLoading(true);
    contractorApi.info.get()
      .then((r) => {
        if (!cancelled) {
          const info = r?.info ?? null;
          setContractorInfo(info);
          setContractorInfoForm(info ? {
            company_name: info.companyName ?? '',
            cipc_registration_number: info.cipcRegistrationNumber ?? '',
            cipc_registration_date: info.cipcRegistrationDate ?? '',
            admin_name: info.adminName ?? '',
            admin_email: info.adminEmail ?? '',
            admin_phone: info.adminPhone ?? '',
            control_room_contact: info.controlRoomContact ?? '',
            control_room_phone: info.controlRoomPhone ?? '',
            control_room_email: info.controlRoomEmail ?? '',
            mechanic_name: info.mechanicName ?? '',
            mechanic_phone: info.mechanicPhone ?? '',
            mechanic_email: info.mechanicEmail ?? '',
            emergency_contact_1_name: info.emergencyContact1Name ?? '',
            emergency_contact_1_phone: info.emergencyContact1Phone ?? '',
            emergency_contact_2_name: info.emergencyContact2Name ?? '',
            emergency_contact_2_phone: info.emergencyContact2Phone ?? '',
            emergency_contact_3_name: info.emergencyContact3Name ?? '',
            emergency_contact_3_phone: info.emergencyContact3Phone ?? '',
          } : {});
        }
      })
      .catch(() => { if (!cancelled) setContractorInfo(null); setContractorInfoForm({}); })
      .finally(() => { if (!cancelled) setContractorInfoLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab]);

  // Subcontractors: load when tab is active
  useEffect(() => {
    if (activeTab !== 'subcontract-details') return;
    let cancelled = false;
    setSubcontractorsLoading(true);
    contractorApi.subcontractors.list()
      .then((r) => { if (!cancelled) setSubcontractorsList(r?.subcontractors ?? []); })
      .catch(() => { if (!cancelled) setSubcontractorsList([]); })
      .finally(() => { if (!cancelled) setSubcontractorsLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab]);

  // Library: load document types and list when tab is active
  useEffect(() => {
    if (activeTab !== 'library') return;
    let cancelled = false;
    setLibraryLoading(true);
    Promise.all([
      contractorApi.library.documentTypes().then((r) => r?.documentTypes ?? []),
      contractorApi.library.list().then((r) => r?.documents ?? []),
    ])
      .then(([types, documents]) => {
        if (!cancelled) {
          setLibraryDocumentTypes(types);
          setLibraryDocuments(documents);
        }
      })
      .catch(() => { if (!cancelled) setLibraryDocumentTypes([]); setLibraryDocuments([]); })
      .finally(() => { if (!cancelled) setLibraryLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab]);

  useEffect(() => {
    if (!selectedIncident?.id) {
      setIncidentDetail(null);
      setShowResolveForm(false);
      return;
    }
    // Show list data immediately so (INC-xxx) panel always has data to display
    setIncidentDetail(selectedIncident);
    let cancelled = false;
    setIncidentDetailLoading(true);
    contractorApi.incidents
      .get(selectedIncident.id)
      .then((r) => {
        if (!cancelled && r?.incident) setIncidentDetail(r.incident);
      })
      .catch(() => {
        if (!cancelled) setIncidentDetail(selectedIncident);
      })
      .finally(() => {
        if (!cancelled) setIncidentDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedIncident?.id]);

  // Normalize path key (DB may return snake_case; some layers might use camelCase)
  function getIncidentPath(incident, pathKey) {
    if (!incident) return null;
    const snake = incident[pathKey];
    if (snake != null && snake !== '') return snake;
    const camel = pathKey.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    return incident[camel] ?? null;
  }

  // Read any incident field regardless of key casing (API may return different cases)
  function getIncidentField(incident, field) {
    if (!incident) return null;
    const v = incident[field] ?? incident[field.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
    if (v !== undefined && v !== null) return typeof v === 'string' ? v.trim() : v;
    const lower = field.toLowerCase().replace(/_/g, '');
    for (const [k, val] of Object.entries(incident)) {
      if (k && k.toLowerCase().replace(/_/g, '') === lower && val !== undefined && val !== null) return typeof val === 'string' ? val.trim() : val;
    }
    return null;
  }

  const incidentForPanel = incidentDetail ?? selectedIncident;
  const panelTruckId = getIncidentField(incidentForPanel, 'truck_id');
  const panelDriverId = getIncidentField(incidentForPanel, 'driver_id');
  const byContractor = (list) => {
    if (!selectedContractorId || !Array.isArray(list)) return list || [];
    return list.filter((x) => (x.contractor_id ?? x.contractor_Id) == selectedContractorId);
  };
  const trucksList = byContractor(data.trucks);
  const driversList = byContractor(data.drivers);
  const incidentsList = byContractor(data.incidents);

  // Subcontractor company names from fleet (trucks’ sub_contractor) + existing subcontractors, for dropdown
  const subcontractorCompanyOptions = (() => {
    const fromFleet = (trucksList || [])
      .map((t) => (t.sub_contractor ?? t.subContractor ?? '').trim())
      .filter(Boolean);
    const fromList = (subcontractorsList || []).map((s) => (s.company_name ?? '').trim()).filter(Boolean);
    const current = (subcontractorForm.company_name ?? '').trim();
    const set = new Set([...fromFleet, ...fromList, ...(current ? [current] : [])]);
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  })();
  const expiriesList = byContractor(data.expiries);
  const suspensionsList = byContractor(data.suspensions);
  const complianceRecordsList = byContractor(data.complianceRecords);
  const messagesList = byContractor(data.messages);
  const routesList = data.routes || [];
  const enrollmentRouteSearchMinChars = 2;
  const enrollmentRouteMatches = useMemo(() => {
    const q = enrollmentRoutePickerQuery.trim().toLowerCase();
    let list = [];
    if (q.length >= enrollmentRouteSearchMinChars) {
      list = (routesList || []).filter((r) => {
        const name = String(r.name || '').toLowerCase();
        const start = String(r.starting_point || '').toLowerCase();
        const end = String(r.destination || '').toLowerCase();
        return name.includes(q) || start.includes(q) || end.includes(q);
      });
    }
    if (enrollmentRouteId) {
      const selected = (routesList || []).find((r) => String(r.id) === String(enrollmentRouteId));
      if (selected && !list.some((r) => String(r.id) === String(enrollmentRouteId))) {
        list = [selected, ...list];
      }
    }
    return list;
  }, [routesList, enrollmentRoutePickerQuery, enrollmentRouteId]);
  const [expirySearch, setExpirySearch] = useState('');
  const filteredExpiriesList = (() => {
    const q = (expirySearch || '').trim().toLowerCase();
    if (!q) return expiriesList;
    return expiriesList.filter((e) => {
      const type = (e.item_type || '').toLowerCase();
      const ref = (e.item_ref || '').toLowerCase();
      const desc = (e.description || '').toLowerCase();
      const expiryStr = e.expiry_date ? formatDate(e.expiry_date).toLowerCase() : '';
      return type.includes(q) || ref.includes(q) || desc.includes(q) || expiryStr.includes(q);
    });
  })();
  const panelTruck = panelTruckId && trucksList.find((t) => String(t.id || '').toLowerCase() === String(panelTruckId).toLowerCase());
  const panelDriver = panelDriverId && driversList.find((d) => String(d.id || '').toLowerCase() === String(panelDriverId).toLowerCase());

  function extFromBlob(blob) {
    const t = blob.type || '';
    if (t.includes('pdf')) return '.pdf';
    if (t.includes('jpeg') || t.includes('jpg')) return '.jpg';
    if (t.includes('png')) return '.png';
    if (t.includes('gif')) return '.gif';
    return '.bin';
  }

  const viewAttachment = async (type) => {
    if (!incidentForPanel?.id) return;
    setAttachmentLoading(type);
    setError('');
    try {
      const blob = await contractorApi.incidents.getAttachmentBlob(incidentForPanel.id, type);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.message);
    } finally {
      setAttachmentLoading(null);
    }
  };

  const downloadAttachment = async (type, label) => {
    if (!incidentForPanel?.id) return;
    setAttachmentLoading(type);
    setError('');
    try {
      const blob = await contractorApi.incidents.getAttachmentBlob(incidentForPanel.id, type);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${label.replace(/\s+/g, '_')}${extFromBlob(blob)}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setAttachmentLoading(null);
    }
  };

  const downloadFullReport = async () => {
    if (!incidentForPanel?.id) return;
    setDownloadingReport(true);
    setError('');
    try {
      const zip = new JSZip();
      const i = incidentForPanel;
      const truck = trucksList.find((t) => String(t.id || '').toLowerCase() === String(i.truck_id || '').toLowerCase());
      const driver = driversList.find((d) => String(d.id || '').toLowerCase() === String(i.driver_id || '').toLowerCase());
      const truckName = (i.truck_id && truck && truck.registration) ? truck.registration : '';
      const driverName = (i.driver_id && driver && driver.full_name) ? driver.full_name : '';
      const reportText = [
        `Incident Report: ${i.title}`,
        `Type: ${i.type}`,
        `Severity: ${i.severity || '—'}`,
        `Reported: ${formatDate(i.reported_at)}`,
        `Truck: ${truckName || '—'}`,
        `Driver: ${driverName || '—'}`,
        '',
        'Description:',
        i.description || '—',
        '',
        'Actions taken:',
        i.actions_taken || '—',
        '',
        i.resolved_at ? `Resolved: ${formatDate(i.resolved_at)}` : 'Status: Open',
      ].join('\n');
      zip.file('report.txt', reportText);
      for (const { type, label, pathKey } of INCIDENT_ATTACHMENTS) {
        if (!getIncidentPath(i, pathKey)) continue;
        const blob = await contractorApi.incidents.getAttachmentBlob(i.id, type);
        const ext = extFromBlob(blob);
        zip.file(`${label.replace(/\s+/g, '_')}${ext}`, blob);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `incident-report-${i.id.slice(0, 8)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloadingReport(false);
    }
  };

  const downloadPdfReport = () => {
    if (!incidentForPanel?.id) return;
    setDownloadingPdf(true);
    setError('');
    const runPdf = (logoDataUrl, attachmentImages = []) => {
      try {
        const i = incidentForPanel;
        const truck = trucksList.find((t) => String(t.id || '').toLowerCase() === String(i.truck_id || '').toLowerCase());
        const driver = driversList.find((d) => String(d.id || '').toLowerCase() === String(i.driver_id || '').toLowerCase());
        const truckName = (i.truck_id && truck && truck.registration) ? truck.registration : '—';
        const driverName = (i.driver_id && driver && driver.full_name) ? driver.full_name : '—';
        const attachmentLabels = INCIDENT_ATTACHMENTS.filter(({ pathKey }) => getIncidentPath(i, pathKey)).map(({ label }) => label);
        if (getIncidentField(i, 'offloading_slip_path')) attachmentLabels.push('Offloading slip');
        const routeId = getIncidentField(i, 'route_id');
        const route = (data.routes || []).find((r) => String(r.id) === String(routeId));
        const routeName = route?.name || null;
        const doc = generateBreakdownPdf({
          incident: i,
          ref: incidentRef(i),
          truckName,
          driverName,
          typeLabel: incidentTypeLabel(getIncidentField(i, 'type')),
          routeName,
          attachmentLabels,
          attachmentImages,
          formatDateTime,
          formatDate,
          logoDataUrl: logoDataUrl || undefined,
        });
        doc.save(`${incidentRef(i)}-report.pdf`);
      } catch (err) {
        setError(err?.message || 'Failed to generate PDF');
      } finally {
        setDownloadingPdf(false);
      }
    };
    const tihloLogoFallback = () =>
      fetch('/logos/tihlo-logo.png', { credentials: 'include' })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => (blob ? new Promise((resolve, reject) => { const r = new FileReader(); r.onloadend = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); }) : null))
        .catch(() => null);

    const resolveLogo = (tenantId) => {
      if (tenantId) {
        return fetch(tenantsApi.logoUrl(tenantId), { credentials: 'include' })
          .then((r) => (r.ok ? r.blob() : null))
          .then((blob) => (blob ? new Promise((resolve, reject) => { const r = new FileReader(); r.onloadend = () => resolve(r.result); r.onerror = () => resolve(null); r.readAsDataURL(blob); }) : null))
          .catch(() => null)
          .then((dataUrl) => dataUrl || tihloLogoFallback());
      }
      return tihloLogoFallback();
    };

    const resolveAttachmentImages = async (incidentId) => {
      const out = [];
      for (const { type, label, pathKey } of INCIDENT_ATTACHMENTS) {
        if (!getIncidentPath(incidentForPanel, pathKey)) continue;
        try {
          const blob = await contractorApi.incidents.getAttachmentBlob(incidentId, type);
          if (blob && blob.type && blob.type.startsWith('image/')) {
            const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onloadend = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
            out.push({ label, dataUrl });
          }
        } catch (_) { /* skip failed attachment */ }
      }
      return out;
    };

    resolveLogo(user?.tenant_id)
      .then((logoDataUrl) => resolveAttachmentImages(incidentForPanel.id).then((attachmentImages) => ({ logoDataUrl, attachmentImages })))
      .then(({ logoDataUrl, attachmentImages }) => runPdf(logoDataUrl, attachmentImages))
      .catch(() => runPdf(null, []));
  };

  useEffect(() => {
    const closeDropdowns = (e) => {
      if (truckDropdownRef.current?.contains(e.target) || driverDropdownRef.current?.contains(e.target) || expiryRefDropdownRef.current?.contains(e.target) || driverLinkedTruckDropdownRef.current?.contains(e.target)) return;
      setTruckDropdownOpen(false);
      setDriverDropdownOpen(false);
      setExpiryRefDropdownOpen(false);
      setDriverLinkedTruckDropdownOpen(false);
    };
    document.addEventListener('click', closeDropdowns);
    return () => document.removeEventListener('click', closeDropdowns);
  }, []);

  useEffect(() => {
    if (activeTab !== 'fleet') setSelectedFleetTruck(null);
    if (activeTab !== 'driver-register') setSelectedRegisterDriver(null);
  }, [activeTab]);

  useEffect(() => {
    if (!selectedRegisterDriver || activeTab !== 'driver-register') return;
    const d = selectedRegisterDriver;
    const linkedId = d.linkedTruckId ?? d.linked_truck_id;
    const trucks = data.trucks || [];
    const truck = linkedId ? trucks.find((t) => String(t.id) === String(linkedId)) : null;
    setDriverLinkedTruckSelection(truck || null);
    setDriverLinkedTruckSearch(truck ? (truck.registration || '') : '');
  }, [selectedRegisterDriver?.id, selectedRegisterDriver?.linkedTruckId, selectedRegisterDriver?.linked_truck_id, activeTab, data.trucks]);

  const filteredTrucks = trucksList.filter(
    (t) =>
      !truckSearch.trim() ||
      (t.registration || '').toLowerCase().includes(truckSearch.toLowerCase()) ||
      (t.main_contractor || '').toLowerCase().includes(truckSearch.toLowerCase())
  );
  const filteredDrivers = driversList.filter(
    (d) =>
      !driverSearch.trim() ||
      (d.full_name || '').toLowerCase().includes(driverSearch.toLowerCase()) ||
      (d.surname || '').toLowerCase().includes(driverSearch.toLowerCase())
  );

  const filteredTrucksForDriverLink = trucksList.filter(
    (t) =>
      !driverLinkedTruckSearch.trim() ||
      (t.registration || '').toLowerCase().includes(driverLinkedTruckSearch.toLowerCase()) ||
      (t.fleet_no || '').toLowerCase().includes(driverLinkedTruckSearch.toLowerCase()) ||
      (t.make_model || '').toLowerCase().includes(driverLinkedTruckSearch.toLowerCase()) ||
      (t.main_contractor || '').toLowerCase().includes(driverLinkedTruckSearch.toLowerCase())
  );

  const filteredFleetList = trucksList.filter((t) => {
    const q = fleetListSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      (t.registration || '').toLowerCase().includes(q) ||
      (t.main_contractor || '').toLowerCase().includes(q) ||
      (t.sub_contractor || '').toLowerCase().includes(q) ||
      (t.make_model || '').toLowerCase().includes(q) ||
      (t.fleet_no || '').toLowerCase().includes(q)
    );
  });

  const filteredDriverRegisterList = driversList.filter((d) => {
    const q = driverRegisterSearch.trim().toLowerCase();
    if (!q) return true;
    const full = (d.full_name || [d.name, d.surname].filter(Boolean).join(' ')).toLowerCase();
    return (
      full.includes(q) ||
      (d.surname || '').toLowerCase().includes(q) ||
      (d.id_number || '').toLowerCase().includes(q) ||
      (d.license_number || '').toLowerCase().includes(q) ||
      (d.phone || '').toLowerCase().includes(q) ||
      (d.email || '').toLowerCase().includes(q)
    );
  });

  const filteredIncidentsList = incidentsList.filter((i) => {
    const q = incidentsListSearch.trim().toLowerCase();
    if (!q) return true;
    const typeLabel = incidentTypeLabel(i.type).toLowerCase();
    return (
      incidentRef(i).toLowerCase().includes(q) ||
      String(i.title || '').toLowerCase().includes(q) ||
      typeLabel.includes(q) ||
      String(i.description || '').toLowerCase().includes(q) ||
      String(i.severity || '').toLowerCase().includes(q) ||
      String(i.location_text || i.location || '').toLowerCase().includes(q)
    );
  });

  const filteredEnrollmentRouteTrucks = (enrollmentRouteDetail?.trucks || []).filter((t) => {
    const q = enrollmentRouteTruckSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      String(t.registration || '').toLowerCase().includes(q) ||
      String(t.make_model || '').toLowerCase().includes(q) ||
      String(t.fleet_no || '').toLowerCase().includes(q)
    );
  });

  const filteredEnrollmentRouteDrivers = (enrollmentRouteDetail?.drivers || []).filter((d) => {
    const q = enrollmentRouteDriverSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      String(d.full_name || '').toLowerCase().includes(q) ||
      String(d.license_number || '').toLowerCase().includes(q)
    );
  });

  const filteredEnrollmentApprovedTrucks = enrollmentApprovedTrucks.filter((t) => {
    const q = enrollmentApprovedTruckSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      String(t.registration || '').toLowerCase().includes(q) ||
      String(t.make_model || '').toLowerCase().includes(q) ||
      String(t.fleet_no || '').toLowerCase().includes(q)
    );
  });

  const filteredEnrollmentApprovedDrivers = enrollmentApprovedDrivers.filter((d) => {
    const q = enrollmentApprovedDriverSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      String(d.full_name || '').toLowerCase().includes(q) ||
      String(d.license_number || '').toLowerCase().includes(q)
    );
  });

  const isRecentlyApprovedTruck = (truck) => {
    const approvedAt = truck?.facility_access_at || truck?.approved_at || truck?.updated_at || truck?.created_at;
    if (!approvedAt) return false;
    const ts = new Date(approvedAt).getTime();
    if (Number.isNaN(ts)) return false;
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    return Date.now() - ts <= threeDaysMs;
  };

  // Expiry reference search: trucks + drivers, filter by search term
  const expiryRefOptions = (() => {
    const q = (expiryRefSearch || '').trim().toLowerCase();
    const out = [];
    trucksList.forEach((t) => {
      const reg = (t.registration || '').trim();
      const label = reg ? `${reg} (truck)` : null;
      if (!label) return;
      if (!q || reg.toLowerCase().includes(q) || (t.main_contractor || '').toLowerCase().includes(q) || (t.fleet_no || '').toLowerCase().includes(q)) {
        out.push({ type: 'truck', value: reg, label });
      }
    });
    driversList.forEach((d) => {
      const name = (d.full_name || [d.name, d.surname].filter(Boolean).join(' ')).trim() || '—';
      const idNum = (d.id_number || '').trim();
      const lic = (d.license_number || '').trim();
      const label = idNum ? `${name} · ID ${idNum}` : lic ? `${name} · ${lic}` : name;
      if (!q || name.toLowerCase().includes(q) || idNum.toLowerCase().includes(q) || lic.toLowerCase().includes(q)) {
        out.push({ type: 'driver', value: label, label });
      }
    });
    return out.slice(0, 20);
  })();

  const load = async () => {
    if (!hasTenant) return;
    setLoading(true);
    setError('');
    setContextError(null);
    const defaults = { trucks: [], drivers: [], incidents: [], expiries: [], suspensions: [], messages: [], complianceRecords: [], routes: [] };
    try {
      const contextRes = await contractorApi.context().catch((e) => {
        const msg = e?.message || '';
        if (msg.includes('tenant') || msg.includes('company') || msg.includes('403')) setContextError('Your account is not linked to a company. Contact your administrator.');
        else setContextError(msg || 'Could not verify access.');
        throw e;
      });
      if (!contextRes?.tenantId) {
        setContextError('Your account is not linked to a company.');
        setData(defaults);
        setLoading(false);
        return;
      }
      const contractors = Array.isArray(contextRes.contractors) ? contextRes.contractors : [];
      setContractorsList(contractors);
      if (contractors.length === 1 && !selectedContractorId) setSelectedContractorId(contractors[0].id);

      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out. Check your connection and retry.')), 20000));
      const messageContractorId = selectedContractorId || (contractors.length === 1 ? contractors[0].id : null);
      const results = await Promise.race([
        Promise.allSettled([
          contractorApi.trucks.list().then((r) => r.trucks || []),
          contractorApi.drivers.list().then((r) => r.drivers || []),
          contractorApi.incidents.list().then((r) => r.incidents || []),
          contractorApi.expiries.list().then((r) => r.expiries || []),
          contractorApi.suspensions.list().then((r) => r.suspensions || []),
          messageContractorId ? contractorApi.messages.list({ contractor_id: messageContractorId }).then((r) => r.messages || []) : Promise.resolve([]),
          contractorApi.complianceRecords.list().then((r) => r.records || []),
          contractorApi.routes.list().then((r) => r.routes || []),
        ]),
        timeout.then(() => {
          throw new Error('Request timed out. Check your connection and retry.');
        }),
      ]);

      if (!Array.isArray(results)) {
        setError('Failed to load data.');
        setData(defaults);
        setLoading(false);
        return;
      }

      const keys = ['trucks', 'drivers', 'incidents', 'expiries', 'suspensions', 'messages', 'complianceRecords', 'routes'];
      const failed = [];
      const next = {};
      keys.forEach((key, i) => {
        const r = results[i];
        if (r?.status === 'fulfilled' && Array.isArray(r.value)) {
          next[key] = r.value;
        } else {
          next[key] = defaults[key];
          if (r?.status === 'rejected') failed.push(key);
        }
      });
      setData(next);
      if (failed.length) setError(`Could not load: ${failed.join(', ')}. Other data loaded.`);
      else setError('');
    } catch (err) {
      const msg = err?.message || 'Failed to load data';
      if (!contextError && (msg.includes('tenant') || msg.includes('company'))) setContextError('Your account is not linked to a company. Contact your administrator.');
      setError(msg);
      setData(defaults);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasTenant) load();
    else setLoading(false);
  }, [hasTenant]);

  useEffect(() => {
    if (!hasTenant || !selectedContractorId) return;
    contractorApi.messages.list({ contractor_id: selectedContractorId })
      .then((r) => {
        setData((prev) => ({ ...prev, messages: r.messages || [] }));
      })
      .catch(() => {
        setData((prev) => ({ ...prev, messages: [] }));
      });
  }, [hasTenant, selectedContractorId]);

  if (authLoading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-surface-500">Loading…</p>
      </div>
    );
  }

  if (!hasTenant) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h2 className="font-semibold text-lg">Contractor area</h2>
          <p className="mt-2 text-sm">Contractor features (trucks, drivers, fleet, messages) are only available for users linked to a company. Your current account is not linked to a company.</p>
          <p className="mt-3 text-sm font-medium">To see data here:</p>
          <ul className="mt-1 list-disc list-inside text-sm space-y-0.5">
            <li>Log in with an account that is linked to a company, or</li>
            <li>Ask your administrator to link your user to a tenant (company) in the system, or</li>
            <li>If you have database access: run <code className="bg-amber-100 px-1 rounded">npm run seed:contractor</code> to create a contractor user (contractor@thinkers.africa / Admin123!), then log in with that account.</li>
          </ul>
          <p className="mt-3 text-sm text-amber-800">Use the super admin account (admin@thinkers.africa) for Command Centre; use a contractor-linked account for this page.</p>
        </div>
      </div>
    );
  }

  const addTruck = async (e) => {
    e.preventDefault();
    const form = e.target;
    setSaving(true);
    setError('');
    try {
      await contractorApi.trucks.create({
        contractor_id: selectedContractorId || undefined,
        main_contractor: form.main_contractor?.value?.trim() || null,
        sub_contractor: form.sub_contractor?.value?.trim() || null,
        make_model: form.make_model?.value?.trim() || null,
        year_model: form.year_model?.value?.trim() || null,
        ownership_desc: form.ownership_desc?.value?.trim() || null,
        fleet_no: form.fleet_no?.value?.trim() || null,
        registration: form.registration?.value?.trim() || '',
        trailer_1_reg_no: form.trailer_1_reg_no?.value?.trim() || null,
        trailer_2_reg_no: form.trailer_2_reg_no?.value?.trim() || null,
        tracking_provider: form.tracking_provider?.value === 'Other'
          ? (form.tracking_provider_other?.value?.trim() || 'Other')
          : (form.tracking_provider?.value || null),
        tracking_username: form.tracking_username?.value?.trim() || null,
        tracking_password: form.tracking_password?.value || null,
        commodity_type: form.commodity_type?.value || null,
        capacity_tonnes: form.capacity_tonnes?.value ? parseFloat(form.capacity_tonnes.value) : null,
        status: 'active',
      });
      form.reset();
      setTrackingProviderIsOther(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addDriver = async (e) => {
    e.preventDefault();
    const form = e.target;
    setSaving(true);
    setError('');
    try {
      await contractorApi.drivers.create({
        contractor_id: selectedContractorId || undefined,
        name: form.name?.value?.trim() || '',
        surname: form.surname?.value?.trim() || null,
        id_number: form.id_number?.value?.trim() || null,
        license_number: form.license_number?.value?.trim() || null,
        license_expiry: form.license_expiry?.value || null,
        phone: form.phone?.value?.trim() || null,
        email: form.email?.value?.trim() || null,
      });
      form.reset();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveTruck = async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!selectedFleetTruck?.id) return;
    setSavingTruck(true);
    setError('');
    try {
      const newPassword = form.tracking_password?.value?.trim();
      const body = {
        registration: form.registration?.value?.trim() || '',
        main_contractor: form.main_contractor?.value?.trim() || null,
        sub_contractor: form.sub_contractor?.value?.trim() || null,
        make_model: form.make_model?.value?.trim() || null,
        year_model: form.year_model?.value?.trim() || null,
        ownership_desc: form.ownership_desc?.value?.trim() || null,
        fleet_no: form.fleet_no?.value?.trim() || null,
        trailer_1_reg_no: form.trailer_1_reg_no?.value?.trim() || null,
        trailer_2_reg_no: form.trailer_2_reg_no?.value?.trim() || null,
        tracking_provider: form.tracking_provider?.value === 'Other' ? (form.tracking_provider_other?.value?.trim() || 'Other') : (form.tracking_provider?.value || null),
        tracking_username: form.tracking_username?.value?.trim() || null,
        commodity_type: form.commodity_type?.value || null,
        capacity_tonnes: form.capacity_tonnes?.value ? parseFloat(form.capacity_tonnes.value) : null,
        status: form.status?.value || 'active',
      };
      if (newPassword) body.tracking_password = newPassword;
      const res = await contractorApi.trucks.update(selectedFleetTruck.id, body);
      if (res?.truck) setSelectedFleetTruck(res.truck);
      load();
    } catch (err) {
      setError(err?.message || 'Failed to save truck');
    } finally {
      setSavingTruck(false);
    }
  };

  const saveDriver = async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!selectedRegisterDriver?.id) return;
    setSavingDriver(true);
    setError('');
    try {
      const body = {
        full_name: form.full_name?.value?.trim() || null,
        surname: form.surname?.value?.trim() || null,
        id_number: form.id_number?.value?.trim() || null,
        license_number: form.license_number?.value?.trim() || null,
        license_expiry: form.license_expiry?.value || null,
        phone: form.phone?.value?.trim() || null,
        email: form.email?.value?.trim() || null,
        linked_truck_id: driverLinkedTruckSelection?.id ?? null,
      };
      const res = await contractorApi.drivers.update(selectedRegisterDriver.id, body);
      if (res?.driver) setSelectedRegisterDriver(res.driver);
      load();
    } catch (err) {
      setError(err?.message || 'Failed to save driver');
    } finally {
      setSavingDriver(false);
    }
  };

  const handleTruckImport = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    setImportSuccess(null);
    setImporting(true);
    setError('');
    try {
      const { trucks } = await parseExcelFile(file, 'trucks');
      if (!trucks.length) {
        setError('No valid rows found. Ensure the first row has headers and rows have Truck registration number.');
        e.target.value = '';
        return;
      }
      const res = await contractorApi.trucks.bulk({ trucks, contractor_id: selectedContractorId || undefined });
      setImportSuccess({ type: 'trucks', count: res.imported, skipped: res.skipped ?? 0, skippedRegistrations: res.skippedRegistrations });
      load();
      e.target.value = '';
    } catch (err) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleDriverImport = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    setImportSuccess(null);
    setImporting(true);
    setError('');
    try {
      const { drivers } = await parseExcelFile(file, 'drivers');
      if (!drivers.length) {
        setError('No valid rows found. Ensure the first row has headers and rows have Name or Surname.');
        e.target.value = '';
        return;
      }
      const res = await contractorApi.drivers.bulk({ drivers, contractor_id: selectedContractorId || undefined });
      setImportSuccess({ type: 'drivers', count: res.imported, skipped: res.skipped ?? 0 });
      load();
      e.target.value = '';
    } catch (err) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleConsolidatedImport = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    setImportSuccess(null);
    setImporting(true);
    setError('');
    try {
      const { trucks, drivers } = await parseConsolidatedFile(file);
      let trucksImported = 0;
      let driversImported = 0;
      let trucksSkipped = 0;
      let driversSkipped = 0;
      if (trucks?.length) {
        const tr = await contractorApi.trucks.bulk({ trucks, contractor_id: selectedContractorId || undefined });
        trucksImported = tr.imported ?? 0;
        trucksSkipped = tr.skipped ?? 0;
      }
      if (drivers?.length) {
        const dr = await contractorApi.drivers.bulk({ drivers, contractor_id: selectedContractorId || undefined });
        driversImported = dr.imported ?? 0;
        driversSkipped = dr.skipped ?? 0;
      }
      setImportSuccess({ type: 'all', trucks: trucksImported, drivers: driversImported, trucksSkipped, driversSkipped });
      load();
      e.target.value = '';
    } catch (err) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const addIncident = async (e) => {
    e.preventDefault();
    const form = e.target;
    const loadingSlip = loadingSlipRef.current?.files?.[0];
    const seal1 = seal1Ref.current?.files?.[0];
    const seal2 = seal2Ref.current?.files?.[0];
    const pictureProblem = pictureProblemRef.current?.files?.[0];
    if (!loadingSlip || !seal1 || !seal2 || !pictureProblem) {
      setError('All four attachments are required: Loading slip, Seal 1, Seal 2, and Picture of the problem.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const typeValue = form.type?.value || 'incident';
      const titleValue = (form.title?.value || '').trim();
      const payload = {
        truck_id: selectedTruck?.id != null ? String(selectedTruck.id) : null,
        driver_id: selectedDriver?.id != null ? String(selectedDriver.id) : null,
        type: typeValue,
        title: titleValue || (typeValue === 'breakdown' ? 'Breakdown' : 'Breakdown / Incident'),
        description: (form.description?.value || '').trim() || null,
        severity: (form.severity?.value || '').trim() || null,
        actions_taken: (form.actions_taken?.value || '').trim() || null,
        reported_date: form.reported_date?.value || null,
        reported_time: form.reported_time?.value || '00:00',
        location: (incidentLocation || '').trim() || null,
        route_id: (incidentRouteId || '').trim() || null,
      };
      const fd = new FormData();
      fd.append('payload', JSON.stringify(payload));
      fd.append('loading_slip', loadingSlip);
      fd.append('seal_1', seal1);
      fd.append('seal_2', seal2);
      fd.append('picture_problem', pictureProblem);
      const { incident } = await contractorApi.incidents.createWithAttachments(fd);
      form.reset();
      setSelectedTruck(null);
      setSelectedDriver(null);
      setTruckSearch('');
      setDriverSearch('');
      setIncidentLocation('');
      setIncidentRouteId('');
      if (loadingSlipRef.current) loadingSlipRef.current.value = '';
      if (seal1Ref.current) seal1Ref.current.value = '';
      if (seal2Ref.current) seal2Ref.current.value = '';
      if (pictureProblemRef.current) pictureProblemRef.current.value = '';
      if (incident) {
        setData((prev) => ({ ...prev, incidents: [incident, ...(prev.incidents || [])] }));
      }
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addExpiry = async (e) => {
    e.preventDefault();
    const form = e.target;
    setSaving(true);
    setError('');
    try {
      const itemType = expiryItemType === 'other'
        ? (form.item_type_other?.value?.trim() || null)
        : (form.item_type?.value || 'license');
      if (expiryItemType === 'other' && !itemType) {
        setError('Please specify the type when selecting Other.');
        return;
      }
      await contractorApi.expiries.create({
        item_type: itemType || 'other',
        item_ref: (form.item_ref?.value ?? expiryRefSearch).trim() || null,
        issued_date: form.issued_date?.value || null,
        expiry_date: form.expiry_date.value || null,
        description: form.description.value.trim() || null,
      });
      form.reset();
      setExpiryRefSearch('');
      setExpiryItemType('license');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addSuspension = async (e) => {
    e.preventDefault();
    const form = e.target;
    setSaving(true);
    setError('');
    try {
      const permanent = form.suspend_permanent?.value === 'permanent';
      const durationDays = form.suspend_duration_days?.value ? parseInt(form.suspend_duration_days.value, 10) : null;
      await contractorApi.suspensions.create({
        entity_type: form.entity_type.value || 'driver',
        entity_id: form.entity_id.value.trim() || null,
        reason: form.reason.value.trim(),
        status: 'suspended',
        appeal_notes: null,
        is_permanent: permanent || (!durationDays || durationDays < 1),
        duration_days: permanent ? null : (durationDays || 7),
      });
      form.reset();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveContractorInfo = async (e) => {
    e.preventDefault();
    setContractorInfoSaving(true);
    setError('');
    setContractorInfoSuccess('');
    try {
      const res = await contractorApi.info.update(contractorInfoForm);
      if (res?.info) setContractorInfo(res.info);
      setContractorInfoSuccess('Contractor information saved successfully.');
      setTimeout(() => setContractorInfoSuccess(''), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setContractorInfoSaving(false);
    }
  };

  const openSubcontractorForm = (row = null) => {
    setSubcontractorEdit(row ?? {});
    const form = row ? {
      company_name: row.company_name ?? '',
      contact_person: row.contact_person ?? '',
      contact_phone: row.contact_phone ?? '',
      contact_email: row.contact_email ?? '',
      control_room_contact: row.control_room_contact ?? '',
      control_room_phone: row.control_room_phone ?? '',
      mechanic_name: row.mechanic_name ?? '',
      mechanic_phone: row.mechanic_phone ?? '',
      emergency_contact_name: row.emergency_contact_name ?? '',
      emergency_contact_phone: row.emergency_contact_phone ?? '',
    } : {};
    setSubcontractorForm(form);
    const name = (form.company_name ?? '').trim();
    setSubcontractorCompanySelect(row && name ? name : '');
  };

  const onSubcontractorCompanySelect = (value) => {
    setSubcontractorCompanySelect(value);
    if (value === '__NEW__') {
      setSubcontractorForm((f) => ({ ...f, company_name: '' }));
      return;
    }
    setSubcontractorForm((f) => ({ ...f, company_name: value || '' }));
    if (!value) return;
    const existing = subcontractorsList.find((s) => (s.company_name || '').trim().toLowerCase() === value.trim().toLowerCase());
    if (existing) {
      setSubcontractorForm((f) => ({
        ...f,
        company_name: existing.company_name ?? '',
        contact_person: existing.contact_person ?? '',
        contact_phone: existing.contact_phone ?? '',
        contact_email: existing.contact_email ?? '',
        control_room_contact: existing.control_room_contact ?? '',
        control_room_phone: existing.control_room_phone ?? '',
        mechanic_name: existing.mechanic_name ?? '',
        mechanic_phone: existing.mechanic_phone ?? '',
        emergency_contact_name: existing.emergency_contact_name ?? '',
        emergency_contact_phone: existing.emergency_contact_phone ?? '',
      }));
    }
  };

  const saveSubcontractor = async (e) => {
    e.preventDefault();
    setSubcontractorSaving(true);
    setError('');
    try {
      if (subcontractorEdit?.id) {
        await contractorApi.subcontractors.update(subcontractorEdit.id, subcontractorForm);
      } else {
        await contractorApi.subcontractors.create(subcontractorForm);
      }
      const r = await contractorApi.subcontractors.list();
      setSubcontractorsList(r?.subcontractors ?? []);
      setSubcontractorEdit(null);
      setSubcontractorForm({});
      setSubcontractorCompanySelect('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubcontractorSaving(false);
    }
  };

  const deleteSubcontractor = async (id) => {
    if (!confirm('Remove this subcontractor?')) return;
    setError('');
    try {
      await contractorApi.subcontractors.delete(id);
      setSubcontractorsList((prev) => prev.filter((s) => s.id !== id));
      if (subcontractorEdit?.id === id) setSubcontractorEdit(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const uploadLibraryDocument = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    const type = libraryUploadType || 'other';
    const link =
      libraryLinkKind === 'truck' && libraryLinkTruckId
        ? { linked_entity_type: 'truck', linked_entity_id: libraryLinkTruckId }
        : libraryLinkKind === 'driver' && libraryLinkDriverId
          ? { linked_entity_type: 'driver', linked_entity_id: libraryLinkDriverId }
          : {};
    setLibraryUploading(true);
    setError('');
    try {
      const res = await contractorApi.library.upload(file, type, link);
      setLibraryDocuments((prev) => [res.document, ...prev]);
      if (libraryFileRef.current) libraryFileRef.current.value = '';
      setLibraryLinkKind('none');
      setLibraryLinkTruckId('');
      setLibraryLinkDriverId('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLibraryUploading(false);
    }
  };

  const formatLibraryLinkLabel = (d) => {
    if (!d?.linked_entity_type) return 'Not linked to fleet';
    if (String(d.linked_entity_type).toLowerCase() === 'truck') {
      return `Truck · ${d.linked_truck_registration || '—'}`;
    }
    const name = [d.linked_driver_name, d.linked_driver_surname].filter(Boolean).join(' ').trim();
    return `Driver · ${name || '—'}`;
  };

  const openLibraryLinkEdit = (doc) => {
    const lt = doc.linked_entity_type ? String(doc.linked_entity_type).toLowerCase() : '';
    setLibraryEditId(doc.id);
    setLibraryEditKind(lt === 'truck' || lt === 'driver' ? lt : 'none');
    setLibraryEditTruckId(lt === 'truck' && doc.linked_entity_id ? String(doc.linked_entity_id) : '');
    setLibraryEditDriverId(lt === 'driver' && doc.linked_entity_id ? String(doc.linked_entity_id) : '');
  };

  const saveLibraryLink = async (docId) => {
    setLibraryLinkSavingId(docId);
    setError('');
    try {
      if (libraryEditKind === 'none') {
        await contractorApi.library.patchLink(docId, { clear: true });
      } else if (libraryEditKind === 'truck') {
        if (!libraryEditTruckId) {
          setError('Select a truck or choose “Not linked”.');
          return;
        }
        await contractorApi.library.patchLink(docId, { linked_entity_type: 'truck', linked_entity_id: libraryEditTruckId });
      } else if (libraryEditKind === 'driver') {
        if (!libraryEditDriverId) {
          setError('Select a driver or choose “Not linked”.');
          return;
        }
        await contractorApi.library.patchLink(docId, { linked_entity_type: 'driver', linked_entity_id: libraryEditDriverId });
      }
      const r = await contractorApi.library.list();
      setLibraryDocuments(r.documents || []);
      setLibraryEditId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLibraryLinkSavingId(null);
    }
  };

  const deleteLibraryDocument = async (id) => {
    if (!confirm('Delete this document?')) return;
    setError('');
    try {
      await contractorApi.library.delete(id);
      setLibraryDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const addMessage = async (e) => {
    e.preventDefault();
    const form = e.target;
    setSaving(true);
    setError('');
    try {
      await contractorApi.messages.create({
        subject: form.subject.value.trim(),
        body: form.body.value.trim() || null,
        contractor_id: selectedContractorId || undefined,
      }, form.attachments?.files || null);
      form.reset();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitResolve = async (e) => {
    e.preventDefault();
    if (!incidentForPanel?.id) return;
    const form = resolveFormRef.current;
    const note = form?.resolution_note?.value?.trim();
    const file = offloadingSlipRef.current?.files?.[0];
    if (!note) {
      setError('Resolution note is required.');
      return;
    }
    setResolvingIncident(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('resolution_note', note);
      if (file) fd.append('offloading_slip', file);
      const updated = await contractorApi.incidents.resolveWithDetails(incidentForPanel.id, fd);
      setIncidentDetail(updated.incident || { ...incidentForPanel, resolved_at: new Date().toISOString(), resolution_note: note });
      setSelectedIncident(updated.incident || { ...incidentForPanel, resolved_at: new Date().toISOString(), resolution_note: note });
      setShowResolveForm(false);
      if (form) form.reset();
      if (offloadingSlipRef.current) offloadingSlipRef.current.value = '';
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setResolvingIncident(false);
    }
  };

  const submitOffloadingSlipLater = async (e) => {
    e.preventDefault();
    if (!incidentForPanel?.id) return;
    const file = offloadingSlipLaterRef.current?.files?.[0];
    if (!file) {
      setError('Please select an offloading slip file.');
      return;
    }
    setUploadingOffloadingSlip(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('offloading_slip', file);
      const updated = await contractorApi.incidents.submitOffloadingSlip(incidentForPanel.id, fd);
      setIncidentDetail(updated.incident || { ...incidentForPanel, offloading_slip_path: true });
      setSelectedIncident(updated.incident || { ...incidentForPanel, offloading_slip_path: true });
      if (offloadingSlipLaterRef.current) offloadingSlipLaterRef.current.value = '';
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingOffloadingSlip(false);
    }
  };

  return (
    <div className="flex gap-0 w-full min-h-0 -m-4 sm:-m-6">
      {/* Contractor side nav */}
      <nav
        className={`shrink-0 flex flex-col border-r border-surface-200 bg-white transition-[width] duration-200 ease-out overflow-hidden ${navHidden ? 'w-0 border-r-0' : 'w-72'}`}
        aria-hidden={navHidden}
      >
        <div className="p-4 border-b border-surface-100 flex items-start justify-between gap-2 w-72">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-surface-900">Contractor</h2>
            {user?.tenant_name ? <p className="text-sm font-medium text-surface-700 mt-0.5" title="Data for this company">{user.tenant_name}</p> : null}
            <p className="text-xs text-surface-500 mt-0.5">Fleet & operations</p>
            <Link to="/command-centre" className="text-xs text-brand-600 hover:text-brand-700 mt-1 inline-block">Command Centre →</Link>
          </div>
          <button type="button" onClick={() => setNavHidden(true)} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Hide navigation" title="Hide navigation">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 w-72">
          {CONTRACTOR_NAV.map((group) => (
            <div key={group.section} className="mb-4">
              <p className="px-4 py-1.5 text-xs font-medium text-surface-400 uppercase tracking-wider">
                {group.section}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors rounded-none min-w-0 ${
                        activeTab === item.id
                          ? 'bg-brand-50 text-brand-700 border-l-2 border-l-brand-500 font-medium'
                          : 'text-surface-600 hover:bg-surface-50 hover:text-surface-900 border-l-2 border-l-transparent'
                      }`}
                    >
                      <ContractorNavIcon name={item.icon} className="w-5 h-5 shrink-0 text-inherit opacity-90" />
                      <span className="min-w-0 break-words">{item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-auto p-4 sm:p-6 flex flex-col">
        {navHidden && (
          <button type="button" onClick={() => setNavHidden(false)} className="self-start flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-surface-200 bg-white text-surface-700 hover:bg-surface-50 text-sm font-medium shadow-sm" aria-label="Show navigation">
            <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            Show navigation
          </button>
        )}
        <div className="w-full max-w-7xl mx-auto flex-1">
          {contextError ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900 max-w-xl">
              <h3 className="font-semibold">Cannot load company data</h3>
              <p className="mt-2 text-sm">{contextError}</p>
              <p className="mt-2 text-sm">Ensure your user account is linked to a tenant (company) in the system. Contact your administrator or sign in with a different account.</p>
              <div className="mt-4 flex gap-3">
                <button type="button" onClick={() => { setContextError(null); setError(''); load(); }} className="px-4 py-2 text-sm font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700">Retry</button>
                <a href="/" className="px-4 py-2 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Go home</a>
              </div>
            </div>
          ) : (
          <>
          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex flex-wrap justify-between items-center gap-2">
              <span>{error}</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => { setError(''); load(); }} className="font-medium text-red-700 hover:text-red-800">Retry</button>
                <button type="button" onClick={() => setError('')}>Dismiss</button>
              </span>
            </div>
          )}

          <div>
        {loading ? (
          <p className="text-surface-500">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <p className="text-xs text-surface-500">Showing data for <strong className="text-surface-700">{user?.tenant_name || 'your company'}</strong></p>
              {contractorsList.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-surface-600">Contractor:</span>
                  <select
                    value={selectedContractorId ?? ''}
                    onChange={(e) => setSelectedContractorId(e.target.value ? e.target.value : null)}
                    className="rounded-lg border border-surface-300 px-3 py-1.5 text-sm text-surface-800 bg-white min-w-[180px]"
                  >
                    {contractorsList.length > 1 && <option value="">All contractors</option>}
                    {contractorsList.map((c) => (
                      <option key={c.id} value={c.id}>{c.name || `Contractor ${c.id}`}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {activeTab === 'dashboard' && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-surface-900">Dashboard</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
                    <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Fleet</p>
                    <p className="mt-1 text-2xl font-semibold text-surface-900">{trucksList.length}</p>
                    <p className="text-sm text-surface-500">trucks</p>
                  </div>
                  <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
                    <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Drivers</p>
                    <p className="mt-1 text-2xl font-semibold text-surface-900">{driversList.length}</p>
                    <p className="text-sm text-surface-500">registered</p>
                  </div>
                  <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
                    <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Incidents</p>
                    <p className="mt-1 text-2xl font-semibold text-surface-900">{incidentsList.length}</p>
                    <p className="text-sm text-surface-500">
                      {incidentsList.filter((i) => !(i.resolved_at ?? i.resolvedAt)).length} open
                    </p>
                  </div>
                  <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
                    <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Expiries</p>
                    <p className="mt-1 text-2xl font-semibold text-surface-900">{expiriesList.length}</p>
                    <p className="text-sm text-surface-500">
                      {expiriesList.filter((e) => new Date(e.expiry_date) < new Date()).length} expired
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
                    <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Suspensions</p>
                    <p className="mt-1 text-2xl font-semibold text-surface-900">{suspensionsList.length}</p>
                    <p className="text-sm text-surface-500">recorded</p>
                  </div>
                  <div className="bg-white rounded-xl border border-surface-200 p-4 shadow-sm">
                    <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Messages</p>
                    <p className="mt-1 text-2xl font-semibold text-surface-900">{messagesList.length}</p>
                    <p className="text-sm text-surface-500">inbox</p>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-surface-200 p-4">
                  <h3 className="font-medium text-surface-900 mb-2">Quick links</h3>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setActiveTab('trucks')} className="px-3 py-1.5 text-sm rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100">Add truck</button>
                    <button type="button" onClick={() => setActiveTab('drivers')} className="px-3 py-1.5 text-sm rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100">Add driver</button>
                    <button type="button" onClick={() => setActiveTab('incidents')} className="px-3 py-1.5 text-sm rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100">Report incident</button>
                    <button type="button" onClick={() => setActiveTab('expiries')} className="px-3 py-1.5 text-sm rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100">Add expiry</button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'trucks' && (
              <div className="w-full space-y-6">
                <div className="bg-white rounded-xl border border-surface-200 p-6">
                  <h2 className="font-medium text-surface-900 mb-4">Add truck (contract portal)</h2>
                  <form onSubmit={addTruck} className="space-y-3">
                    <input name="main_contractor" placeholder="Main contractor (e.g. ABC Logistics)" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="sub_contractor" placeholder="If sub contractor (e.g. XYZ Logistics)" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm border-l-2 border-l-red-300" />
                    <input name="make_model" placeholder="Make / model" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="year_model" placeholder="Year model" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="ownership_desc" placeholder="Ownership description" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="fleet_no" placeholder="Fleet number" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="registration" placeholder="Truck registration number" required className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="trailer_1_reg_no" placeholder="Trailer 1 registration" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="trailer_2_reg_no" placeholder="Trailer 2 registration" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <select name="tracking_provider" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" onChange={(e) => setTrackingProviderIsOther(e.target.value === 'Other')}>
                      {TRACKING_PROVIDERS.map((p) => <option key={p || 'any'} value={p}>{p || 'Tracking provider (Fleetcam/Cartrack/Nest Tar/Any)'}</option>)}
                    </select>
                    {trackingProviderIsOther && (
                      <input name="tracking_provider_other" placeholder="Enter tracking provider name" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm border-l-2 border-l-amber-400" />
                    )}
                    <input name="tracking_username" placeholder="Tracking user name" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="tracking_password" type="password" placeholder="Tracking password" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <select name="commodity_type" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                      <option value="">Commodity type</option>
                      {COMMODITY_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input name="capacity_tonnes" type="number" step="0.01" placeholder="Capacity (tonnes)" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Add truck</button>
                  </form>
                </div>
                <div className="bg-white rounded-xl border border-surface-200 p-6">
                  <h2 className="font-medium text-surface-900 mb-3">Import from Excel</h2>
                  <p className="text-sm text-surface-500 mb-4">Download the template, fill in your fleet data, then upload the file to import multiple trucks at once.</p>
                  <div className="flex flex-wrap gap-3 items-center">
                    <button type="button" onClick={() => downloadTruckTemplate().catch((err) => setError(err?.message || 'Download failed'))} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Download truck template</button>
                    <label className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 cursor-pointer disabled:opacity-50 inline-block">
                      <input ref={truckFileRef} type="file" accept=".xlsx,.xls" className="sr-only" onChange={handleTruckImport} disabled={importing} />
                      {importing ? 'Importing…' : 'Choose file and import'}
                    </label>
                  </div>
                  {importSuccess?.type === 'trucks' && (
                    <p className="mt-3 text-sm text-green-600">
                      Successfully imported {importSuccess.count} truck(s).
                      {importSuccess.skipped > 0 && (
                        <span className="text-amber-700"> {importSuccess.skipped} skipped (duplicate registration).</span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'fleet' && (
              <div className="w-full">
                <div className="bg-white rounded-xl border border-surface-200 p-6">
                  <h2 className="font-medium text-surface-900 mb-4">Fleet</h2>
                  {canAccessPage(user, 'tracking_integration') && (
                    <p className="text-sm text-surface-600 mb-3">
                      <Link to="/tracking-integration" className="text-brand-600 font-medium hover:underline">
                        Tracking & integration
                      </Link>
                      <span className="text-surface-500"> — link trucks to telematics providers and monitor trips (uses this fleet list).</span>
                    </p>
                  )}
                  <p className="text-xs text-surface-500 mb-3">Click a truck to view full details.</p>
                  <input
                    type="search"
                    value={fleetListSearch}
                    onChange={(e) => setFleetListSearch(e.target.value)}
                    placeholder="Search fleet by registration, contractor, make/model, fleet no…"
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-3"
                  />
                  <ul className="space-y-1 text-sm">
                    {filteredFleetList.length === 0 ? <li className="text-surface-500">{trucksList.length === 0 ? 'No trucks yet.' : 'No fleet matches your search.'}</li> : filteredFleetList.map((t) => (
                      <li
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedFleetTruck(t)}
                        onKeyDown={(e) => e.key === 'Enter' && setSelectedFleetTruck(t)}
                        className={`flex justify-between items-center py-2.5 px-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedFleetTruck?.id === t.id ? 'border-brand-300 bg-brand-50' : 'border-transparent hover:bg-surface-50'
                        }`}
                      >
                        <span className="font-mono font-medium">{t.registration}</span>
                        <span className="text-surface-500 text-xs">{t.main_contractor || t.make_model || '—'} {t.trailer_1_reg_no ? `· T1: ${t.trailer_1_reg_no}` : ''}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${t.facility_access ? 'bg-green-100 text-green-800' : t.last_decline_reason ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`} title={t.last_decline_reason || ''}>
                          {t.facility_access ? 'Facility access' : t.last_decline_reason ? 'Declined' : 'Pending'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Truck detail panel (Fleet tab) – editable */}
            {activeTab === 'fleet' && selectedFleetTruck && (
              <div className="fixed inset-0 z-50 flex items-stretch" aria-modal="true" role="dialog" aria-label="Truck details">
                <button type="button" onClick={() => setSelectedFleetTruck(null)} className="absolute inset-0 bg-black/40" aria-label="Close" />
                <div className="relative w-full max-w-lg ml-auto bg-white shadow-xl flex flex-col max-h-full overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200">
                    <h3 className="font-semibold text-surface-900">Truck details</h3>
                    <button type="button" onClick={() => setSelectedFleetTruck(null)} className="p-2 rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Close">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <form onSubmit={saveTruck} className="flex-1 overflow-y-auto p-4 space-y-3">
                    {(() => {
                      const t = selectedFleetTruck;
                      const get = (snake, camel) => (t[snake] ?? t[camel]) != null ? String(t[snake] ?? t[camel]).trim() : '';
                      const trackingProvider = get('tracking_provider', 'trackingProvider');
                      const providerInList = TRACKING_PROVIDERS.some((p) => (p || '') === (trackingProvider || ''));
                      return (
                        <>
                          <div className="rounded-lg border border-surface-200 bg-surface-50 p-3 mb-2">
                            <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Facility access</p>
                            {t.facility_access ? (
                              <p className="text-sm text-green-700 font-medium">Approved — this truck can access the facility.</p>
                            ) : t.last_decline_reason ? (
                              <>
                                <p className="text-sm text-red-700 font-medium">Declined</p>
                                <p className="text-sm text-surface-600 mt-1 whitespace-pre-wrap">{t.last_decline_reason}</p>
                              </>
                            ) : (
                              <p className="text-sm text-amber-700">Pending approval. Command Centre will review this addition.</p>
                            )}
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Registration</label>
                            <input name="registration" defaultValue={get('registration', 'registration')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" required />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Main contractor</label>
                            <input name="main_contractor" defaultValue={get('main_contractor', 'mainContractor')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Sub contractor</label>
                            <input name="sub_contractor" defaultValue={get('sub_contractor', 'subContractor')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Make / model</label>
                            <input name="make_model" defaultValue={get('make_model', 'makeModel')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Year model</label>
                            <input name="year_model" defaultValue={get('year_model', 'yearModel')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Ownership</label>
                            <input name="ownership_desc" defaultValue={get('ownership_desc', 'ownershipDesc')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Fleet number</label>
                            <input name="fleet_no" defaultValue={get('fleet_no', 'fleetNo')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Trailer 1 reg</label>
                            <input name="trailer_1_reg_no" defaultValue={get('trailer_1_reg_no', 'trailer1RegNo')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Trailer 2 reg</label>
                            <input name="trailer_2_reg_no" defaultValue={get('trailer_2_reg_no', 'trailer2RegNo')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Tracking provider</label>
                            <select name="tracking_provider" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" defaultValue={providerInList ? (trackingProvider || '') : 'Other'}>
                              {TRACKING_PROVIDERS.map((p) => (
                                <option key={p || 'blank'} value={p}>{p || '—'}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Tracking provider (if Other)</label>
                            <input name="tracking_provider_other" defaultValue={providerInList ? '' : trackingProvider} placeholder="Leave blank if not Other" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Tracking username</label>
                            <input name="tracking_username" defaultValue={get('tracking_username', 'trackingUsername')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Tracking password</label>
                            <input name="tracking_password" type="password" placeholder="Leave blank to keep current" autoComplete="new-password" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Commodity type</label>
                            <select name="commodity_type" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" defaultValue={get('commodity_type', 'commodityType') || ''}>
                              <option value="">—</option>
                              {COMMODITY_TYPES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Capacity (tonnes)</label>
                            <input name="capacity_tonnes" type="number" step="0.01" min="0" defaultValue={t.capacity_tonnes ?? t.capacityTonnes ?? ''} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Status</label>
                            <select name="status" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" defaultValue={get('status', 'status') || 'active'}>
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                            </select>
                          </div>
                        </>
                      );
                    })()}
                    <div className="flex gap-2 pt-2">
                      <button type="submit" disabled={savingTruck} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                        {savingTruck ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" onClick={() => setSelectedFleetTruck(null)} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {activeTab === 'drivers' && (
              <div className="w-full space-y-6">
                <div className="bg-white rounded-xl border border-surface-200 p-6">
                  <h2 className="font-medium text-surface-900 mb-4">Add driver</h2>
                  <form onSubmit={addDriver} className="space-y-3">
                    <input name="name" placeholder="Name" required className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="surname" placeholder="Surname" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="id_number" placeholder="ID number" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="license_number" placeholder="Driver licence number" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="license_expiry" type="date" placeholder="Licence expiry" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="phone" type="tel" placeholder="Cellphone number" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="email" type="email" placeholder="Email address" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Add driver</button>
                  </form>
                </div>
                <div className="bg-white rounded-xl border border-surface-200 p-6">
                  <h2 className="font-medium text-surface-900 mb-3">Import from Excel</h2>
                  <p className="text-sm text-surface-500 mb-4">Download the template, fill in your drivers, then upload the file to import multiple drivers at once.</p>
                  <div className="flex flex-wrap gap-3 items-center">
                    <button type="button" onClick={() => downloadDriverTemplate().catch((err) => setError(err?.message || 'Download failed'))} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Download driver template</button>
                    <label className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 cursor-pointer disabled:opacity-50 inline-block">
                      <input ref={driverFileRef} type="file" accept=".xlsx,.xls" className="sr-only" onChange={handleDriverImport} disabled={importing} />
                      {importing ? 'Importing…' : 'Choose file and import'}
                    </label>
                  </div>
                  {importSuccess?.type === 'drivers' && (
                    <p className="mt-3 text-sm text-green-600">
                      Successfully imported {importSuccess.count} driver(s).
                      {importSuccess.skipped > 0 && (
                        <span className="text-amber-700"> {importSuccess.skipped} skipped (duplicate ID or licence).</span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'driver-register' && (
              <div className="w-full">
                <div className="bg-white rounded-xl border border-surface-200 p-6">
                  <h2 className="font-medium text-surface-900 mb-4">Driver register</h2>
                  <p className="text-xs text-surface-500 mb-3">Click a driver to view full details.</p>
                  <input
                    type="search"
                    value={driverRegisterSearch}
                    onChange={(e) => setDriverRegisterSearch(e.target.value)}
                    placeholder="Search drivers by name, ID, license, phone, email…"
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-3"
                  />
                  <ul className="space-y-1 text-sm">
                    {filteredDriverRegisterList.length === 0 ? <li className="text-surface-500">{driversList.length === 0 ? 'No drivers yet.' : 'No drivers match your search.'}</li> : filteredDriverRegisterList.map((d) => (
                      <li
                        key={d.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedRegisterDriver(d)}
                        onKeyDown={(e) => e.key === 'Enter' && setSelectedRegisterDriver(d)}
                        className={`flex justify-between items-center py-2.5 px-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedRegisterDriver?.id === d.id ? 'border-brand-300 bg-brand-50' : 'border-transparent hover:bg-surface-50'
                        }`}
                      >
                        <span className="font-medium">{d.full_name || [d.name, d.surname].filter(Boolean).join(' ') || '—'}</span>
                        <span className="text-surface-500 text-xs">
                          {d.id_number ? `ID ${d.id_number}` : ''} {d.license_number ? `· ${d.license_number}` : ''} {d.license_expiry ? `· exp ${formatDate(d.license_expiry)}` : ''}
                          {(d.linkedTruckRegistration || d.linked_truck_registration) && (
                            <span className="ml-1 text-brand-600">· Truck: {d.linkedTruckRegistration || d.linked_truck_registration}</span>
                          )}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${d.facility_access ? 'bg-green-100 text-green-800' : d.last_decline_reason ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`} title={d.last_decline_reason || ''}>
                          {d.facility_access ? 'Facility access' : d.last_decline_reason ? 'Declined' : 'Pending'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Driver detail panel (Driver register tab) – editable */}
            {activeTab === 'driver-register' && selectedRegisterDriver && (
              <div className="fixed inset-0 z-50 flex items-stretch" aria-modal="true" role="dialog" aria-label="Driver details">
                <button type="button" onClick={() => setSelectedRegisterDriver(null)} className="absolute inset-0 bg-black/40" aria-label="Close" />
                <div className="relative w-full max-w-lg ml-auto bg-white shadow-xl flex flex-col max-h-full overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200">
                    <h3 className="font-semibold text-surface-900">Driver details</h3>
                    <button type="button" onClick={() => setSelectedRegisterDriver(null)} className="p-2 rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700" aria-label="Close">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <form onSubmit={saveDriver} className="flex-1 overflow-y-auto p-4 space-y-3">
                    {(() => {
                      const d = selectedRegisterDriver;
                      const get = (snake, camel) => (d[snake] ?? d[camel]) != null ? String(d[snake] ?? d[camel]).trim() : '';
                      const fullName = get('full_name', 'fullName') || [get('name', 'name'), get('surname', 'surname')].filter(Boolean).join(' ') || '';
                      const licenseExpiry = d.license_expiry ?? d.licenseExpiry;
                      const expiryStr = licenseExpiry ? (typeof licenseExpiry === 'string' && licenseExpiry.match(/^\d{4}-\d{2}-\d{2}/) ? licenseExpiry : new Date(licenseExpiry).toISOString().slice(0, 10)) : '';
                      return (
                        <>
                          <div className="rounded-lg border border-surface-200 bg-surface-50 p-3 mb-2">
                            <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Facility access</p>
                            {d.facility_access ? (
                              <p className="text-sm text-green-700 font-medium">Approved — this driver can access the facility.</p>
                            ) : d.last_decline_reason ? (
                              <>
                                <p className="text-sm text-red-700 font-medium">Declined</p>
                                <p className="text-sm text-surface-600 mt-1 whitespace-pre-wrap">{d.last_decline_reason}</p>
                              </>
                            ) : (
                              <p className="text-sm text-amber-700">Pending approval. Command Centre will review this addition.</p>
                            )}
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Full name</label>
                            <input name="full_name" defaultValue={fullName} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Surname</label>
                            <input name="surname" defaultValue={get('surname', 'surname')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">ID number</label>
                            <input name="id_number" defaultValue={get('id_number', 'idNumber')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">License number</label>
                            <input name="license_number" defaultValue={get('license_number', 'licenseNumber')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">License expiry</label>
                            <input name="license_expiry" type="date" defaultValue={expiryStr} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Phone</label>
                            <input name="phone" type="tel" defaultValue={get('phone', 'phone')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Email</label>
                            <input name="email" type="email" defaultValue={get('email', 'email')} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div className="rounded-lg border border-surface-200 bg-surface-50/80 p-3 space-y-2">
                            <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Link to truck</p>
                            <p className="text-xs text-surface-600">Assign this driver to a primary truck. Search by registration, fleet no, make/model or contractor.</p>
                            {(driverLinkedTruckSelection || d.linkedTruckId || d.linked_truck_id) && (
                              <div className="flex items-center justify-between gap-2 rounded-lg border border-surface-200 bg-white px-3 py-2">
                                <span className="text-sm font-medium text-surface-900">
                                  {driverLinkedTruckSelection
                                    ? `${driverLinkedTruckSelection.registration || '—'}${driverLinkedTruckSelection.fleet_no ? ` · Fleet ${driverLinkedTruckSelection.fleet_no}` : ''}${driverLinkedTruckSelection.make_model ? ` · ${driverLinkedTruckSelection.make_model}` : ''}`
                                    : (d.linkedTruckRegistration || d.linked_truck_registration || '—') + (d.linkedTruckFleetNo || d.linked_truck_fleet_no ? ` · Fleet ${d.linkedTruckFleetNo || d.linked_truck_fleet_no}` : '')}
                                </span>
                                <button type="button" onClick={() => { setDriverLinkedTruckSelection(null); setDriverLinkedTruckSearch(''); }} className="text-xs font-medium text-red-600 hover:text-red-700 shrink-0">Clear link</button>
                              </div>
                            )}
                            <div className="relative" ref={driverLinkedTruckDropdownRef}>
                              <input
                                type="text"
                                placeholder="Search trucks to link..."
                                value={driverLinkedTruckSearch}
                                onChange={(e) => { setDriverLinkedTruckSearch(e.target.value); setDriverLinkedTruckDropdownOpen(true); }}
                                onFocus={() => setDriverLinkedTruckDropdownOpen(true)}
                                className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                              />
                              {driverLinkedTruckDropdownOpen && (
                                <ul className="absolute z-20 mt-1 w-full max-h-52 overflow-auto rounded-lg border border-surface-200 bg-white shadow-lg py-1 text-sm">
                                  {filteredTrucksForDriverLink.length === 0 ? (
                                    <li className="px-3 py-2 text-surface-500">No trucks match</li>
                                  ) : (
                                    filteredTrucksForDriverLink.map((t) => (
                                      <li
                                        key={t.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => {
                                          setDriverLinkedTruckSelection(t);
                                          setDriverLinkedTruckSearch(t.registration || '');
                                          setDriverLinkedTruckDropdownOpen(false);
                                        }}
                                        onKeyDown={(ev) => ev.key === 'Enter' && (setDriverLinkedTruckSelection(t), setDriverLinkedTruckSearch(t.registration || ''), setDriverLinkedTruckDropdownOpen(false))}
                                        className="px-3 py-2 hover:bg-surface-100 cursor-pointer border-b border-surface-100 last:border-0"
                                      >
                                        <span className="font-medium text-surface-900">{t.registration || '—'}</span>
                                        {t.fleet_no && <span className="text-surface-500"> · Fleet {t.fleet_no}</span>}
                                        {t.make_model && <span className="text-surface-600"> · {t.make_model}</span>}
                                        {t.main_contractor && <span className="text-surface-500"> · {t.main_contractor}</span>}
                                      </li>
                                    ))
                                  )}
                                </ul>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2 pt-2">
                            <button type="submit" disabled={savingDriver} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                              {savingDriver ? 'Saving…' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setSelectedRegisterDriver(null)} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">
                              Cancel
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </form>
                </div>
              </div>
            )}

            {activeTab === 'import-all' && (
              <div className="w-full">
                <div className="bg-white rounded-xl border border-surface-200 p-6">
                  <h2 className="font-medium text-surface-900 mb-3">Import trucks and drivers at once</h2>
                  <p className="text-sm text-surface-500 mb-4">Use the consolidated template with a <strong>Trucks</strong> sheet and a <strong>Drivers</strong> sheet. Fill in your data, then upload the file to import both in one go.</p>
                  <div className="flex flex-wrap gap-3 items-center">
                    <button type="button" onClick={() => downloadConsolidatedTemplate().catch((err) => setError(err?.message || 'Download failed'))} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Download consolidated template</button>
                    <label className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 cursor-pointer disabled:opacity-50 inline-block">
                      <input ref={consolidatedFileRef} type="file" accept=".xlsx,.xls" className="sr-only" onChange={handleConsolidatedImport} disabled={importing} />
                      {importing ? 'Importing…' : 'Choose file and import all'}
                    </label>
                  </div>
                  {importSuccess?.type === 'all' && (
                    <p className="mt-3 text-sm text-green-600">
                      Imported {importSuccess.trucks ?? 0} truck(s) and {importSuccess.drivers ?? 0} driver(s).
                      {(importSuccess.trucksSkipped > 0 || importSuccess.driversSkipped > 0) && (
                        <span className="text-amber-700">
                          {' '}({importSuccess.trucksSkipped ?? 0} truck, {importSuccess.driversSkipped ?? 0} driver duplicates skipped)
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'incidents' && (
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="bg-white rounded-xl border border-surface-200 p-6">
                  <h2 className="font-medium text-surface-900 mb-4">Report breakdown or incident</h2>
                  <form onSubmit={addIncident} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-surface-700 mb-1">Type of incident / breakdown</label>
                      <select name="type" required className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                        <option value="">Select type</option>
                        {INCIDENT_TYPES.map((t) => (
                          <option key={t} value={t.toLowerCase().replace(/ /g, '_')}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div className="relative" ref={truckDropdownRef}>
                      <label className="block text-sm font-medium text-surface-700 mb-1">Truck</label>
                      <input
                        type="text"
                        placeholder="Search and select truck..."
                        value={truckSearch}
                        onChange={(e) => { setTruckSearch(e.target.value); setTruckDropdownOpen(true); }}
                        onFocus={() => setTruckDropdownOpen(true)}
                        className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                      />
                      {selectedTruck && (
                        <p className="text-xs text-surface-500 mt-1">Selected: {selectedTruck.registration}{selectedTruck.main_contractor ? ` (${selectedTruck.main_contractor})` : ''}</p>
                      )}
                      {truckDropdownOpen && (
                        <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-auto rounded-lg border border-surface-200 bg-white shadow-lg py-1 text-sm">
                          {filteredTrucks.length === 0 ? <li className="px-3 py-2 text-surface-500">No trucks match</li> : filteredTrucks.map((t) => (
                            <li
                              key={t.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => { setSelectedTruck(t); setTruckSearch(t.registration); setTruckDropdownOpen(false); }}
                              onKeyDown={(ev) => ev.key === 'Enter' && (setSelectedTruck(t), setTruckSearch(t.registration), setTruckDropdownOpen(false))}
                              className="px-3 py-2 hover:bg-surface-100 cursor-pointer"
                            >
                              {t.registration}{t.main_contractor ? ` · ${t.main_contractor}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="relative" ref={driverDropdownRef}>
                      <label className="block text-sm font-medium text-surface-700 mb-1">Driver</label>
                      <input
                        type="text"
                        placeholder="Search and select driver..."
                        value={driverSearch}
                        onChange={(e) => { setDriverSearch(e.target.value); setDriverDropdownOpen(true); }}
                        onFocus={() => setDriverDropdownOpen(true)}
                        className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                      />
                      {selectedDriver && (
                        <p className="text-xs text-surface-500 mt-1">Selected: {selectedDriver.full_name || [selectedDriver.name, selectedDriver.surname].filter(Boolean).join(' ')}</p>
                      )}
                      {driverDropdownOpen && (
                        <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-auto rounded-lg border border-surface-200 bg-white shadow-lg py-1 text-sm">
                          {filteredDrivers.length === 0 ? <li className="px-3 py-2 text-surface-500">No drivers match</li> : filteredDrivers.map((d) => (
                            <li
                              key={d.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => { setSelectedDriver(d); setDriverSearch(d.full_name || [d.name, d.surname].filter(Boolean).join(' ')); setDriverDropdownOpen(false); }}
                              onKeyDown={(ev) => ev.key === 'Enter' && (setSelectedDriver(d), setDriverSearch(d.full_name || ''), setDriverDropdownOpen(false))}
                              className="px-3 py-2 hover:bg-surface-100 cursor-pointer"
                            >
                              {d.full_name || [d.name, d.surname].filter(Boolean).join(' ')} {d.license_number ? `· ${d.license_number}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-surface-700 mb-1">Location (optional)</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Address or coordinates (e.g. -26.2041, 28.0473)"
                          value={incidentLocation}
                          onChange={(e) => setIncidentLocation(e.target.value)}
                          className="flex-1 rounded-lg border border-surface-300 px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!navigator.geolocation) {
                              setError('GPS is not supported in this browser.');
                              return;
                            }
                            navigator.geolocation.getCurrentPosition(
                              (pos) => setIncidentLocation(`${pos.coords.latitude}, ${pos.coords.longitude}`),
                              () => setError('Could not get GPS location.')
                            );
                          }}
                          className="shrink-0 px-3 py-2 text-sm font-medium rounded-lg border border-surface-300 bg-surface-50 text-surface-700 hover:bg-surface-100"
                        >
                          Use GPS
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-surface-700 mb-1">Route (optional)</label>
                      {incidentRoutesLoading ? (
                        <p className="text-sm text-surface-500 py-2">Loading routes…</p>
                      ) : incidentRoutesForTruck.length === 0 ? (
                        <p className="text-sm text-surface-500 py-2">No route enrolled for this truck</p>
                      ) : incidentRoutesForTruck.length === 1 ? (
                        <p className="text-sm text-surface-600 py-2">{incidentRoutesForTruck[0].name}</p>
                      ) : (
                        <select
                          value={incidentRouteId}
                          onChange={(e) => setIncidentRouteId(e.target.value)}
                          className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                        >
                          <option value="">Select route</option>
                          {incidentRoutesForTruck.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-1">Date</label>
                        <input name="reported_date" type="date" required className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-surface-700 mb-1">Time</label>
                        <input name="reported_time" type="time" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-surface-700 mb-1">Title (optional)</label>
                      <input name="title" placeholder="e.g. Axle failure on N4" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-surface-700 mb-1">Description</label>
                      <textarea name="description" placeholder="Describe the breakdown or incident" rows={3} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-surface-700 mb-1">Actions taken</label>
                      <textarea name="actions_taken" placeholder="What actions were taken?" rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    </div>
                    <select name="severity" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                      <option value="">Severity (optional)</option>
                      {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <div className="border border-surface-200 rounded-lg p-4 bg-surface-50 space-y-3">
                      <p className="text-sm font-medium text-surface-700">Attachments (all required)</p>
                      <div>
                        <label className="block text-xs font-medium text-surface-600 mb-1">Loading slip</label>
                        <input ref={loadingSlipRef} type="file" accept="image/*,.pdf" required className="w-full text-sm text-surface-600 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand-100 file:text-brand-700" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-surface-600 mb-1">Seal 1</label>
                        <input ref={seal1Ref} type="file" accept="image/*,.pdf" required className="w-full text-sm text-surface-600 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand-100 file:text-brand-700" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-surface-600 mb-1">Seal 2</label>
                        <input ref={seal2Ref} type="file" accept="image/*,.pdf" required className="w-full text-sm text-surface-600 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand-100 file:text-brand-700" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-surface-600 mb-1">Picture of the problem</label>
                        <input ref={pictureProblemRef} type="file" accept="image/*,.pdf" required className="w-full text-sm text-surface-600 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand-100 file:text-brand-700" />
                      </div>
                    </div>
                    <button type="submit" disabled={saving} className="w-full px-4 py-3 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2">
                      {saving ? (
                        <>
                          <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden />
                          Submitting…
                        </>
                      ) : (
                        'Submit report'
                      )}
                    </button>
                  </form>
                </div>
                <div className="bg-white rounded-xl border border-surface-200 p-4">
                  <h2 className="font-medium text-surface-900 mb-3">Breakdowns & incidents</h2>
                  <p className="text-xs text-surface-500 mb-2">Click an incident to view details and resolve it.</p>
                  <input
                    type="search"
                    value={incidentsListSearch}
                    onChange={(e) => setIncidentsListSearch(e.target.value)}
                    placeholder="Search incidents by ref, title, type, severity, location…"
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-3"
                  />
                  <ul className="space-y-1 text-sm">
                    {filteredIncidentsList.length === 0 ? <li className="text-surface-500 py-2">{incidentsList.length === 0 ? 'No reports yet.' : 'No incidents match your search.'}</li> : filteredIncidentsList.map((i) => {
                      const truckId = i.truck_id ?? i.truckId;
                      const driverId = i.driver_id ?? i.driverId;
                      const truck = truckId && trucksList.find((t) => String(t.id || '').toLowerCase() === String(truckId).toLowerCase());
                      const driver = driverId && driversList.find((d) => String(d.id || '').toLowerCase() === String(driverId).toLowerCase());
                      const titleDisplay = (i.title && i.title.trim() && i.title.toLowerCase() !== 'incident')
                        ? i.title
                        : incidentTypeLabel(i.type);
                      return (
                      <li
                        key={i.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedIncident(i)}
                        onKeyDown={(e) => e.key === 'Enter' && setSelectedIncident(i)}
                        className={`py-2.5 px-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedIncident?.id === i.id
                            ? 'border-brand-300 bg-brand-50'
                            : 'border-transparent hover:bg-surface-50'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-surface-500">{incidentRef(i)}</span>
                          <span className="font-medium text-surface-900">{titleDisplay}</span>
                          {(i.type && incidentTypeLabel(i.type).toLowerCase() !== 'incident') && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-surface-200 text-surface-600">{incidentTypeLabel(i.type)}</span>
                          )}
                          {i.severity && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{i.severity}</span>}
                          {i.resolved_at && <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800">Resolved</span>}
                          {i.resolved_at && !(i.offloading_slip_path ?? i.offloadingSlipPath) && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Slip pending</span>
                          )}
                        </div>
                        <p className="text-surface-500 text-xs mt-1">
                          {formatDateTime(i.reported_at)}
                          {truck && ` · Truck: ${truck.registration}`}
                          {driver && ` · Driver: ${driver.full_name}`}
                        </p>
                      </li>
                    ); })}
                  </ul>
                </div>
              </div>
            )}

            {/* Incident detail panel (when an incident is selected) */}
            {selectedIncident && (
              <div
                className="fixed inset-0 z-50 flex items-stretch"
                aria-modal="true"
                role="dialog"
                aria-label="Incident details"
              >
                <button
                  type="button"
                  onClick={() => setSelectedIncident(null)}
                  className="absolute inset-0 bg-black/40"
                  aria-label="Close"
                />
                <div className="relative w-full max-w-xl ml-auto bg-white shadow-xl flex flex-col max-h-full overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200">
                    <h3 className="font-semibold text-surface-900">Incident details {incidentForPanel && <span className="font-mono text-surface-500 font-normal">({incidentRef(incidentForPanel)})</span>}</h3>
                    <button
                      type="button"
                      onClick={() => setSelectedIncident(null)}
                      className="p-2 rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-700"
                      aria-label="Close"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {incidentDetailLoading ? (
                      <div className="flex items-center justify-center py-12 text-surface-500">
                        <span className="inline-block w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mr-2" aria-hidden />
                        Loading incident…
                      </div>
                    ) : (
                      <>
                    <div>
                      <p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Title</p>
                      <p className="text-surface-900 font-medium mt-0.5">{getIncidentField(incidentForPanel, 'title') || '—'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center px-2 py-1 rounded-md bg-surface-100 text-surface-700 text-xs font-medium">{incidentTypeLabel(getIncidentField(incidentForPanel, 'type'))}</span>
                      {getIncidentField(incidentForPanel, 'severity') && <span className="inline-flex items-center px-2 py-1 rounded-md bg-amber-100 text-amber-800 text-xs font-medium">{getIncidentField(incidentForPanel, 'severity')}</span>}
                      {getIncidentField(incidentForPanel, 'resolved_at') ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-green-100 text-green-800 text-xs font-medium">Resolved {formatDate(getIncidentField(incidentForPanel, 'resolved_at'))}</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-amber-100 text-amber-800 text-xs font-medium">Open</span>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Reported</p>
                      <p className="text-surface-700 text-sm mt-0.5">{formatDateTime(getIncidentField(incidentForPanel, 'reported_at'))}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Truck</p>
                      <p className="text-surface-700 text-sm mt-0.5">{panelTruck ? panelTruck.registration : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Driver</p>
                      <p className="text-surface-700 text-sm mt-0.5">{panelDriver ? (panelDriver.full_name || [panelDriver.name, panelDriver.surname].filter(Boolean).join(' ')) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Description</p>
                      <p className="text-surface-700 text-sm mt-0.5 whitespace-pre-wrap">{getIncidentField(incidentForPanel, 'description') || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-surface-400 uppercase tracking-wider">Actions taken</p>
                      <p className="text-surface-700 text-sm mt-0.5 whitespace-pre-wrap">{getIncidentField(incidentForPanel, 'actions_taken') || '—'}</p>
                    </div>
                    {getIncidentField(incidentForPanel, 'resolved_at') && (
                      <div className="rounded-lg border border-green-200 bg-green-50/50 p-3 space-y-2">
                        <p className="text-xs font-medium text-surface-600 uppercase tracking-wider">Resolution</p>
                        {getIncidentField(incidentForPanel, 'resolution_note') && (
                          <p className="text-surface-700 text-sm whitespace-pre-wrap">{getIncidentField(incidentForPanel, 'resolution_note')}</p>
                        )}
                        {getIncidentField(incidentForPanel, 'offloading_slip_path') ? (
                          <div className="flex items-center justify-between gap-2 pt-2">
                            <span className="text-sm text-surface-700">Offloading slip</span>
                            <div className="flex gap-2 shrink-0">
                              <button type="button" onClick={() => viewAttachment('offloading_slip')} disabled={attachmentLoading !== null} className="text-xs px-2.5 py-1.5 rounded-md border border-surface-200 text-surface-700 hover:bg-surface-100 disabled:opacity-50">{attachmentLoading === 'offloading_slip' ? '…' : 'View'}</button>
                              <button type="button" onClick={() => downloadAttachment('offloading_slip', 'Offloading slip')} disabled={attachmentLoading !== null} className="text-xs px-2.5 py-1.5 rounded-md bg-surface-200 text-surface-800 hover:bg-surface-300 disabled:opacity-50">{attachmentLoading === 'offloading_slip' ? '…' : 'Download'}</button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 pt-3 border-t border-amber-200">
                            <p className="text-amber-800 text-sm font-medium">Pending offloading slip</p>
                            <p className="text-amber-700 text-xs mt-0.5">Submit the offloading slip to complete this resolution.</p>
                            <form onSubmit={submitOffloadingSlipLater} className="mt-2 flex flex-wrap items-end gap-2">
                              <input ref={offloadingSlipLaterRef} type="file" accept="image/*,.pdf" required className="text-sm text-surface-600 file:mr-2 file:py-1.5 file:px-2 file:rounded file:border-0 file:bg-amber-100 file:text-amber-800 file:text-xs" />
                              <button type="submit" disabled={uploadingOffloadingSlip} className="px-3 py-1.5 text-xs font-medium rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                                {uploadingOffloadingSlip ? 'Uploading…' : 'Submit offloading slip'}
                              </button>
                            </form>
                          </div>
                        )}
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">Attachments</p>
                      <div className="space-y-2">
                        {INCIDENT_ATTACHMENTS.map(({ type, label, pathKey }) =>
                          getIncidentPath(incidentForPanel, pathKey) ? (
                            <div key={type} className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-surface-50 border border-surface-100">
                              <span className="text-sm text-surface-700">{label}</span>
                              <div className="flex gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => viewAttachment(type)}
                                  disabled={attachmentLoading !== null}
                                  className="text-xs px-2.5 py-1.5 rounded-md border border-surface-200 text-surface-700 hover:bg-surface-100 disabled:opacity-50"
                                >
                                  {attachmentLoading === type ? '…' : 'View'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => downloadAttachment(type, label)}
                                  disabled={attachmentLoading !== null}
                                  className="text-xs px-2.5 py-1.5 rounded-md bg-surface-200 text-surface-800 hover:bg-surface-300 disabled:opacity-50"
                                >
                                  {attachmentLoading === type ? '…' : 'Download'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div key={type} className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-50 border border-surface-100">
                              <span className="text-sm text-surface-500">{label}</span>
                              <span className="text-xs text-surface-400">Not uploaded</span>
                            </div>
                          )
                        )}
                      </div>
                      <div className="mt-3 flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          onClick={downloadPdfReport}
                          disabled={downloadingPdf || downloadingReport}
                          className="flex-1 py-2.5 px-3 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {downloadingPdf ? (
                            <>
                              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden />
                              Generating…
                            </>
                          ) : (
                            'Download PDF report'
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={downloadFullReport}
                          disabled={downloadingReport || downloadingPdf}
                          className="flex-1 py-2.5 px-3 text-sm font-medium rounded-lg border-2 border-brand-200 text-brand-700 hover:bg-brand-50 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {downloadingReport ? (
                            <>
                              <span className="inline-block w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" aria-hidden />
                              Preparing…
                            </>
                          ) : (
                            'Download full report (ZIP)'
                          )}
                        </button>
                      </div>
                    </div>
                      </>
                    )}
                  </div>
                  {!incidentDetailLoading && incidentForPanel && !getIncidentField(incidentForPanel, 'resolved_at') && (
                    <div className="px-4 py-3 border-t border-surface-200 bg-surface-50">
                      {showResolveForm ? (
                        <form ref={resolveFormRef} onSubmit={submitResolve} className="space-y-3">
                          <div>
                            <label className="block text-sm font-medium text-surface-700 mb-1">Resolution note <span className="text-red-500">*</span></label>
                            <textarea name="resolution_note" rows={3} required placeholder="Describe how the incident was resolved…" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-surface-700 mb-1">Offloading slip <span className="text-surface-500 font-normal">(optional – you can submit later)</span></label>
                            <input ref={offloadingSlipRef} type="file" accept="image/*,.pdf" className="w-full text-sm text-surface-600 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand-100 file:text-brand-700" />
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setShowResolveForm(false)} className="flex-1 py-2 px-4 text-sm font-medium rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
                            <button type="submit" disabled={resolvingIncident} className="flex-1 py-2.5 px-4 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
                              {resolvingIncident ? (
                                <>
                                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden />
                                  Resolving…
                                </>
                              ) : (
                                'Submit & mark resolved'
                              )}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowResolveForm(true)}
                          className="w-full py-2.5 px-4 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700"
                        >
                          Mark as resolved
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'expiries' && (
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="bg-white rounded-xl border border-surface-200 p-4">
                  <h2 className="font-medium text-surface-900 mb-3">Add expiry (licence, roadworthy, permit)</h2>
                  <form onSubmit={addExpiry} className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Type</label>
                      <select
                        name="item_type"
                        value={expiryItemType}
                        onChange={(e) => setExpiryItemType(e.target.value)}
                        className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                      >
                        <option value="license">Driver licence</option>
                        <option value="roadworthy">Vehicle roadworthy</option>
                        <option value="permit">Permit / certificate</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    {expiryItemType === 'other' && (
                      <div>
                        <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Please specify type <span className="text-red-600">*</span></label>
                        <input
                          name="item_type_other"
                          type="text"
                          placeholder="e.g. Customs clearance, Insurance"
                          required
                          className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                        />
                      </div>
                    )}
                    <div className="relative" ref={expiryRefDropdownRef}>
                      <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Reference</label>
                      <input
                        name="item_ref"
                        type="text"
                        value={expiryRefSearch}
                        onChange={(e) => { setExpiryRefSearch(e.target.value); setExpiryRefDropdownOpen(true); }}
                        onFocus={() => setExpiryRefDropdownOpen(true)}
                        placeholder="Search truck reg, driver name or ID, or type a reference..."
                        className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                        autoComplete="off"
                      />
                      {expiryRefDropdownOpen && (expiryRefOptions.length > 0 || expiryRefSearch.trim()) && (
                        <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-auto rounded-lg border border-surface-200 bg-white shadow-lg py-1 text-sm">
                          {expiryRefOptions.length === 0 ? (
                            <li className="px-3 py-2 text-surface-500">No matches. You can type a custom reference above.</li>
                          ) : (
                            expiryRefOptions.map((opt, idx) => (
                              <li
                                key={`${opt.type}-${opt.value}-${idx}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => { setExpiryRefSearch(opt.value); setExpiryRefDropdownOpen(false); }}
                                onKeyDown={(ev) => ev.key === 'Enter' && (setExpiryRefSearch(opt.value), setExpiryRefDropdownOpen(false))}
                                className="px-3 py-2 hover:bg-surface-100 cursor-pointer"
                              >
                                {opt.label}
                              </li>
                            ))
                          )}
                        </ul>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Issued date</label>
                      <input name="issued_date" type="date" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Expiry date</label>
                      <input name="expiry_date" type="date" required className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    </div>
                    <input name="description" placeholder="Description" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Add expiry</button>
                  </form>
                </div>
                <div className="bg-white rounded-xl border border-surface-200 p-4">
                  <h2 className="font-medium text-surface-900 mb-3">Expiries</h2>
                  <input
                    type="search"
                    value={expirySearch}
                    onChange={(e) => setExpirySearch(e.target.value)}
                    placeholder="Search by type, reference, description or date..."
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-3"
                    aria-label="Search expiries"
                  />
                  <ul className="space-y-2 text-sm">
                    {filteredExpiriesList.length === 0 ? (
                      <li className="text-surface-500">
                        {expiriesList.length === 0 ? 'No expiries recorded.' : 'No expiries match your search.'}
                      </li>
                    ) : (
                      filteredExpiriesList.map((e) => (
                        <li key={e.id} className="py-2 border-b border-surface-100 flex justify-between items-start gap-2">
                          <span>
                            {e.item_type} {e.item_ref && `· ${e.item_ref}`}
                            {(e.issued_date || e.issuedDate) && (
                              <span className="text-surface-400 text-xs block mt-0.5">Issued {formatDate(e.issued_date ?? e.issuedDate)}</span>
                            )}
                          </span>
                          <span className={new Date(e.expiry_date) < new Date() ? 'text-red-600' : 'text-surface-600'}>{formatDate(e.expiry_date)}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            )}

            {activeTab === 'suspensions' && (
              <div className="flex flex-col lg:flex-row gap-4 lg:gap-0 lg:min-h-0">
                <div className="space-y-6 flex-1 min-w-0 lg:overflow-auto">
                <div className="bg-white rounded-xl border border-surface-200 p-4">
                  <h2 className="font-medium text-surface-900 mb-2">Compliance records</h2>
                  <p className="text-sm text-surface-500 mb-3">Click a row to view full details in the side panel. Respond within 8 hours or the truck/driver will be auto-suspended.</p>
                  <div className="overflow-x-auto -mx-4 sm:mx-0">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead>
                        <tr className="border-b border-surface-200 text-left">
                          <th className="pb-2 pr-2 font-medium text-surface-700 whitespace-nowrap">Date</th>
                          <th className="pb-2 pr-2 font-medium text-surface-700 whitespace-nowrap">Truck</th>
                          <th className="pb-2 pr-2 font-medium text-surface-700 whitespace-nowrap">Driver</th>
                          <th className="pb-2 pr-2 font-medium text-surface-700 whitespace-nowrap">Truck / Driver result</th>
                          <th className="pb-2 pr-2 font-medium text-surface-700 whitespace-nowrap">Response due</th>
                          <th className="pb-2 pr-2 font-medium text-surface-700 whitespace-nowrap">Status</th>
                          <th className="pb-2 pl-2 font-medium text-surface-700 whitespace-nowrap">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {complianceRecordsList.length === 0 ? (
                          <tr><td colSpan={7} className="py-6 text-surface-500 text-center">No compliance records.</td></tr>
                        ) : complianceRecordsList.map((rec) => {
                          const due = rec.responseDueAt ? new Date(rec.responseDueAt) : null;
                          const isOverdue = due && due.getTime() < Date.now();
                          const canRespond = rec.status === 'pending_response' && !isOverdue;
                          const canAppeal = rec.status === 'auto_suspended' && rec.suspension && rec.suspension.status === 'suspended' && !rec.suspension.appeal_notes;
                          return (
                            <tr
                              key={rec.id}
                              className={`border-b border-surface-100 cursor-pointer transition-colors ${complianceDetailRecord?.id === rec.id ? 'bg-brand-50' : 'hover:bg-surface-50'}`}
                              onClick={() => {
                                setComplianceDetailRecord(null);
                                setComplianceDetailLoading(true);
                                contractorApi.complianceRecords.get(rec.id)
                                  .then((r) => { setComplianceDetailRecord(r.record); })
                                  .catch(() => { setComplianceDetailRecord(null); })
                                  .finally(() => { setComplianceDetailLoading(false); });
                              }}
                            >
                              <td className="py-3 pr-2 text-surface-600 whitespace-nowrap">{formatDateTime(rec.inspectedAt)}</td>
                              <td className="py-3 pr-2 font-medium">{rec.truckRegistration || '—'}</td>
                              <td className="py-3 pr-2">{rec.driverName || '—'}</td>
                              <td className="py-3 pr-2">
                                <span className={rec.recommendSuspendTruck ? 'text-red-700' : 'text-green-700'}>Truck: {rec.recommendSuspendTruck ? 'suspend' : 'OK'}</span>
                                <span className="text-surface-400 mx-1">·</span>
                                <span className={rec.recommendSuspendDriver ? 'text-red-700' : 'text-green-700'}>Driver: {rec.recommendSuspendDriver ? 'suspend' : 'OK'}</span>
                              </td>
                              <td className="py-3 pr-2 text-surface-600 whitespace-nowrap">{due ? formatDateTime(rec.responseDueAt) : '—'}</td>
                              <td className="py-3 pr-2">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${rec.status === 'pending_response' ? 'bg-amber-100 text-amber-800' : rec.status === 'responded' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{rec.status === 'pending_response' ? (isOverdue ? 'Overdue' : 'Pending') : rec.status === 'responded' ? 'Responded' : 'Auto-suspended'}</span>
                              </td>
                              <td className="py-3 pl-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                {canRespond && <button type="button" onClick={() => { setComplianceRespondRecord(rec); setComplianceRespondText(rec.contractorResponseText || ''); }} className="text-brand-600 hover:underline text-xs font-medium">Respond</button>}
                                {canAppeal && <button type="button" onClick={() => { setComplianceAppealRecord(rec); setComplianceAppealNotes(rec.suspension?.appeal_notes || ''); }} className="text-amber-600 hover:underline text-xs font-medium ml-2">Appeal</button>}
                                {rec.suspension?.appeal_notes && <span className="text-surface-500 text-xs ml-2">Appeal submitted</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="bg-white rounded-xl border border-surface-200 p-4">
                    <h2 className="font-medium text-surface-900 mb-3">Record suspension</h2>
                    <form onSubmit={addSuspension} className="space-y-3">
                      <select name="entity_type" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
                        <option value="driver">Driver</option>
                        <option value="truck">Truck</option>
                        <option value="other">Other</option>
                      </select>
                      <input name="entity_id" placeholder="Reference (e.g. licence or reg)" className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      <textarea name="reason" placeholder="Reason for suspension" required rows={3} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                      <div>
                        <p className="text-xs font-medium text-surface-700 mb-1.5">Duration</p>
                        <div className="flex flex-wrap gap-3 mb-1">
                          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <input type="radio" name="suspend_permanent" value="permanent" defaultChecked className="rounded-full" />
                            <span>Permanent</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <input type="radio" name="suspend_permanent" value="temporary" className="rounded-full" />
                            <span>For a period</span>
                          </label>
                        </div>
                        <select name="suspend_duration_days" className="rounded-lg border border-surface-300 px-3 py-2 text-sm mt-1" defaultValue={7}>
                          <option value={1}>1 day</option>
                          <option value={7}>7 days</option>
                          <option value={14}>14 days</option>
                          <option value={30}>30 days</option>
                          <option value={90}>90 days</option>
                          <option value={180}>180 days</option>
                          <option value={365}>1 year</option>
                        </select>
                      </div>
                      <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Record suspension</button>
                    </form>
                  </div>
                  <div className="bg-white rounded-xl border border-surface-200 p-4">
                    <h2 className="font-medium text-surface-900 mb-3">Suspensions and appeals</h2>
                    <ul className="space-y-2 text-sm">
                      {suspensionsList.length === 0 ? <li className="text-surface-500">No suspensions.</li> : suspensionsList.map((s) => {
                        const permanent = s.is_permanent !== false && s.is_permanent !== 0;
                        const endsAt = s.suspension_ends_at;
                        const durationText = permanent ? 'Permanent' : (endsAt ? `Until ${formatDateTime(endsAt)}` : 'Temporary');
                        return (
                          <li key={s.id} className="py-2 border-b border-surface-100">
                            <span className="font-medium">{s.entity_type} {s.entity_id && `· ${s.entity_id}`}</span>
                            <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${s.status === 'under_appeal' ? 'bg-amber-100 text-amber-800' : s.status === 'resolved' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{s.status}</span>
                            <span className="ml-2 text-xs text-surface-500">{durationText}</span>
                            <p className="text-surface-500 text-xs mt-1">{s.reason}</p>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
                {complianceRespondRecord && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => { setComplianceRespondRecord(null); setComplianceRespondText(''); setComplianceRespondFiles([]); }}>
                    <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full my-8 p-6" onClick={(e) => e.stopPropagation()}>
                      <h3 className="font-semibold text-surface-900 text-lg mb-1">Respond to compliance inspection</h3>
                      <p className="text-sm text-surface-500 mb-4">Truck: {complianceRespondRecord.truckRegistration} · Driver: {complianceRespondRecord.driverName}</p>
                      <label className="block text-sm font-medium text-surface-700 mb-1">Your response (optional)</label>
                      <textarea value={complianceRespondText} onChange={(e) => setComplianceRespondText(e.target.value)} placeholder="Add your comments or explanation…" rows={8} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-4 resize-y min-h-[120px]" />
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-surface-700 mb-1">Attachments (optional, max 10 files)</label>
                        <input type="file" ref={complianceRespondFileInputRef} multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.xls,.xlsx" className="hidden" onChange={(e) => setComplianceRespondFiles(Array.from(e.target.files || []))} />
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" onClick={() => complianceRespondFileInputRef.current?.click()} className="px-3 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Choose files</button>
                          {complianceRespondFiles.length > 0 && (
                            <span className="text-sm text-surface-500">
                              {complianceRespondFiles.length} file{complianceRespondFiles.length !== 1 ? 's' : ''} selected
                              {complianceRespondFiles.slice(0, 3).map((f, i) => (
                                <span key={i} className="ml-1 text-surface-700">{f.name}{i < Math.min(2, complianceRespondFiles.length - 1) ? ',' : ''}</span>
                              ))}
                              {complianceRespondFiles.length > 3 && ` +${complianceRespondFiles.length - 3} more`}
                            </span>
                          )}
                        </div>
                        {complianceRespondFiles.length > 0 && (
                          <button type="button" onClick={() => { setComplianceRespondFiles([]); complianceRespondFileInputRef.current && (complianceRespondFileInputRef.current.value = ''); }} className="mt-1 text-xs text-surface-500 hover:text-surface-700">Clear attachments</button>
                        )}
                      </div>
                      <div className="flex gap-3 pt-2">
                        <button type="button" onClick={() => { setComplianceRespondRecord(null); setComplianceRespondText(''); setComplianceRespondFiles([]); }} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50">Cancel</button>
                        <button type="button" disabled={complianceResponding} onClick={async () => {
                          setComplianceResponding(true);
                          try {
                            const filesToSend = complianceRespondFiles.length > 10 ? complianceRespondFiles.slice(0, 10) : complianceRespondFiles;
                            await contractorApi.complianceRecords.respond(complianceRespondRecord.id, complianceRespondText, filesToSend.length ? filesToSend : null);
                            setComplianceRespondRecord(null);
                            setComplianceRespondText('');
                            setComplianceRespondFiles([]);
                            if (complianceRespondFileInputRef.current) complianceRespondFileInputRef.current.value = '';
                            load();
                            if (complianceDetailRecord?.id === complianceRespondRecord.id) {
                              contractorApi.complianceRecords.get(complianceRespondRecord.id).then((r) => setComplianceDetailRecord(r.record)).catch(() => {});
                            }
                          } finally {
                            setComplianceResponding(false);
                          }
                        }} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Submit response</button>
                      </div>
                    </div>
                  </div>
                )}
                {complianceAppealRecord && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setComplianceAppealRecord(null)}>
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-4" onClick={(e) => e.stopPropagation()}>
                      <h3 className="font-semibold text-surface-900 mb-2">Submit appeal</h3>
                      <p className="text-sm text-surface-500 mb-2">Truck: {complianceAppealRecord.truckRegistration} · Driver: {complianceAppealRecord.driverName}. This record was auto-suspended for no response within 8 hours.</p>
                      <textarea value={complianceAppealNotes} onChange={(e) => setComplianceAppealNotes(e.target.value)} placeholder="Reason for appeal (required)" rows={4} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-3" required />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setComplianceAppealRecord(null); setComplianceAppealNotes(''); }} className="px-3 py-2 text-sm rounded-lg border border-surface-300 text-surface-700">Cancel</button>
                        <button type="button" disabled={complianceAppealing || !complianceAppealNotes.trim()} onClick={async () => {
                          setComplianceAppealing(true);
                          try {
                            const sid = complianceAppealRecord.suspension?.id;
                            if (sid) await contractorApi.suspensions.update(sid, { status: 'under_appeal', appeal_notes: complianceAppealNotes.trim() });
                            setComplianceAppealRecord(null);
                            setComplianceAppealNotes('');
                            load();
                            if (complianceDetailRecord?.id === complianceAppealRecord.id) {
                              contractorApi.complianceRecords.get(complianceAppealRecord.id).then((r) => setComplianceDetailRecord(r.record)).catch(() => {});
                            }
                          } finally {
                            setComplianceAppealing(false);
                          }
                        }} className="px-3 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">Submit appeal</button>
                      </div>
                    </div>
                  </div>
                )}
                </div>

                {(complianceDetailLoading || complianceDetailRecord) && (
                  <div className="w-full lg:w-[26rem] shrink-0 flex flex-col border border-surface-200 lg:border-l-2 bg-white rounded-xl lg:rounded-none shadow-xl lg:shadow-none overflow-hidden min-h-[320px] lg:min-h-0">
                    <div className="shrink-0 px-4 py-3 border-b border-surface-200 bg-surface-50 flex justify-between items-center">
                      <h3 className="font-semibold text-surface-900 text-sm">Compliance record details</h3>
                      <button type="button" onClick={() => { setComplianceDetailRecord(null); }} className="w-8 h-8 rounded-lg border border-surface-300 text-surface-600 hover:bg-surface-100 flex items-center justify-center text-lg leading-none" aria-label="Close">×</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm min-h-0">
                      {complianceDetailLoading ? (
                        <div className="flex items-center justify-center py-8 text-surface-500">Loading…</div>
                      ) : complianceDetailRecord ? (
                        <>
                          <div>
                            <p className="font-medium text-surface-900 text-xs uppercase tracking-wide text-surface-500 mb-0.5">Date &amp; time</p>
                            <p className="text-surface-800">{formatDateTime(complianceDetailRecord.inspectedAt)}</p>
                          </div>
                          <div>
                            <p className="font-medium text-surface-900 text-xs uppercase tracking-wide text-surface-500 mb-0.5">Truck</p>
                            <p className="text-surface-800 break-words">{complianceDetailRecord.truckRegistration || '—'}{complianceDetailRecord.truckMakeModel ? ` · ${complianceDetailRecord.truckMakeModel}` : ''}</p>
                          </div>
                          <div>
                            <p className="font-medium text-surface-900 text-xs uppercase tracking-wide text-surface-500 mb-0.5">Driver</p>
                            <p className="text-surface-800">{complianceDetailRecord.driverName || '—'}</p>
                            {(complianceDetailRecord.driverIdNumber || complianceDetailRecord.licenseNumber) && <p className="text-surface-500 text-xs mt-0.5 break-words">ID: {complianceDetailRecord.driverIdNumber || '—'} · Licence: {complianceDetailRecord.licenseNumber || '—'}</p>}
                          </div>
                          <div className="border-t border-surface-200 pt-3 mt-3">
                            <p className="font-medium text-surface-900 text-xs uppercase tracking-wide text-surface-500 mb-1.5">Truck inspection</p>
                            <ul className="space-y-1.5 text-surface-700">
                              <li><span className="text-surface-500">GPS:</span> {complianceDetailRecord.gpsStatus || '—'}{complianceDetailRecord.gpsComment ? ` — ${complianceDetailRecord.gpsComment}` : ''}</li>
                              <li><span className="text-surface-500">Camera:</span> {complianceDetailRecord.cameraStatus || '—'}{complianceDetailRecord.cameraComment ? ` — ${complianceDetailRecord.cameraComment}` : ''}</li>
                              <li><span className="text-surface-500">Visibility:</span> {complianceDetailRecord.cameraVisibility || '—'}{complianceDetailRecord.cameraVisibilityComment ? ` — ${complianceDetailRecord.cameraVisibilityComment}` : ''}</li>
                            </ul>
                            <p className="mt-2">{complianceDetailRecord.recommendSuspendTruck ? <span className="text-red-700 font-medium">Recommend suspension</span> : <span className="text-green-700">OK</span>}</p>
                          </div>
                          <div className="border-t border-surface-200 pt-3 mt-3">
                            <p className="font-medium text-surface-900 text-xs uppercase tracking-wide text-surface-500 mb-1.5">Driver road safety</p>
                            <ul className="space-y-1.5 text-surface-700">
                              {(complianceDetailRecord.driverItems || []).map((d) => {
                                const label = COMPLIANCE_DRIVER_ITEM_LABELS[d.id] || d.id;
                                return <li key={d.id} className="break-words"><span className="text-surface-500 text-xs">{label}:</span> {d.status || '—'}{d.comment ? ` — ${d.comment}` : ''}</li>;
                              })}
                            </ul>
                            <p className="mt-2">{complianceDetailRecord.recommendSuspendDriver ? <span className="text-red-700 font-medium">Recommend suspension</span> : <span className="text-green-700">OK</span>}</p>
                          </div>
                          <div className="border-t border-surface-200 pt-3 mt-3">
                            <p className="font-medium text-surface-900 text-xs uppercase tracking-wide text-surface-500 mb-0.5">Response due</p>
                            <p className="text-surface-800">{formatDateTime(complianceDetailRecord.responseDueAt)}</p>
                          </div>
                          <div>
                            <p className="font-medium text-surface-900 text-xs uppercase tracking-wide text-surface-500 mb-0.5">Status</p>
                            <p className="text-surface-800">{complianceDetailRecord.status === 'pending_response' ? 'Pending response' : complianceDetailRecord.status === 'responded' ? 'Responded' : 'Auto-suspended'}</p>
                          </div>
                          {(complianceDetailRecord.contractorRespondedAt || complianceDetailRecord.status === 'responded' || ((complianceDetailRecord.responseAttachments || []).length > 0)) && (
                            <div className="border-t border-surface-200 pt-3 mt-3 bg-surface-50 rounded-lg p-3 -mx-1">
                              <p className="font-medium text-surface-900 text-xs uppercase tracking-wide text-surface-500 mb-1">Your response</p>
                              {complianceDetailRecord.contractorRespondedAt && <p className="text-surface-600 text-xs mb-2">Submitted: {formatDateTime(complianceDetailRecord.contractorRespondedAt)}</p>}
                              <div className="bg-white border border-surface-200 rounded-md p-3 mb-3">
                                <p className="text-surface-800 text-sm whitespace-pre-wrap break-words min-h-[2em]">{complianceDetailRecord.contractorResponseText || '—'}</p>
                              </div>
                              {(complianceDetailRecord.responseAttachments || []).length > 0 && (
                                <div className="mt-2">
                                  <p className="text-surface-700 text-xs font-medium mb-1.5">Attachments ({complianceDetailRecord.responseAttachments.length})</p>
                                  <ul className="space-y-1.5">
                                    {(complianceDetailRecord.responseAttachments || []).map((a) => (
                                      <li key={a.id} className="flex items-center gap-2 flex-wrap">
                                        <span className="text-surface-700 text-sm truncate flex-1 min-w-0" title={a.fileName}>{a.fileName}</span>
                                        <button type="button" onClick={() => openAttachmentWithAuth(contractorApi.complianceRecords.attachmentUrl(complianceDetailRecord.id, a.id)).catch((e) => window.alert(e?.message || 'Could not open'))} className="text-xs font-medium text-brand-600 hover:text-brand-700 shrink-0">View</button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                          {(complianceDetailRecord.inspectorReplyText != null || complianceDetailRecord.inspectorRepliedAt) && (
                            <div className="border-t border-surface-200 pt-3 mt-3 bg-brand-50 rounded-lg p-3 -mx-1">
                              <p className="font-medium text-surface-900 text-xs uppercase tracking-wide text-surface-500 mb-1">Command Centre reply</p>
                              {complianceDetailRecord.inspectorRepliedAt && <p className="text-surface-600 text-xs mb-2">Replied: {formatDateTime(complianceDetailRecord.inspectorRepliedAt)}</p>}
                              <p className="text-surface-800 text-sm whitespace-pre-wrap break-words">{complianceDetailRecord.inspectorReplyText || '—'}</p>
                            </div>
                          )}
                          {complianceDetailRecord.suspension && (
                            <div className="border-t border-surface-200 pt-3 mt-3">
                              <p className="font-medium text-surface-900 text-xs uppercase tracking-wide text-surface-500 mb-0.5">Suspension / appeal</p>
                              <p className="text-surface-600 text-xs">Status: {complianceDetailRecord.suspension.status}</p>
                              {complianceDetailRecord.suspension.appeal_notes && <p className="text-surface-800 mt-1 break-words">{complianceDetailRecord.suspension.appeal_notes}</p>}
                            </div>
                          )}
                          {(() => {
                            const due = complianceDetailRecord.responseDueAt ? new Date(complianceDetailRecord.responseDueAt) : null;
                            const isOverdue = due && due.getTime() < Date.now();
                            const canRespond = complianceDetailRecord.status === 'pending_response' && !isOverdue;
                            const canAppeal = complianceDetailRecord.status === 'auto_suspended' && complianceDetailRecord.suspension && complianceDetailRecord.suspension.status === 'suspended' && !complianceDetailRecord.suspension.appeal_notes;
                            if (!canRespond && !canAppeal) return null;
                            return (
                              <div className="border-t border-surface-200 pt-4 mt-4 flex flex-wrap gap-2">
                                {canRespond && <button type="button" onClick={() => { setComplianceRespondRecord(complianceDetailRecord); setComplianceRespondText(complianceDetailRecord.contractorResponseText || ''); }} className="px-3 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-medium">Respond</button>}
                                {canAppeal && <button type="button" onClick={() => { setComplianceAppealRecord(complianceDetailRecord); setComplianceAppealNotes(complianceDetailRecord.suspension?.appeal_notes || ''); }} className="px-3 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 font-medium">Submit appeal</button>}
                              </div>
                            );
                          })()}
                        </>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'enrollment' && (
              <div className="w-full space-y-6">
                <div>
                  <h2 className="font-medium text-surface-900">Fleet and driver enrollment</h2>
                  <p className="text-sm text-surface-500 mt-1">Approved fleet only; suspended trucks/drivers are excluded. Search for a route by name (or start/end point), select it, then enrol trucks or drivers.</p>
                </div>
                {routesList.length === 0 ? (
                  <p className="text-sm text-surface-500">No routes yet. Routes are created in Access Management.</p>
                ) : (
                  <div className="rounded-xl border border-surface-200 bg-white p-4 space-y-3 max-w-2xl">
                    <label className="block text-sm font-medium text-surface-700" htmlFor="enrollment-route-search">Search routes</label>
                    <p className="text-xs text-surface-500">Route names are not listed until you type at least {enrollmentRouteSearchMinChars} characters — this limits exposure of other operations.</p>
                    <input
                      id="enrollment-route-search"
                      type="search"
                      autoComplete="off"
                      value={enrollmentRoutePickerQuery}
                      onChange={(e) => {
                        setEnrollmentRoutePickerQuery(e.target.value);
                        setEnrollmentRouteId(null);
                        setEnrollmentRouteDetail(null);
                        setEnrollmentRouteTruckSearch('');
                        setEnrollmentRouteDriverSearch('');
                      }}
                      placeholder="Type part of route name, start, or destination…"
                      className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                    />
                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-1" htmlFor="enrollment-route-select">Select route</label>
                      <select
                        id="enrollment-route-select"
                        value={enrollmentRouteId || ''}
                        disabled={enrollmentRouteMatches.length === 0}
                        onChange={(e) => {
                          const id = e.target.value || null;
                          setEnrollmentRouteId(id);
                          setEnrollmentRouteTruckSearch('');
                          setEnrollmentRouteDriverSearch('');
                        }}
                        className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm bg-white disabled:bg-surface-50 disabled:text-surface-400"
                      >
                        <option value="">
                          {enrollmentRoutePickerQuery.trim().length < enrollmentRouteSearchMinChars
                            ? `Type at least ${enrollmentRouteSearchMinChars} characters to search…`
                            : enrollmentRouteMatches.length === 0
                              ? 'No routes match — try different words'
                              : 'Choose a route…'}
                        </option>
                        {enrollmentRouteMatches.map((r) => (
                          <option key={r.id} value={r.id}>{r.name || 'Unnamed route'}</option>
                        ))}
                      </select>
                    </div>
                    {enrollmentRouteId && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-xs text-surface-600">
                          Working on: <strong className="text-surface-800">{routesList.find((x) => String(x.id) === String(enrollmentRouteId))?.name || 'Route'}</strong>
                        </span>
                        <button
                          type="button"
                          className="text-xs font-medium text-brand-600 hover:text-brand-800"
                          onClick={() => {
                            setEnrollmentRouteId(null);
                            setEnrollmentRouteDetail(null);
                            setEnrollmentRoutePickerQuery('');
                            setEnrollmentRouteTruckSearch('');
                            setEnrollmentRouteDriverSearch('');
                          }}
                        >
                          Clear and search again
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {enrollmentLoading && (
                  <p className="text-sm text-surface-500">Loading approved fleet…</p>
                )}
                {enrollmentRouteId && (
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="bg-white rounded-xl border border-surface-200 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium text-surface-900">Trucks on this route</h3>
                        <button
                          type="button"
                          onClick={() => setEnrollmentAddTruckOpen(true)}
                          className="px-2 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                        >
                          Enrol truck(s)
                        </button>
                      </div>
                      <input
                        type="search"
                        value={enrollmentRouteTruckSearch}
                        onChange={(e) => setEnrollmentRouteTruckSearch(e.target.value)}
                        placeholder="Search trucks on this route…"
                        className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-3"
                      />
                      <ul className="space-y-1.5 text-sm">
                        {(!enrollmentRouteDetail?.trucks || enrollmentRouteDetail.trucks.length === 0) ? (
                          <li className="text-surface-500">No trucks enrolled on this route.</li>
                        ) : filteredEnrollmentRouteTrucks.length === 0 ? (
                          <li className="text-surface-500">No route trucks match your search.</li>
                        ) : (
                          filteredEnrollmentRouteTrucks.map((t) => (
                            <li key={t.truck_id} className="flex items-center justify-between py-1 border-b border-surface-100">
                              <span>{t.registration} {t.make_model ? ` · ${t.make_model}` : ''} {t.fleet_no ? ` · #${t.fleet_no}` : ''}</span>
                              <button type="button" onClick={async () => { try { await contractorApi.routes.unenrollTruck(enrollmentRouteId, t.truck_id); const r = await contractorApi.routes.get(enrollmentRouteId, enrollmentContractorQuery()); setEnrollmentRouteDetail(r); } catch (e) { setError(e?.message); } }} className="text-red-600 hover:text-red-700 text-xs">Remove</button>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                    <div className="bg-white rounded-xl border border-surface-200 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium text-surface-900">Drivers on this route</h3>
                        <button
                          type="button"
                          onClick={() => setEnrollmentAddDriverOpen(true)}
                          className="px-2 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                        >
                          Enrol driver(s)
                        </button>
                      </div>
                      <input
                        type="search"
                        value={enrollmentRouteDriverSearch}
                        onChange={(e) => setEnrollmentRouteDriverSearch(e.target.value)}
                        placeholder="Search drivers on this route…"
                        className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-3"
                      />
                      <ul className="space-y-1.5 text-sm">
                        {(!enrollmentRouteDetail?.drivers || enrollmentRouteDetail.drivers.length === 0) ? (
                          <li className="text-surface-500">No drivers enrolled on this route.</li>
                        ) : filteredEnrollmentRouteDrivers.length === 0 ? (
                          <li className="text-surface-500">No route drivers match your search.</li>
                        ) : (
                          filteredEnrollmentRouteDrivers.map((d) => (
                            <li key={d.driver_id} className="flex items-center justify-between py-1 border-b border-surface-100">
                              <span>{d.full_name} {d.license_number ? ` · ${d.license_number}` : ''}</span>
                              <button type="button" onClick={async () => { try { await contractorApi.routes.unenrollDriver(enrollmentRouteId, d.driver_id); const r = await contractorApi.routes.get(enrollmentRouteId, enrollmentContractorQuery()); setEnrollmentRouteDetail(r); } catch (e) { setError(e?.message); } }} className="text-red-600 hover:text-red-700 text-xs">Remove</button>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  </div>
                )}
                {enrollmentAddTruckOpen && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setEnrollmentAddTruckOpen(false); setEnrollmentSelectedTruckIds([]); setEnrollmentApprovedTruckSearch(''); }}>
                    <div className="bg-white rounded-xl shadow-lg max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                      <div className="p-4 border-b border-surface-200 flex justify-between items-center">
                        <h3 className="font-medium text-surface-900">Enrol trucks on route</h3>
                        <button type="button" onClick={() => { setEnrollmentAddTruckOpen(false); setEnrollmentSelectedTruckIds([]); setEnrollmentApprovedTruckSearch(''); }} className="text-surface-500 hover:text-surface-700">×</button>
                      </div>
                      <div className="p-4 overflow-auto flex-1">
                        {enrollmentApprovedTrucks.length === 0 ? (
                          <p className="text-sm text-surface-500">No approved trucks available (or all are suspended).</p>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 mb-3">
                              <button
                                type="button"
                                onClick={() => {
                                  const available = enrollmentApprovedTrucks
                                    .filter((t) => !enrollmentRouteDetail?.trucks?.some((e) => String(e.truck_id) === String(t.id)))
                                    .map((t) => t.id);
                                  setEnrollmentSelectedTruckIds(available);
                                }}
                                className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
                              >
                                Select all
                              </button>
                              <span className="text-surface-400">|</span>
                              <button
                                type="button"
                                onClick={() => setEnrollmentSelectedTruckIds([])}
                                className="text-xs font-medium text-surface-500 hover:text-surface-700 hover:underline"
                              >
                                Clear
                              </button>
                              <span className="text-xs text-surface-500 ml-auto">
                                {enrollmentSelectedTruckIds.length} selected
                              </span>
                            </div>
                            <input
                              type="search"
                              value={enrollmentApprovedTruckSearch}
                              onChange={(e) => setEnrollmentApprovedTruckSearch(e.target.value)}
                              placeholder="Search approved trucks…"
                              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-3"
                            />
                            <ul className="space-y-2">
                              {filteredEnrollmentApprovedTrucks.length === 0 ? (
                                <li className="text-sm text-surface-500 py-2">No approved trucks match your search.</li>
                              ) : filteredEnrollmentApprovedTrucks.map((t) => {
                                const enrolled = enrollmentRouteDetail?.trucks?.some((e) => String(e.truck_id) === String(t.id));
                                const selected = enrollmentSelectedTruckIds.includes(t.id);
                                return (
                                  <li key={t.id} className="flex items-center gap-3">
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      disabled={enrolled}
                                      onChange={() => {
                                        if (enrolled) return;
                                        setEnrollmentSelectedTruckIds((prev) =>
                                          prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id]
                                        );
                                      }}
                                      className="rounded border-surface-300 text-brand-600"
                                    />
                                    <span className="text-sm flex-1">
                                      {t.registration} {t.make_model ? ` · ${t.make_model}` : ''} {t.fleet_no ? ` #${t.fleet_no}` : ''}
                                    </span>
                                    {isRecentlyApprovedTruck(t) && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                                        Recently approved
                                      </span>
                                    )}
                                    {enrolled && <span className="text-xs text-surface-500">Enrolled</span>}
                                  </li>
                                );
                              })}
                            </ul>
                            <div className="mt-4 pt-4 border-t border-surface-200">
                              <button
                                type="button"
                                disabled={enrollmentSelectedTruckIds.length === 0 || enrollmentEnrollingTrucks}
                                onClick={async () => {
                                  if (!enrollmentRouteId || enrollmentSelectedTruckIds.length === 0) return;
                                  setEnrollmentEnrollingTrucks(true);
                                  setError('');
                                  try {
                                    await contractorApi.routes.enrollTrucks(enrollmentRouteId, enrollmentSelectedTruckIds);
                                    const r = await contractorApi.routes.get(enrollmentRouteId, enrollmentContractorQuery());
                                    setEnrollmentRouteDetail(r);
                                    setEnrollmentSelectedTruckIds([]);
                                  } catch (e) {
                                    setError(e?.message || 'Failed to enrol trucks');
                                  } finally {
                                    setEnrollmentEnrollingTrucks(false);
                                  }
                                }}
                                className="w-full px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {enrollmentEnrollingTrucks ? 'Enrolling…' : `Enrol selected (${enrollmentSelectedTruckIds.length})`}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {enrollmentAddDriverOpen && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setEnrollmentAddDriverOpen(false); setEnrollmentSelectedDriverIds([]); setEnrollmentApprovedDriverSearch(''); }}>
                    <div className="bg-white rounded-xl shadow-lg max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                      <div className="p-4 border-b border-surface-200 flex justify-between items-center">
                        <h3 className="font-medium text-surface-900">Enrol drivers on route</h3>
                        <button type="button" onClick={() => { setEnrollmentAddDriverOpen(false); setEnrollmentSelectedDriverIds([]); setEnrollmentApprovedDriverSearch(''); }} className="text-surface-500 hover:text-surface-700">×</button>
                      </div>
                      <div className="p-4 overflow-auto flex-1">
                        {enrollmentApprovedDrivers.length === 0 ? (
                          <p className="text-sm text-surface-500">No approved drivers available (or all are suspended).</p>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 mb-3">
                              <button
                                type="button"
                                onClick={() => {
                                  const available = enrollmentApprovedDrivers
                                    .filter((d) => !enrollmentRouteDetail?.drivers?.some((e) => String(e.driver_id) === String(d.id)))
                                    .map((d) => d.id);
                                  setEnrollmentSelectedDriverIds(available);
                                }}
                                className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
                              >
                                Select all
                              </button>
                              <span className="text-surface-400">|</span>
                              <button
                                type="button"
                                onClick={() => setEnrollmentSelectedDriverIds([])}
                                className="text-xs font-medium text-surface-500 hover:text-surface-700 hover:underline"
                              >
                                Clear
                              </button>
                              <span className="text-xs text-surface-500 ml-auto">
                                {enrollmentSelectedDriverIds.length} selected
                              </span>
                            </div>
                            <input
                              type="search"
                              value={enrollmentApprovedDriverSearch}
                              onChange={(e) => setEnrollmentApprovedDriverSearch(e.target.value)}
                              placeholder="Search approved drivers…"
                              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mb-3"
                            />
                            <ul className="space-y-2">
                              {filteredEnrollmentApprovedDrivers.length === 0 ? (
                                <li className="text-sm text-surface-500 py-2">No approved drivers match your search.</li>
                              ) : filteredEnrollmentApprovedDrivers.map((d) => {
                                const enrolled = enrollmentRouteDetail?.drivers?.some((e) => String(e.driver_id) === String(d.id));
                                const selected = enrollmentSelectedDriverIds.includes(d.id);
                                return (
                                  <li key={d.id} className="flex items-center gap-3">
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      disabled={enrolled}
                                      onChange={() => {
                                        if (enrolled) return;
                                        setEnrollmentSelectedDriverIds((prev) =>
                                          prev.includes(d.id) ? prev.filter((id) => id !== d.id) : [...prev, d.id]
                                        );
                                      }}
                                      className="rounded border-surface-300 text-brand-600"
                                    />
                                    <span className="text-sm flex-1">{d.full_name} {d.license_number ? ` · ${d.license_number}` : ''}</span>
                                    {enrolled && <span className="text-xs text-surface-500">Enrolled</span>}
                                  </li>
                                );
                              })}
                            </ul>
                            <div className="mt-4 pt-4 border-t border-surface-200">
                              <button
                                type="button"
                                disabled={enrollmentSelectedDriverIds.length === 0 || enrollmentEnrollingDrivers}
                                onClick={async () => {
                                  if (!enrollmentRouteId || enrollmentSelectedDriverIds.length === 0) return;
                                  setEnrollmentEnrollingDrivers(true);
                                  setError('');
                                  try {
                                    await contractorApi.routes.enrollDrivers(enrollmentRouteId, enrollmentSelectedDriverIds);
                                    const r = await contractorApi.routes.get(enrollmentRouteId, enrollmentContractorQuery());
                                    setEnrollmentRouteDetail(r);
                                    setEnrollmentSelectedDriverIds([]);
                                  } catch (e) {
                                    setError(e?.message || 'Failed to enrol drivers');
                                  } finally {
                                    setEnrollmentEnrollingDrivers(false);
                                  }
                                }}
                                className="w-full px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {enrollmentEnrollingDrivers ? 'Enrolling…' : `Enrol selected (${enrollmentSelectedDriverIds.length})`}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'contractor-details' && (
              <div className="max-w-4xl">
                <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-surface-200 bg-surface-50">
                    <h2 className="text-lg font-semibold text-surface-900">Details of the contractor</h2>
                    <p className="text-sm text-surface-500 mt-0.5">Company details, CIPC registration, administrator, control room, mechanic and emergency contacts.</p>
                  </div>
                  <div className="p-6">
                    {contractorInfoSuccess && (
                      <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center justify-between gap-2">
                        <span>{contractorInfoSuccess}</span>
                        <button type="button" onClick={() => setContractorInfoSuccess('')} className="text-green-600 hover:text-green-800 font-medium">Dismiss</button>
                      </div>
                    )}
                    {contractorInfoLoading ? (
                      <p className="text-surface-500">Loading…</p>
                    ) : (
                      <form onSubmit={saveContractorInfo} className="space-y-8">
                        <section>
                          <h3 className="text-sm font-medium text-surface-700 mb-3">Company</h3>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                              <label className="block text-sm text-surface-600 mb-1">Company name</label>
                              <input value={contractorInfoForm.company_name ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, company_name: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Company name" />
                            </div>
                            <div>
                              <label className="block text-sm text-surface-600 mb-1">CIPC registration number</label>
                              <input value={contractorInfoForm.cipc_registration_number ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, cipc_registration_number: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="CIPC number" />
                            </div>
                            <div>
                              <label className="block text-sm text-surface-600 mb-1">CIPC registration date</label>
                              <input type="date" value={contractorInfoForm.cipc_registration_date ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, cipc_registration_date: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                            </div>
                          </div>
                        </section>
                        <section>
                          <h3 className="text-sm font-medium text-surface-700 mb-3">Administrator details</h3>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="block text-sm text-surface-600 mb-1">Name</label>
                              <input value={contractorInfoForm.admin_name ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, admin_name: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Administrator name" />
                            </div>
                            <div>
                              <label className="block text-sm text-surface-600 mb-1">Email</label>
                              <input type="email" value={contractorInfoForm.admin_email ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, admin_email: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="admin@company.co.za" />
                            </div>
                            <div>
                              <label className="block text-sm text-surface-600 mb-1">Phone</label>
                              <input value={contractorInfoForm.admin_phone ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, admin_phone: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Phone" />
                            </div>
                          </div>
                        </section>
                        <section>
                          <h3 className="text-sm font-medium text-surface-700 mb-3">Control room contact details</h3>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="block text-sm text-surface-600 mb-1">Contact name</label>
                              <input value={contractorInfoForm.control_room_contact ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, control_room_contact: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Control room contact" />
                            </div>
                            <div>
                              <label className="block text-sm text-surface-600 mb-1">Phone</label>
                              <input value={contractorInfoForm.control_room_phone ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, control_room_phone: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Phone" />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-sm text-surface-600 mb-1">Email</label>
                              <input type="email" value={contractorInfoForm.control_room_email ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, control_room_email: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="control@company.co.za" />
                            </div>
                          </div>
                        </section>
                        <section>
                          <h3 className="text-sm font-medium text-surface-700 mb-3">Mechanic details</h3>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="block text-sm text-surface-600 mb-1">Name</label>
                              <input value={contractorInfoForm.mechanic_name ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, mechanic_name: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Mechanic name" />
                            </div>
                            <div>
                              <label className="block text-sm text-surface-600 mb-1">Phone</label>
                              <input value={contractorInfoForm.mechanic_phone ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, mechanic_phone: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Phone" />
                            </div>
                            <div>
                              <label className="block text-sm text-surface-600 mb-1">Email</label>
                              <input type="email" value={contractorInfoForm.mechanic_email ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, mechanic_email: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="mechanic@company.co.za" />
                            </div>
                          </div>
                        </section>
                        <section>
                          <h3 className="text-sm font-medium text-surface-700 mb-3">Emergency contact persons</h3>
                          <div className="grid gap-4 sm:grid-cols-2">
                            {[1, 2, 3].map((i) => (
                              <div key={i} className="sm:col-span-2 flex gap-4 flex-wrap">
                                <div className="flex-1 min-w-[140px]">
                                  <label className="block text-sm text-surface-600 mb-1">Contact {i} name</label>
                                  <input value={contractorInfoForm[`emergency_contact_${i}_name`] ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, [`emergency_contact_${i}_name`]: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Name" />
                                </div>
                                <div className="flex-1 min-w-[140px]">
                                  <label className="block text-sm text-surface-600 mb-1">Contact {i} phone</label>
                                  <input value={contractorInfoForm[`emergency_contact_${i}_phone`] ?? ''} onChange={(e) => setContractorInfoForm((f) => ({ ...f, [`emergency_contact_${i}_phone`]: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Phone" />
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                        <div className="pt-4 border-t border-surface-200">
                          <button type="submit" disabled={contractorInfoSaving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Save details</button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'subcontract-details' && (
              <div className="space-y-6">
                <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-surface-200 bg-surface-50 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-surface-900">Subcontract details</h2>
                      <p className="text-sm text-surface-500 mt-0.5">Subcontractor companies, contact persons, control room, mechanic and emergency contacts.</p>
                    </div>
                    <button type="button" onClick={() => openSubcontractorForm(null)} className="px-3 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700">Add subcontractor</button>
                  </div>
                  <div className="p-6">
                    {subcontractorsLoading ? (
                      <p className="text-surface-500">Loading…</p>
                    ) : subcontractorsList.length === 0 && !subcontractorEdit ? (
                      <p className="text-surface-500">No subcontractors. Click “Add subcontractor” to add one.</p>
                    ) : (
                      <div className="space-y-6">
                        {subcontractorEdit !== null && (
                          <form onSubmit={saveSubcontractor} className="p-4 rounded-lg border border-surface-200 bg-surface-50 space-y-4">
                            <h3 className="font-medium text-surface-900">{subcontractorEdit.id ? 'Edit subcontractor' : 'New subcontractor'}</h3>
                            <p className="text-xs text-surface-500 -mt-2">
                              {subcontractorCompanyOptions.length > 0
                                ? 'Companies from your fleet (sub-contractor on trucks) and existing subcontractors. Select one or add new.'
                                : 'Add trucks with a sub-contractor name in Fleet to see them here, or use “Add new company name” below.'}
                            </p>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="sm:col-span-2">
                                <label className="block text-sm font-medium text-surface-700 mb-1">Company</label>
                                <select
                                  value={subcontractorCompanySelect}
                                  onChange={(e) => onSubcontractorCompanySelect(e.target.value)}
                                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                                >
                                  <option value="">— Select from fleet or existing —</option>
                                  <option value="__NEW__">+ Add new company name</option>
                                  {subcontractorCompanyOptions.length > 0 && (
                                    <optgroup label="From fleet &amp; existing">
                                      {subcontractorCompanyOptions.map((name) => (
                                        <option key={name} value={name}>{name}</option>
                                      ))}
                                    </optgroup>
                                  )}
                                </select>
                                {subcontractorCompanySelect === '__NEW__' && (
                                  <input
                                    value={subcontractorForm.company_name ?? ''}
                                    onChange={(e) => setSubcontractorForm((f) => ({ ...f, company_name: e.target.value }))}
                                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm mt-2 border-l-4 border-l-brand-500 focus:ring-2 focus:ring-brand-500"
                                    placeholder="Type new company name"
                                    required
                                  />
                                )}
                                {subcontractorCompanySelect && subcontractorCompanySelect !== '__NEW__' && (
                                  <p className="text-xs text-surface-500 mt-1.5">Selected: {subcontractorCompanySelect}</p>
                                )}
                              </div>
                              <div><label className="block text-sm text-surface-600 mb-1">Contact person</label><input value={subcontractorForm.contact_person ?? ''} onChange={(e) => setSubcontractorForm((f) => ({ ...f, contact_person: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Name" /></div>
                              <div><label className="block text-sm text-surface-600 mb-1">Contact phone</label><input value={subcontractorForm.contact_phone ?? ''} onChange={(e) => setSubcontractorForm((f) => ({ ...f, contact_phone: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Phone" /></div>
                              <div className="sm:col-span-2"><label className="block text-sm text-surface-600 mb-1">Contact email</label><input type="email" value={subcontractorForm.contact_email ?? ''} onChange={(e) => setSubcontractorForm((f) => ({ ...f, contact_email: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Email" /></div>
                              <div><label className="block text-sm text-surface-600 mb-1">Control room contact</label><input value={subcontractorForm.control_room_contact ?? ''} onChange={(e) => setSubcontractorForm((f) => ({ ...f, control_room_contact: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Name" /></div>
                              <div><label className="block text-sm text-surface-600 mb-1">Control room phone</label><input value={subcontractorForm.control_room_phone ?? ''} onChange={(e) => setSubcontractorForm((f) => ({ ...f, control_room_phone: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Phone" /></div>
                              <div><label className="block text-sm text-surface-600 mb-1">Mechanic name</label><input value={subcontractorForm.mechanic_name ?? ''} onChange={(e) => setSubcontractorForm((f) => ({ ...f, mechanic_name: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Name" /></div>
                              <div><label className="block text-sm text-surface-600 mb-1">Mechanic phone</label><input value={subcontractorForm.mechanic_phone ?? ''} onChange={(e) => setSubcontractorForm((f) => ({ ...f, mechanic_phone: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Phone" /></div>
                              <div><label className="block text-sm text-surface-600 mb-1">Emergency contact name</label><input value={subcontractorForm.emergency_contact_name ?? ''} onChange={(e) => setSubcontractorForm((f) => ({ ...f, emergency_contact_name: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Name" /></div>
                              <div><label className="block text-sm text-surface-600 mb-1">Emergency contact phone</label><input value={subcontractorForm.emergency_contact_phone ?? ''} onChange={(e) => setSubcontractorForm((f) => ({ ...f, emergency_contact_phone: e.target.value }))} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Phone" /></div>
                            </div>
                            <div className="flex gap-2">
                              <button type="submit" disabled={subcontractorSaving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Save</button>
                              <button type="button" onClick={() => { setSubcontractorEdit(null); setSubcontractorForm({}); setSubcontractorCompanySelect(''); }} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-100">Cancel</button>
                            </div>
                          </form>
                        )}
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead><tr className="border-b border-surface-200 text-left text-surface-600"><th className="pb-2 pr-4">Company</th><th className="pb-2 pr-4">Contact</th><th className="pb-2 pr-4">Control room</th><th className="pb-2 pr-4">Mechanic</th><th className="pb-2 pr-4">Emergency</th><th className="pb-2 w-20"></th></tr></thead>
                            <tbody>
                              {subcontractorsList.map((s) => (
                                <tr key={s.id} className="border-b border-surface-100">
                                  <td className="py-2 pr-4 font-medium">{s.company_name || '—'}</td>
                                  <td className="py-2 pr-4">{s.contact_person || '—'} {s.contact_phone ? `· ${s.contact_phone}` : ''}</td>
                                  <td className="py-2 pr-4">{s.control_room_contact || '—'} {s.control_room_phone ? `· ${s.control_room_phone}` : ''}</td>
                                  <td className="py-2 pr-4">{s.mechanic_name || '—'} {s.mechanic_phone ? `· ${s.mechanic_phone}` : ''}</td>
                                  <td className="py-2 pr-4">{s.emergency_contact_name || '—'} {s.emergency_contact_phone ? `· ${s.emergency_contact_phone}` : ''}</td>
                                  <td className="py-2">
                                    <button type="button" onClick={() => openSubcontractorForm(s)} className="text-brand-600 hover:underline mr-2">Edit</button>
                                    <button type="button" onClick={() => deleteSubcontractor(s.id)} className="text-red-600 hover:underline">Delete</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'library' && (
              <div className="space-y-6">
                <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-surface-200 bg-surface-50">
                    <h2 className="text-lg font-semibold text-surface-900">Library</h2>
                    <p className="text-sm text-surface-500 mt-0.5">
                      Upload documents; they stay in your library. Optionally link each file to a truck or driver so reviewers see them in Command Centre → Fleet &amp; driver applications.
                    </p>
                  </div>
                  <div className="p-6">
                    {libraryLoading ? (
                      <p className="text-surface-500">Loading…</p>
                    ) : (
                      <>
                        <div className="mb-6 p-4 rounded-lg border border-surface-200 bg-surface-50 space-y-3">
                          <h3 className="text-sm font-medium text-surface-700">Upload document</h3>
                          <div className="flex flex-wrap items-end gap-3">
                            <div>
                              <label className="block text-sm text-surface-600 mb-1">Document type</label>
                              <select value={libraryUploadType} onChange={(e) => setLibraryUploadType(e.target.value || 'other')} className="rounded-lg border border-surface-300 px-3 py-2 text-sm mr-2">
                                {libraryDocumentTypes.map((t) => (
                                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex flex-col gap-1 min-w-[200px]">
                              <span className="text-sm text-surface-600">Link to fleet (optional)</span>
                              <div className="flex flex-wrap gap-2 items-center">
                                <select
                                  value={libraryLinkKind}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setLibraryLinkKind(v);
                                    setLibraryLinkTruckId('');
                                    setLibraryLinkDriverId('');
                                  }}
                                  className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm"
                                >
                                  <option value="none">Not linked</option>
                                  <option value="truck">Truck</option>
                                  <option value="driver">Driver</option>
                                </select>
                                {libraryLinkKind === 'truck' && (
                                  <select value={libraryLinkTruckId} onChange={(e) => setLibraryLinkTruckId(e.target.value)} className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm max-w-[240px]">
                                    <option value="">Select truck…</option>
                                    {trucksList.map((t) => (
                                      <option key={t.id} value={t.id}>{t.registration || t.fleet_no || t.id}{t.make_model ? ` · ${t.make_model}` : ''}</option>
                                    ))}
                                  </select>
                                )}
                                {libraryLinkKind === 'driver' && (
                                  <select value={libraryLinkDriverId} onChange={(e) => setLibraryLinkDriverId(e.target.value)} className="rounded-lg border border-surface-300 px-2 py-1.5 text-sm max-w-[280px]">
                                    <option value="">Select driver…</option>
                                    {driversList.map((dr) => (
                                      <option key={dr.id} value={dr.id}>{[dr.full_name, dr.surname].filter(Boolean).join(' ') || dr.id}</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </div>
                            <div className="flex items-end gap-2">
                              <input type="file" ref={libraryFileRef} id="library-file" className="text-sm" onChange={uploadLibraryDocument} />
                              <span className="text-surface-500 text-sm">Max 25 MB</span>
                            </div>
                          </div>
                          {libraryUploading && <p className="text-sm text-surface-500">Uploading…</p>}
                        </div>
                        <div>
                          <h3 className="text-sm font-medium text-surface-700 mb-2">Documents</h3>
                          {libraryDocuments.length === 0 ? (
                            <p className="text-surface-500">No documents yet. Upload a file above.</p>
                          ) : (
                            <ul className="divide-y divide-surface-200">
                              {libraryDocuments.map((d) => (
                                <li key={d.id} className="py-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <span className="font-medium text-surface-900">{d.file_name || 'Document'}</span>
                                    <span className="text-surface-500 text-sm ml-2">({(d.document_type || 'other').replace(/_/g, ' ')})</span>
                                    {d.created_at && <span className="text-surface-400 text-xs block">{formatDateTime(d.created_at)}</span>}
                                    <p className="text-xs text-surface-600 mt-1">{formatLibraryLinkLabel(d)}</p>
                                    {libraryEditId === d.id && (
                                      <div className="mt-2 flex flex-wrap items-center gap-2 p-2 rounded-lg border border-surface-200 bg-white">
                                        <select
                                          value={libraryEditKind}
                                          onChange={(e) => {
                                            setLibraryEditKind(e.target.value);
                                            setLibraryEditTruckId('');
                                            setLibraryEditDriverId('');
                                          }}
                                          className="rounded border border-surface-300 px-2 py-1 text-sm"
                                        >
                                          <option value="none">Not linked</option>
                                          <option value="truck">Truck</option>
                                          <option value="driver">Driver</option>
                                        </select>
                                        {libraryEditKind === 'truck' && (
                                          <select value={libraryEditTruckId} onChange={(e) => setLibraryEditTruckId(e.target.value)} className="rounded border border-surface-300 px-2 py-1 text-sm max-w-[220px]">
                                            <option value="">Select truck…</option>
                                            {trucksList.map((t) => (
                                              <option key={t.id} value={t.id}>{t.registration || t.fleet_no || t.id}</option>
                                            ))}
                                          </select>
                                        )}
                                        {libraryEditKind === 'driver' && (
                                          <select value={libraryEditDriverId} onChange={(e) => setLibraryEditDriverId(e.target.value)} className="rounded border border-surface-300 px-2 py-1 text-sm max-w-[220px]">
                                            <option value="">Select driver…</option>
                                            {driversList.map((dr) => (
                                              <option key={dr.id} value={dr.id}>{[dr.full_name, dr.surname].filter(Boolean).join(' ') || dr.id}</option>
                                            ))}
                                          </select>
                                        )}
                                        <button
                                          type="button"
                                          disabled={libraryLinkSavingId === d.id}
                                          onClick={() => saveLibraryLink(d.id)}
                                          className="px-2 py-1 text-xs rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                                        >
                                          {libraryLinkSavingId === d.id ? 'Saving…' : 'Save link'}
                                        </button>
                                        <button type="button" onClick={() => setLibraryEditId(null)} className="px-2 py-1 text-xs rounded-lg border border-surface-300 text-surface-700">Cancel</button>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-2 shrink-0">
                                    {libraryEditId !== d.id && (
                                      <button type="button" onClick={() => openLibraryLinkEdit(d)} className="text-sm text-surface-700 hover:underline">Edit link</button>
                                    )}
                                    <a href={contractorApi.library.downloadUrl(d.id)} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-600 hover:underline">Download</a>
                                    <button type="button" onClick={() => deleteLibraryDocument(d.id)} className="text-sm text-red-600 hover:underline">Delete</button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'messages' && (
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="bg-white rounded-xl border border-surface-200 p-4">
                  <h2 className="font-medium text-surface-900 mb-3">New message (commodity operations)</h2>
                  <form onSubmit={addMessage} className="space-y-3">
                    <input name="subject" placeholder="Subject" required className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <textarea name="body" placeholder="Message (e.g. route change, load schedule)" rows={4} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <input name="attachments" type="file" multiple className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
                    <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Send</button>
                  </form>
                </div>
                <div className="bg-white rounded-xl border border-surface-200 p-4">
                  <h2 className="font-medium text-surface-900 mb-3">Messages</h2>
                  <ul className="space-y-2 text-sm">
                    {messagesList.length === 0 ? <li className="text-surface-500">No messages.</li> : messagesList.map((m) => (
                      <li key={m.id} className="py-2 border-b border-surface-100">
                        <span className="font-medium">{m.subject}</span>
                        <span className="text-surface-500 ml-2">· {m.sender_name}</span>
                        <p className="text-surface-500 text-xs mt-0.5">{formatDate(m.created_at)}</p>
                        {m.body ? <p className="text-surface-700 mt-1 whitespace-pre-wrap">{m.body}</p> : null}
                        {Array.isArray(m.attachments) && m.attachments.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {m.attachments.map((a) => (
                              <a key={a.id} href={contractorApi.messages.attachmentUrl(m.id, a.id)} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:underline">
                                {a.file_name || 'Attachment'}
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
