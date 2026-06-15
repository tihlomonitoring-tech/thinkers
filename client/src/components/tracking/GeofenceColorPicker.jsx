import { GEOFENCE_COLOR_PRESETS } from '../../lib/geofenceStyle.js';

export default function GeofenceColorPicker({ value, onChange, className = '' }) {
  return (
    <div className={className}>
      <label className="text-xs text-surface-500 block mb-1.5">Colour</label>
      <div className="flex flex-wrap items-center gap-2">
        {GEOFENCE_COLOR_PRESETS.map((c) => (
          <button
            key={c.value}
            type="button"
            title={c.label}
            onClick={() => onChange?.(c.value)}
            className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
              value === c.value ? 'border-surface-900 dark:border-white scale-110 ring-2 ring-offset-1 ring-surface-400' : 'border-white shadow-sm'
            }`}
            style={{ backgroundColor: c.value }}
          />
        ))}
        <label className="inline-flex items-center gap-1.5 ml-1 cursor-pointer">
          <input
            type="color"
            value={value || '#2563eb'}
            onChange={(e) => onChange?.(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border border-surface-200 dark:border-surface-700"
          />
          <span className="text-[10px] text-surface-500 font-mono">{value || '#2563eb'}</span>
        </label>
      </div>
    </div>
  );
}
