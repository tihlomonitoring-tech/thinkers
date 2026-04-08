import { useState, useEffect, useCallback } from 'react';
import { shiftClock } from '../api';
import { getCurrentPosition } from '../lib/geolocation.js';

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

/** Calendar date YYYY-MM-DD in local time (avoids UTC shifting SQL dates). */
function workDateKey(d) {
  if (d == null) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  try {
    const x = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(x.getTime())) return '';
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '';
  }
}

function dateStr(d) {
  return workDateKey(d);
}

function sessionIdOf(s) {
  if (!s) return null;
  return s.id ?? s.Id ?? null;
}

function breakIdOf(b) {
  if (!b) return null;
  return b.id ?? b.Id ?? null;
}

/**
 * Clock-in / breaks / clock-out for a selected calendar day with a shift entry.
 * Uses browser GPS only (no paid APIs). Actions must match clock-in location unless management authorizes.
 */
export default function ShiftClockPanel({ shift, selectedDate, onError }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [otMinutes, setOtMinutes] = useState(0);
  const [locModal, setLocModal] = useState(null);
  const [motivation, setMotivation] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [requestSent, setRequestSent] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    shiftClock
      .myStatus()
      .then((d) => setStatus(d))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load, selectedDate]);

  useEffect(() => {
    if (!locModal) {
      setMotivation('');
      setAuthCode('');
      setRequestSent(false);
    }
  }, [locModal]);

  if (!shift?.entry_id) return null;

  const session = status?.session;
  const breaks = status?.breaks || [];

  const clockOutAt = session && (session.clock_out_at ?? session.Clock_Out_At);
  const sessionStatusLc = String(session?.status ?? session?.Status ?? 'active').toLowerCase();

  /**
   * Active session for the selected calendar day. Must be the session object (not a boolean):
   * `a && b && (x || y)` returns `true` when the last part is boolean true, which broke sessionIdOf().
   */
  const sessionForThisDay =
    session &&
    workDateKey(session.work_date) === selectedDate &&
    !clockOutAt &&
    !['completed', 'cancelled'].includes(sessionStatusLc)
      ? session
      : null;

  const hasOpenElsewhere =
    !!session && !clockOutAt && workDateKey(session.work_date) !== selectedDate;

  const openBreak = sessionForThisDay
    ? breaks.find((b) => !(b.ended_at ?? b.Ended_At ?? b.ended_At))
    : null;

  const withCoords = async (extra = {}) => {
    try {
      const pos = await getCurrentPosition();
      return {
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy_meters: pos.accuracy_meters,
        ...extra,
      };
    } catch (geoErr) {
      const code = geoErr?.code;
      const hint =
        code === 1
          ? 'Location permission denied. Allow location for this site, then try again.'
          : 'Could not read GPS. Check signal, permissions, and try again.';
      throw new Error(hint);
    }
  };

  const clockIn = async () => {
    setBusy(true);
    onError('');
    try {
      const body = await withCoords({
        schedule_entry_id: shift.entry_id,
        work_date: selectedDate,
      });
      await shiftClock.startSession(body);
      load();
    } catch (e) {
      onError(e?.message || 'Could not clock in');
    } finally {
      setBusy(false);
    }
  };

  const clockOut = async (overrideCode) => {
    const sid = sessionIdOf(sessionForThisDay);
    if (!sid) {
      onError('Could not find your active session. Refresh the page or pick the calendar day you clocked in on.');
      return;
    }
    setBusy(true);
    onError('');
    try {
      const body = await withCoords({
        overtime_minutes: Math.min(360, Math.max(0, Number(otMinutes) || 0)),
        ...(overrideCode ? { authorization_code: overrideCode } : {}),
      });
      await shiftClock.clockOut(sid, body);
      setLocModal(null);
      load();
    } catch (e) {
      if (e?.code === 'LOCATION_MISMATCH' && !overrideCode) {
        setLocModal({ action: 'clock_out' });
        onError('');
      } else {
        onError(e?.message || 'Could not clock out');
      }
    } finally {
      setBusy(false);
    }
  };

  const startBreak = async (breakType, overrideCode) => {
    const sid = sessionIdOf(sessionForThisDay);
    if (!sid) {
      onError('No active session for this day.');
      return;
    }
    setBusy(true);
    onError('');
    try {
      const body = await withCoords({
        break_type: breakType,
        ...(overrideCode ? { authorization_code: overrideCode } : {}),
      });
      await shiftClock.startBreak(sid, body);
      setLocModal(null);
      load();
    } catch (e) {
      if (e?.code === 'LOCATION_MISMATCH' && !overrideCode) {
        setLocModal({ action: 'break_start', breakType });
        onError('');
      } else {
        onError(e?.message || 'Could not start break');
      }
    } finally {
      setBusy(false);
    }
  };

  const endBreak = async (breakId, overrideCode) => {
    const sid = sessionIdOf(sessionForThisDay);
    if (!sid || !breakId) {
      if (!sid) onError('No active session for this day.');
      return;
    }
    setBusy(true);
    onError('');
    try {
      const body = await withCoords(
        overrideCode ? { authorization_code: overrideCode } : {}
      );
      await shiftClock.endBreak(sid, breakId, body);
      setLocModal(null);
      load();
    } catch (e) {
      if (e?.code === 'LOCATION_MISMATCH' && !overrideCode) {
        setLocModal({ action: 'break_end', breakId });
        onError('');
      } else {
        onError(e?.message || 'Could not end break');
      }
    } finally {
      setBusy(false);
    }
  };

  const requestAuthEmail = async () => {
    const sid = sessionIdOf(sessionForThisDay);
    if (!sid || !locModal) return;
    const mot = motivation.trim();
    if (mot.length < 10) {
      onError('Enter a motivation (at least 10 characters) for management.');
      return;
    }
    const actionMap = {
      break_start: 'break_start',
      break_end: 'break_end',
      clock_out: 'clock_out',
    };
    const action_type = actionMap[locModal.action];
    if (!action_type) return;
    setBusy(true);
    onError('');
    try {
      await shiftClock.requestLocationAuth(sid, { motivation: mot, action_type });
      setRequestSent(true);
    } catch (e) {
      onError(e?.message || 'Could not send request');
    } finally {
      setBusy(false);
    }
  };

  const cancelDuty = async () => {
    const sid = sessionIdOf(sessionForThisDay);
    if (!sid) {
      onError('No active session to cancel.');
      return;
    }
    const msg =
      'Cancel this clock-in? Your on-duty record and any breaks for this session will be removed. Use this if you clocked in by mistake. You can clock in again afterward. If Command Centre requires a clock-in for today, it will stay locked until you clock in again.';
    if (!window.confirm(msg)) return;
    setBusy(true);
    onError('');
    try {
      await shiftClock.cancelSession(sid);
      setLocModal(null);
      load();
    } catch (e) {
      onError(e?.message || 'Could not cancel clock-in');
    } finally {
      setBusy(false);
    }
  };

  const retryWithCode = async () => {
    const code = authCode.trim();
    if (!code) {
      onError('Enter the code from management.');
      return;
    }
    if (locModal?.action === 'clock_out') await clockOut(code);
    else if (locModal?.action === 'break_start' && locModal.breakType) await startBreak(locModal.breakType, code);
    else if (locModal?.action === 'break_end' && locModal.breakId) await endBreak(locModal.breakId, code);
  };

  const actionLabel =
    locModal?.action === 'clock_out'
      ? 'clock out'
      : locModal?.action === 'break_end'
        ? 'declare back from break'
        : 'start break';

  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900/80 dark:to-slate-950 dark:border-slate-700 p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-700 pb-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white tracking-tight">Shift clock</h3>
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">On duty</span>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
        30-minute rest breaks and one 1-hour major break. Wait at least <strong>2 hours</strong> between breaks. Colleagues may not overlap
        breaks. Maximum <strong>6 hours</strong> overtime claim. Clock out after your shift; Command Centre stays locked until you clock in on
        a scheduled day. <strong>Breaks and clock-out</strong> use your current GPS vs your clock-in point (browser only — no extra services). GPS is
        approximate; request a management code only if you are legitimately away from site (e.g. approved errand), not to bypass normal on-site rules.
      </p>
      {loading ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : (
        <>
          {hasOpenElsewhere && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/40 dark:border-red-900 p-3 text-xs text-red-900 dark:text-red-200">
              You have an active shift clock session on <strong>{dateStr(session.work_date)}</strong>. Clock out from{' '}
              <strong>Profile → Shift activity</strong> (or that day on the calendar) before starting a new shift here.
            </div>
          )}
          {!sessionForThisDay && !hasOpenElsewhere && (
            <button
              type="button"
              disabled={busy}
              onClick={clockIn}
              className="w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 dark:bg-brand-600 dark:hover:bg-brand-500 disabled:opacity-50"
            >
              Clock in — start shift (uses location)
            </button>
          )}
          {sessionForThisDay && (
            <div className="space-y-3 text-xs">
              <div className="flex justify-between text-slate-700 dark:text-slate-300">
                <span>Clocked in</span>
                <span className="font-mono">{fmtTime(session.clock_in_at ?? session.Clock_In_At)}</span>
              </div>
              {openBreak ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50/90 dark:bg-amber-950/40 dark:border-amber-800 p-3 space-y-2">
                  <p className="font-medium text-amber-950 dark:text-amber-100">
                    On break ({openBreak.break_type === 'major_60' ? '1 hour' : '30 min'})
                  </p>
                  <p className="text-amber-900/90 dark:text-amber-200/90">Started {fmtTime(openBreak.started_at)}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => endBreak(breakIdOf(openBreak))}
                    className="w-full py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Declare back from break
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startBreak('minor_30')}
                    className="flex-1 min-w-[120px] py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:text-slate-100 text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                  >
                    Start 30 min break
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startBreak('major_60')}
                    className="flex-1 min-w-[120px] py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:text-slate-100 text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                  >
                    Start 1 h major break
                  </button>
                </div>
              )}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                <label className="block text-slate-600 dark:text-slate-400">
                  Overtime to claim (minutes, max 360)
                  <input
                    type="number"
                    min={0}
                    max={360}
                    value={otMinutes}
                    onChange={(e) => setOtMinutes(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !!openBreak}
                  onClick={() => clockOut()}
                  className="w-full py-2.5 rounded-lg border-2 border-slate-800 dark:border-slate-500 text-slate-900 dark:text-white font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  Clock out
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={cancelDuty}
                  className="w-full py-2 rounded-lg text-xs font-medium text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/80 bg-red-50/80 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 disabled:opacity-50"
                >
                  Cancel clock-in (wrong duty / mistake)
                </button>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                  Cancelling removes this session entirely (including an ongoing break). It does not replace a normal clock-out at end of shift.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {locModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-xl shadow-xl max-w-md w-full p-5 space-y-3">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Location does not match clock-in</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              You are too far from your clock-in point to {actionLabel}. Either move to your work location, or ask management for a one-time
              code (sent by email to users with the Management role). Positions can be off by tens or hundreds of metres—only request a code when
              your absence from the work area is genuine and approved.
            </p>
            <label className="block text-xs text-slate-600 dark:text-slate-400">
              Motivation (required to email management)
              <textarea
                value={motivation}
                onChange={(e) => setMotivation(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-1.5 text-sm"
                placeholder="Brief reason (e.g. official errand, site change approved)…"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={requestAuthEmail}
              className="w-full py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
            >
              Email authorization code to management
            </button>
            {requestSent && (
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                If email is configured, management received a code. Enter it below, then confirm.
              </p>
            )}
            <label className="block text-xs text-slate-600 dark:text-slate-400">
              Authorization code
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                className="mt-1 w-full font-mono rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 px-2 py-1.5 text-sm"
                placeholder="6-digit code"
              />
            </label>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setLocModal(null)}
                className="flex-1 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={retryWithCode}
                className="flex-1 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
              >
                Apply code & retry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
