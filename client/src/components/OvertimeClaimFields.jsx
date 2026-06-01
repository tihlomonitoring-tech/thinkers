import { useMemo } from 'react';
import {
  BCEA_OT,
  calculateSaOvertimeClaim,
  hourlyRateFromMonthlySalary,
} from '../lib/saOvertimeClaim.js';

function fmtZar(v) {
  const n = Number(v);
  return Number.isNaN(n) ? 'R 0.00' : `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Overtime claim section (SA BCEA auto-calc). Mutates form via setForm.
 */
export default function OvertimeClaimFields({ form, setForm }) {
  const calc = useMemo(
    () =>
      calculateSaOvertimeClaim({
        ordinaryHourlyRate: form.hourly_rate,
        weekdayHours: form.ot_weekday_hours,
        sundayHours: form.ot_sunday_hours,
        publicHolidayHours: form.ot_public_holiday_hours,
      }),
    [form.hourly_rate, form.ot_weekday_hours, form.ot_sunday_hours, form.ot_public_holiday_hours]
  );

  const applyMonthlyRate = () => {
    const rate = hourlyRateFromMonthlySalary(form.ot_monthly_salary);
    if (rate != null) setForm((f) => ({ ...f, hourly_rate: String(rate) }));
  };

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50/50 p-4 space-y-4">
      <div>
        <h4 className="text-xs font-semibold text-orange-900 uppercase tracking-wider">Overtime (SA labour)</h4>
        <p className="text-[11px] text-orange-900/80 mt-1 leading-relaxed">
          Auto-calculated per the Basic Conditions of Employment Act: weekday overtime at{' '}
          {BCEA_OT.WEEKDAY_OT_MULTIPLIER}×, Sunday and public holiday work at {BCEA_OT.SUNDAY_MULTIPLIER}× your
          ordinary hourly wage. Normal working time is up to {BCEA_OT.STANDARD_WEEKLY_HOURS} hours per week; overtime
          is typically capped at {BCEA_OT.MAX_OT_HOURS_PER_DAY}h per day and {BCEA_OT.MAX_OT_HOURS_PER_WEEK}h per week
          unless agreed otherwise.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Work period start *</label>
          <input
            type="date"
            required
            value={form.claim_date}
            onChange={(e) => setForm((f) => ({ ...f, claim_date: e.target.value }))}
            className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Work period end</label>
          <input
            type="date"
            value={form.ot_period_end || form.claim_date}
            onChange={(e) => setForm((f) => ({ ...f, ot_period_end: e.target.value }))}
            className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="rounded-lg border border-surface-200 bg-white/80 p-3 space-y-2">
        <p className="text-xs font-medium text-surface-700">Ordinary hourly wage</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-surface-500 mb-1">Monthly salary (optional)</label>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.ot_monthly_salary || ''}
                onChange={(e) => setForm((f) => ({ ...f, ot_monthly_salary: e.target.value }))}
                placeholder="e.g. 25000"
                className="flex-1 border border-surface-300 rounded-lg px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={applyMonthlyRate}
                className="shrink-0 px-3 py-2 text-xs font-medium rounded-lg border border-orange-300 text-orange-800 hover:bg-orange-100"
              >
                Use ÷{BCEA_OT.MONTHLY_HOURS_DIVISOR}
              </button>
            </div>
            <p className="text-[10px] text-surface-500 mt-1">Divides monthly pay by {BCEA_OT.MONTHLY_HOURS_DIVISOR} (≈45h/week).</p>
          </div>
          <div>
            <label className="block text-[11px] text-surface-500 mb-1">Ordinary hourly rate (R) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={form.hourly_rate}
              onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))}
              className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Weekday OT hours</label>
          <input
            type="number"
            step="0.25"
            min="0"
            value={form.ot_weekday_hours}
            onChange={(e) => setForm((f) => ({ ...f, ot_weekday_hours: e.target.value }))}
            className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm"
            placeholder="0"
          />
          <p className="text-[10px] text-surface-500 mt-0.5">× {BCEA_OT.WEEKDAY_OT_MULTIPLIER} ordinary rate</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Sunday hours</label>
          <input
            type="number"
            step="0.25"
            min="0"
            value={form.ot_sunday_hours}
            onChange={(e) => setForm((f) => ({ ...f, ot_sunday_hours: e.target.value }))}
            className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm"
            placeholder="0"
          />
          <p className="text-[10px] text-surface-500 mt-0.5">× {BCEA_OT.SUNDAY_MULTIPLIER} ordinary rate</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-600 mb-1">Public holiday hours</label>
          <input
            type="number"
            step="0.25"
            min="0"
            value={form.ot_public_holiday_hours}
            onChange={(e) => setForm((f) => ({ ...f, ot_public_holiday_hours: e.target.value }))}
            className="w-full border border-surface-300 rounded-lg px-3 py-2 text-sm"
            placeholder="0"
          />
          <p className="text-[10px] text-surface-500 mt-0.5">× {BCEA_OT.PUBLIC_HOLIDAY_MULTIPLIER} ordinary rate</p>
        </div>
      </div>

      {calc.warnings.length > 0 && (
        <ul className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1 list-disc list-inside">
          {calc.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {calc.lines.length > 0 && (
        <div className="rounded-lg border border-orange-300 bg-white p-3">
          <p className="text-xs font-semibold text-surface-800 mb-2">Calculation breakdown</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-surface-500 border-b border-surface-200">
                <th className="text-left py-1 pr-2">Type</th>
                <th className="text-right py-1 px-2">Hours</th>
                <th className="text-right py-1 px-2">Rate</th>
                <th className="text-right py-1 px-2">×</th>
                <th className="text-right py-1 pl-2">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {calc.lines.map((l) => (
                <tr key={l.label} className="border-b border-surface-100">
                  <td className="py-1.5 pr-2">{l.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{l.hours}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtZar(l.rate)}</td>
                  <td className="py-1.5 text-right tabular-nums">{l.multiplier}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">{fmtZar(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="pt-2 text-right font-semibold text-surface-800">
                  Total claim
                </td>
                <td className="pt-2 text-right font-bold text-orange-800 tabular-nums">{fmtZar(calc.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export function OvertimeClaimDetail({ claim, fmtZar }) {
  if (claim?.claim_type !== 'overtime') return null;
  const calc = calculateSaOvertimeClaim({
    ordinaryHourlyRate: claim.hourly_rate,
    weekdayHours: claim.ot_weekday_hours,
    sundayHours: claim.ot_sunday_hours,
    publicHolidayHours: claim.ot_public_holiday_hours,
  });
  const periodEnd = claim.ot_period_end ? String(claim.ot_period_end).slice(0, 10) : null;
  const periodStart = claim.claim_date ? String(claim.claim_date).slice(0, 10) : null;

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50/40 p-4 space-y-2 text-sm">
      <p className="text-xs font-semibold text-orange-900 uppercase">Overtime breakdown (BCEA)</p>
      {periodStart && (
        <p className="text-xs text-surface-600">
          Period: {periodStart}
          {periodEnd && periodEnd !== periodStart ? ` → ${periodEnd}` : ''}
        </p>
      )}
      <p className="text-xs text-surface-600">Ordinary hourly rate: {fmtZar(claim.hourly_rate)}</p>
      {calc.lines.map((l) => (
        <p key={l.label} className="text-xs font-mono text-surface-800">
          {l.label}: {l.hours}h × {fmtZar(l.rate)} × {l.multiplier} = {fmtZar(l.subtotal)}
        </p>
      ))}
    </div>
  );
}
