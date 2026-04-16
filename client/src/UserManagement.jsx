import { useState, useEffect, useCallback, useMemo } from 'react';
import { todayYmd } from './lib/appTime.js';
import { useAuth } from './AuthContext';
import { users as usersApi, tenants as tenantsApi } from './api';

const ROLES = ['super_admin', 'tenant_admin', 'user'];
const STATUSES = ['active', 'inactive', 'invited'];

/** Main app pages as roles (multi-select). Must match backend PAGE_IDS. Order matches sidebar. */
const PAGE_ROLES = [
  { id: 'profile', label: 'Profile' },
  { id: 'management', label: 'Management' },
  { id: 'users', label: 'Users' },
  { id: 'tenants', label: 'Tenants' },
  { id: 'contractor', label: 'Contractor' },
  { id: 'command_centre', label: 'Command Centre' },
  { id: 'access_management', label: 'Access management' },
  { id: 'rector', label: 'Rector' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'transport_operations', label: 'Transport operations' },
  { id: 'recruitment', label: 'Recruitment' },
  { id: 'letters', label: 'Letters' },
  { id: 'accounting_management', label: 'Accounting management' },
  { id: 'tracking_integration', label: 'Tracking & integration' },
  { id: 'fuel_supply_management', label: 'Fuel supply management' },
  { id: 'fuel_customer_orders', label: 'Customer diesel orders (portal)' },
  { id: 'team_leader_admin', label: 'Team leader admin' },
  { id: 'performance_evaluations', label: 'Performance evaluations' },
  { id: 'auditor', label: 'Auditor' },
];

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { dateStyle: 'short' }) + ' ' + dt.toLocaleTimeString(undefined, { timeStyle: 'short' });
}

function RoleBadge({ role }) {
  const styles = {
    super_admin: 'bg-amber-100 text-amber-800',
    tenant_admin: 'bg-brand-100 text-brand-800',
    user: 'bg-surface-100 text-surface-700',
  };
  const label = role?.replace('_', ' ') || '';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[role] || styles.user}`}>{label}</span>;
}

function StatusBadge({ status }) {
  const styles = {
    active: 'bg-emerald-100 text-emerald-800',
    inactive: 'bg-surface-200 text-surface-600',
    invited: 'bg-sky-100 text-sky-800',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.inactive}`}>{status}</span>;
}

