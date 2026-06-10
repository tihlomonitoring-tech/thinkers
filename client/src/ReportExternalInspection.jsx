import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { getApiBase } from './lib/apiBase.js';
import InspectionItemMedia from './components/InspectionItemMedia.jsx';
import SignaturePad from './components/SignaturePad.jsx';

const API_BASE = getApiBase();

function RegSearchField({ label, required, value, onChange, onSelect, trucks, trucksLoading, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const q = value.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return trucks.slice(0, 25);
    return trucks.filter((t) => {
      const reg = (t.registration || '').toLowerCase();
      const fleet = (t.fleet_no || '').toLowerCase();
      const make = (t.make_model || '').toLowerCase();
      return reg.includes(q) || fleet.includes(q) || make.includes(q);
    }).slice(0, 25);
  }, [trucks, q]);

  const showDropdown = open;

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <label className="block text-sm font-medium text-surface-700 mb-1.5">
        {label}{required ? ' *' : ''}
      </label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base"
        required={required}
      />
      {showDropdown && (
        <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-auto rounded-xl border border-surface-200 bg-white shadow-lg py-1 text-sm">
          {trucksLoading ? (
            <li className="px-4 py-3 text-surface-500">Loading fleet…</li>
          ) : filtered.length === 0 ? (
            <li className="px-4 py-3 text-surface-500">
              {q ? 'No matches — keep typing or enter registration manually' : 'Type a letter or number to search fleet'}
            </li>
          ) : (
            filtered.map((t) => (
              <li
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => { onSelect(t); setOpen(false); }}
                onKeyDown={(ev) => ev.key === 'Enter' && (onSelect(t), setOpen(false))}
                className="px-4 py-2.5 hover:bg-brand-50 cursor-pointer border-b border-surface-100 last:border-0"
              >
                <span className="font-medium text-surface-900">{t.registration}</span>
                {t.fleet_no ? <span className="text-surface-500"> · Fleet {t.fleet_no}</span> : null}
                {t.make_model ? <span className="text-surface-500"> · {t.make_model}</span> : null}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

const LAYOUT_KEY = 'external-inspection-checklist-layout';

function ChecklistItemCard({ it, st, photo, onResult, onComment, onPhoto }) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-2">
        <span className="text-xs font-bold text-surface-400 shrink-0">{it.code}</span>
        <p className="text-sm text-surface-800 flex-1 leading-snug">{it.label}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {['pass', 'fail', 'n/a'].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onResult(r)}
            className={`flex-1 min-w-[4.5rem] py-2.5 rounded-xl text-xs font-bold uppercase ${
              st.result === r
                ? r === 'pass' ? 'bg-emerald-500 text-white' : r === 'fail' ? 'bg-red-500 text-white' : 'bg-surface-400 text-white'
                : 'bg-surface-100 text-surface-600 border border-surface-200'
            }`}
          >
            {r === 'n/a' ? 'N/A' : r}
          </button>
        ))}
      </div>
      <textarea
        placeholder="Comment (optional)"
        value={st.comment || ''}
        onChange={(e) => onComment(e.target.value)}
        rows={2}
        className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
      />
      <InspectionItemMedia itemCode={it.code} photo={photo} onPhotoChange={onPhoto} />
    </div>
  );
}

function LayoutPicker({ value, onChange, compact = false }) {
  const options = [
    { id: 'scroll', label: 'Scroll down', hint: 'Expand categories and scroll through all items' },
    { id: 'slide', label: 'Slide left / right', hint: 'One item at a time — swipe or use arrows (best on phone)' },
  ];
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {!compact && (
        <div>
          <p className="text-sm font-semibold text-surface-900">Checklist layout</p>
          <p className="text-xs text-surface-500 mt-0.5">Choose how you want to move through inspection items on your phone.</p>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`text-left rounded-xl border-2 p-3 transition-colors ${
              value === opt.id
                ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-200'
                : 'border-surface-200 bg-white hover:border-surface-300'
            }`}
          >
            <p className="text-sm font-semibold text-surface-900">{opt.label}</p>
            {!compact && <p className="text-xs text-surface-500 mt-1">{opt.hint}</p>}
          </button>
        ))}
      </div>
    </div>
  );
}

