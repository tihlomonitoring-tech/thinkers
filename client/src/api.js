import { getApiBase } from './lib/apiBase.js';

// In dev, call API directly so it works even if proxy fails. Override with VITE_API_BASE in client .env.
const API = getApiBase();

/** Open an attachment URL in a new tab using fetch with credentials so auth is sent. */
export async function openAttachmentWithAuth(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(res.status === 401 ? 'Please sign in again' : 'Could not load attachment');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const w = window.open(objectUrl, '_blank', 'noopener');
  if (w) setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  else URL.revokeObjectURL(objectUrl);
}

/** Download an attachment (fetch with credentials, then trigger save). */
export async function downloadAttachmentWithAuth(url, filename) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const text = await res.text();
    let msg = res.status === 401 ? 'Please sign in again' : 'Could not download';
    try {
      const data = JSON.parse(text);
      if (data?.error) msg = data.error;
    } catch (_) {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename || 'attachment';
  a.click();
  URL.revokeObjectURL(objectUrl);
}

function wrapNetworkError(err) {
  if (err?.message === 'Failed to fetch') {
    if (import.meta.env.DEV) {
      return new Error(
        'Cannot reach the API (local dev). (1) Start the backend in the project root: npm run server or npm start. (2) If the API uses another port, set VITE_API_BASE in client/.env and restart Vite. (3) This text only appears while running Vite (npm run dev)—it is not shown by the production build. If you see it on https://your live domain, you are not running the deployed bundle; use the production build on Azure and fix server env (FRONTEND_ORIGIN), not localhost.'
      );
    }
    return new Error(
      'Cannot reach the API. If the site is hosted separately from the API, rebuild the client with VITE_API_BASE set to your API base URL (e.g. https://your-app.azurewebsites.net/api). On the server, set FRONTEND_ORIGIN (and optionally FRONTEND_ORIGINS) to this site’s exact URL(s) so CORS allows the browser. See docs/azure-hosting.md.'
    );
  }
  return err;
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      credentials: 'include',
    });
  } catch (err) {
    throw wrapNetworkError(err);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const base =
      data.error ||
      (res.status === 404 ? `Not found (${path})` : res.statusText);
    const hint = data.hint ? ` ${data.hint}` : '';
    throw new Error(`${base}${hint}`.trim());
  }
  return data;
}

export const auth = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
  switchTenant: (tenantId) => request('/auth/switch-tenant', { method: 'POST', body: JSON.stringify({ tenant_id: tenantId }) }),
  forgotPassword: (body) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify(body) }),
  resetPassword: (body) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify(body) }),
  signUp: (body) => request('/auth/sign-up', { method: 'POST', body: JSON.stringify(body) }),
};

export const users = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/users${q ? `?${q}` : ''}`);
  },
  get: (id) => request(`/users/${id}`),
  /** Contractors for given tenant IDs (for assigning user to contractors in User Management). */
  contractorsForTenants: (tenantIds) => {
    const ids = (Array.isArray(tenantIds) ? tenantIds : [])
      .map((id) => (id != null ? String(id).trim() : ''))
      .filter(Boolean);
    if (ids.length === 0) return Promise.resolve({ contractors: [] });
    const q = ids.length === 1
      ? `tenant_id=${encodeURIComponent(ids[0])}`
      : `tenant_ids=${encodeURIComponent(ids.join(','))}`;
    return request(`/users/contractors-for-tenants?${q}`);
  },
  /** Create a contractor company under a tenant (from User Management). */
  createContractor: (body) => request('/users/contractors', { method: 'POST', body: JSON.stringify(body) }),
  activity: (id) => request(`/users/${id}/activity`),
  create: (body) => request('/users', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  bulk: (body) => request('/users/bulk', { method: 'POST', body: JSON.stringify(body) }),
  delete: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  signUpRequests: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/users/sign-up-requests${q ? `?${q}` : ''}`);
    },
    get: (id) => request(`/users/sign-up-requests/${id}`),
    approve: (id, body) => request(`/users/sign-up-requests/${id}/approve`, { method: 'POST', body: JSON.stringify(body) }),
    reject: (id, body) => request(`/users/sign-up-requests/${id}/reject`, { method: 'POST', body: JSON.stringify(body || {}) }),
  },
  /** Super admin: accounts locked after failed sign-in attempts. */
  blockRequests: {
    list: () => request('/users/block-requests'),
    unlock: (id) => request(`/users/block-requests/${encodeURIComponent(id)}/unlock`, { method: 'POST', body: '{}' }),
  },
};

export const tenants = {
  list: () => request('/tenants'),
  get: (id) => request(`/tenants/${id}`),
  create: (body) => request('/tenants', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id) => request(`/tenants/${id}`, { method: 'DELETE' }),
  uploadLogo: (id, file) => {
    const formData = new FormData();
    formData.append('logo', file);
    return fetch(`${API}/tenants/${id}/logo`, { method: 'POST', body: formData, credentials: 'include' })
      .then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText)))));
  },
  logoUrl: (id) => `${API}/tenants/${id}/logo`,
};

