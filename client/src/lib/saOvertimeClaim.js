/**
 * South Africa BCEA — overtime claim calculation (client).
 */
export const BCEA_OT = {
  WEEKDAY_OT_MULTIPLIER: 1.5,
  SUNDAY_MULTIPLIER: 2.0,
  PUBLIC_HOLIDAY_MULTIPLIER: 2.0,
  MAX_OT_HOURS_PER_DAY: 3,
  MAX_OT_HOURS_PER_WEEK: 10,
  STANDARD_WEEKLY_HOURS: 45,
  MONTHLY_HOURS_DIVISOR: 173.33,
};

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : 0;
}

export function hourlyRateFromMonthlySalary(monthlySalary) {
  const m = n(monthlySalary);
  if (m <= 0) return null;
  return Math.round((m / BCEA_OT.MONTHLY_HOURS_DIVISOR) * 100) / 100;
}

export function calculateSaOvertimeClaim(input) {
  const rate = n(input.ordinaryHourlyRate);
  const weekday = n(input.weekdayHours);
  const sunday = n(input.sundayHours);
  const publicHoliday = n(input.publicHolidayHours);
  const warnings = [];

  if (rate <= 0) {
    return { total: 0, lines: [], warnings: ['Enter your ordinary hourly wage (or derive it from monthly salary).'] };
  }
  const totalHours = weekday + sunday + publicHoliday;
  if (totalHours <= 0) {
    return { total: 0, lines: [], warnings: ['Enter at least one overtime hour.'] };
  }
  if (weekday > BCEA_OT.MAX_OT_HOURS_PER_DAY) {
    warnings.push(
      `Weekday overtime exceeds ${BCEA_OT.MAX_OT_HOURS_PER_DAY}h per day — confirm a written agreement exists (BCEA s10).`
    );
  }
  if (totalHours > BCEA_OT.MAX_OT_HOURS_PER_WEEK) {
    warnings.push(
      `Total overtime hours exceed ${BCEA_OT.MAX_OT_HOURS_PER_WEEK}h per week — confirm compliance with BCEA limits.`
    );
  }

  const lines = [];
  if (weekday > 0) {
    lines.push({
      label: 'Weekday overtime',
      hours: weekday,
      rate,
      multiplier: BCEA_OT.WEEKDAY_OT_MULTIPLIER,
      subtotal: Math.round(weekday * rate * BCEA_OT.WEEKDAY_OT_MULTIPLIER * 100) / 100,
    });
  }
  if (sunday > 0) {
    lines.push({
      label: 'Sunday work',
      hours: sunday,
      rate,
      multiplier: BCEA_OT.SUNDAY_MULTIPLIER,
      subtotal: Math.round(sunday * rate * BCEA_OT.SUNDAY_MULTIPLIER * 100) / 100,
    });
  }
  if (publicHoliday > 0) {
    lines.push({
      label: 'Public holiday work',
      hours: publicHoliday,
      rate,
      multiplier: BCEA_OT.PUBLIC_HOLIDAY_MULTIPLIER,
      subtotal: Math.round(publicHoliday * rate * BCEA_OT.PUBLIC_HOLIDAY_MULTIPLIER * 100) / 100,
    });
  }

  const total = Math.round(lines.reduce((s, l) => s + l.subtotal, 0) * 100) / 100;
  return { total, lines, warnings };
}

export function formatOvertimeBreakdownText(calc) {
  if (!calc?.lines?.length) return '';
  return calc.lines
    .map(
      (l) =>
        `${l.label}: ${l.hours}h × R${l.rate.toFixed(2)} × ${l.multiplier} = R${l.subtotal.toFixed(2)}`
    )
    .join('\n');
}