export default function UserManagement() {
  const { user: me } = useAuth();
  const canManageUsers = me?.role === 'super_admin' || me?.role === 'tenant_admin';
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [tenants, setTenants] = useState([]);
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState('desc');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [detailUser, setDetailUser] = useState(null);
  const [detailTab, setDetailTab] = useState('audit');
  const [activity, setActivity] = useState([]);
  const [loginActivityRows, setLoginActivityRows] = useState([]);
  const [loginActivitySel, setLoginActivitySel] = useState(new Set());
  const [modal, setModal] = useState(null); // 'create' | 'edit' | null
  const [formUser, setFormUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('users'); // 'users' | 'approvals' | 'block-requests'
  const [signUpRequests, setSignUpRequests] = useState([]);
  const [signUpRequestStatus, setSignUpRequestStatus] = useState('pending');
  const [approvalRequest, setApprovalRequest] = useState(null);
  const [approvalForm, setApprovalForm] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [formContractors, setFormContractors] = useState([]);
  const [formContractorsLoading, setFormContractorsLoading] = useState(false);
  const [newContractorName, setNewContractorName] = useState('');
  const [addingContractor, setAddingContractor] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [blockRequestsLoading, setBlockRequestsLoading] = useState(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        sort,
        order,
      };
      if (searchDebounced) params.search = searchDebounced;
      if (roleFilter) params.role = roleFilter;
      if (statusFilter) params.status = statusFilter;
      if (tenantFilter && me?.role === 'super_admin') params.tenant_id = tenantFilter;
      const data = await usersApi.list(params);
      setUsers(data.users);
      setPagination((p) => ({ ...p, total: data.pagination.total }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, sort, order, searchDebounced, roleFilter, statusFilter, tenantFilter, me?.role]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (canManageUsers) {
      tenantsApi.list().then((d) => setTenants(d.tenants || [])).catch(() => {});
    }
  }, [canManageUsers]);

  const fetchSignUpRequests = useCallback(async () => {
    setApprovalsLoading(true);
    try {
      const data = await usersApi.signUpRequests.list({ status: signUpRequestStatus });
      setSignUpRequests(data.requests || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setApprovalsLoading(false);
    }
  }, [signUpRequestStatus]);

  useEffect(() => {
    if (tab === 'approvals') fetchSignUpRequests();
  }, [tab, fetchSignUpRequests]);

  const fetchBlockRequests = useCallback(async () => {
    setBlockRequestsLoading(true);
    try {
      const data = await usersApi.blockRequests.list();
      setBlockedUsers(data.blocked || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBlockRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'block-requests') fetchBlockRequests();
  }, [tab, fetchBlockRequests]);

  const unlockBlockedUser = async (userId) => {
    setSaving(true);
    setError('');
    try {
      await usersApi.blockRequests.unlock(userId);
      await fetchBlockRequests();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSort = (col) => {
    if (sort === col) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else setSort(col);
  };

  const toggleSelect = (id) => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === users.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(users.map((u) => u.id)));
  };

  const handleBulk = async () => {
    if (!bulkAction || selectedIds.size === 0) return;
    setSaving(true);
    setError('');
    try {
      const payload = { ids: [...selectedIds] };
      if (bulkAction === 'active') payload.status = 'active';
      else if (bulkAction === 'inactive') payload.status = 'inactive';
      else if (bulkAction.startsWith('role:')) payload.role = bulkAction.replace('role:', '');
      await usersApi.bulk(payload);
      setSelectedIds(new Set());
      setBulkAction('');
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (u) => {
    setDetailUser(u);
    setDetailTab('audit');
    setActivity([]);
    setLoginActivityRows([]);
    setLoginActivitySel(new Set());
    try {
      const [act, la] = await Promise.all([
        usersApi.activity(u.id).catch(() => ({ activity: [] })),
        usersApi.loginActivity(u.id).catch(() => ({ rows: [] })),
      ]);
      setActivity(act.activity || []);
      setLoginActivityRows(la.rows || []);
    } catch {}
  };

  const refreshLoginActivity = async () => {
    if (!detailUser?.id) return;
    try {
      const la = await usersApi.loginActivity(detailUser.id);
      setLoginActivityRows(la.rows || []);
      setLoginActivitySel(new Set());
    } catch {
      setLoginActivityRows([]);
    }
  };

  const bulkDeleteLoginActivity = async () => {
    if (!detailUser || loginActivitySel.size === 0) return;
    if (!window.confirm(`Delete ${loginActivitySel.size} login location record(s)? This cannot be undone.`)) return;
    setSaving(true);
    setError('');
    try {
      await usersApi.loginActivityBulkDelete([...loginActivitySel]);
      await refreshLoginActivity();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleLoginSel = (id) => {
    setLoginActivitySel((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportCsv = () => {
    const headers = ['Email', 'Full name', 'Role', 'Page access', 'Status', 'Tenant', 'Last login', 'Login count', 'Created'];
    const rows = users.map((u) => [
      u.email,
      u.full_name,
      u.role,
      (u.page_roles || []).map((p) => PAGE_ROLES.find((r) => r.id === p)?.label || p).join('; ') || '—',
      u.status,
      u.tenant_name || '—',
      u.last_login_at ? formatDate(u.last_login_at) : '—',
      u.login_count ?? 0,
      formatDate(u.created_at),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `thinkers-users-${todayYmd()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const openCreate = () => {
    setFormUser({ email: '', full_name: '', password: '', role: 'user', id_number: '', cellphone: '', tenant_id: me?.tenant_id || '', tenant_ids: me?.tenant_id ? [me.tenant_id] : [], page_roles: [], contractor_ids: [] });
    setFormContractors([]);
    setModal('create');
    setError('');
  };

  /** Open Add user form pre-filled from an existing user (tenants, page roles, contractors). You only change name, email, password. */
  const openCreateFromUser = (u) => {
    const tenantIds = (Array.isArray(u.tenant_ids) && u.tenant_ids.length > 0)
      ? u.tenant_ids.map((id) => (id != null ? String(id) : '')).filter(Boolean)
      : (u.tenant_id != null ? [String(u.tenant_id)] : []);
    setFormUser({
      email: '',
      full_name: '',
      password: '',
      role: u.role || 'user',
      id_number: '',
      cellphone: '',
      tenant_id: tenantIds[0] || me?.tenant_id || '',
      tenant_ids: tenantIds,
      page_roles: Array.isArray(u.page_roles) ? u.page_roles.slice() : [],
      contractor_ids: (Array.isArray(u.contractor_ids) ? u.contractor_ids : []).map((id) => (id != null ? String(id) : '')).filter(Boolean),
    });
    setFormContractors([]);
    setModal('create');
    setError('');
  };

  const openEdit = (u) => {
    const tenantIds = (Array.isArray(u.tenant_ids) && u.tenant_ids.length > 0)
      ? u.tenant_ids.map((id) => (id != null ? String(id) : '')).filter(Boolean)
      : (u.tenant_id != null ? [String(u.tenant_id)] : []);
    setFormUser({
      ...u,
      password: '',
      cellphone: u.cellphone ?? '',
      page_roles: Array.isArray(u.page_roles) ? u.page_roles.slice() : [],
      tenant_ids: tenantIds,
      contractor_ids: (Array.isArray(u.contractor_ids) ? u.contractor_ids : []).map((id) => (id != null ? String(id) : '')).filter(Boolean),
    });
    setFormContractors([]);
    setModal('edit');
    setError('');
  };

  // Resolve tenant IDs to the same format as tenants list (so API receives correct IDs)
  const resolveTenantIdsForContractors = useCallback(() => {
    const tenantIds = formUser?.tenant_ids;
    if (!Array.isArray(tenantIds) || tenantIds.length === 0) return [];
    return tenantIds
      .map((tid) => {
        const id = tid != null ? String(tid).trim() : '';
        if (!id) return null;
        const fromList = tenants.find((t) => String(t.id) === id || String(t.id).toLowerCase() === id.toLowerCase());
        return fromList ? String(fromList.id) : id;
      })
      .filter(Boolean);
  }, [formUser?.tenant_ids, tenants]);

  // Load contractors for form user's tenants (for Contractor assignment)
  useEffect(() => {
    const ids = resolveTenantIdsForContractors();
    if (!modal || ids.length === 0) {
      setFormContractors([]);
      setFormContractorsLoading(false);
      return;
    }
    setFormContractorsLoading(true);
    usersApi.contractorsForTenants(ids)
      .then((d) => {
        setFormContractors(d.contractors || []);
        if (d._error) setError(d._error);
      })
      .catch((err) => {
        setFormContractors([]);
        setError(err?.message || 'Could not load contractors');
      })
      .finally(() => setFormContractorsLoading(false));
  }, [modal, resolveTenantIdsForContractors]);

  const refreshFormContractors = useCallback(() => {
    const ids = resolveTenantIdsForContractors();
    if (ids.length === 0) return;
    setFormContractorsLoading(true);
    setError('');
    usersApi.contractorsForTenants(ids)
      .then((d) => {
        setFormContractors(d.contractors || []);
        if (d._error) setError(d._error);
      })
      .catch((err) => {
        setFormContractors([]);
        setError(err?.message || 'Could not load contractors');
      })
      .finally(() => setFormContractorsLoading(false));
  }, [resolveTenantIdsForContractors]);

  const addContractorCompany = async (e) => {
    e.preventDefault();
    const name = (newContractorName || '').trim();
    const tenantIds = formUser?.tenant_ids;
    if (!name || !Array.isArray(tenantIds) || tenantIds.length === 0) return;
    const tenantId = tenantIds[0];
    setAddingContractor(true);
    setError('');
    try {
      await usersApi.createContractor({ tenant_id: tenantId, name });
      setNewContractorName('');
      refreshFormContractors();
    } catch (err) {
      setError(err?.message || 'Could not add contractor');
    } finally {
      setAddingContractor(false);
    }
  };

  const saveUser = async () => {
    if (!formUser) return;
    setSaving(true);
    setError('');
    try {
      if (modal === 'create') {
        await usersApi.create({
          email: formUser.email,
          full_name: formUser.full_name,
          password: formUser.password || 'ChangeMe123!',
          role: formUser.role,
          id_number: formUser.id_number?.trim() || undefined,
          cellphone: formUser.cellphone?.trim() || undefined,
          tenant_ids: (formUser.tenant_ids || []).length ? formUser.tenant_ids : (formUser.tenant_id ? [formUser.tenant_id] : []),
          page_roles: formUser.page_roles || [],
          contractor_ids: formUser.contractor_ids || [],
        });
      } else {
        await usersApi.update(formUser.id, {
          full_name: formUser.full_name,
          ...(formUser.email != null && String(formUser.email).trim() ? { email: String(formUser.email).trim() } : {}),
          role: formUser.role,
          status: formUser.status,
          id_number: formUser.id_number?.trim() || undefined,
          cellphone: formUser.cellphone?.trim() ?? undefined,
          tenant_ids: formUser.tenant_ids,
          page_roles: formUser.page_roles || [],
          contractor_ids: formUser.contractor_ids || [],
          ...(formUser.password ? { password: formUser.password } : {}),
        });
      }
      setModal(null);
      setFormUser(null);
      fetchUsers();
      if (detailUser?.id === formUser.id) setDetailUser((u) => (u ? { ...u, ...formUser } : null));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (id) => {
    if (!confirm('Remove this user? This cannot be undone.')) return;
    setSaving(true);
    try {
      await usersApi.delete(id);
      setDetailUser(null);
      setModal(null);
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openApproval = (request) => {
    setApprovalRequest(request);
    setApprovalForm({
      role: 'user',
      tenant_ids: me?.tenant_id ? [me.tenant_id] : (tenants.length ? [tenants[0].id] : []),
      page_roles: [],
    });
    setRejectReason('');
    setError('');
  };

  const approveSignUpRequest = async () => {
    if (!approvalRequest || !approvalForm) return;
    if (!(approvalForm.tenant_ids || []).length) {
      setError('Select at least one tenant.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await usersApi.signUpRequests.approve(approvalRequest.id, {
        role: approvalForm.role,
        tenant_ids: approvalForm.tenant_ids,
        page_roles: approvalForm.page_roles || [],
      });
      setApprovalRequest(null);
      setApprovalForm(null);
      fetchSignUpRequests();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const rejectSignUpRequest = async () => {
    if (!approvalRequest) return;
    setSaving(true);
    setError('');
    try {
      await usersApi.signUpRequests.reject(approvalRequest.id, { reason: rejectReason.trim() || undefined });
      setApprovalRequest(null);
      setApprovalForm(null);
      setRejectReason('');
      fetchSignUpRequests();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit));

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-xl font-semibold text-surface-900">User management</h1>
        <div className="flex flex-wrap items-center gap-2">
          {tab === 'users' && (
            <>
              <button
                type="button"
                onClick={exportCsv}
                className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50"
              >
                Export CSV
              </button>
              {canManageUsers && (
                <button
                  type="button"
                  onClick={openCreate}
                  className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700"
                >
                  Add user
                </button>
              )}
            </>
          )}
          {tab === 'block-requests' && me?.role === 'super_admin' && (
            <button
              type="button"
              onClick={() => fetchBlockRequests()}
              className="px-3 py-1.5 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50"
            >
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-surface-200">
        <button
          type="button"
          onClick={() => setTab('users')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg ${tab === 'users' ? 'bg-white border border-surface-200 border-b-0 -mb-px text-brand-600' : 'text-surface-600 hover:text-surface-900'}`}
        >
          Users
        </button>
        {canManageUsers && (
          <button
            type="button"
            onClick={() => setTab('approvals')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg ${tab === 'approvals' ? 'bg-white border border-surface-200 border-b-0 -mb-px text-brand-600' : 'text-surface-600 hover:text-surface-900'}`}
          >
            Sign-up approvals
          </button>
        )}
        {me?.role === 'super_admin' && (
          <button
            type="button"
            onClick={() => setTab('block-requests')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg ${tab === 'block-requests' ? 'bg-white border border-surface-200 border-b-0 -mb-px text-brand-600' : 'text-surface-600 hover:text-surface-900'}`}
          >
            Block requests
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between items-center">
          {error}
          <button type="button" onClick={() => setError('')} className="text-red-500 hover:text-red-700">Dismiss</button>
        </div>
      )}

      {tab === 'users' && (
      <>
      {/* Filters & search */}
      <div className="bg-white rounded-xl border border-surface-200 p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-[200px]">
            <input
              type="search"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-700"
          >
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{r.replace('_', ' ')}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-700"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {me?.role === 'super_admin' && tenants.length > 0 && (
            <select
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
              className="rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-700"
            >
              <option value="">All tenants</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Bulk bar */}
      {selectedIds.size > 0 && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-brand-900">{selectedIds.size} selected</span>
          <select
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
            className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm"
          >
            <option value="">Bulk action…</option>
            <option value="active">Set Active</option>
            <option value="inactive">Set Inactive</option>
            <option value="role:user">Set role: User</option>
            <option value="role:tenant_admin">Set role: Tenant admin</option>
          </select>
          <button
            type="button"
            onClick={handleBulk}
            disabled={!bulkAction || saving}
            className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Apply
          </button>
          <button type="button" onClick={() => { setSelectedIds(new Set()); setBulkAction(''); }} className="text-sm text-brand-700 hover:underline">
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="w-10 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={users.length > 0 && selectedIds.size === users.length}
                    onChange={toggleSelectAll}
                    className="rounded border-surface-300 text-brand-600 focus:ring-brand-500"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-surface-700 cursor-pointer hover:text-surface-900" onClick={() => handleSort('full_name')}>
                  Name {sort === 'full_name' && (order === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-4 py-3 text-left font-medium text-surface-700 cursor-pointer hover:text-surface-900" onClick={() => handleSort('email')}>
                  Email {sort === 'email' && (order === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-4 py-3 text-left font-medium text-surface-700">Role</th>
                <th className="px-4 py-3 text-left font-medium text-surface-700">Page access</th>
                <th className="px-4 py-3 text-left font-medium text-surface-700">Status</th>
                {me?.role === 'super_admin' && <th className="px-4 py-3 text-left font-medium text-surface-700">Tenant</th>}
                <th className="px-4 py-3 text-left font-medium text-surface-700 cursor-pointer hover:text-surface-900" onClick={() => handleSort('last_login_at')}>
                  Last login {sort === 'last_login_at' && (order === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-4 py-3 text-right font-medium text-surface-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {loading ? (
                <tr><td colSpan={me?.role === 'super_admin' ? 10 : 9} className="px-4 py-8 text-center text-surface-500">Loading…</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={me?.role === 'super_admin' ? 10 : 9} className="px-4 py-8 text-center text-surface-500">No users found.</td></tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-surface-50/50">
                    <td className="w-10 px-4 py-2">
                      {u.id !== me?.id && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(u.id)}
                          onChange={() => toggleSelect(u.id)}
                          className="rounded border-surface-300 text-brand-600 focus:ring-brand-500"
                        />
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <button type="button" onClick={() => openDetail(u)} className="font-medium text-brand-600 hover:underline text-left">
                        {u.full_name}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-surface-600 font-mono text-xs">{u.email}</td>
                    <td className="px-4 py-2"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-2 text-surface-600 text-xs break-words min-w-0">
                      {(u.page_roles || []).length ? (u.page_roles || []).map((p) => PAGE_ROLES.find((r) => r.id === p)?.label || p).join(', ') : '—'}
                    </td>
                    <td className="px-4 py-2"><StatusBadge status={u.status} /></td>
                    {me?.role === 'super_admin' && <td className="px-4 py-2 text-surface-600">{u.tenant_name || '—'}</td>}
                    <td className="px-4 py-2 text-surface-600">{formatDate(u.last_login_at)}</td>
                    <td className="px-4 py-2 text-right">
                      {canManageUsers && (
                        <button type="button" onClick={() => openCreateFromUser(u)} className="text-brand-600 hover:underline mr-2" title="Add a new user with same tenants, page access and contractors">Add like this</button>
                      )}
                      {canManageUsers && u.id !== me?.id && (
                        <button type="button" onClick={() => openEdit(u)} className="text-brand-600 hover:underline mr-2">Edit</button>
                      )}
                      <button type="button" onClick={() => openDetail(u)} className="text-surface-500 hover:underline">View</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-surface-100 flex items-center justify-between">
            <span className="text-sm text-surface-500">
              {pagination.total} total · page {pagination.page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
                className="px-2 py-1 text-sm rounded border border-surface-300 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={pagination.page >= totalPages}
                onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
                className="px-2 py-1 text-sm rounded border border-surface-300 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
      </>
      )}

      {tab === 'block-requests' && me?.role === 'super_admin' && (
        <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
          <div className="p-4 border-b border-surface-100">
            <p className="text-sm text-surface-600">
              Accounts appear here after <strong>three failed sign-in attempts</strong> in a row. Unlocking clears the lock and resets the failure counter so the user can sign in again.
            </p>
            <p className="text-sm text-surface-600 mt-2">
              If the locked user is the only super admin, they can still recover by using <strong>Forgot password</strong> on the sign-in page (after setting a new password, the lock is cleared). Anyone with database access can also run <code className="text-xs bg-surface-100 px-1 rounded">npm run db:unlock-user-login -- email@example.com</code> from the app repo with server <code className="text-xs bg-surface-100 px-1 rounded">.env</code>.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-50 border-b border-surface-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-surface-700">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-surface-700">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-surface-700">Role</th>
                  <th className="px-4 py-3 text-left font-medium text-surface-700">Tenant</th>
                  <th className="px-4 py-3 text-left font-medium text-surface-700">Failed attempts</th>
                  <th className="px-4 py-3 text-left font-medium text-surface-700">Locked at</th>
                  <th className="px-4 py-3 text-right font-medium text-surface-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {blockRequestsLoading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-surface-500">Loading…</td></tr>
                ) : blockedUsers.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-surface-500">No blocked accounts.</td></tr>
                ) : (
                  blockedUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-surface-50/50">
                      <td className="px-4 py-2 font-medium text-surface-900">{u.full_name}</td>
                      <td className="px-4 py-2 text-surface-600 font-mono text-xs">{u.email}</td>
                      <td className="px-4 py-2"><RoleBadge role={u.role} /></td>
                      <td className="px-4 py-2 text-surface-600">{u.tenant_name || '—'}</td>
                      <td className="px-4 py-2 text-surface-600">{u.login_failed_attempts ?? '—'}</td>
                      <td className="px-4 py-2 text-surface-600">{formatDate(u.login_locked_at)}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => unlockBlockedUser(u.id)}
                          className="text-brand-600 hover:underline disabled:opacity-50"
                        >
                          Unlock
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'approvals' && canManageUsers && (
        <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
          <div className="p-4 border-b border-surface-100 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-surface-700">Status</span>
            <select
              value={signUpRequestStatus}
              onChange={(e) => setSignUpRequestStatus(e.target.value)}
              className="rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-700"
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-50 border-b border-surface-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-surface-700">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-surface-700">Email</th>
                  <th className="px-4 py-3 text-left font-medium text-surface-700">ID number</th>
                  <th className="px-4 py-3 text-left font-medium text-surface-700">Cellphone</th>
                  <th className="px-4 py-3 text-left font-medium text-surface-700">Requested</th>
                  {signUpRequestStatus === 'pending' && <th className="px-4 py-3 text-right font-medium text-surface-700">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {approvalsLoading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-surface-500">Loading…</td></tr>
                ) : signUpRequests.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-surface-500">No sign-up requests.</td></tr>
                ) : (
                  signUpRequests.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-50/50">
                      <td className="px-4 py-2 font-medium text-surface-900">{r.full_name}</td>
                      <td className="px-4 py-2 text-surface-600 font-mono text-xs">{r.email}</td>
                      <td className="px-4 py-2 text-surface-600">{r.id_number || '—'}</td>
                      <td className="px-4 py-2 text-surface-600">{r.cellphone || '—'}</td>
                      <td className="px-4 py-2 text-surface-600">{formatDate(r.created_at)}</td>
                      {signUpRequestStatus === 'pending' && (
                        <td className="px-4 py-2 text-right">
                          <button type="button" onClick={() => openApproval(r)} className="text-brand-600 hover:underline">Review</button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {detailUser && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetailUser(null)} />
          <div className="relative w-full max-w-md bg-white shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-surface-200 px-4 py-3 flex justify-between items-center">
              <h2 className="font-semibold text-surface-900">User details</h2>
              <button type="button" onClick={() => setDetailUser(null)} className="text-surface-500 hover:text-surface-700">✕</button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <p className="text-sm text-surface-500">Name</p>
                <p className="font-medium text-surface-900">{detailUser.full_name}</p>
              </div>
              <div>
                <p className="text-sm text-surface-500">Email</p>
                <p className="font-mono text-sm text-surface-700">{detailUser.email}</p>
              </div>
              <div className="flex gap-2">
                <RoleBadge role={detailUser.role} />
                <StatusBadge status={detailUser.status} />
              </div>
              <div>
                <p className="text-sm text-surface-500">Page access</p>
                <p className="text-surface-700">{(detailUser.page_roles || []).length ? (detailUser.page_roles || []).map((p) => PAGE_ROLES.find((r) => r.id === p)?.label || p).join(', ') : 'None'}</p>
              </div>
              <div>
                <p className="text-sm text-surface-500">Tenant(s)</p>
                <p className="text-surface-700">
                  {(detailUser.tenant_ids || detailUser.tenant_id ? [detailUser.tenant_id] : []).length
                    ? (detailUser.tenant_ids || [detailUser.tenant_id]).map((tid) => tenants.find((t) => t.id === tid)?.name || tid).join(', ')
                    : (detailUser.tenant_name || '—')}
                </p>
              </div>
              <div>
                <p className="text-sm text-surface-500">Last login</p>
                <p className="text-surface-700">{formatDate(detailUser.last_login_at)}</p>
              </div>
              <div>
                <p className="text-sm text-surface-500">Login count</p>
                <p className="text-surface-700">{detailUser.login_count ?? 0}</p>
              </div>
              {canManageUsers && detailUser.id !== me?.id && (
                <div className="flex gap-2 pt-2">
                  {canManageUsers && (
                    <button type="button" onClick={() => { openCreateFromUser(detailUser); setDetailUser(null); }} className="px-3 py-1.5 text-sm rounded-lg border border-brand-600 text-brand-700 hover:bg-brand-50 mr-2">Add like this</button>
                  )}
                  <button type="button" onClick={() => { openEdit(detailUser); setDetailUser(null); }} className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700">Edit</button>
                  <button type="button" onClick={() => deleteUser(detailUser.id)} className="px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50">Delete</button>
                </div>
              )}
              <div>
                <div className="flex gap-1 mb-2 border-b border-surface-200">
                  <button
                    type="button"
                    onClick={() => setDetailTab('audit')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-t-lg ${
                      detailTab === 'audit' ? 'bg-surface-100 text-surface-900' : 'text-surface-500 hover:text-surface-800'
                    }`}
                  >
                    Recent activity
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab('login')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-t-lg ${
                      detailTab === 'login' ? 'bg-surface-100 text-surface-900' : 'text-surface-500 hover:text-surface-800'
                    }`}
                  >
                    Login activity
                  </button>
                </div>
                {detailTab === 'audit' && (
                  <>
                    {activity.length === 0 ? (
                      <p className="text-sm text-surface-500">No recent activity.</p>
                    ) : (
                      <ul className="space-y-1.5 text-sm">
                        {activity.map((a, i) => (
                          <li key={i} className="flex justify-between text-surface-600">
                            <span>{a.action}</span>
                            <span className="text-surface-400 font-mono text-xs">{formatDate(a.created_at)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                {detailTab === 'login' && (
                  <div className="space-y-2">
                    <p className="text-xs text-surface-500">
                      Sign-in IP and GPS captured at login. Select rows to delete in bulk (admin only).
                    </p>
                    {canManageUsers && loginActivityRows.length > 0 && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={saving || loginActivitySel.size === 0}
                          onClick={bulkDeleteLoginActivity}
                          className="text-xs px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Delete selected ({loginActivitySel.size})
                        </button>
                        <button type="button" onClick={refreshLoginActivity} className="text-xs px-2 py-1 rounded border border-surface-200 text-surface-700 hover:bg-surface-50">
                          Refresh
                        </button>
                      </div>
                    )}
                    {loginActivityRows.length === 0 ? (
                      <p className="text-sm text-surface-500">No login location records.</p>
                    ) : (
                      <div className="max-h-64 overflow-auto border border-surface-200 rounded-lg text-xs">
                        <table className="w-full text-left">
                          <thead className="bg-surface-50 sticky top-0">
                            <tr className="text-surface-500">
                              {canManageUsers && <th className="p-2 w-8" />}
                              <th className="p-2">When</th>
                              <th className="p-2">IP</th>
                              <th className="p-2">Location</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-surface-100">
                            {loginActivityRows.map((row) => (
                              <tr key={row.id}>
                                {canManageUsers && (
                                  <td className="p-2">
                                    <input
                                      type="checkbox"
                                      checked={loginActivitySel.has(row.id)}
                                      onChange={() => toggleLoginSel(row.id)}
                                      className="rounded border-surface-300"
                                    />
                                  </td>
                                )}
                                <td className="p-2 text-surface-700 whitespace-nowrap">{formatDate(row.created_at)}</td>
                                <td className="p-2 font-mono text-surface-600">{row.ip_address || '—'}</td>
                                <td className="p-2 text-surface-600">
                                  {row.latitude != null && row.longitude != null
                                    ? `${Number(row.latitude).toFixed(5)}, ${Number(row.longitude).toFixed(5)}`
                                    : '—'}
                                  {row.accuracy_meters != null && (
                                    <span className="text-surface-400"> ±{Math.round(row.accuracy_meters)}m</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit modal */}
      {modal && formUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setModal(null); setFormUser(null); }} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
            <div className="flex-none px-6 pt-6 pb-2 border-b border-surface-200">
              <h2 className="text-lg font-semibold text-surface-900">{modal === 'create' ? 'Add user' : 'Edit user'}</h2>
              {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Full name</label>
                <input
                  type="text"
                  value={formUser.full_name}
                  onChange={(e) => setFormUser((f) => ({ ...f, full_name: e.target.value }))}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Email</label>
                <input
                  type="email"
                  value={formUser.email}
                  onChange={(e) => setFormUser((f) => ({ ...f, email: e.target.value }))}
                  disabled={modal === 'edit' && !canManageUsers}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm disabled:bg-surface-100"
                  title={modal === 'edit' && !canManageUsers ? 'Only admins can change email' : ''}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">SA ID number (for password reset)</label>
                <input
                  type="text"
                  value={formUser.id_number || ''}
                  onChange={(e) => setFormUser((f) => ({ ...f, id_number: e.target.value }))}
                  placeholder="Optional"
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Cellphone number</label>
                <input
                  type="tel"
                  value={formUser.cellphone || ''}
                  onChange={(e) => setFormUser((f) => ({ ...f, cellphone: e.target.value }))}
                  placeholder="Optional"
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Password {modal === 'edit' && '(leave blank to keep)'}</label>
                <input
                  type="password"
                  value={formUser.password || ''}
                  onChange={(e) => setFormUser((f) => ({ ...f, password: e.target.value }))}
                  placeholder={modal === 'edit' ? '••••••••' : ''}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Role</label>
                <select
                  value={formUser.role}
                  onChange={(e) => setFormUser((f) => ({ ...f, role: e.target.value }))}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                >
                  {ROLES.filter((r) => me?.role === 'super_admin' || r !== 'super_admin').map((r) => (
                    <option key={r} value={r}>{r.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-2">Page access (roles)</label>
                <p className="text-xs text-surface-500 mb-2">Select which main pages this user can access. Multiple selection allowed.</p>
                <div className="flex flex-wrap gap-3">
                  {PAGE_ROLES.map((pr) => (
                    <label key={pr.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(formUser.page_roles || []).includes(pr.id)}
                        onChange={(e) => {
                          const next = new Set(formUser.page_roles || []);
                          if (e.target.checked) next.add(pr.id);
                          else next.delete(pr.id);
                          setFormUser((f) => ({ ...f, page_roles: [...next] }));
                        }}
                        className="rounded border-surface-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="text-sm text-surface-700">{pr.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              {modal === 'edit' && (
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1">Status</label>
                  <select
                    value={formUser.status}
                    onChange={(e) => setFormUser((f) => ({ ...f, status: e.target.value }))}
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}
              {(modal === 'create' || modal === 'edit') && canManageUsers && tenants.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-2">Tenants</label>
                  <p className="text-xs text-surface-500 mb-2">User can belong to multiple tenants. Select all that apply.</p>
                  <div className="flex flex-wrap gap-3 max-h-40 overflow-y-auto">
                    {tenants.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={(formUser.tenant_ids || []).includes(t.id)}
                          onChange={(e) => {
                            const next = new Set(formUser.tenant_ids || []);
                            if (e.target.checked) next.add(t.id);
                            else next.delete(t.id);
                            setFormUser((f) => ({ ...f, tenant_ids: [...next], tenant_id: [...next][0] || '' }));
                          }}
                          className="rounded border-surface-300 text-brand-600 focus:ring-brand-500"
                        />
                        <span className="text-sm text-surface-700">{t.name}</span>
                      </label>
                    ))}
                  </div>
                  {tenants.length === 0 && <p className="text-sm text-surface-500">No tenants. Create tenants first.</p>}
                </div>
              )}
              {(formUser.page_roles || []).includes('contractor') && (formUser.tenant_ids || []).length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1">Contractor companies</label>
                  <p className="text-xs text-surface-500 mb-2">One tenant can have many contractor companies (e.g. Teshuah Trucks, Matsimane). Choose which ones this user can access. Leave all unchecked for roles that see all (e.g. Command Centre).</p>
                  <div className="flex items-center gap-2 mb-2">
                    {formContractorsLoading ? (
                      <p className="text-sm text-surface-500">Loading…</p>
                    ) : (
                      <button
                        type="button"
                        onClick={refreshFormContractors}
                        className="text-xs text-surface-600 hover:text-surface-900 underline"
                      >
                        Refresh list
                      </button>
                    )}
                  </div>
                  {!formContractorsLoading && (
                    <>
                      <div className="flex flex-wrap gap-3 max-h-36 overflow-y-auto mb-3">
                        {formContractors.length === 0 ? (
                          <p className="text-sm text-surface-500">No contractor companies yet. Add one below, or click Refresh list to try again.</p>
                        ) : (
                          formContractors.map((c) => (
                            <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={(formUser.contractor_ids || []).map((x) => String(x)).includes(String(c.id))}
                                onChange={(e) => {
                                  const current = (formUser.contractor_ids || []).map((x) => String(x));
                                  const next = new Set(current);
                                  const cid = String(c.id);
                                  if (e.target.checked) next.add(cid);
                                  else next.delete(cid);
                                  setFormUser((f) => ({ ...f, contractor_ids: [...next] }));
                                }}
                                className="rounded border-surface-300 text-brand-600 focus:ring-brand-500"
                              />
                              <span className="text-sm text-surface-700">{c.name}</span>
                            </label>
                          ))
                        )}
                      </div>
                      <form onSubmit={addContractorCompany} className="flex gap-2 items-center flex-wrap">
                        <input
                          type="text"
                          value={newContractorName}
                          onChange={(e) => setNewContractorName(e.target.value)}
                          placeholder="New company name (e.g. Teshuah Trucks)"
                          className="flex-1 min-w-[140px] rounded-lg border border-surface-300 px-3 py-1.5 text-sm"
                        />
                        <button type="submit" disabled={addingContractor || !newContractorName.trim()} className="px-3 py-1.5 text-sm rounded-lg bg-surface-200 text-surface-800 hover:bg-surface-300 disabled:opacity-50">
                          {addingContractor ? 'Adding…' : 'Add company'}
                        </button>
                      </form>
                    </>
                  )}
                </div>
              )}
            </div>
            </div>
            <div className="flex-none flex gap-2 px-6 py-4 border-t border-surface-200 bg-surface-50 rounded-b-xl">
              <button type="button" onClick={saveUser} disabled={saving || !formUser.full_name || (modal === 'create' && !formUser.email)} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Save</button>
              <button type="button" onClick={() => { setModal(null); setFormUser(null); }} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-100">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Sign-up approval modal */}
      {approvalRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setApprovalRequest(null); setApprovalForm(null); setRejectReason(''); }} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-semibold text-surface-900 mb-4">Approve or reject sign-up</h2>
            <div className="space-y-4 mb-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p className="text-surface-500">Full name</p>
                <p className="font-medium text-surface-900">{approvalRequest.full_name}</p>
                <p className="text-surface-500">Email</p>
                <p className="font-mono text-surface-900">{approvalRequest.email}</p>
                <p className="text-surface-500">ID number</p>
                <p className="text-surface-900">{approvalRequest.id_number || '—'}</p>
                <p className="text-surface-500">Cellphone</p>
                <p className="text-surface-900">{approvalRequest.cellphone || '—'}</p>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              {approvalForm && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1">Role</label>
                    <select
                      value={approvalForm.role}
                      onChange={(e) => setApprovalForm((f) => ({ ...f, role: e.target.value }))}
                      className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                    >
                      {ROLES.filter((r) => me?.role === 'super_admin' || r !== 'super_admin').map((r) => (
                        <option key={r} value={r}>{r.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-2">Page access (roles)</label>
                    <div className="flex flex-wrap gap-3">
                      {PAGE_ROLES.map((pr) => (
                        <label key={pr.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(approvalForm.page_roles || []).includes(pr.id)}
                            onChange={(e) => {
                              const next = new Set(approvalForm.page_roles || []);
                              if (e.target.checked) next.add(pr.id);
                              else next.delete(pr.id);
                              setApprovalForm((f) => ({ ...f, page_roles: [...next] }));
                            }}
                            className="rounded border-surface-300 text-brand-600 focus:ring-brand-500"
                          />
                          <span className="text-sm text-surface-700">{pr.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {tenants.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-surface-700 mb-2">Tenants</label>
                      <div className="flex flex-wrap gap-3 max-h-32 overflow-y-auto">
                        {tenants.map((t) => (
                          <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(approvalForm.tenant_ids || []).includes(t.id)}
                              onChange={(e) => {
                                const next = new Set(approvalForm.tenant_ids || []);
                                if (e.target.checked) next.add(t.id);
                                else next.delete(t.id);
                                setApprovalForm((f) => ({ ...f, tenant_ids: [...next] }));
                              }}
                              className="rounded border-surface-300 text-brand-600 focus:ring-brand-500"
                            />
                            <span className="text-sm text-surface-700">{t.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Rejection reason (optional, for Reject)</label>
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g. Duplicate or invalid details"
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={approveSignUpRequest}
                disabled={saving || !(approvalForm?.tenant_ids || []).length}
                className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Approve & send login email'}
              </button>
              <button
                type="button"
                onClick={rejectSignUpRequest}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => { setApprovalRequest(null); setApprovalForm(null); setRejectReason(''); }}
                className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
