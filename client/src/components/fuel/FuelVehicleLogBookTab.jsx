import { useState, useEffect, useCallback } from 'react';
import { fuelSupply, openAttachmentWithAuth } from '../../api';
import { inputClass, formatDt, pickRow } from '../../lib/fuelSupplyUi';
import InfoHint from '../InfoHint.jsx';

export default function FuelVehicleLogBookTab({ orders, onError }) {
  const [vehicles, setVehicles] = useState([]);
  const [trips, setTrips] = useState([]);
  const [summary, setSummary] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [selectedTripId, setSelectedTripId] = useState('');
  const [tripDetail, setTripDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  const [vehForm, setVehForm] = useState({ name: '', registration: '', tank_capacity_liters: '', current_liters_estimate: '' });
  const [tripForm, setTripForm] = useState({
    vehicle_id: '',
    diesel_order_id: '',
    driver_name: '',
    driver_employee_number: '',
    start_now: true,
    odometer_start_km: '',
    opening_liters_estimate: '',
    notes: '',
  });
  const [stopForm, setStopForm] = useState({
    place_label: '',
    arrived_at: '',
    departed_at: '',
    odometer_km: '',
    liters_on_gauge: '',
    is_refuel: false,
    refuel_liters: '',
    notes: '',
    gauge_photo: null,
    slip_photo: null,
  });
  const [completeForm, setCompleteForm] = useState({ odometer_end_km: '', closing_liters_estimate: '' });
  const [startForm, setStartForm] = useState({ odometer_start_km: '', opening_liters_estimate: '' });
  const [saving, setSaving] = useState(false);

  const refreshLists = useCallback(() => {
    Promise.all([
      fuelSupply.vehicles(),
      fuelSupply.trips({}),
      fuelSupply.tripsSummary(),
      fuelSupply.analyticsMonthly(6),
    ])
      .then(([v, t, s, a]) => {
        setVehicles(v.vehicles || []);
        setTrips(t.trips || []);
        setSummary(s);
        setAnalytics(a);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  useEffect(() => {
    if (!tripForm.vehicle_id && vehicles.length) {
      const id = pickRow(vehicles[0], 'id', 'Id');
      setTripForm((f) => ({ ...f, vehicle_id: id }));
    }
  }, [vehicles, tripForm.vehicle_id]);

  useEffect(() => {
    if (!selectedTripId) {
      setTripDetail(null);
      return;
    }
    let cancelled = false;
    fuelSupply
      .trip(selectedTripId)
      .then((r) => {
        if (!cancelled) setTripDetail(r);
      })
      .catch(() => {
        if (!cancelled) setTripDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTripId]);

  const createVehicle = (e) => {
    e.preventDefault();
    setSaving(true);
    fuelSupply
      .createVehicle({
        name: vehForm.name,
        registration: vehForm.registration || null,
        tank_capacity_liters: vehForm.tank_capacity_liters === '' ? null : Number(vehForm.tank_capacity_liters),
        current_liters_estimate: vehForm.current_liters_estimate === '' ? 0 : Number(vehForm.current_liters_estimate),
      })
      .then(() => {
        setVehForm({ name: '', registration: '', tank_capacity_liters: '', current_liters_estimate: '' });
        refreshLists();
      })
      .catch((err) => onError(err?.message || 'Could not save vehicle'))
      .finally(() => setSaving(false));
  };

  const createTrip = (e) => {
    e.preventDefault();
    if (!tripForm.vehicle_id) return;
    setSaving(true);
    fuelSupply
      .createTrip({
        vehicle_id: tripForm.vehicle_id,
        diesel_order_id: tripForm.diesel_order_id || null,
        driver_name: tripForm.driver_name,
        driver_employee_number: tripForm.driver_employee_number,
        start_now: tripForm.start_now,
        odometer_start_km: tripForm.odometer_start_km === '' ? null : Number(tripForm.odometer_start_km),
        opening_liters_estimate: tripForm.opening_liters_estimate === '' ? null : Number(tripForm.opening_liters_estimate),
        notes: tripForm.notes || null,
      })
      .then((r) => {
        const tid = pickRow(r.trip, 'id', 'Id');
        setSelectedTripId(tid);
        refreshLists();
      })
      .catch((err) => onError(err?.message || 'Could not create trip'))
      .finally(() => setSaving(false));
  };

  const patchStart = () => {
    if (!selectedTripId) return;
    setSaving(true);
    fuelSupply
      .patchTrip(selectedTripId, {
        action: 'start',
        odometer_start_km: startForm.odometer_start_km === '' ? null : Number(startForm.odometer_start_km),
        opening_liters_estimate: startForm.opening_liters_estimate === '' ? null : Number(startForm.opening_liters_estimate),
      })
      .then(() => refreshLists())
      .then(() => fuelSupply.trip(selectedTripId).then(setTripDetail))
      .catch((err) => onError(err?.message || 'Start failed'))
      .finally(() => setSaving(false));
  };

  const patchComplete = () => {
    if (!selectedTripId) return;
    setSaving(true);
    fuelSupply
      .patchTrip(selectedTripId, {
        action: 'complete',
        odometer_end_km: completeForm.odometer_end_km === '' ? null : Number(completeForm.odometer_end_km),
        closing_liters_estimate: completeForm.closing_liters_estimate === '' ? null : Number(completeForm.closing_liters_estimate),
      })
      .then(() => refreshLists())
      .then(() => fuelSupply.trip(selectedTripId).then(setTripDetail))
      .catch((err) => onError(err?.message || 'Complete failed'))
      .finally(() => setSaving(false));
  };

  const addStop = (e) => {
    e.preventDefault();
    if (!selectedTripId) return;
    if (!stopForm.arrived_at) {
      onError('Arrived time required');
      return;
    }
    setSaving(true);
    const fd = new FormData();
    fd.append('arrived_at', new Date(stopForm.arrived_at).toISOString());
    if (stopForm.departed_at) fd.append('departed_at', new Date(stopForm.departed_at).toISOString());
    if (stopForm.place_label) fd.append('place_label', stopForm.place_label);
    if (stopForm.odometer_km !== '') fd.append('odometer_km', String(stopForm.odometer_km));
    if (stopForm.liters_on_gauge !== '') fd.append('liters_on_gauge', String(stopForm.liters_on_gauge));
    if (stopForm.is_refuel) fd.append('is_refuel', 'true');
    if (stopForm.refuel_liters !== '') fd.append('refuel_liters', String(stopForm.refuel_liters));
    if (stopForm.notes) fd.append('notes', stopForm.notes);
    if (stopForm.gauge_photo) fd.append('gauge_photo', stopForm.gauge_photo);
    if (stopForm.slip_photo) fd.append('slip_photo', stopForm.slip_photo);
    fuelSupply
      .addTripStop(selectedTripId, fd)
      .then(() => {
        setStopForm({
          place_label: '',
          arrived_at: '',
          departed_at: '',
          odometer_km: '',
          liters_on_gauge: '',
          is_refuel: false,
          refuel_liters: '',
          notes: '',
          gauge_photo: null,
          slip_photo: null,
        });
        return fuelSupply.trip(selectedTripId).then(setTripDetail);
      })
      .then(() => refreshLists())
      .catch((err) => onError(err?.message || 'Could not add stop'))
      .finally(() => setSaving(false));
  };

  const trip = tripDetail?.trip;
  const stops = tripDetail?.stops || [];
  const tripStatus = trip ? String(pickRow(trip, 'status', 'Status') || '').toLowerCase() : '';

  if (loading) return <p className="text-surface-500">Loading vehicle log…</p>;

  const ts = summary?.trips || {};
  const fc = analytics?.forecast_next_month;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Delivery vehicle log book</h2>
        <InfoHint
          title="Delivery vehicle log book help"
          text="Trip sheets: start and complete trips, add stops with odometer, time, gauge photo, and refuel events with slip photos. Remaining liters on each vehicle update from gauge and refuel entries."
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-surface-200 bg-white p-4 sm:p-6 shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-50">Operational overview</h3>
            <InfoHint
              title="Operational overview help"
              text="Trip distance and refuel volumes for this tenant. Cost trend uses reconciliation history — see Production vs expenses for detail."
            />
          </div>
          <ul className="text-sm text-surface-800 space-y-1">
            <li>Trips recorded: {pickRow(ts, 'trip_count', 'TRIP_COUNT') ?? '—'}</li>
            <li>Completed: {pickRow(ts, 'completed_count', 'COMPLETED_COUNT') ?? '—'}</li>
            <li>In progress: {pickRow(ts, 'active_count', 'ACTIVE_COUNT') ?? '—'}</li>
            <li>Total trip km (completed): {Number(pickRow(ts, 'total_km', 'TOTAL_KM') || 0).toFixed(1)}</li>
            <li>Refuel volume logged (L): {Number(summary?.refuel_liters || 0).toFixed(1)}</li>
            <li>
              Forecast next month: {fc?.liters != null ? `${Math.round(fc.liters)} L volume` : '—'} ·{' '}
              {fc?.cost != null ? `R ${fc.cost.toFixed(2)} cost` : '—'}
            </li>
          </ul>
        </div>
        <div className="rounded-xl border border-surface-200 bg-white p-4 sm:p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-surface-900 mb-3">Fleet vehicles</h3>
          <ul className="text-sm space-y-2 mb-4 max-h-40 overflow-y-auto">
            {vehicles.map((v) => {
              const id = pickRow(v, 'id', 'Id');
              return (
                <li key={id} className="flex justify-between gap-2 border-b border-surface-100 pb-2">
                  <span>
                    {pickRow(v, 'name', 'Name')}{' '}
                    <span className="text-surface-500 text-xs">{pickRow(v, 'registration', 'Registration')}</span>
                  </span>
                  <span className="text-surface-600 whitespace-nowrap">
                    ~{Number(pickRow(v, 'current_liters_estimate', 'currentLitersEstimate') || 0).toFixed(0)} L
                  </span>
                </li>
              );
            })}
            {vehicles.length === 0 && <li className="text-surface-500">No vehicles yet — add one below.</li>}
          </ul>
          <form onSubmit={createVehicle} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input required className={inputClass()} placeholder="Name" value={vehForm.name} onChange={(e) => setVehForm((f) => ({ ...f, name: e.target.value }))} />
            <input className={inputClass()} placeholder="Registration" value={vehForm.registration} onChange={(e) => setVehForm((f) => ({ ...f, registration: e.target.value }))} />
            <input className={inputClass()} placeholder="Tank capacity (L)" type="number" value={vehForm.tank_capacity_liters} onChange={(e) => setVehForm((f) => ({ ...f, tank_capacity_liters: e.target.value }))} />
            <input className={inputClass()} placeholder="Current liters est." type="number" value={vehForm.current_liters_estimate} onChange={(e) => setVehForm((f) => ({ ...f, current_liters_estimate: e.target.value }))} />
            <button type="submit" disabled={saving} className="sm:col-span-2 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50">
              Add vehicle
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white p-4 sm:p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-surface-900">New trip</h3>
        <form onSubmit={createTrip} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Vehicle</label>
            <select className={inputClass()} value={tripForm.vehicle_id} onChange={(e) => setTripForm((f) => ({ ...f, vehicle_id: e.target.value }))} required>
              {vehicles.map((v) => {
                const id = pickRow(v, 'id', 'Id');
                return (
                  <option key={id} value={id}>
                    {pickRow(v, 'name', 'Name')}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1">Linked diesel order (optional)</label>
            <select className={inputClass()} value={tripForm.diesel_order_id} onChange={(e) => setTripForm((f) => ({ ...f, diesel_order_id: e.target.value }))}>
              <option value="">—</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.depot_name} → {o.delivery_site_name}
                </option>
              ))}
            </select>
          </div>
          <input required className={inputClass()} placeholder="Driver name" value={tripForm.driver_name} onChange={(e) => setTripForm((f) => ({ ...f, driver_name: e.target.value }))} />
          <input required className={inputClass()} placeholder="Employee #" value={tripForm.driver_employee_number} onChange={(e) => setTripForm((f) => ({ ...f, driver_employee_number: e.target.value }))} />
          <input className={inputClass()} placeholder="Odometer start (if starting now)" type="number" value={tripForm.odometer_start_km} onChange={(e) => setTripForm((f) => ({ ...f, odometer_start_km: e.target.value }))} />
          <input className={inputClass()} placeholder="Opening liters est." type="number" value={tripForm.opening_liters_estimate} onChange={(e) => setTripForm((f) => ({ ...f, opening_liters_estimate: e.target.value }))} />
          <label className="flex items-center gap-2 text-sm text-surface-700 sm:col-span-2">
            <input type="checkbox" checked={tripForm.start_now} onChange={(e) => setTripForm((f) => ({ ...f, start_now: e.target.checked }))} />
            Start trip immediately (in progress)
          </label>
          <textarea className={`${inputClass()} sm:col-span-2`} rows={2} placeholder="Notes" value={tripForm.notes} onChange={(e) => setTripForm((f) => ({ ...f, notes: e.target.value }))} />
          <button type="submit" disabled={saving || !vehicles.length} className="sm:col-span-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50">
            Create trip
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-surface-100">
          <h3 className="text-sm font-semibold text-surface-900">Trips</h3>
        </div>
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="sticky top-0 bg-surface-50">
              <tr className="text-left text-surface-600">
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Driver</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => {
                const id = pickRow(t, 'id', 'Id');
                return (
                  <tr key={id} className="border-t border-surface-100">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDt(pickRow(t, 'started_at', 'startedAt'))}</td>
                    <td className="px-3 py-2">{pickRow(t, 'vehicle_name', 'vehicleName')}</td>
                    <td className="px-3 py-2">{pickRow(t, 'driver_name', 'driverName')}</td>
                    <td className="px-3 py-2 capitalize">{pickRow(t, 'status', 'Status')}</td>
                    <td className="px-3 py-2">
                      <button type="button" className="text-brand-600 text-xs font-medium" onClick={() => setSelectedTripId(id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {trips.length === 0 && <p className="p-6 text-center text-surface-500 text-sm">No trips yet.</p>}
        </div>
      </div>

      {selectedTripId && trip ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-4 sm:p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <h3 className="text-sm font-semibold text-surface-900">Trip detail</h3>
            <span className="text-xs uppercase tracking-wide text-surface-500">{tripStatus}</span>
          </div>

          {tripStatus === 'planned' && (
            <div className="flex flex-wrap gap-3 items-end bg-white rounded-lg border border-surface-200 p-4">
              <div>
                <label className="block text-xs text-surface-600 mb-1">Odometer start</label>
                <input type="number" className={inputClass()} value={startForm.odometer_start_km} onChange={(e) => setStartForm((f) => ({ ...f, odometer_start_km: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-surface-600 mb-1">Opening liters</label>
                <input type="number" className={inputClass()} value={startForm.opening_liters_estimate} onChange={(e) => setStartForm((f) => ({ ...f, opening_liters_estimate: e.target.value }))} />
              </div>
              <button type="button" disabled={saving} onClick={patchStart} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm">
                Start trip
              </button>
            </div>
          )}

          {tripStatus === 'in_progress' && (
            <div className="flex flex-wrap gap-3 items-end bg-white rounded-lg border border-surface-200 p-4">
              <div>
                <label className="block text-xs text-surface-600 mb-1">Odometer end</label>
                <input type="number" className={inputClass()} value={completeForm.odometer_end_km} onChange={(e) => setCompleteForm((f) => ({ ...f, odometer_end_km: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-surface-600 mb-1">Closing liters (gauge)</label>
                <input type="number" className={inputClass()} value={completeForm.closing_liters_estimate} onChange={(e) => setCompleteForm((f) => ({ ...f, closing_liters_estimate: e.target.value }))} />
              </div>
              <button type="button" disabled={saving} onClick={patchComplete} className="px-4 py-2 rounded-lg bg-surface-800 text-white text-sm">
                Complete trip
              </button>
            </div>
          )}

          <div className="bg-white rounded-lg border border-surface-200 p-4 space-y-3">
            <h4 className="text-xs font-semibold text-surface-800 uppercase tracking-wide">Add stop / refuel</h4>
            <form onSubmit={addStop} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className={inputClass()} placeholder="Place label" value={stopForm.place_label} onChange={(e) => setStopForm((f) => ({ ...f, place_label: e.target.value }))} />
              <div>
                <label className="block text-xs text-surface-600 mb-1">Arrived *</label>
                <input type="datetime-local" className={inputClass()} value={stopForm.arrived_at} onChange={(e) => setStopForm((f) => ({ ...f, arrived_at: e.target.value }))} required />
              </div>
              <div>
                <label className="block text-xs text-surface-600 mb-1">Departed</label>
                <input type="datetime-local" className={inputClass()} value={stopForm.departed_at} onChange={(e) => setStopForm((f) => ({ ...f, departed_at: e.target.value }))} />
              </div>
              <input className={inputClass()} placeholder="Odometer km" type="number" value={stopForm.odometer_km} onChange={(e) => setStopForm((f) => ({ ...f, odometer_km: e.target.value }))} />
              <input className={inputClass()} placeholder="Liters on gauge" type="number" value={stopForm.liters_on_gauge} onChange={(e) => setStopForm((f) => ({ ...f, liters_on_gauge: e.target.value }))} />
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={stopForm.is_refuel} onChange={(e) => setStopForm((f) => ({ ...f, is_refuel: e.target.checked }))} />
                Refuel event (upload slip)
              </label>
              <input className={inputClass()} placeholder="Refuel liters" type="number" value={stopForm.refuel_liters} onChange={(e) => setStopForm((f) => ({ ...f, refuel_liters: e.target.value }))} />
              <div>
                <label className="block text-xs text-surface-600 mb-1">Gauge photo</label>
                <input type="file" accept="image/*" className="text-xs" onChange={(e) => setStopForm((f) => ({ ...f, gauge_photo: e.target.files?.[0] || null }))} />
              </div>
              <div>
                <label className="block text-xs text-surface-600 mb-1">Slip photo (refuel)</label>
                <input type="file" accept="image/*" className="text-xs" onChange={(e) => setStopForm((f) => ({ ...f, slip_photo: e.target.files?.[0] || null }))} />
              </div>
              <textarea className={`${inputClass()} sm:col-span-2`} rows={2} placeholder="Notes" value={stopForm.notes} onChange={(e) => setStopForm((f) => ({ ...f, notes: e.target.value }))} />
              <button type="submit" disabled={saving || tripStatus === 'planned'} className="sm:col-span-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm disabled:opacity-50">
                {tripStatus === 'planned' ? 'Start trip before adding stops' : 'Save stop'}
              </button>
            </form>
          </div>

          <div className="bg-white rounded-lg border border-surface-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="bg-surface-50 text-left text-surface-600">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Arrived</th>
                  <th className="px-3 py-2 font-medium">Place</th>
                  <th className="px-3 py-2 font-medium">Odo</th>
                  <th className="px-3 py-2 font-medium">Gauge L</th>
                  <th className="px-3 py-2 font-medium">Refuel</th>
                  <th className="px-3 py-2 font-medium">Photos</th>
                </tr>
              </thead>
              <tbody>
                {stops.map((s) => {
                  const sid = pickRow(s, 'id', 'Id');
                  const gaugePath = pickRow(s, 'gauge_photo_path', 'gaugePhotoPath');
                  const slipPath = pickRow(s, 'slip_photo_path', 'slipPhotoPath');
                  return (
                    <tr key={sid} className="border-t border-surface-100">
                      <td className="px-3 py-2">{pickRow(s, 'sequence_no', 'sequenceNo')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDt(pickRow(s, 'arrived_at', 'arrivedAt'))}</td>
                      <td className="px-3 py-2">{pickRow(s, 'place_label', 'placeLabel')}</td>
                      <td className="px-3 py-2">{pickRow(s, 'odometer_km', 'odometerKm') ?? '—'}</td>
                      <td className="px-3 py-2">{pickRow(s, 'liters_on_gauge', 'litersOnGauge') ?? '—'}</td>
                      <td className="px-3 py-2">
                        {pickRow(s, 'is_refuel', 'isRefuel') === true ||
                        pickRow(s, 'is_refuel', 'isRefuel') === 1 ||
                        pickRow(s, 'is_refuel', 'isRefuel') === '1'
                          ? `${pickRow(s, 'refuel_liters', 'refuelLiters') ?? ''} L`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 space-x-2">
                        {gaugePath ? (
                          <button type="button" className="text-brand-600 text-xs" onClick={() => openAttachmentWithAuth(fuelSupply.tripGaugeUrl(sid)).catch((e) => onError(e?.message))}>
                            Gauge
                          </button>
                        ) : null}
                        {slipPath ? (
                          <button type="button" className="text-brand-600 text-xs" onClick={() => openAttachmentWithAuth(fuelSupply.tripSlipUrl(sid)).catch((e) => onError(e?.message))}>
                            Slip
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {stops.length === 0 && <p className="p-4 text-surface-500 text-sm">No stops yet.</p>}
          </div>
        </div>
      ) : null}
    </div>
  );
}