export const contractor = {
  context: () => request('/contractor/context'),
  contractors: {
    list: () => request('/contractor/contractors'),
    create: (body) => request('/contractor/contractors', { method: 'POST', body: JSON.stringify(body) }),
  },
  trucks: {
    list: () => request('/contractor/trucks'),
    create: (body) => request('/contractor/trucks', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/contractor/trucks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    bulk: (body) => request('/contractor/trucks/bulk', { method: 'POST', body: JSON.stringify(body) }),
  },
  drivers: {
    list: () => request('/contractor/drivers'),
    create: (body) => request('/contractor/drivers', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/contractor/drivers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    bulk: (body) => request('/contractor/drivers/bulk', { method: 'POST', body: JSON.stringify(body) }),
  },
  incidents: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/contractor/incidents${q ? `?${q}` : ''}`);
    },
    get: (id) => request(`/contractor/incidents/${id != null ? String(id) : ''}`),
    create: (body) => request('/contractor/incidents', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/contractor/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    resolveWithDetails: (id, formData) =>
      fetch(`${API}/contractor/incidents/${id}/resolve`, {
        method: 'PATCH',
        body: formData,
        credentials: 'include',
      }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
      }).catch((err) => { throw wrapNetworkError(err); }),
    /** Submit offloading slip later (incident must be resolved). */
    submitOffloadingSlip: (id, formData) =>
      fetch(`${API}/contractor/incidents/${id}/offloading-slip`, {
        method: 'PATCH',
        body: formData,
        credentials: 'include',
      }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
      }).catch((err) => { throw wrapNetworkError(err); }),
    /** Fetch an attachment as blob (for view/download). Uses credentials. */
    getAttachmentBlob: (id, type) =>
      fetch(`${API}/contractor/incidents/${id}/attachments/${type}`, { credentials: 'include' }).then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Attachment not found' : 'Failed to load attachment');
        return res.blob();
      }).catch((err) => { throw wrapNetworkError(err); }),
    createWithAttachments: (formData) =>
      fetch(`${API}/contractor/incidents`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
      }).catch((err) => {
        throw wrapNetworkError(err);
      }),
  },
  expiries: {
    list: () => request('/contractor/expiries'),
    create: (body) => request('/contractor/expiries', { method: 'POST', body: JSON.stringify(body) }),
  },
  suspensions: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/contractor/suspensions${q ? `?${q}` : ''}`);
    },
    create: (body) => request('/contractor/suspensions', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/contractor/suspensions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },
  reinstatementRequests: () => request('/contractor/reinstatement-requests'),
    reinstatementHistory: () => request('/contractor/reinstatement-history'),
  complianceRecords: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/contractor/compliance-records${q ? `?${q}` : ''}`);
    },
    get: (id) => request(`/contractor/compliance-records/${id}`),
    respond: (id, responseText, files = null) => {
      if (files && files.length > 0) {
        const formData = new FormData();
        formData.append('responseText', responseText ?? '');
        for (let i = 0; i < files.length; i++) formData.append('attachments', files[i]);
        return fetch(`${API}/contractor/compliance-records/${id}/respond`, {
          method: 'PATCH',
          body: formData,
          credentials: 'include',
        }).then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText)))));
      }
      return request(`/contractor/compliance-records/${id}/respond`, { method: 'PATCH', body: JSON.stringify({ responseText: responseText ?? '' }) });
    },
    attachmentUrl: (inspectionId, attachmentId) => `${API}/contractor/compliance-records/${inspectionId}/attachments/${attachmentId}`,
  },
  messages: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.contractor_id) q.set('contractor_id', params.contractor_id);
      return request(`/contractor/messages${q.toString() ? `?${q.toString()}` : ''}`);
    },
    create: (body, files = null) => {
      if (files && files.length > 0) {
        const formData = new FormData();
        if (body?.subject != null) formData.append('subject', body.subject);
        if (body?.body != null) formData.append('body', body.body);
        if (body?.contractor_id != null) formData.append('contractor_id', body.contractor_id);
        for (let i = 0; i < files.length; i++) formData.append('attachments', files[i]);
        return fetch(`${API}/contractor/messages`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        }).then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText)))));
      }
      return request('/contractor/messages', { method: 'POST', body: JSON.stringify(body) });
    },
    markRead: (id) => request(`/contractor/messages/${id}/read`, { method: 'PATCH' }),
    attachmentUrl: (messageId, attachmentId) => `${API}/contractor/messages/${messageId}/attachments/${attachmentId}`,
  },
  routes: {
    list: () => request('/contractor/routes'),
    enrolledByTruck: (truckId) => request(`/contractor/routes/enrolled-by-truck/${encodeURIComponent(truckId)}`),
    get: (id, params = {}) => {
      const q = new URLSearchParams();
      if (params.contractor_id) q.set('contractor_id', params.contractor_id);
      if (params.enrollmentPortal) q.set('enrollmentPortal', params.enrollmentPortal);
      const qs = q.toString();
      return request(`/contractor/routes/${id}${qs ? `?${qs}` : ''}`);
    },
    create: (body) => request('/contractor/routes', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/contractor/routes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => request(`/contractor/routes/${id}`, { method: 'DELETE' }),
    enrollTrucks: (routeId, truckIds) => request(`/contractor/routes/${routeId}/trucks?enrollmentPortal=1`, { method: 'POST', body: JSON.stringify({ truckIds }) }),
    enrollDrivers: (routeId, driverIds) => request(`/contractor/routes/${routeId}/drivers?enrollmentPortal=1`, { method: 'POST', body: JSON.stringify({ driverIds }) }),
    unenrollTruck: (routeId, truckId) => request(`/contractor/routes/${routeId}/trucks/${truckId}?enrollmentPortal=1`, { method: 'DELETE' }),
    unenrollDriver: (routeId, driverId) => request(`/contractor/routes/${routeId}/drivers/${driverId}?enrollmentPortal=1`, { method: 'DELETE' }),
  },
  rectorMyRoutes: () => request('/contractor/rector-my-routes'),
  routeFactors: {
    list: (routeId) => request(`/contractor/route-factors${routeId ? `?routeId=${encodeURIComponent(routeId)}` : ''}`),
    create: (body) => request('/contractor/route-factors', { method: 'POST', body: JSON.stringify(body) }),
    bulkCreate: (body) => request('/contractor/route-factors/bulk', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/contractor/route-factors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => request(`/contractor/route-factors/${id}`, { method: 'DELETE' }),
  },
  distributionHistory: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request(`/contractor/distribution-history${q ? `?${q}` : ''}`);
    },
    contractors: () => request('/contractor/distribution/contractors'),
    create: (body) => request('/contractor/distribution-history', { method: 'POST', body: JSON.stringify(body) }),
    sendEmail: (body) => request('/contractor/distribution/send-email', { method: 'POST', body: JSON.stringify(body) }),
    exportUrl: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return `${getApiBase()}/contractor/distribution-history/export${q ? `?${q}` : ''}`;
    },
  },
  pilotDistribution: {
    list: () => request('/contractor/pilot-distribution'),
    history: () => request('/contractor/pilot-distribution/history'),
    create: (body) => request('/contractor/pilot-distribution', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/contractor/pilot-distribution/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => request(`/contractor/pilot-distribution/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  enrollment: {
    approvedTrucks: (contractorId, opts = {}) => {
      const q = new URLSearchParams();
      if (contractorId) q.set('contractor_id', contractorId);
      if (opts.enrollmentPortal) q.set('enrollmentPortal', opts.enrollmentPortal);
      const qs = q.toString();
      return request(`/contractor/enrollment/approved-trucks${qs ? `?${qs}` : ''}`);
    },
    approvedDrivers: (contractorId, opts = {}) => {
      const q = new URLSearchParams();
      if (contractorId) q.set('contractor_id', contractorId);
      if (opts.enrollmentPortal) q.set('enrollmentPortal', opts.enrollmentPortal);
      const qs = q.toString();
      return request(`/contractor/enrollment/approved-drivers${qs ? `?${qs}` : ''}`);
    },
    downloadFleetList: (routeId, contractorId, opts = {}) => {
      const q = new URLSearchParams();
      if (routeId) q.set('routeId', routeId);
      if (contractorId) q.set('contractor_id', contractorId);
      if (opts.enrollmentPortal) q.set('enrollmentPortal', opts.enrollmentPortal);
      const qs = q.toString();
      return fetch(`${API}/contractor/enrollment/fleet-list${qs ? `?${qs}` : ''}`, { credentials: 'include' })
        .then((res) => {
          if (!res.ok) throw new Error('Failed to download fleet list');
          return res.blob();
        })
        .then((blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'fleet-list.csv';
          a.click();
          URL.revokeObjectURL(a.href);
        });
    },
    downloadDriverList: (routeId, contractorId, opts = {}) => {
      const q = new URLSearchParams();
      if (routeId) q.set('routeId', routeId);
      if (contractorId) q.set('contractor_id', contractorId);
      if (opts.enrollmentPortal) q.set('enrollmentPortal', opts.enrollmentPortal);
      const qs = q.toString();
      return fetch(`${API}/contractor/enrollment/driver-list${qs ? `?${qs}` : ''}`, { credentials: 'include' })
        .then((res) => {
          if (!res.ok) throw new Error('Failed to download driver list');
          return res.blob();
        })
        .then((blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'driver-list.csv';
          a.click();
          URL.revokeObjectURL(a.href);
        });
    },
  },
  info: {
    get: () => request('/contractor/info'),
    update: (body) => request('/contractor/info', { method: 'PATCH', body: JSON.stringify(body) }),
  },
  subcontractors: {
    list: () => request('/contractor/subcontractors'),
    create: (body) => request('/contractor/subcontractors', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/contractor/subcontractors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => request(`/contractor/subcontractors/${id}`, { method: 'DELETE' }),
  },
  library: {
    documentTypes: () => request('/contractor/library/document-types'),
    list: () => request('/contractor/library'),
    upload: (file, documentType = 'other') => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('document_type', documentType);
      return fetch(`${API}/contractor/library`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
      }).catch((err) => { throw wrapNetworkError(err); });
    },
    delete: (id) => request(`/contractor/library/${id}`, { method: 'DELETE' }),
    downloadUrl: (id) => `${API}/contractor/library/${id}/download`,
  },
};

