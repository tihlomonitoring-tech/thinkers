import { useEffect, useState } from 'react';
import { tabAccess as tabAccessApi, users as usersApi } from '../api';

/**
 * Super-admin matrix to grant/revoke per-tab access on a page.
 * @param {boolean} [emptyMeansAll] — when false, users with zero grants see no tabs (strict).
 */
export default function ManagePageTabAccess({
  pageKey,
  pageLabel,
  allTabIds,
  tabLabels,
  permissions,
  setPermissions,
  users,
  setUsers,
  emptyMeansAll = true,
  onError,
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(null);
  const [search, setSearch] = useState('');

  const reportError = (err) => {
    onError?.(err?.message || 'Tab access update failed');
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([tabAccessApi.permissions(pageKey), usersApi.list({ limit: 200 })])
      .then(([permRes, usersRes]) => {
        setPermissions(permRes.permissions || []);
        setUsers(usersRes.users || []);
      })
      .catch(() => setPermissions([]))
      .finally(() => setLoading(false));
  }, [pageKey, setPermissions, setUsers]);

  const handleGrant = (userId, tabId) => {
    setSaving(`${userId}-${tabId}`);
    tabAccessApi
      .grant(pageKey, userId, tabId)
      .then(() => {
        setPermissions((prev) => {
          const existing = prev.find((p) => p.user_id === userId);
          if (existing) {
            return prev.map((p) => (p.user_id === userId ? { ...p, tabs: [...(p.tabs || []), tabId] } : p));
          }
          const u = (users || []).find((x) => x.id === userId);
          return [...prev, { user_id: userId, full_name: u?.full_name || '', email: u?.email || '', tabs: [tabId] }];
        });
      })
      .catch(reportError)
      .finally(() => setSaving(null));
  };

  const handleRevoke = (userId, tabId) => {
    setSaving(`${userId}-${tabId}`);
    tabAccessApi
      .revoke(pageKey, userId, tabId)
      .then(() => {
        setPermissions((prev) =>
          prev.map((p) => (p.user_id === userId ? { ...p, tabs: (p.tabs || []).filter((t) => t !== tabId) } : p))
        );
      })
      .catch(reportError)
      .finally(() => setSaving(null));
  };

  const handleGrantAll = (userId) => {
    setSaving(`${userId}-all`);
    tabAccessApi
      .bulkSet(pageKey, userId, allTabIds)
      .then(() => {
        setPermissions((prev) => {
          const existing = prev.find((p) => p.user_id === userId);
          if (existing) return prev.map((p) => (p.user_id === userId ? { ...p, tabs: [...allTabIds] } : p));
          const u = (users || []).find((x) => x.id === userId);
          return [...prev, { user_id: userId, full_name: u?.full_name || '', email: u?.email || '', tabs: [...allTabIds] }];
        });
      })
      .catch(reportError)
      .finally(() => setSaving(null));
  };

  const handleRevokeAll = (userId) => {
    setSaving(`${userId}-all`);
    tabAccessApi
      .bulkSet(pageKey, userId, [])
      .then(() => {
        setPermissions((prev) => prev.map((p) => (p.user_id === userId ? { ...p, tabs: [] } : p)));
      })
      .catch(reportError)
      .finally(() => setSaving(null));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  const permByUser = (permissions || []).reduce((acc, p) => {
    acc[p.user_id] = p;
    return acc;
  }, {});
  const filtered = search
    ? (users || []).filter(
        (u) =>
          (u.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
          (u.email || '').toLowerCase().includes(search.toLowerCase())
      )
    : users || [];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Manage tab access</h2>
        <p className="text-sm text-surface-500 mt-1">
          Control which tabs each user can see on <strong>{pageLabel}</strong>. Tenant and super admins can manage this.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users…"
          className="border border-surface-300 dark:border-surface-600 rounded-lg px-3 py-2 text-sm w-64 dark:bg-surface-950"
        />
        <span className="text-xs text-surface-500">
          {filtered.length} user{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/50">
                <th className="px-4 py-3 text-left font-medium text-surface-700 dark:text-surface-300 sticky left-0 bg-surface-50 dark:bg-surface-900/50 z-10 min-w-[180px]">
                  User
                </th>
                <th className="px-3 py-3 text-center font-medium text-surface-700 dark:text-surface-300 whitespace-nowrap min-w-[80px]">
                  All
                </th>
                {allTabIds.map((tabId) => (
                  <th
                    key={tabId}
                    className="px-3 py-3 text-center font-medium text-surface-600 dark:text-surface-400 whitespace-nowrap text-xs"
                  >
                    {(tabLabels[tabId] || tabId).length > 16
                      ? `${(tabLabels[tabId] || tabId).slice(0, 14)}…`
                      : tabLabels[tabId] || tabId}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const grants = permByUser[u.id]?.tabs || [];
                const allGranted = allTabIds.every((t) => grants.includes(t));
                return (
                  <tr key={u.id} className="border-b border-surface-100 dark:border-surface-800 hover:bg-surface-50/50 dark:hover:bg-surface-800/30">
                    <td className="px-4 py-2.5 sticky left-0 bg-white dark:bg-surface-900 z-10">
                      <span className="font-medium text-surface-900 dark:text-surface-100 block">{u.full_name || u.email}</span>
                      <span className="text-surface-400 text-xs block">{u.email}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {allGranted ? (
                        <button
                          type="button"
                          onClick={() => handleRevokeAll(u.id)}
                          disabled={saving?.startsWith(u.id)}
                          className="text-[10px] px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                        >
                          Revoke all
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleGrantAll(u.id)}
                          disabled={saving?.startsWith(u.id)}
                          className="text-[10px] px-2 py-1 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-50"
                        >
                          Grant all
                        </button>
                      )}
                    </td>
                    {allTabIds.map((tabId) => {
                      const has = grants.includes(tabId);
                      const key = `${u.id}-${tabId}`;
                      return (
                        <td key={key} className="px-3 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => (has ? handleRevoke(u.id, tabId) : handleGrant(u.id, tabId))}
                            disabled={saving === key || saving === `${u.id}-all`}
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors mx-auto ${
                              has
                                ? 'bg-brand-500 text-white hover:bg-brand-600'
                                : 'bg-surface-100 text-surface-400 hover:bg-surface-200 dark:bg-surface-800'
                            } disabled:opacity-50`}
                            title={has ? `Revoke ${tabLabels[tabId] || tabId}` : `Grant ${tabLabels[tabId] || tabId}`}
                          >
                            {saving === key ? (
                              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            ) : has ? (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <p className="p-6 text-center text-surface-500 text-sm">No users found.</p>}
      </div>

      <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-4">
        <p className="text-xs text-amber-800 dark:text-amber-200">
          {emptyMeansAll ? (
            <>
              <strong>Note:</strong> Users with no specific grants will see all tabs by default. Once you grant at least one tab to a user, they will only see the tabs you have granted. Super admins always have access to all tabs.
            </>
          ) : (
            <>
              <strong>Note:</strong> Users must be granted at least one tab to see anything on Tracking management (they still need the Tracking management page role under User management). Super admins always see all tabs.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
