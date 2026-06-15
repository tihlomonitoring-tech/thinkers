import { useEffect, useRef, useState } from 'react';
import { tracking as trackingApi } from '../../api';
import { parseCombinedLatLng } from '../../lib/geoCoords.js';
import { searchLandGeofencePlaces } from '../../lib/geofenceLabels.js';

export default function MapPlaceSearch({ onSelect, savedPlaces = [], className = '' }) {
  const [query, setQuery] = useState('');
  const [localResults, setLocalResults] = useState([]);
  const [remoteResults, setRemoteResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const debounce = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const canSearchRemote = (q) => {
    const term = q.trim();
    if (!term) return false;
    if (parseCombinedLatLng(term)) return true;
    return term.length >= 3;
  };

  const canSearchLocal = (q) => q.trim().length >= 2 && savedPlaces.length > 0;

  const canSearch = (q) => canSearchLocal(q) || canSearchRemote(q);

  const runSearch = async (q) => {
    const term = q.trim();
    const localHits = canSearchLocal(term) ? searchLandGeofencePlaces(savedPlaces, term) : [];
    setLocalResults(localHits);

    if (!canSearchRemote(term)) {
      setRemoteResults([]);
      setError(localHits.length ? '' : '');
      setOpen(localHits.length > 0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await trackingApi.map.geocode(term);
      const hit = res?.result;
      if (hit) {
        setRemoteResults([hit]);
        setOpen(true);
      } else {
        setRemoteResults([]);
        setError(localHits.length ? '' : 'No places found');
        setOpen(localHits.length > 0 || true);
      }
    } catch {
      const coords = parseCombinedLatLng(term);
      if (coords) {
        setRemoteResults([{
          lat: coords.lat,
          lng: coords.lng,
          display_name: `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`,
          from_coordinates: true,
        }]);
        setOpen(true);
        setError('');
      } else {
        setRemoteResults([]);
        setError(localHits.length ? '' : 'Search failed');
        setOpen(localHits.length > 0 || true);
      }
    } finally {
      setLoading(false);
    }
  };

  const onChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(v), 350);
  };

  const pickLocal = (hit) => {
    setQuery(hit.name);
    setOpen(false);
    onSelect?.({
      lat: hit.lat,
      lng: hit.lng,
      label: hit.name,
      zoom: 16,
      geofenceId: hit.geofenceId || hit.id,
      kind: 'geofence',
    });
  };

  const pickRemote = (hit) => {
    setQuery(hit.display_name || `${Number(hit.lat).toFixed(6)}, ${Number(hit.lng).toFixed(6)}`);
    setOpen(false);
    onSelect?.({ lat: hit.lat, lng: hit.lng, label: hit.display_name, zoom: 15, kind: 'place' });
  };

  const onSubmit = (e) => {
    e.preventDefault();
    clearTimeout(debounce.current);
    runSearch(query);
  };

  const coordsPreview = parseCombinedLatLng(query.trim());
  const hasResults = localResults.length > 0 || remoteResults.length > 0;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <form onSubmit={onSubmit} className="flex shadow-lg rounded-lg overflow-hidden border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900">
        <span className="flex items-center pl-3 text-surface-400" aria-hidden>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" /></svg>
        </span>
        <input
          type="search"
          value={query}
          onChange={onChange}
          onFocus={() => hasResults && setOpen(true)}
          placeholder="Search geofence name, address, or lat, lng…"
          className="flex-1 min-w-0 px-2 py-2 text-sm bg-transparent outline-none dark:text-surface-100"
        />
        <button
          type="submit"
          disabled={loading || !canSearch(query)}
          className="px-3 text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
        >
          {loading ? '…' : 'Go'}
        </button>
      </form>
      {coordsPreview && !open && (
        <p className="absolute z-[1099] mt-1 w-full text-[10px] text-surface-500 px-1 pointer-events-none">
          Coordinates detected — press Go to fly to this point
        </p>
      )}
      {savedPlaces.length > 0 && !query.trim() && (
        <p className="absolute z-[1099] mt-1 w-full text-[10px] text-surface-500 px-1 pointer-events-none truncate">
          {savedPlaces.length} saved land geofence{savedPlaces.length === 1 ? '' : 's'} searchable by name
        </p>
      )}
      {open && (
        <ul className="absolute z-[1100] mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl text-sm">
          {error && !hasResults && (
            <li className="px-3 py-2 text-surface-500">{error}</li>
          )}
          {localResults.length > 0 && (
            <>
              <li className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-surface-400 bg-surface-50 dark:bg-surface-800/80 sticky top-0">
                Saved land geofences
              </li>
              {localResults.map((hit) => (
                <li key={`gf-${hit.id}`}>
                  <button
                    type="button"
                    onClick={() => pickLocal(hit)}
                    className="w-full text-left px-3 py-2 hover:bg-amber-50 dark:hover:bg-amber-950/30 border-l-2 border-amber-500"
                  >
                    <span className="block font-medium text-surface-900 dark:text-surface-100 truncate">{hit.name}</span>
                    <span className="text-[10px] text-surface-500">{hit.subtitle}</span>
                    <span className="block text-[10px] text-surface-400 font-mono tabular-nums">{Number(hit.lat).toFixed(5)}, {Number(hit.lng).toFixed(5)}</span>
                  </button>
                </li>
              ))}
            </>
          )}
          {remoteResults.length > 0 && (
            <>
              {localResults.length > 0 && (
                <li className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-surface-400 bg-surface-50 dark:bg-surface-800/80 sticky top-0">
                  Places &amp; coordinates
                </li>
              )}
              {remoteResults.map((hit) => (
                <li key={`${hit.lat}-${hit.lng}-${hit.display_name}`}>
                  <button
                    type="button"
                    onClick={() => pickRemote(hit)}
                    className="w-full text-left px-3 py-2 hover:bg-brand-50 dark:hover:bg-brand-950/30"
                  >
                    {hit.from_coordinates && (
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-brand-600 mb-0.5">Coordinates</span>
                    )}
                    <span className="block font-medium text-surface-900 dark:text-surface-100 truncate">{hit.display_name}</span>
                    <span className="text-[10px] text-surface-500 font-mono tabular-nums">{Number(hit.lat).toFixed(5)}, {Number(hit.lng).toFixed(5)}</span>
                  </button>
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