export const commandCentre = {
  myTabs: () => request('/command-centre/my-tabs'),
  permissions: () => request('/command-centre/permissions'),
  grantPermission: (userId, tabId) => request('/command-centre/permissions', { method: 'POST', body: JSON.stringify({ user_id: userId, tab_id: tabId }) }),
  revokePermission: (userId, tabId) => request(`/command-centre/permissions?user_id=${encodeURIComponent(userId)}&tab_id=${encodeURIComponent(tabId)}`, { method: 'DELETE' }),
  approvers: () => request('/command-centre/approvers'),
  trends: (params = {}) => {
    const q = new URLSearchParams();
    if (params.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params.dateTo) q.set('dateTo', params.dateTo);
    if (params.route) q.set('route', params.route);
    return request(`/command-centre/trends${q.toString() ? `?${q.toString()}` : ''}`);
  },
  deliveryTimeline: (days = 30) => request(`/command-centre/delivery-timeline?days=${encodeURIComponent(days)}`),
  shiftReports: {
    list: (requestsOnly) => request(`/command-centre/shift-reports${requestsOnly ? '?requests=1' : ''}`),
    listDecidedByMe: () => request('/command-centre/shift-reports?decidedByMe=1'),
    get: (id) => request(`/command-centre/shift-reports/${id}`),
    create: (body) => request('/command-centre/shift-reports', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/command-centre/shift-reports/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => request(`/command-centre/shift-reports/${id}`, { method: 'DELETE' }),
    submit: (id, submitted_to_user_id) => request(`/command-centre/shift-reports/${id}/submit`, { method: 'POST', body: JSON.stringify({ submitted_to_user_id }) }),
    addComment: (id, comment_text) => request(`/command-centre/shift-reports/${id}/comments`, { method: 'POST', body: JSON.stringify({ comment_text }) }),
    markCommentAddressed: (reportId, commentId) => request(`/command-centre/shift-reports/${reportId}/comments/${commentId}/addressed`, { method: 'PATCH' }),
    getEvaluation: (id) => request(`/command-centre/shift-reports/${id}/evaluation`),
    submitEvaluation: (id, body) => request(`/command-centre/shift-reports/${id}/evaluation`, { method: 'POST', body: JSON.stringify(body) }),
    requestOverride: (id) => request(`/command-centre/shift-reports/${id}/request-override`, { method: 'POST' }),
    approve: (id, overrideCode) => request(`/command-centre/shift-reports/${id}/approve`, { method: 'PATCH', body: JSON.stringify(overrideCode ? { override_code: overrideCode } : {}) }),
    reject: (id, overrideCode) => request(`/command-centre/shift-reports/${id}/reject`, { method: 'PATCH', body: JSON.stringify(overrideCode ? { override_code: overrideCode } : {}) }),
    provisional: (id, overrideCode) => request(`/command-centre/shift-reports/${id}/provisional`, { method: 'PATCH', body: JSON.stringify(overrideCode ? { override_code: overrideCode } : {}) }),
    revokeApproval: (id) => request(`/command-centre/shift-reports/${id}/revoke-approval`, { method: 'PATCH' }),
  },
  shiftItems: (params = {}) => {
    const q = new URLSearchParams();
    if (params.days != null) q.set('days', params.days);
    if (params.route) q.set('route', params.route);
    return request(`/command-centre/shift-items${q.toString() ? `?${q.toString()}` : ''}`);
  },
  shiftReportExport: (params = {}) => {
    const q = new URLSearchParams();
    if (params.section) q.set('section', params.section);
    if (params.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params.dateTo) q.set('dateTo', params.dateTo);
    if (params.route) q.set('route', params.route);
    return request(`/command-centre/shift-report-export${q.toString() ? `?${q.toString()}` : ''}`);
  },
  library: () => request('/command-centre/library'),
  messages: {
    list: (params = {}) => contractor.messages.list(params),
    create: (body, files = null) => contractor.messages.create(body, files),
    markRead: (id) => request(`/contractor/messages/${id}/read`, { method: 'PATCH' }),
    attachmentUrl: (messageId, attachmentId) => `${API}/contractor/messages/${messageId}/attachments/${attachmentId}`,
  },
  notesReminders: {
    list: (onlyMine = false) => request(`/command-centre/notes-reminders${onlyMine ? '?only_mine=1' : ''}`),
    create: (body) => request('/command-centre/notes-reminders', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/command-centre/notes-reminders/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id) => request(`/command-centre/notes-reminders/${id}`, { method: 'DELETE' }),
  },
  libraryDocuments: {
    list: () => request('/command-centre/library/documents'),
    upload: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return fetch(`${getApiBase()}/command-centre/library/documents`, { method: 'POST', body: formData, credentials: 'include' })
        .then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText)))));
    },
    downloadUrl: (id) => `${getApiBase()}/command-centre/library/documents/${id}/download`,
  },
  investigationReports: {
    list: (approvedOnly) => request(`/command-centre/investigation-reports${approvedOnly ? '?approved=1' : ''}`),
    create: (body) => request('/command-centre/investigation-reports', { method: 'POST', body: JSON.stringify(body) }),
    approve: (id) => request(`/command-centre/investigation-reports/${id}/approve`, { method: 'PATCH' }),
  },
  complianceInspections: {
    list: () => request('/command-centre/compliance-inspections'),
    create: (body) => request('/command-centre/compliance-inspections', { method: 'POST', body: JSON.stringify(body) }),
    reply: (id, replyText) => request(`/command-centre/compliance-inspections/${id}/reply`, { method: 'PATCH', body: JSON.stringify({ replyText }) }),
    attachmentUrl: (inspectionId, attachmentId) => `${API}/command-centre/compliance-inspections/${inspectionId}/attachments/${attachmentId}`,
  },
  suspendTruck: (truckId, reason, options = {}) => request('/command-centre/suspend-truck', {
    method: 'POST',
    body: JSON.stringify({
      truck_id: truckId,
      reason: reason || undefined,
      permanent: options.permanent !== false,
      duration_days: options.duration_days ?? undefined,
    }),
  }),
  suspensions: {
    list: (status) => request(`/command-centre/suspensions${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    reinstate: (suspensionId) => request('/command-centre/reinstate-suspension', { method: 'POST', body: JSON.stringify({ suspensionId }) }),
  },
  fleetApplications: {
    list: (status) => request(`/command-centre/fleet-applications${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    get: (id) => request(`/command-centre/fleet-applications/${id}`),
    getComments: (id) => request(`/command-centre/fleet-applications/${id}/comments`),
    addComment: (id, body) => request(`/command-centre/fleet-applications/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
    approve: (id, body = {}) => request(`/command-centre/fleet-applications/${id}/approve`, { method: 'PATCH', body: JSON.stringify(body) }),
    bulkApprove: (ids, body = {}) => request('/command-centre/fleet-applications/bulk-approve', { method: 'POST', body: JSON.stringify({ ids, ...body }) }),
    decline: (id, declineReason) => request(`/command-centre/fleet-applications/${id}/decline`, { method: 'PATCH', body: JSON.stringify({ decline_reason: declineReason }) }),
  },
  /** Rectors (users in access_route_factors) for "Notify rectors" when approving fleet applications */
  rectors: () => request('/command-centre/rectors'),
  fleetIntegration: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.tenantId) q.set('tenantId', params.tenantId);
      return request(`/command-centre/fleet-integration${q.toString() ? `?${q.toString()}` : ''}`);
    },
  },
  deleteFleetDrivers: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.tenant_id) q.set('tenant_id', params.tenant_id);
      if (params.contractor_id) q.set('contractor_id', params.contractor_id);
      if (params.type) q.set('type', params.type);
      return request(`/command-centre/delete-fleet-drivers/list${q.toString() ? `?${q.toString()}` : ''}`);
    },
    deleteTruck: (id) => request(`/command-centre/delete-fleet-drivers/truck/${id}`, { method: 'DELETE' }),
    deleteDriver: (id) => request(`/command-centre/delete-fleet-drivers/driver/${id}`, { method: 'DELETE' }),
    deleteBreakdown: (id) => request(`/command-centre/delete-fleet-drivers/breakdown/${id}`, { method: 'DELETE' }),
  },
  contractorsDetails: () => request('/command-centre/contractors-details'),
  breakdowns: {
    tenants: () => request('/command-centre/breakdowns/tenants'),
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.resolved !== undefined && params.resolved !== '') q.set('resolved', params.resolved);
      if (params.dateFrom) q.set('dateFrom', params.dateFrom);
      if (params.dateTo) q.set('dateTo', params.dateTo);
      if (params.type) q.set('type', params.type);
      if (params.severity) q.set('severity', params.severity);
      if (params.tenantId) q.set('tenantId', params.tenantId);
      return request(`/command-centre/breakdowns${q.toString() ? `?${q.toString()}` : ''}`);
    },
    get: (id) => request(`/command-centre/breakdowns/${id}`),
    resolve: (id, resolutionNote) =>
      request(`/command-centre/breakdowns/${id}/resolve`, {
        method: 'PATCH',
        body: JSON.stringify({ resolution_note: resolutionNote }),
      }),
    notifyRector: (id, rectorUserIds) =>
      request(`/command-centre/breakdowns/${id}/notify-rector`, {
        method: 'POST',
        body: JSON.stringify({ rector_user_ids: rectorUserIds }),
      }),
    attachmentUrl: (id, type) => `${API}/command-centre/breakdowns/${id}/attachments/${type}`,
  },
  truckAnalysis: {
    controllers: () => request('/command-centre/truck-analysis/controllers'),
    listSessions: () => request('/command-centre/truck-analysis/sessions'),
    createSession: (payload) =>
      request('/command-centre/truck-analysis/sessions', { method: 'POST', body: JSON.stringify({ payload }) }),
    getSession: (id) => request(`/command-centre/truck-analysis/sessions/${encodeURIComponent(id)}`),
    saveSession: (id, payload) =>
      request(`/command-centre/truck-analysis/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ payload }),
      }),
    handover: (id, summary) =>
      request(`/command-centre/truck-analysis/sessions/${encodeURIComponent(id)}/handover`, {
        method: 'POST',
        body: JSON.stringify({ summary }),
      }),
  },
  rectorsWithRoutes: () => request('/command-centre/rectors-with-routes'),
};