function SlideChecklist({ allItems, itemResults, itemPhotos, setItemResults, setItemPhotos, slideIndex, setSlideIndex }) {
  const touchStartX = useRef(null);
  const item = allItems[slideIndex];
  if (!item) return null;

  const st = itemResults[item.code] || { result: 'not_checked', comment: '' };
  const goPrev = () => setSlideIndex((i) => Math.max(0, i - 1));
  const goNext = () => setSlideIndex((i) => Math.min(allItems.length - 1, i + 1));

  const onTouchStart = (e) => { touchStartX.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e) => {
    if (touchStartX.current == null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
    const diff = endX - touchStartX.current;
    if (Math.abs(diff) > 48) {
      if (diff < 0) goNext();
      else goPrev();
    }
    touchStartX.current = null;
  };

  return (
    <div
      className="rounded-xl border border-surface-200 bg-white overflow-hidden touch-pan-y"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="px-4 py-2.5 bg-brand-50 border-b border-surface-200 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-brand-800 truncate">{item.category}</span>
        <span className="text-xs text-surface-500 tabular-nums shrink-0">{slideIndex + 1} / {allItems.length}</span>
      </div>
      <ChecklistItemCard
        it={item}
        st={st}
        photo={itemPhotos[item.code]}
        onResult={(r) => setItemResults((p) => ({ ...p, [item.code]: { ...p[item.code], result: r } }))}
        onComment={(v) => setItemResults((p) => ({ ...p, [item.code]: { ...p[item.code], comment: v } }))}
        onPhoto={(f) => setItemPhotos((p) => ({ ...p, [item.code]: f }))}
      />
      <div className="flex items-center gap-2 px-4 pb-4">
        <button
          type="button"
          onClick={goPrev}
          disabled={slideIndex === 0}
          className="flex-1 py-3 rounded-xl text-sm font-semibold border border-surface-300 bg-white disabled:opacity-40"
        >
          ← Previous
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={slideIndex >= allItems.length - 1}
          className="flex-1 py-3 rounded-xl text-sm font-semibold bg-brand-600 text-white disabled:opacity-40"
        >
          Next →
        </button>
      </div>
      <p className="text-center text-[11px] text-surface-400 pb-3 px-4">Swipe left or right to move between items</p>
    </div>
  );
}

function ScrollChecklist({ checklist, expandedCat, setExpandedCat, itemResults, itemPhotos, setItemResults, setItemPhotos }) {
  return (
    <>
      {checklist.map((cat) => (
        <div key={cat.category} className="rounded-xl border border-surface-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandedCat((c) => (c === cat.category ? '' : cat.category))}
            className="w-full flex items-center justify-between px-4 py-3 bg-brand-50 text-left font-semibold text-sm text-brand-900"
          >
            {cat.category}
            <span className="text-brand-600">{expandedCat === cat.category ? '−' : '+'}</span>
          </button>
          {expandedCat === cat.category && (
            <div className="divide-y divide-surface-100">
              {cat.items.map((it) => {
                const st = itemResults[it.code] || { result: 'not_checked', comment: '' };
                return (
                  <ChecklistItemCard
                    key={it.code}
                    it={it}
                    st={st}
                    photo={itemPhotos[it.code]}
                    onResult={(r) => setItemResults((p) => ({ ...p, [it.code]: { ...p[it.code], result: r } }))}
                    onComment={(v) => setItemResults((p) => ({ ...p, [it.code]: { ...p[it.code], comment: v } }))}
                    onPhoto={(f) => setItemPhotos((p) => ({ ...p, [it.code]: f }))}
                  />
                );
              })}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

export default function ReportExternalInspection({ driverName, onBack, onSuccess }) {
  const [step, setStep] = useState('setup');
  const [checklist, setChecklist] = useState([]);
  const [trucks, setTrucks] = useState([]);
  const [trucksLoading, setTrucksLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [truckReg, setTruckReg] = useState('');
  const [selectedTruck, setSelectedTruck] = useState(null);
  const [trailer1, setTrailer1] = useState('');
  const [trailer2, setTrailer2] = useState('');
  const [inspDate, setInspDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [inspTime, setInspTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [contractorName, setContractorName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [generalComments, setGeneralComments] = useState('');

  const [itemResults, setItemResults] = useState({});
  const [itemPhotos, setItemPhotos] = useState({});
  const [inspectorSignature, setInspectorSignature] = useState('');
  const [expandedCat, setExpandedCat] = useState('');
  const [checklistLayout, setChecklistLayout] = useState(() => {
    try {
      const saved = sessionStorage.getItem(LAYOUT_KEY);
      return saved === 'slide' || saved === 'scroll' ? saved : 'slide';
    } catch { return 'slide'; }
  });
  const [slideIndex, setSlideIndex] = useState(0);

  const setLayout = (layout) => {
    setChecklistLayout(layout);
    try { sessionStorage.setItem(LAYOUT_KEY, layout); } catch { /* ignore */ }
  };

  useEffect(() => {
    setTrucksLoading(true);
    Promise.all([
      fetch(`${API_BASE}/report-external-inspection/checklist`, { credentials: 'include' }).then((r) => r.json()),
      fetch(`${API_BASE}/report-external-inspection/trucks`, { credentials: 'include' }).then((r) => r.json()),
    ])
      .then(([cl, tr]) => {
        const cats = cl.checklist || [];
        setChecklist(cats);
        setExpandedCat(cats[0]?.category || '');
        const map = {};
        for (const cat of cats) {
          for (const it of cat.items) {
            map[it.code] = { result: 'not_checked', comment: '' };
          }
        }
        setItemResults(map);
        setTrucks(tr.trucks || []);
      })
      .catch(() => setError('Could not load inspection data. Refresh and try again.'))
      .finally(() => setTrucksLoading(false));
  }, []);

  const handleTruckSelect = useCallback(async (t) => {
    setSelectedTruck(t);
    setTruckReg(t.registration || '');
    if (t.trailer_1_reg_no) setTrailer1(t.trailer_1_reg_no);
    if (t.trailer_2_reg_no) setTrailer2(t.trailer_2_reg_no);
    try {
      const res = await fetch(
        `${API_BASE}/report-external-inspection/trucks/lookup?registration=${encodeURIComponent(t.registration || '')}`,
        { credentials: 'include' }
      );
      const data = await res.json();
      if (data.truck?.contractor_id) {
        setSelectedTruck((prev) => ({ ...prev, ...data.truck }));
      }
    } catch { /* optional enrichment */ }
  }, []);

  const allItems = useMemo(
    () => checklist.flatMap((c) => c.items.map((it) => ({ ...it, category: c.category }))),
    [checklist]
  );
  const checkedCount = allItems.filter((it) => {
    const r = itemResults[it.code]?.result;
    return r && r !== 'not_checked';
  }).length;
  const progressPct = allItems.length > 0 ? Math.round((checkedCount / allItems.length) * 100) : 0;

  const startInspection = (e) => {
    e.preventDefault();
    if (!truckReg.trim()) { setError('Enter truck registration.'); return; }
    if (!contractorName.trim()) { setError('Enter contractor name.'); return; }
    if (!confirmed) { setError('Confirm date and time before starting.'); return; }
    setError('');
    setStep('inspect');
  };

  const handleSubmit = async () => {
    const unchecked = allItems.filter((it) => !itemResults[it.code]?.result || itemResults[it.code]?.result === 'not_checked');
    if (unchecked.length > 0) {
      setError(`${unchecked.length} item(s) still unchecked. Mark each as Pass, Fail, or N/A.`);
      return;
    }
    if (!inspectorSignature) {
      setError('Draw your inspector signature before submitting.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const items = allItems.map((it, idx) => ({
        category: it.category,
        item_code: it.code,
        item_label: it.label,
        result: itemResults[it.code]?.result || 'not_checked',
        comment: itemResults[it.code]?.comment || null,
        sort_order: idx,
      }));
      const payload = {
        truck_id: selectedTruck?.id || null,
        contractor_id: selectedTruck?.contractor_id || null,
        fleet_registration: truckReg.trim(),
        trailer_1_registration: trailer1.trim() || null,
        trailer_2_registration: trailer2.trim() || null,
        contractor_name: contractorName.trim(),
        inspection_date: inspDate,
        inspection_time: inspTime,
        general_comments: generalComments.trim() || null,
        inspector_signature: inspectorSignature,
        items,
      };
      const fd = new FormData();
      fd.append('payload', JSON.stringify(payload));
      for (const [code, file] of Object.entries(itemPhotos)) {
        if (file) fd.append(`photo_${code}`, file);
      }
      const res = await fetch(`${API_BASE}/report-external-inspection/submit`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Submit failed.');
        return;
      }
      onSuccess?.(data);
      setStep('done');
    } catch (err) {
      setError(err?.message || 'Submit failed.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'done') {
    return (
      <div className="text-center py-4">
        <p className="text-green-700 font-medium">Inspection submitted successfully.</p>
        <p className="text-surface-600 text-sm mt-2">Your contractor will receive this inspection report.</p>
        <button type="button" onClick={onBack} className="mt-6 w-full py-3 px-4 rounded-xl text-sm font-medium bg-surface-200 text-surface-800 hover:bg-surface-300">
          Back to menu
        </button>
      </div>
    );
  }

  if (step === 'setup') {
    return (
      <form onSubmit={startInspection} className="space-y-4">
        {error && <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3">{error}</div>}
        <p className="text-sm text-surface-600">Side tipper truck — national road safety inspection. Confirm vehicle details before starting.</p>

        <RegSearchField
          label="Truck registration"
          required
          value={truckReg}
          onChange={(v) => { setTruckReg(v); setSelectedTruck(null); }}
          onSelect={handleTruckSelect}
          trucks={trucks}
          trucksLoading={trucksLoading}
          placeholder="Type registration to search…"
        />
        {selectedTruck && (
          <p className="text-xs text-emerald-700 -mt-2">Loaded from system: {selectedTruck.registration}{selectedTruck.make_model ? ` · ${selectedTruck.make_model}` : ''}</p>
        )}

        <RegSearchField
          label="Trailer 1 registration"
          value={trailer1}
          onChange={setTrailer1}
          onSelect={(t) => setTrailer1(t.registration || '')}
          trucks={trucks}
          trucksLoading={trucksLoading}
          placeholder="Type registration to search…"
        />
        <RegSearchField
          label="Trailer 2 registration"
          value={trailer2}
          onChange={setTrailer2}
          onSelect={(t) => setTrailer2(t.registration || '')}
          trucks={trucks}
          trucksLoading={trucksLoading}
          placeholder="Optional — type to search…"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">Inspection date *</label>
            <input type="date" value={inspDate} onChange={(e) => setInspDate(e.target.value)} required className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base" />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">Inspection time *</label>
            <input type="time" value={inspTime} onChange={(e) => setInspTime(e.target.value)} required className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-surface-700 mb-1.5">Contractor name *</label>
          <input
            type="text"
            value={contractorName}
            onChange={(e) => setContractorName(e.target.value)}
            placeholder="Type contractor / company name"
            required
            className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base"
          />
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-surface-200 bg-surface-50 p-4 cursor-pointer">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 rounded border-surface-300" />
          <span className="text-sm text-surface-700">
            I confirm the truck registration, trailer registrations, date ({inspDate}) and time ({inspTime}) are correct. Inspector: <strong>{driverName}</strong>.
          </span>
        </label>

        <LayoutPicker value={checklistLayout} onChange={setLayout} />

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 px-4 rounded-xl text-base font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60"
        >
          Start inspection
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3">{error}</div>}

      <div className="rounded-xl border border-surface-200 bg-surface-50 p-3 text-xs text-surface-600 space-y-0.5">
        <p><strong>Truck:</strong> {truckReg}</p>
        {trailer1 && <p><strong>Trailer 1:</strong> {trailer1}</p>}
        {trailer2 && <p><strong>Trailer 2:</strong> {trailer2}</p>}
        <p><strong>Contractor:</strong> {contractorName} · <strong>Date:</strong> {inspDate} {inspTime}</p>
      </div>

      <div className="rounded-xl border border-surface-200 bg-white p-3 space-y-3">
        <div className="flex justify-between text-sm font-semibold">
          <span>Progress</span>
          <span>{checkedCount}/{allItems.length} ({progressPct}%)</span>
        </div>
        <div className="h-2 rounded-full bg-surface-200 overflow-hidden">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <LayoutPicker value={checklistLayout} onChange={setLayout} compact />
      </div>

      {checklistLayout === 'slide' ? (
        <SlideChecklist
          allItems={allItems}
          itemResults={itemResults}
          itemPhotos={itemPhotos}
          setItemResults={setItemResults}
          setItemPhotos={setItemPhotos}
          slideIndex={slideIndex}
          setSlideIndex={setSlideIndex}
        />
      ) : (
        <ScrollChecklist
          checklist={checklist}
          expandedCat={expandedCat}
          setExpandedCat={setExpandedCat}
          itemResults={itemResults}
          itemPhotos={itemPhotos}
          setItemResults={setItemResults}
          setItemPhotos={setItemPhotos}
        />
      )}

      <div>
        <label className="block text-sm font-medium text-surface-700 mb-1.5">General comments</label>
        <textarea value={generalComments} onChange={(e) => setGeneralComments(e.target.value)} rows={2} className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base" placeholder="Any overall notes…" />
      </div>

      <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-surface-900">Inspector signature *</p>
          <p className="text-xs text-surface-500">Sign to confirm this inspection is complete and accurate.</p>
        </div>
        <SignaturePad onChange={setInspectorSignature} className="max-w-md" />
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={() => setStep('setup')} className="flex-1 py-3 rounded-xl text-sm font-medium border border-surface-300 bg-white">Back</button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          className="flex-[2] py-3.5 rounded-xl text-base font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {loading ? 'Submitting…' : 'Submit signed inspection'}
        </button>
      </div>
    </div>
  );
}
