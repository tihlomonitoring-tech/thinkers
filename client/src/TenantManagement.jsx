import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { tenants as tenantsApi, users as usersApi } from './api';

const PLANS = ['free', 'standard', 'enterprise'];
const STATUSES = ['active', 'suspended', 'trial'];

export default function TenantManagement() {
  const { user: me } = useAuth();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // 'create' | 'edit' | null
  const [detailTenant, setDetailTenant] = useState(null);
  const [tenantUsers, setTenantUsers] = useState([]);
  const [formTenant, setFormTenant] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(null);
  const [error, setError] = useState('');

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    try {
      const data = await tenantsApi.list();
      setTenants(data.tenants || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const canViewAllTenants = me?.role === 'super_admin';

  const openDetail = async (t) => {
    setDetailTenant(t);
    setTenantUsers([]);
    if (canViewAllTenants) {
      try {
        const data = await usersApi.list({ tenant_id: t.id, limit: 100 });
        setTenantUsers(data.users || []);
      } catch {}
    }
  };

  const filteredTenants = search.trim()
    ? tenants.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()) || (t.slug && t.slug.toLowerCase().includes(search.trim().toLowerCase())))
    : tenants;

  const openCreate = () => {
    setFormTenant({ name: '', slug: '', domain: '', plan: 'standard', status: 'active' });
    setModal('create');
    setError('');
  };

  const openEdit = (t) => {
    setFormTenant({ id: t.id, name: t.name, slug: t.slug, domain: t.domain || '', plan: t.plan, status: t.status, logo_url: t.logo_url });
    setModal('edit');
    setError('');
    setLogoPreviewUrl(null);
    if (t.logo_url) {
      fetch(tenantsApi.logoUrl(t.id), { credentials: 'include' })
        .then((r) => r.ok ? r.blob() : null)
        .then((blob) => blob && setLogoPreviewUrl(URL.createObjectURL(blob)))
        .catch(() => {});
    }
  };

  const saveTenant = async () => {
    if (!formTenant) return;
    setSaving(true);
    setError('');
    try {
      if (modal === 'create') {
        await tenantsApi.create({
          name: formTenant.name,
          slug: formTenant.slug || formTenant.name.trim().toLowerCase().replace(/\s+/g, '-'),
          domain: formTenant.domain || undefined,
          plan: formTenant.plan,
          status: formTenant.status,
        });
      } else {
        await tenantsApi.update(formTenant.id, {
          name: formTenant.name,
          domain: formTenant.domain || undefined,
          plan: formTenant.plan,
          status: formTenant.status,
        });
      }
      setModal(null);
      setFormTenant(null);
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
      setLogoPreviewUrl(null);
      fetchTenants();
      if (detailTenant?.id === formTenant.id) setDetailTenant((prev) => (prev ? { ...prev, ...formTenant } : null));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = (e) => {
    const file = e.target?.files?.[0];
    if (!file || !formTenant?.id) return;
    setUploadingLogo(true);
    setError('');
    tenantsApi.uploadLogo(formTenant.id, file)
      .then((data) => {
        setFormTenant((f) => (f ? { ...f, logo_url: data.tenant?.logo_url } : f));
        if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
        return fetch(tenantsApi.logoUrl(formTenant.id), { credentials: 'include' });
      })
      .then((r) => r.ok ? r.blob() : null)
      .then((blob) => { if (blob) setLogoPreviewUrl(URL.createObjectURL(blob)); })
      .catch((err) => setError(err?.message || 'Logo upload failed'))
      .finally(() => { setUploadingLogo(false); e.target.value = ''; });
  };

  const removeLogo = () => {
    if (!formTenant?.id) return;
    setSaving(true);
    tenantsApi.update(formTenant.id, { logo_url: null })
      .then((data) => {
        setFormTenant((f) => (f ? { ...f, logo_url: null } : f));
        if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
        setLogoPreviewUrl(null);
      })
      .catch((err) => setError(err?.message || 'Failed to remove logo'))
      .finally(() => setSaving(false));
  };

  const deleteTenant = async (id) => {
    if (!confirm('Delete this tenant and all its users? This cannot be undone.')) return;
    setSaving(true);
    try {
      await tenantsApi.delete(id);
      setDetailTenant(null);
      setModal(null);
      fetchTenants();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-xl font-semibold text-surface-900">Tenant management</h1>
        {(me?.role === 'super_admin') && (
          <button
            type="button"
            onClick={openCreate}
            className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700"
          >
            Add tenant
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2 flex justify-between items-center">
          {error}
          <button type="button" onClick={() => setError('')} className="text-red-500 hover:text-red-700">Dismiss</button>
        </div>
      )}

      <div className="mb-4">
        <input
          type="search"
          placeholder="Search tenants by name or slug…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <div className="col-span-full text-center py-12 text-surface-500">Loading…</div>
        ) : filteredTenants.length === 0 ? (
          <div className="col-span-full text-center py-12 text-surface-500">No tenants found.</div>
        ) : (
          filteredTenants.map((t) => (
            <div
              key={t.id}
              className="app-glass-card p-4 hover:border-brand-200 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => openDetail(t)} className="text-left flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {t.logo_url ? (
                      <img src={tenantsApi.logoUrl(t.id)} alt="" className="h-10 w-10 object-contain rounded border border-surface-200 bg-white flex-shrink-0" onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : null}
                    <div className="min-w-0">
                  <h2 className="font-semibold text-surface-900 break-words">{t.name}</h2>
                  <p className="text-sm text-surface-500 font-mono mt-0.5">{t.slug}</p>
                  <div className="flex gap-2 mt-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-100 text-surface-700">{t.plan}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      t.status === 'active' ? 'bg-emerald-100 text-emerald-800' : t.status === 'suspended' ? 'bg-red-100 text-red-800' : 'bg-sky-100 text-sky-800'
                    }`}>{t.status}</span>
                  </div>
                  <p className="text-sm text-surface-500 mt-2">{t.user_count ?? 0} users</p>
                    </div>
                  </div>
                </button>
                {(me?.role === 'super_admin' || (canViewAllTenants && t.id === me?.tenant_id)) && (
                  <div className="flex gap-1 shrink-0">
                    <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(t); }} className="p-1.5 text-surface-500 hover:text-brand-600 rounded">Edit</button>
                    {me?.role === 'super_admin' && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); if (confirm('Delete this tenant?')) deleteTenant(t.id); }} className="p-1.5 text-surface-500 hover:text-red-600 rounded">Delete</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Detail panel */}
      {detailTenant && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetailTenant(null)} />
          <div className="relative w-full max-w-md bg-white shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-surface-200 px-4 py-3 flex justify-between items-center">
              <h2 className="font-semibold text-surface-900">Tenant details</h2>
              <button type="button" onClick={() => setDetailTenant(null)} className="text-surface-500 hover:text-surface-700">✕</button>
            </div>
            <div className="p-4 space-y-4">
              {detailTenant.logo_url && (
                <div>
                  <p className="text-sm text-surface-500 mb-1">Company logo</p>
                  <img src={tenantsApi.logoUrl(detailTenant.id)} alt="" className="h-16 w-auto object-contain rounded border border-surface-200 bg-surface-50" onError={(e) => { e.target.style.display = 'none'; }} />
                </div>
              )}
              <div>
                <p className="text-sm text-surface-500">Name</p>
                <p className="font-medium text-surface-900">{detailTenant.name}</p>
              </div>
              <div>
                <p className="text-sm text-surface-500">Slug</p>
                <p className="font-mono text-sm text-surface-700">{detailTenant.slug}</p>
              </div>
              {detailTenant.domain && (
                <div>
                  <p className="text-sm text-surface-500">Domain</p>
                  <p className="text-surface-700">{detailTenant.domain}</p>
                </div>
              )}
              <div className="flex gap-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-100 text-surface-700">{detailTenant.plan}</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  detailTenant.status === 'active' ? 'bg-emerald-100 text-emerald-800' : detailTenant.status === 'suspended' ? 'bg-red-100 text-red-800' : 'bg-sky-100 text-sky-800'
                }`}>{detailTenant.status}</span>
              </div>
              <div>
                <p className="text-sm text-surface-500">User count</p>
                <p className="text-surface-700">{detailTenant.user_count ?? 0}</p>
              </div>
              {(me?.role === 'super_admin' || (canViewAllTenants && detailTenant.id === me?.tenant_id)) && (
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={() => { openEdit(detailTenant); setDetailTenant(null); }} className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700">Edit tenant</button>
                  {me?.role === 'super_admin' && (
                    <button type="button" onClick={() => deleteTenant(detailTenant.id)} className="px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50">Delete tenant</button>
                  )}
                </div>
              )}
              {canViewAllTenants && tenantUsers.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-surface-700 mb-2">Users in this tenant</p>
                  <ul className="space-y-1.5 text-sm">
                    {tenantUsers.slice(0, 20).map((u) => (
                      <li key={u.id} className="flex justify-between text-surface-600">
                        <span>{u.full_name}</span>
                        <span className="text-surface-400">{u.email}</span>
                      </li>
                    ))}
                    {tenantUsers.length > 20 && <li className="text-surface-500">+{tenantUsers.length - 20} more</li>}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit modal */}
      {modal && formTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setModal(null); setFormTenant(null); }} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-surface-900 mb-4">{modal === 'create' ? 'Add tenant' : 'Edit tenant'}</h2>
            {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Name</label>
                <input
                  type="text"
                  value={formTenant.name}
                  onChange={(e) => setFormTenant((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  placeholder="Acme Inc"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Slug (URL-friendly)</label>
                <input
                  type="text"
                  value={formTenant.slug}
                  onChange={(e) => setFormTenant((f) => ({ ...f, slug: e.target.value }))}
                  disabled={modal === 'edit'}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm disabled:bg-surface-100 font-mono"
                  placeholder="acme-inc"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Domain (optional)</label>
                <input
                  type="text"
                  value={formTenant.domain || ''}
                  onChange={(e) => setFormTenant((f) => ({ ...f, domain: e.target.value }))}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  placeholder="acme.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Plan</label>
                <select
                  value={formTenant.plan}
                  onChange={(e) => setFormTenant((f) => ({ ...f, plan: e.target.value }))}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                >
                  {PLANS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Status</label>
                <select
                  value={formTenant.status}
                  onChange={(e) => setFormTenant((f) => ({ ...f, status: e.target.value }))}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Company logo</label>
                <p className="text-xs text-surface-500 mb-2">Used on reports. PNG, JPEG, GIF or WebP, max 2MB.</p>
                {modal === 'edit' && (
                  <>
                    {(logoPreviewUrl || formTenant.logo_url) ? (
                      <div className="flex items-center gap-3">
                        {logoPreviewUrl ? (
                          <img src={logoPreviewUrl} alt="Logo" className="h-16 w-auto object-contain rounded border border-surface-200 bg-surface-50" />
                        ) : (
                          <div className="h-16 w-24 rounded border border-surface-200 bg-surface-100 flex items-center justify-center text-surface-400 text-xs">Logo</div>
                        )}
                        <div className="flex flex-col gap-1">
                          <label className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 cursor-pointer inline-block w-fit disabled:opacity-50" style={{ pointerEvents: uploadingLogo ? 'none' : 'auto' }}>
                            {uploadingLogo ? 'Uploading…' : 'Change logo'}
                            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={handleLogoUpload} disabled={uploadingLogo} />
                          </label>
                          <button type="button" onClick={removeLogo} disabled={saving} className="px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50">Remove logo</button>
                        </div>
                      </div>
                    ) : (
                      <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-300 text-surface-700 hover:bg-surface-50 cursor-pointer disabled:opacity-50">
                        {uploadingLogo ? 'Uploading…' : 'Upload logo'}
                        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={handleLogoUpload} disabled={uploadingLogo} />
                      </label>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button type="button" onClick={saveTenant} disabled={saving || !formTenant.name} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">Save</button>
              <button type="button" onClick={() => { setModal(null); setFormTenant(null); if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl); setLogoPreviewUrl(null); }} className="px-4 py-2 text-sm rounded-lg border border-surface-300 text-surface-700">Cancel</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