export const progressReports = {
  list: () => request('/progress-reports'),
  get: (id) => request(`/progress-reports/${id}`),
  /** Users in same tenant for email recipient selection (id, full_name, email) */
  recipients: () => request('/progress-reports/users'),
  /** Send report by email. body: { to_user_ids: [], cc_emails: [], message?: string, pdf_base64, pdf_filename } */
  sendEmail: (id, body) => request(`/progress-reports/${id}/send-email`, { method: 'POST', body: JSON.stringify(body) }),
  create: (body) => request('/progress-reports', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/progress-reports/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id) => request(`/progress-reports/${id}`, { method: 'DELETE' }),
};

export const actionPlans = {
  list: () => request('/action-plans'),
  get: (id) => request(`/action-plans/${id}`),
  /** Users in same tenant for email recipient selection (id, full_name, email) */
  recipients: () => request('/action-plans/users'),
  /** Send plan by email. body: { to_user_ids: [], cc_emails: [], message?: string, pdf_base64, pdf_filename } */
  sendEmail: (id, body) => request(`/action-plans/${id}/send-email`, { method: 'POST', body: JSON.stringify(body) }),
  create: (body) => request('/action-plans', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/action-plans/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id) => request(`/action-plans/${id}`, { method: 'DELETE' }),
};

