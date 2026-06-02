import { useState, useEffect, useCallback } from 'react';
import { teamGoals, profileManagement as pm } from '../api';
import InfoHint from './InfoHint.jsx';

function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString();
  } catch {
    return String(d);
  }
}

/** Wallet summary + issue credit/demerit to roster members + review member applications */
export function TeamLeaderCreditWalletBar({ workDate, onError, onRefresh }) {
  const [wallet, setWallet] = useState(null);
  const [creditCats, setCreditCats] = useState([]);
  const [demeritCats, setDemeritCats] = useState([]);

  const load = useCallback(() => {
    teamGoals
      .leaderCreditWallet(workDate)
      .then(setWallet)
      .catch((e) => onError?.(e?.message || 'Could not load credit wallet'));
    pm.creditDemeritCategories.list('credit').then((d) => setCreditCats(d.categories || [])).catch(() => {});
    pm.creditDemeritCategories.list('demerit').then((d) => setDemeritCats(d.categories || [])).catch(() => {});
  }, [workDate, onError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    onRefresh?.(load);
  }, [onRefresh, load]);

  if (!wallet) return null;

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-2 dark:border-indigo-900/50 dark:bg-indigo-950/20">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">Team leader credits</p>
        <InfoHint
          title="Your credit budget"
          bullets={[
            'Complete 6 daily pulses in a week to receive 10 credits for that week (once per week).',
            'Grant credits to roster members using a category — not to yourself.',
            'When you grant a member credit, you receive 15 grace credits on your own record.',
            'Demerits use your team’s sanction pool (allocated by management).',
          ]}
        />
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          Available: <strong className="tabular-nums">{wallet.available_credits ?? 0}</strong> pts
        </span>
        <span>
          Pulses this week: <strong className="tabular-nums">{wallet.pulse_count_this_week ?? 0}</strong> / {wallet.pulses_required_for_weekly_grant ?? 6}
        </span>
        {(wallet.teams || []).map((t) => (
          <span key={t.team_key} className="text-surface-600 dark:text-surface-400">
            {t.team_name}: pool {t.grace_points_balance ?? 0} · sanctions {t.sanction_points_balance ?? 0}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TeamLeaderIssueCreditsOnPulse({ workDate, roster, teamKey, onError, onDone }) {
  const [wallet, setWallet] = useState(null);
  const [creditCats, setCreditCats] = useState([]);
  const [demeritCats, setDemeritCats] = useState([]);
  const [targetUser, setTargetUser] = useState('');
  const [kind, setKind] = useState('credit');
  const [categoryId, setCategoryId] = useState('');
  const [points, setPoints] = useState(1);
  const [justification, setJustification] = useState('');
  const [saving, setSaving] = useState(false);

  const loadWallet = useCallback(() => {
    teamGoals.leaderCreditWallet(workDate).then(setWallet).catch(() => setWallet(null));
  }, [workDate]);

  useEffect(() => {
    loadWallet();
    pm.creditDemeritCategories.list('credit').then((d) => setCreditCats(d.categories || []));
    pm.creditDemeritCategories.list('demerit').then((d) => setDemeritCats(d.categories || []));
  }, [loadWallet]);

  const rosterWithIds = (roster || []).filter((m) => m.id || m.user_id);

  const submit = async (e) => {
    e.preventDefault();
    if (!targetUser || !categoryId || !justification.trim()) {
      onError?.('Select member, category, and justification');
      return;
    }
    setSaving(true);
    onError?.('');
    try {
      const body = {
        user_id: targetUser,
        category_id: categoryId,
        points: Number(points) || 1,
        justification: justification.trim(),
        team_key: teamKey || wallet?.teams?.[0]?.team_key,
      };
      if (kind === 'credit') {
        await teamGoals.issueMemberCredit(body);
      } else {
        await teamGoals.issueMemberDemerit(body);
      }
      setJustification('');
      setTargetUser('');
      loadWallet();
      onDone?.();
    } catch (err) {
      onError?.(err?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const cats = kind === 'credit' ? creditCats : demeritCats;

  return (
    <div className="rounded-xl border border-surface-200 p-4 space-y-3 dark:border-surface-700">
      <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">Grant credits or demerits (daily pulse)</p>
      {wallet && (
        <p className="text-xs text-surface-500">
          Your wallet: {wallet.available_credits ?? 0} pts · Pulses this week: {wallet.pulse_count_this_week ?? 0}/6
        </p>
      )}
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Team member</label>
          <select
            value={targetUser}
            onChange={(e) => setTargetUser(e.target.value)}
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            required
          >
            <option value="">— Select —</option>
            {rosterWithIds.map((m) => {
              const id = m.id || m.user_id;
              return (
                <option key={id} value={id}>
                  {m.full_name || m.email || id}
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Type</label>
          <select value={kind} onChange={(e) => { setKind(e.target.value); setCategoryId(''); }} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm">
            <option value="credit">Grace credit</option>
            <option value="demerit">Debtor sanction</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Category (required)</label>
          <select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              const c = cats.find((x) => x.id === e.target.value);
              if (c) setPoints(c.default_points || 1);
            }}
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
            required
          >
            <option value="">— Select category —</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.default_points} pts)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Points</label>
          <input
            type="number"
            min={1}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm max-w-[120px]"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-surface-600 mb-1">Justification (required)</label>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={2}
            required
            className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className={`px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 ${
              kind === 'credit' ? 'bg-emerald-600' : 'bg-red-600'
            }`}
          >
            {saving ? 'Saving…' : kind === 'credit' ? 'Grant grace credit' : 'Record demerit'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function TeamLeaderMemberCreditRequests({ onError }) {
  const [applications, setApplications] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [reviewId, setReviewId] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    teamGoals
      .memberCreditApplications(filter === 'all' ? {} : { status: filter })
      .then((d) => setApplications(d.applications || []))
      .catch((e) => onError?.(e?.message || 'Failed to load'));
  }, [filter, onError]);

  useEffect(() => {
    load();
  }, [load]);

  const review = async (status) => {
    if (!reviewId) return;
    setSaving(true);
    try {
      await teamGoals.reviewMemberCreditApplication(reviewId, { status, review_notes: reviewNotes.trim() || undefined });
      setReviewId(null);
      setReviewNotes('');
      load();
    } catch (e) {
      onError?.(e?.message || 'Review failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Members credit requests</h2>
        <InfoHint
          title="Member applications"
          text="Employees request grace credits from Profile. Applications route to you automatically when you are their team leader on shift objectives. Approve using your wallet and team pool; you receive a 15-point leader bonus when approving or granting member credits."
        />
      </div>
      <div className="flex gap-2">
        {['pending', 'approved', 'rejected', 'all'].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize ${filter === f ? 'bg-brand-600 text-white' : 'bg-surface-100'}`}
          >
            {f}
          </button>
        ))}
      </div>
      {applications.length === 0 ? (
        <p className="text-sm text-surface-500">No applications in this view.</p>
      ) : (
        <div className="space-y-3">
          {applications.map((a) => (
            <div key={a.id} className="app-glass-card p-4">
              <p className="font-medium">{a.user_name || a.user_email}</p>
              <p className="text-sm text-surface-600">
                {a.requested_points} pts · {a.category_name || '—'}
              </p>
              <p className="text-sm mt-1">{a.justification}</p>
              <p className="text-xs text-surface-400 mt-1">{formatDate(a.created_at)} · {a.status}</p>
              {a.status === 'pending' && (
                <div className="mt-3 border-t pt-3">
                  {reviewId === a.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={reviewNotes}
                        onChange={(e) => setReviewNotes(e.target.value)}
                        placeholder="Notes (optional)"
                        rows={2}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                      />
                      <div className="flex gap-2">
                        <button type="button" disabled={saving} onClick={() => review('approved')} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm">
                          Approve
                        </button>
                        <button type="button" disabled={saving} onClick={() => review('rejected')} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm">
                          Reject
                        </button>
                        <button type="button" onClick={() => setReviewId(null)} className="text-sm">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setReviewId(a.id)} className="text-sm font-medium text-brand-600">
                      Review
                    </button>
                  )}
                </div>
              )}
              {a.status !== 'pending' && a.review_notes && (
                <p className="text-xs text-surface-500 mt-2">Notes: {a.review_notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
