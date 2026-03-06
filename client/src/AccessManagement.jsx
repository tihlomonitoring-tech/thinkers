import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { contractor as contractorApi, users as usersApi } from './api';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', section: 'Overview' },
  { id: 'routes', label: 'Route management', icon: 'route', section: 'Routes' },
  { id: 'rectors', label: 'Route rectors', icon: 'users', section: 'Routes' },
  { id: 'reinstatement', label: 'Reinstatement requests', icon: 'reinstatement', section: 'Routes' },
  { id: 'distribution', label: 'List distribution', icon: 'share', section: 'Distribution' },
  { id: 'distribution-history', label: 'Distribution history', icon: 'history', section: 'Distribution' },
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

export default function AccessManagement() {
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
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
  const [rectorForm, setRectorForm] = useState({ route_id: '', user_id: '', name: '', company: '', email: '', phone: '', mobile_alt: '', address: '', role_or_type: '', notes: '', alert_types: [] });
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

  // Reinstatement requests tab
  const [reinstatementRequests, setReinstatementRequests] = useState([]);
  const [reinstatementLoading, setReinstatementLoading] = useState(false);
  const [reinstatementSelected, setReinstatementSelected] = useState(null);
  const [reinstatingId, setReinstatingId] = useState(null);
  const [reinstatementError, setReinstatementError] = useState('');
  const [reinstatementSuccess, setReinstatementSuccess] = useState('');
  const [reinstatementHistory, setReinstatementHistory] = useState([]);
  const [reinstatementHistoryLoading, setReinstatementHistoryLoading] = useState(false);

  const hasTenant = user?.tenant_id;

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

  // Load contractors for "send per contractor" when List distribution tab is active
  useEffect(() => {
    if (activeTab !== 'distribution') return;
    contractorApi.distributionHistory.contractors()
      .then((r) => setDistContractors(r.contractors || []))
      .catch(() => setDistContractors([]));
  }, [activeTab]);

  // Load fleet & drivers per route when List distribution tab is active
  useEffect(() => {
    if (activeTab !== 'distribution' || !routes.length) {
      setDistRouteDetails({});
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
        await contractorApi.routes.update(editingRouteId, payload);
        setShowRouteForm(false);
        setEditingRouteId(null);
      } else {
        await contractorApi.routes.create(payload);
        setShowRouteForm(false);
        setRouteForm({ name: '', starting_point: '', destination: '', capacity: '', max_tons: '', route_expiration: '' });
      }
      load();
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
      route_id: f.route_id || '',
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
    if (!rectorForm.route_id) {
      setError('Please select a route. Rectors must be linked to at least one route.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        route_id: rectorForm.route_id || null,
        user_id: assignUser || null,
        name: rectorForm.name.trim() || null,
        company: rectorForm.company.trim() || null,
        email: rectorForm.email.trim() || null,
        phone: rectorForm.phone.trim() || null,
        mobile_alt: rectorForm.mobile_alt.trim() || null,
        address: rectorForm.address.trim() || null,
        role_or_type: rectorForm.role_or_type.trim() || null,
        notes: rectorForm.notes.trim() || null,
        alert_types: rectorForm.alert_types.length ? rectorForm.alert_types : null,
      };
      if (editingRectorId) {
        await contractorApi.routeFactors.update(editingRectorId, payload);
        setShowRectorForm(false);
        setEditingRectorId(null);
      } else {
        await contractorApi.routeFactors.create(payload);
        setShowRectorForm(false);
        setRectorForm({ route_id: '', user_id: '', name: '', company: '', email: '', phone: '', mobile_alt: '', address: '', role_or_type: '', notes: '', alert_types: [] });
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
    setRectorForm((prev) => ({ ...prev, route_id: routeId, user_id: '' }));
    setEditingRectorId(null);
    setShowRectorForm(true);
  };

  const distToggleRoute = (routeId) => {
    setDistSelectedRouteIds((prev) =>
      prev.includes(routeId) ? prev.filter((id) => id !== routeId) : [...prev, routeId]
    );
  };
  const distSelectAllRoutes = () => setDistSelectedRouteIds(routes.map((r) => r.id));
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
    const q = ids.length > 0 ? (ids.length === 1 ? `?routeId=${encodeURIComponent(ids[0])}` : `?routeIds=${ids.map(encodeURIComponent).join(',')}`) : '';
    const path = isFleet ? `/contractor/enrollment/fleet-list${q}` : `/contractor/enrollment/driver-list${q}`;
    const API_BASE = (typeof import.meta.env?.VITE_API_BASE === 'string' && import.meta.env.VITE_API_BASE) || (import.meta.env.DEV ? 'http://localhost:3001/api' : '/api');
    const ext = format === 'excel' ? 'xls' : 'csv';
    const filename = (isFleet ? 'fleet-list' : 'driver-list') + '.' + ext;
    fetch(`${API_BASE}${path}`, { credentials: 'include' })
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
    contractorApi.distributionHistory
      .sendEmail({
        recipients: distRecipients.map((r) => r.email),
        cc: distCcRecipients.length > 0 ? distCcRecipients.map((r) => r.email) : undefined,
        list_type: listType,
        route_ids: distSendPerContractor ? null : (distSelectedRouteIds.length > 0 ? distSelectedRouteIds : null),
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
      <nav className="w-72 shrink-0 border-r border-surface-200 bg-white flex flex-col" aria-label="Access management">
        <div className="p-4 border-b border-surface-100">
          <h2 className="text-sm font-semibold text-surface-900">Access management</h2>
          <p className="text-xs text-surface-500 mt-0.5">Routes, rectors & distribution</p>
          <p className="text-xs text-surface-500 mt-1.5">Showing data for <strong className="text-surface-700">{user?.tenant_name || 'your company'}</strong></p>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
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

      <div className="flex-1 min-w-0 overflow-auto p-4 sm:p-6">
        <div className="w-full max-w-7xl mx-auto">
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
              onClick={() => { setEditingRectorId(null); setRectorForm({ route_id: '', user_id: '', name: '', company: '', email: '', phone: '', mobile_alt: '', address: '', role_or_type: '', notes: '', alert_types: [] }); setShowRectorForm(true); }}
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
                <h3 className="font-semibold text-surface-900 mb-4">{editingRectorId ? 'Edit route rector' : 'Assign user to route'}</h3>
                <p className="text-xs text-surface-500 mb-4">User must exist in User management first. They will only see data for their assigned route(s) on the Rector page.</p>
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
                    <label className="block text-xs font-medium text-surface-600 mb-1">Route (required)</label>
                    <select
                      value={rectorForm.route_id}
                      onChange={(e) => setRectorForm((f) => ({ ...f, route_id: e.target.value }))}
                      className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                      required
                    >
                      <option value="">— Select route —</option>
                      {routes.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
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
              const selected = distSelectedRouteIds.includes(r.id);
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
        </div>
      </div>
    </div>
  );
}