export const monthlyPerformanceReports = {
  list: () => request('/monthly-performance-reports'),
  get: (id) => request(`/monthly-performance-reports/${id}`),
  create: (body) => request('/monthly-performance-reports', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/monthly-performance-reports/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id) => request(`/monthly-performance-reports/${id}`, { method: 'DELETE' }),
};

const rec = (path, options = {}) => request(`/recruitment${path}`, { ...options, body: options.body ? JSON.stringify(options.body) : options.body });
/** Public job application (no auth): used by external /apply/:token page */
export const recruitmentApply = {
  getInvite: (token) => fetch(`${API}/recruitment/apply/${encodeURIComponent(token)}`, { credentials: 'include' }).then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText))))),
  submit: (token, formData) =>
    fetch(`${API}/recruitment/apply/${encodeURIComponent(token)}`, { method: 'POST', body: formData, credentials: 'include' }).then((res) =>
      res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText))))
    ),
};
export const recruitment = {
  vacancies: {
    list: () => rec('/vacancies'),
    get: (id) => rec(`/vacancies/${id}`),
    create: (body) => rec('/vacancies', { method: 'POST', body }),
    update: (id, body) => rec(`/vacancies/${id}`, { method: 'PATCH', body }),
    delete: (id) => rec(`/vacancies/${id}`, { method: 'DELETE' }),
  },
  folders: {
    list: () => rec('/folders'),
    create: (body) => rec('/folders', { method: 'POST', body }),
    update: (id, body) => rec(`/folders/${id}`, { method: 'PATCH', body }),
    delete: (id) => rec(`/folders/${id}`, { method: 'DELETE' }),
  },
  cvs: {
    list: (folderId, opts = {}) => {
      const q = new URLSearchParams();
      if (folderId != null && folderId !== '') q.set('folder_id', folderId);
      if (opts.linked_to_interview === true) q.set('linked_to_interview', 'true');
      if (opts.linked_to_interview === false) q.set('linked_to_interview', 'false');
      return rec(`/cvs${q.toString() ? `?${q.toString()}` : ''}`);
    },
    get: (id) => rec(`/cvs/${id}`),
    upload: (file, body = {}) => {
      const formData = new FormData();
      formData.append('file', file);
      if (body.folder_id != null) formData.append('folder_id', body.folder_id);
      if (body.applicant_name) formData.append('applicant_name', body.applicant_name);
      if (body.applicant_email) formData.append('applicant_email', body.applicant_email);
      return fetch(`${API}/recruitment/cvs`, { method: 'POST', body: formData, credentials: 'include' })
        .then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText)))));
    },
    downloadUrl: (id) => `${API}/recruitment/cvs/${id}/download`,
    delete: (id) => rec(`/cvs/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids) => rec('/cvs/bulk-delete', { method: 'POST', body: { ids } }),
  },
  applicants: {
    list: (vacancyIdOrParams) => {
      const params = vacancyIdOrParams == null ? {} : (typeof vacancyIdOrParams === 'string' ? { vacancy_id: vacancyIdOrParams } : vacancyIdOrParams);
      const qs = new URLSearchParams();
      if (params.vacancy_id) qs.set('vacancy_id', params.vacancy_id);
      if (params.date_from) qs.set('date_from', params.date_from);
      if (params.date_to) qs.set('date_to', params.date_to);
      return rec(`/applicants${qs.toString() ? `?${qs.toString()}` : ''}`);
    },
    create: (body) => rec('/applicants', { method: 'POST', body }),
    update: (id, body) => rec(`/applicants/${id}`, { method: 'PATCH', body }),
    sendInterviewInvite: (id, body) => rec(`/applicants/${id}/send-interview-invite`, { method: 'POST', body }),
    sendRegret: (id) => rec(`/applicants/${id}/send-regret`, { method: 'POST' }),
  },
  interviewQuestions: {
    list: (vacancyId) => rec(`/interview-questions${vacancyId ? `?vacancy_id=${encodeURIComponent(vacancyId)}` : ''}`),
    create: (body) => rec('/interview-questions', { method: 'POST', body }),
    update: (id, body) => rec(`/interview-questions/${id}`, { method: 'PATCH', body }),
    delete: (id) => rec(`/interview-questions/${id}`, { method: 'DELETE' }),
  },
  myIntendedQuestions: {
    list: () => rec('/my-intended-questions'),
    add: (questionId) => rec('/my-intended-questions', { method: 'POST', body: { question_id: questionId } }),
    remove: (questionId) => rec(`/my-intended-questions/${questionId}`, { method: 'DELETE' }),
  },
  panelSessions: {
    list: (params) => rec(`/panel-sessions${new URLSearchParams(params).toString() ? `?${new URLSearchParams(params)}` : ''}`),
    create: (body) => rec('/panel-sessions', { method: 'POST', body }),
    update: (id, body) => rec(`/panel-sessions/${id}`, { method: 'PATCH', body }),
    getScores: (id) => rec(`/panel-sessions/${id}/scores`),
    saveScore: (sessionId, body) => rec(`/panel-sessions/${sessionId}/scores`, { method: 'POST', body }),
  },
  results: {
    list: (vacancyId) => rec(`/results${vacancyId ? `?vacancy_id=${encodeURIComponent(vacancyId)}` : ''}`),
  },
  appointments: {
    list: (vacancyId) => rec(`/appointments${vacancyId ? `?vacancy_id=${encodeURIComponent(vacancyId)}` : ''}`),
    create: (body) => rec('/appointments', { method: 'POST', body }),
    update: (id, body) => rec(`/appointments/${id}`, { method: 'PATCH', body }),
    sendCongratulations: (id) => rec(`/appointments/${id}/send-congratulations`, { method: 'POST' }),
    sendRegret: (id) => rec(`/appointments/${id}/send-regret`, { method: 'POST' }),
  },
  invites: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return rec(`/invites${q ? `?${q}` : ''}`);
    },
    create: (body) => rec('/invites', { method: 'POST', body }),
  },
  externalApplications: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return rec(`/external-applications${q ? `?${q}` : ''}`);
    },
    get: (id) => rec(`/external-applications/${id}`),
    update: (id, body) => rec(`/external-applications/${id}`, { method: 'PATCH', body }),
    score: (id) => rec(`/external-applications/${id}/score`, { method: 'POST' }),
    acceptToScreening: (id) => rec(`/external-applications/${id}/accept-to-screening`, { method: 'POST' }),
    downloadUrl: (id, field) => `${API}/recruitment/external-applications/${id}/download/${field}`,
  },
  myTabs: () => rec('/my-tabs'),
  tabPermissions: {
    list: () => rec('/tab-permissions'),
    grant: (body) => rec('/tab-permissions', { method: 'POST', body }),
    revoke: (params) => rec(`/tab-permissions?${new URLSearchParams(params)}`, { method: 'DELETE' }),
  },
  panelMembers: {
    list: () => rec('/panel-members'),
    options: () => rec('/panel-members/options'),
    add: (body) => rec('/panel-members', { method: 'POST', body }),
    remove: (userId) => rec(`/panel-members/${userId}`, { method: 'DELETE' }),
  },
  panelAddQuestion: (body) => rec('/panel/add-question', { method: 'POST', body }),
};

export const tasks = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/tasks${q ? `?${q}` : ''}`);
  },
  get: (id) => request(`/tasks/${id}`),
  create: (body) => request('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  assign: (id, body) => request(`/tasks/${id}/assign`, { method: 'POST', body: JSON.stringify(body) }),
  addProgressUpdate: (id, body) => request(`/tasks/${id}/progress-updates`, { method: 'POST', body: JSON.stringify(body) }),
  addComment: (id, body) => request(`/tasks/${id}/comments`, { method: 'POST', body: JSON.stringify(body) }),
  addCommentAttachments: (taskId, commentId, files) => {
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append('files', file));
    return fetch(`${API}/tasks/${taskId}/comments/${commentId}/attachments`, { method: 'POST', body: formData, credentials: 'include' })
      .then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText)))));
  },
  commentAttachmentDownloadUrl: (taskId, commentId, attachmentId) =>
    `${API}/tasks/${taskId}/comments/${commentId}/attachments/${attachmentId}/download`,
  addReminder: (id, body) => request(`/tasks/${id}/reminders`, { method: 'POST', body: JSON.stringify(body) }),
  dismissReminder: (taskId, reminderId) => request(`/tasks/${taskId}/reminders/${reminderId}/dismiss`, { method: 'PATCH' }),
  uploadAttachment: (id, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${API}/tasks/${id}/attachments`, { method: 'POST', body: formData, credentials: 'include' })
      .then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText)))));
  },
  attachmentDownloadUrl: (id, attachmentId) => `${API}/tasks/${id}/attachments/${attachmentId}/download`,
  tenantUsers: () => request('/tasks/users/tenant'),
  library: {
    folders: {
      list: () => request('/tasks/library/folders'),
      create: (body) => request('/tasks/library/folders', { method: 'POST', body: JSON.stringify(body) }),
    },
    files: {
      list: (folderId) => request(`/tasks/library/files${folderId != null && folderId !== '' ? `?folder_id=${encodeURIComponent(folderId)}` : '?folder_id='}`),
      upload: (file, folderId) => {
        const formData = new FormData();
        formData.append('file', file);
        if (folderId != null && folderId !== '') formData.append('folder_id', folderId);
        return fetch(`${API}/tasks/library/files`, { method: 'POST', body: formData, credentials: 'include' })
          .then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText)))));
      },
      downloadUrl: (id) => `${API}/tasks/library/files/${id}/download`,
    },
  },
};

const pm = (path, options = {}) => request(`/profile-management${path}`, options);

export const profileManagement = {
  schedules: {
    list: (userId) => pm(`/schedules${userId ? `?user_id=${userId}` : ''}`),
    create: (body) => pm('/schedules', { method: 'POST', body: JSON.stringify(body) }),
    generateBulk: (body) => pm('/schedules/bulk', { method: 'POST', body: JSON.stringify(body) }),
    getEntries: (id) => pm(`/schedules/${id}/entries`),
    addEntries: (id, entries) => pm(`/schedules/${id}/entries`, { method: 'POST', body: JSON.stringify({ entries }) }),
  },
  mySchedule: (params) => {
    const q = new URLSearchParams(params).toString();
    return pm(`/my-schedule${q ? `?${q}` : ''}`);
  },
  leave: {
    balance: (year) => pm(`/leave/balance${year != null ? `?year=${year}` : ''}`),
    applications: () => pm('/leave/applications'),
    create: (body) => pm('/leave/applications', { method: 'POST', body: JSON.stringify(body) }),
    addAttachments: (id, files) => {
      const formData = new FormData();
      Array.from(files).forEach((f) => formData.append('files', f));
      return fetch(`${API}/profile-management/leave/applications/${id}/attachments`, { method: 'POST', body: formData, credentials: 'include' })
        .then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText)))));
    },
    pending: () => pm('/leave/pending'),
    review: (id, body) => pm(`/leave/applications/${id}/review`, { method: 'PATCH', body: JSON.stringify(body) }),
    types: () => pm('/leave/types'),
    createType: (body) => pm('/leave/types', { method: 'POST', body: JSON.stringify(body) }),
    history: () => pm('/leave/applications/history'),
  },
  documents: {
    list: (userId) => pm(`/documents${userId ? `?userId=${userId}` : ''}`),
    upload: (file, category) => {
      const formData = new FormData();
      formData.append('file', file);
      if (category) formData.append('category', category);
      return fetch(`${API}/profile-management/documents`, { method: 'POST', body: formData, credentials: 'include' })
        .then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText)))));
    },
    downloadUrl: (id) => `${API}/profile-management/documents/${id}/download`,
    library: () => pm('/documents/library'),
  },
  warnings: { list: () => pm('/warnings'), listAll: () => pm('/warnings/all'), create: (body) => pm('/warnings', { method: 'POST', body: JSON.stringify(body) }) },
  rewards: { list: () => pm('/rewards'), listAll: () => pm('/rewards/all'), create: (body) => pm('/rewards', { method: 'POST', body: JSON.stringify(body) }) },
  queries: {
    list: () => pm('/queries'),
    create: (body) => pm('/queries', { method: 'POST', body: JSON.stringify(body) }),
    listAll: () => pm('/queries/all'),
    respond: (id, body) => pm(`/queries/${id}/respond`, { method: 'PATCH', body: JSON.stringify(body) }),
  },
  evaluations: {
    list: () => pm('/evaluations'),
    listAll: () => pm('/evaluations/all'),
    create: (body) => pm('/evaluations', { method: 'POST', body: JSON.stringify(body) }),
    controllerList: () => pm('/evaluations/controller-evaluations'),
    controllerGet: (id) => pm(`/evaluations/controller-evaluations/${id}`),
  },
  pip: {
    list: () => pm('/pip'),
    listAll: () => pm('/pip/all'),
    create: (body) => pm('/pip', { method: 'POST', body: JSON.stringify(body) }),
    getProgress: (id) => pm(`/pip/${id}/progress`),
    addProgress: (id, body) => pm(`/pip/${id}/progress`, { method: 'POST', body: JSON.stringify(body) }),
  },
  scheduleEvents: {
    list: (month, year) => pm(`/schedule-events${month != null && year != null ? `?month=${month}&year=${year}` : ''}`),
    create: (body) => pm('/schedule-events', { method: 'POST', body: JSON.stringify(body) }),
  },
  shiftSwaps: {
    colleagueEntries: (userId, month, year) => {
      const q = new URLSearchParams({ user_id: userId, month: String(month), year: String(year) });
      return pm(`/shift-swaps/colleague-entries?${q}`);
    },
    my: (month, year) => {
      const q = new URLSearchParams({ month: String(month), year: String(year) });
      return pm(`/shift-swaps/my?${q}`);
    },
    create: (body) => pm('/shift-swaps', { method: 'POST', body: JSON.stringify(body) }),
    cancel: (id) => pm(`/shift-swaps/${id}/cancel`, { method: 'PATCH', body: JSON.stringify({}) }),
    peerReview: (id, body) => pm(`/shift-swaps/${id}/peer`, { method: 'PATCH', body: JSON.stringify(body) }),
    managementQueue: (status) => pm(`/shift-swaps/management-queue${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    managementReview: (id, body) => pm(`/shift-swaps/${id}/management`, { method: 'PATCH', body: JSON.stringify(body) }),
  },
  tenantUsers: () => pm('/users/tenant'),
};

