/** Simple bar comparison: grace credits vs debtor sanctions by month */
export default function GraceCreditsChart({ creditsByMonth = [], sanctionsByMonth = [] }) {
  const months = [...new Set([
    ...creditsByMonth.map((r) => r.ym || r.YM),
    ...sanctionsByMonth.map((r) => r.ym || r.YM),
  ])].sort();
  if (!months.length) {
    return <p className="text-sm text-surface-500">No monthly activity yet — chart appears after credits or sanctions are recorded.</p>;
  }
  const creditMap = Object.fromEntries(creditsByMonth.map((r) => [r.ym || r.YM, Number(r.pts || r.PTS) || 0]));
  const sanctionMap = Object.fromEntries(sanctionsByMonth.map((r) => [r.ym || r.YM, Number(r.pts || r.PTS) || 0]));
  const max = Math.max(
    1,
    ...months.map((m) => Math.max(creditMap[m] || 0, sanctionMap[m] || 0))
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-xs text-surface-600">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500" /> Grace credits</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500" /> Debtor sanctions</span>
      </div>
      <div className="flex items-end gap-2 h-32 overflow-x-auto pb-1">
        {months.map((m) => {
          const c = creditMap[m] || 0;
          const s = sanctionMap[m] || 0;
          return (
            <div key={m} className="flex flex-col items-center gap-1 min-w-[48px] shrink-0">
              <div className="flex items-end gap-0.5 h-24 w-full justify-center">
                <div
                  className="w-3 bg-emerald-500 rounded-t"
                  style={{ height: `${(c / max) * 100}%`, minHeight: c ? 4 : 0 }}
                  title={`Credits: ${c}`}
                />
                <div
                  className="w-3 bg-red-500 rounded-t"
                  style={{ height: `${(s / max) * 100}%`, minHeight: s ? 4 : 0 }}
                  title={`Sanctions: ${s}`}
                />
              </div>
              <span className="text-[10px] text-surface-500 tabular-nums">{m.slice(5)}/{m.slice(2, 4)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
