import { useCallback, useEffect, useState } from 'react';
import { tracking as trackingApi } from '../../api';

function RegulationForm({ title, initial, onSave, onAiSuggest, aiBusy, saving }) {
  const [price, setPrice] = useState(initial?.fuel_price_per_litre ?? '');
  const [l100, setL100] = useState(initial?.fuel_litres_per_100km ?? '');
  const [l100Empty, setL100Empty] = useState(initial?.fuel_litres_per_100km_empty ?? '');
  const [emptyFactor, setEmptyFactor] = useState(initial?.return_empty_consumption_factor ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  useEffect(() => {
    setPrice(initial?.fuel_price_per_litre ?? '');
    setL100(initial?.fuel_litres_per_100km ?? '');
    setL100Empty(initial?.fuel_litres_per_100km_empty ?? '');
    setEmptyFactor(initial?.return_empty_consumption_factor ?? '');
    setNotes(initial?.notes ?? '');
  }, [initial]);

  const submit = (e) => {
    e.preventDefault();
    onSave({
      fuel_price_per_litre: Number(price),
      fuel_litres_per_100km: l100 !== '' ? Number(l100) : null,
      fuel_litres_per_100km_empty: l100Empty !== '' ? Number(l100Empty) : null,
      return_empty_consumption_factor: emptyFactor !== '' ? Number(emptyFactor) : null,
      notes: notes || null,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm block">
          <span className="text-xs text-surface-500 block mb-1">Fuel price per litre (R)</span>
          <input type="number" min="0" step="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" />
        </label>
        <label className="text-sm block">
          <span className="text-xs text-surface-500 block mb-1">Loaded consumption (L/100 km)</span>
          <input type="number" min="0" step="0.1" value={l100} onChange={(e) => setL100(e.target.value)} placeholder="Uses truck / route default if blank" className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" />
        </label>
        <label className="text-sm block sm:col-span-2">
          <span className="text-xs text-surface-500 block mb-1">Empty return to logistics field (L/100 km)</span>
          <input type="number" min="0" step="0.1" value={l100Empty} onChange={(e) => setL100Empty(e.target.value)} placeholder="Leave blank to derive from loaded rate × factor below" className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" />
        </label>
        <label className="text-sm block">
          <span className="text-xs text-surface-500 block mb-1">Empty return factor (× loaded)</span>
          <input type="number" min="0" max="1.5" step="0.01" value={emptyFactor} onChange={(e) => setEmptyFactor(e.target.value)} placeholder="Default 0.75 if blank" className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" />
        </label>
      </div>
      <p className="text-xs text-surface-500">Empty return is calculated when offloading completes (destination → loading point). Snapshotted per delivery — later changes apply only to new deliveries.</p>
      <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="w-full rounded-lg border px-3 py-2 text-sm dark:border-surface-700 dark:bg-surface-950" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        {onAiSuggest && (
          <button type="button" disabled={aiBusy} onClick={onAiSuggest} className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50">
            {aiBusy ? 'AI thinking…' : 'AI suggest'}
          </button>
        )}
      </div>
    </form>
  );
}

export default function FuelRegulationTab({ setError }) {
  const [data, setData] = useState({ default_regulation: null, trucks: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(null);
  const [editTruckId, setEditTruckId] = useState(null);
  const [aiHint, setAiHint] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await trackingApi.fuelRegulation.list();
      setData(r);
    } catch (e) {
      setError(e?.message || 'Failed to load fuel regulation');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    load();
  }, [load]);

  const saveDefault = async (body) => {
    setSaving(true);
    try {
      const r = await trackingApi.fuelRegulation.saveDefault(body);
      setData(r);
    } catch (e) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveTruck = async (truckId, body) => {
    setSaving(true);
    try {
      const r = await trackingApi.fuelRegulation.saveTruck(truckId, body);
      setData(r);
      setEditTruckId(null);
    } catch (e) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const runAi = async (contractorTruckId) => {
    setAiBusy(contractorTruckId || 'default');
    setAiHint('');
    try {
      const r = await trackingApi.fuelRegulation.aiSuggest({ contractor_truck_id: contractorTruckId || undefined });
      if (!r.ai_configured) {
        setAiHint(r.message || 'AI not configured — set OPENAI_API_KEY on the server.');
        return;
      }
      if (r.suggestion) {
        setAiHint(r.suggestion.summary || 'AI suggestion ready — review price and consumption below.');
        if (contractorTruckId) {
          setEditTruckId(contractorTruckId);
        }
        const patch = {
          fuel_price_per_litre: r.suggestion.fuel_price_per_litre,
          fuel_litres_per_100km: r.suggestion.fuel_litres_per_100km,
          fuel_litres_per_100km_empty: r.suggestion.fuel_litres_per_100km_empty,
          return_empty_consumption_factor: r.suggestion.return_empty_consumption_factor,
        };
        if (contractorTruckId) await saveTruck(contractorTruckId, patch);
        else await saveDefault(patch);
      } else {
        setAiHint(r.raw || 'Could not parse AI response.');
      }
    } catch (e) {
      setError(e?.message || 'AI suggestion failed');
    } finally {
      setAiBusy(null);
    }
  };

  if (loading) return <p className="text-sm text-surface-500">Loading fuel regulation…</p>;

  const editTruck = data.trucks.find((t) => t.contractor_truck_id === editTruckId);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">Fuel regulation per truck</h1>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 max-w-3xl">
          Set fuel price per litre and optional consumption overrides. Completed deliveries snapshot these values at completion — later changes apply only to new deliveries.
        </p>
      </header>

      {aiHint && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 dark:bg-brand-950/20 px-4 py-3 text-sm text-brand-900 dark:text-brand-100">
          {aiHint}
        </div>
      )}

      <section className="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
        <RegulationForm
          title="Default for all trucks"
          initial={data.default_regulation}
          onSave={saveDefault}
          onAiSuggest={() => runAi(null)}
          aiBusy={aiBusy === 'default'}
          saving={saving}
        />
      </section>

      {editTruck && (
        <section className="rounded-xl border border-brand-300 dark:border-brand-800 bg-white dark:bg-surface-900 p-5">
          <RegulationForm
            title={`Override — ${editTruck.registration}`}
            initial={editTruck.regulation || {
              fuel_price_per_litre: data.default_regulation?.fuel_price_per_litre,
              fuel_litres_per_100km: editTruck.fuel_consumption_litres_per_100km,
            }}
            onSave={(body) => saveTruck(editTruck.contractor_truck_id, body)}
            onAiSuggest={() => runAi(editTruck.contractor_truck_id)}
            aiBusy={aiBusy === editTruck.contractor_truck_id}
            saving={saving}
          />
          <button type="button" onClick={() => setEditTruckId(null)} className="mt-2 text-xs text-surface-500 hover:underline">Close</button>
        </section>
      )}

      <section className="rounded-xl border border-surface-200 dark:border-surface-800 overflow-hidden">
        <div className="px-4 py-3 border-b text-sm font-semibold bg-surface-50 dark:bg-surface-900">Fleet trucks ({data.trucks.length})</div>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-surface-500 bg-surface-50 dark:bg-surface-900">
            <tr>
              <th className="text-left px-4 py-2">Registration</th>
              <th className="text-left px-4 py-2">Make / model</th>
              <th className="text-left px-4 py-2">Year</th>
              <th className="text-right px-4 py-2">Fleet L/100km</th>
              <th className="text-right px-4 py-2">Reg. price/L</th>
              <th className="text-right px-4 py-2">Reg. L/100km</th>
              <th className="text-right px-4 py-2">Empty L/100km</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.trucks.map((t) => (
              <tr key={t.contractor_truck_id} className="border-t border-surface-100 dark:border-surface-800">
                <td className="px-4 py-2 font-medium">{t.registration}</td>
                <td className="px-4 py-2 text-surface-600">{t.make_model || '—'}</td>
                <td className="px-4 py-2 text-surface-600">{t.year_model || '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{t.fuel_consumption_litres_per_100km ?? '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {t.regulation?.fuel_price_per_litre ?? data.default_regulation?.fuel_price_per_litre ?? '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {t.regulation?.fuel_litres_per_100km ?? '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {t.regulation?.fuel_litres_per_100km_empty
                    ?? (t.regulation?.return_empty_consumption_factor != null
                      ? `${(t.regulation.return_empty_consumption_factor * 100).toFixed(0)}% loaded`
                      : '75% loaded')}
                </td>
                <td className="px-4 py-2 text-right">
                  <button type="button" onClick={() => setEditTruckId(t.contractor_truck_id)} className="text-xs text-brand-600 hover:underline">Regulate</button>
                </td>
              </tr>
            ))}
            {data.trucks.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-surface-500">No contractor trucks found. Add fleet on the Contractor page.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