const to = (path, options = {}) => request(`/transport-operations${path}`, options);

export const transportOperations = {
  tenantUsers: () => to('/tenant-users'),
  trucks: {
    list: () => to('/trucks'),
    create: (body) => to('/trucks', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => to(`/trucks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => to(`/trucks/${id}`, { method: 'DELETE' }),
  },
  drivers: {
    list: () => to('/drivers'),
    create: (body) => to('/drivers', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => to(`/drivers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => to(`/drivers/${id}`, { method: 'DELETE' }),
  },
  routes: {
    list: () => to('/routes'),
    create: (body) => to('/routes', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => to(`/routes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => to(`/routes/${id}`, { method: 'DELETE' }),
  },
  shiftReports: {
    list: (params = {}) => {
      const q = new URLSearchParams();
      if (params.pending_my_approval) q.set('pending_my_approval', '1');
      return to(`/shift-reports${q.toString() ? `?${q.toString()}` : ''}`);
    },
    get: (id) => to(`/shift-reports/${id}`),
    create: (body) => to('/shift-reports', { method: 'POST', body: JSON.stringify(body) }),
    evaluationQuestions: (id) => to(`/shift-reports/${id}/evaluation-questions`),
    getEvaluation: (id) => to(`/shift-reports/${id}/evaluation`),
    submitEvaluation: (id, body) => to(`/shift-reports/${id}/evaluation`, { method: 'POST', body: JSON.stringify(body) }),
    approve: (id) => to(`/shift-reports/${id}/approve`, { method: 'PATCH', body: JSON.stringify({}) }),
  },
  presentations: {
    insights: (params = {}) => {
      const q = new URLSearchParams();
      if (params.dateFrom) q.set('dateFrom', params.dateFrom);
      if (params.dateTo) q.set('dateTo', params.dateTo);
      return to(`/presentations/insights${q.toString() ? `?${q.toString()}` : ''}`);
    },
    recommendations: (params = {}) => {
      const q = new URLSearchParams();
      if (params.status) q.set('status', params.status);
      return to(`/presentations/recommendations${q.toString() ? `?${q.toString()}` : ''}`);
    },
    createRecommendation: (body) => to('/presentations/recommendations', { method: 'POST', body: JSON.stringify(body) }),
    updateRecommendation: (id, body) => to(`/presentations/recommendations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    saveRecommendationsFromInsights: (recommendations) => to('/presentations/insights/save-recommendations', { method: 'POST', body: JSON.stringify({ recommendations }) }),
    pptxDownloadUrl: (params = {}) => {
      const q = new URLSearchParams();
      if (params.dateFrom) q.set('dateFrom', params.dateFrom);
      if (params.dateTo) q.set('dateTo', params.dateTo);
      if (params.shift) q.set('shift', params.shift);
      return `${getApiBase()}/transport-operations/presentations/pptx${q.toString() ? `?${q.toString()}` : ''}`;
    },
  },
};

const acc = (path, options = {}) => request(`/accounting${path}`, options);

export const accounting = {
  companySettings: {
    get: () => acc('/company-settings'),
    update: (body) => acc('/company-settings', { method: 'PATCH', body: JSON.stringify(body) }),
    uploadLogo: (file) => {
      const formData = new FormData();
      formData.append('logo', file);
      return fetch(`${API}/accounting/company-settings/logo`, { method: 'POST', body: formData, credentials: 'include' })
        .then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText)))));
    },
    logoUrl: () => `${API}/accounting/company-settings/logo`,
  },
  library: {
    list: () => acc('/library'),
    upload: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return fetch(`${API}/accounting/library`, { method: 'POST', body: formData, credentials: 'include' })
        .then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText)))));
    },
    viewUrl: (filename) => `${API}/accounting/library/${encodeURIComponent(filename)}`,
  },
  customers: {
    list: () => acc('/customers'),
    get: (id) => acc(`/customers/${id}`),
    create: (body) => acc('/customers', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => acc(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => acc(`/customers/${id}`, { method: 'DELETE' }),
  },
  suppliers: {
    list: () => acc('/suppliers'),
    get: (id) => acc(`/suppliers/${id}`),
    create: (body) => acc('/suppliers', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => acc(`/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => acc(`/suppliers/${id}`, { method: 'DELETE' }),
  },
  items: {
    list: () => acc('/items'),
    get: (id) => acc(`/items/${id}`),
    create: (body) => acc('/items', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => acc(`/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => acc(`/items/${id}`, { method: 'DELETE' }),
  },
  quotations: {
    list: () => acc('/quotations'),
    get: (id) => acc(`/quotations/${id}`),
    create: (body) => acc('/quotations', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => acc(`/quotations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => acc(`/quotations/${id}`, { method: 'DELETE' }),
    recipients: () => acc('/quotations/recipients'),
    pdfUrl: (id) => `${API}/accounting/quotations/${id}/pdf`,
    sendEmail: (id, body) => acc(`/quotations/${id}/send-email`, { method: 'POST', body: JSON.stringify(body) }),
    createInvoice: (id) => acc(`/quotations/${id}/create-invoice`, { method: 'POST' }),
  },
  invoices: {
    list: () => acc('/invoices'),
    get: (id) => acc(`/invoices/${id}`),
    create: (body) => acc('/invoices', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => acc(`/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    markPaid: (id, body) => acc(`/invoices/${id}/mark-paid`, { method: 'POST', body: JSON.stringify(body) }),
    delete: (id) => acc(`/invoices/${id}`, { method: 'DELETE' }),
    recipients: () => acc('/invoices/recipients'),
    pdfUrl: (id) => `${API}/accounting/invoices/${id}/pdf`,
    sendEmail: (id, body) => acc(`/invoices/${id}/send-email`, { method: 'POST', body: JSON.stringify(body) }),
  },
  purchaseOrders: {
    list: () => acc('/purchase-orders'),
    get: (id) => acc(`/purchase-orders/${id}`),
    create: (body) => acc('/purchase-orders', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => acc(`/purchase-orders/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => acc(`/purchase-orders/${id}`, { method: 'DELETE' }),
    recipients: () => acc('/purchase-orders/recipients'),
    pdfUrl: (id) => `${API}/accounting/purchase-orders/${id}/pdf`,
    sendEmail: (id, body) => acc(`/purchase-orders/${id}/send-email`, { method: 'POST', body: JSON.stringify(body) }),
  },
  statements: {
    list: () => acc('/statements'),
    get: (id) => acc(`/statements/${id}`),
    create: (body) => acc('/statements', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => acc(`/statements/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => acc(`/statements/${id}`, { method: 'DELETE' }),
    recipients: () => acc('/statements/recipients'),
    pdfUrl: (id) => `${API}/accounting/statements/${id}/pdf`,
    excelUrl: (id) => `${API}/accounting/statements/${id}/excel`,
    sendEmail: (id, body) => acc(`/statements/${id}/send-email`, { method: 'POST', body: JSON.stringify(body) }),
    importInvoices: (id, body) => acc(`/statements/${id}/import-invoices`, { method: 'POST', body: JSON.stringify(body) }),
    previewCustomerInvoices: (params) => {
      const q = new URLSearchParams(
        Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v != null && v !== ''))
      ).toString();
      return acc(`/statements/preview/customer-invoices?${q}`);
    },
  },
  documentation: {
    list: (params = {}) => {
      const q = new URLSearchParams(
        Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v != null && v !== ''))
      ).toString();
      return acc(`/documentation${q ? `?${q}` : ''}`);
    },
    recipients: () => acc('/documentation/recipients'),
    get: (id) => acc(`/documentation/${id}`),
    create: (body) => acc('/documentation', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => acc(`/documentation/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => acc(`/documentation/${id}`, { method: 'DELETE' }),
    pdfUrl: (id) => `${API}/accounting/documentation/${id}/pdf`,
    pdfDownloadUrl: (id) => `${API}/accounting/documentation/${id}/pdf-download`,
    wordTemplateDownloadUrl: (id) => `${API}/accounting/documentation/${id}/word-template-download`,
    sendEmail: (id, body) => acc(`/documentation/${id}/send-email`, { method: 'POST', body: JSON.stringify(body) }),
    versions: (id) => acc(`/documentation/${id}/versions`),
    getVersion: (id, versionId) => acc(`/documentation/${id}/versions/${versionId}`),
    restoreVersion: (id, versionId) => acc(`/documentation/${id}/restore-version/${versionId}`, { method: 'POST' }),
    uploadFigure: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return fetch(`${API}/accounting/documentation/figures/upload`, { method: 'POST', body: formData, credentials: 'include' })
        .then((res) => res.json().then((data) => (res.ok ? data : Promise.reject(new Error(data.error || res.statusText)))));
    },
  },
};

function trk(path, options = {}) {
  return request(`/tracking${path}`, options);
}

/** Tracking & integration — fleet providers, weighbridges, live trips, alarms. */
export const tracking = {
  dashboard: () => trk('/dashboard'),
  /** Moves MOCK-* trips only; use with Live mode after db:tracking-mock */
  demo: {
    tick: () => trk('/demo/tick', { method: 'POST' }),
  },
  /** Fleet trucks from Contractor page (same tenant). */
  contractorTrucks: {
    list: () => trk('/contractor-trucks'),
  },
  providers: {
    list: () => trk('/providers'),
    create: (body) => trk('/providers', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => trk(`/providers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => trk(`/providers/${id}`, { method: 'DELETE' }),
  },
  vehicles: {
    list: () => trk('/vehicles'),
    create: (body) => trk('/vehicles', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => trk(`/vehicles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => trk(`/vehicles/${id}`, { method: 'DELETE' }),
  },
  weighbridges: {
    list: () => trk('/weighbridges'),
    create: (body) => trk('/weighbridges', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => trk(`/weighbridges/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => trk(`/weighbridges/${id}`, { method: 'DELETE' }),
  },
  routes: {
    list: () => trk('/routes'),
    create: (body) => trk('/routes', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => trk(`/routes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => trk(`/routes/${id}`, { method: 'DELETE' }),
  },
  geofences: {
    list: () => trk('/geofences'),
    create: (body) => trk('/geofences', { method: 'POST', body: JSON.stringify(body) }),
    delete: (id) => trk(`/geofences/${id}`, { method: 'DELETE' }),
  },
  settings: {
    get: () => trk('/settings'),
    update: (body) => trk('/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  },
  trips: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return trk(`/trips${q ? `?${q}` : ''}`);
    },
    create: (body) => trk('/trips', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => trk(`/trips/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    activateDelivery: (id) => trk(`/trips/${id}/activate-delivery`, { method: 'POST' }),
    telemetry: (id, body) => trk(`/trips/${id}/telemetry`, { method: 'POST', body: JSON.stringify(body) }),
    complete: (id, body) => trk(`/trips/${id}/complete`, { method: 'POST', body: JSON.stringify(body) }),
    deviation: (id, body) => trk(`/trips/${id}/deviation`, { method: 'POST', body: JSON.stringify(body) }),
  },
  deliveries: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return trk(`/deliveries${q ? `?${q}` : ''}`);
    },
  },
  alarms: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return trk(`/alarms${q ? `?${q}` : ''}`);
    },
    acknowledge: (id) => trk(`/alarms/${id}/ack`, { method: 'PATCH' }),
  },
};
