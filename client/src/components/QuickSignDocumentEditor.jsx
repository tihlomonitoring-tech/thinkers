import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const DEFAULT_SIG = { width_pct: 0.22, height_pct: 0.07 };
const DEFAULT_INIT = { width_pct: 0.1, height_pct: 0.05 };

function normalizePlacement(p) {
  return {
    page_index: Number(p.page_index) ?? 0,
    type: p.type === 'initial' ? 'initial' : 'signature',
    x_pct: Number(p.x_pct) || 0,
    y_pct: Number(p.y_pct) || 0,
    width_pct: Number(p.width_pct) || (p.type === 'initial' ? DEFAULT_INIT.width_pct : DEFAULT_SIG.width_pct),
    height_pct: Number(p.height_pct) || (p.type === 'initial' ? DEFAULT_INIT.height_pct : DEFAULT_SIG.height_pct),
    readonly: !!p.readonly,
    signer_name: p.signer_name || null,
  };
}

export default function QuickSignDocumentEditor({
  documentUrl,
  pageCount = 1,
  signaturePreviewUrl,
  placements = [],
  onPlacementsChange,
  readOnly = false,
}) {
  const [pdfDoc, setPdfDoc] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('signature');
  const [localPlacements, setLocalPlacements] = useState([]);
  const canvasRefs = useRef({});

  const externalReadonly = (placements || []).map((p) => normalizePlacement({ ...p, readonly: true }));
  const mine = localPlacements.filter((p) => !p.readonly);
  const allMarkers = [...externalReadonly, ...mine];

  useEffect(() => {
    setLocalPlacements([]);
  }, [documentUrl]);

  useEffect(() => {
    if (!documentUrl) return;
    let cancelled = false;
    setLoadError('');
    setPdfDoc(null);

    (async () => {
      try {
        const res = await fetch(documentUrl, { credentials: 'include' });
        if (!res.ok) throw new Error('Could not load document');
        const buf = await res.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        if (!cancelled) setPdfDoc(doc);
      } catch (e) {
        if (!cancelled) setLoadError(e?.message || 'Failed to load PDF');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentUrl]);

  const renderPage = useCallback(
    async (pageNum, canvas) => {
      if (!pdfDoc || !canvas) return;
      const page = await pdfDoc.getPage(pageNum);
      const scale = 1.35;
      const viewport = page.getViewport({ scale });
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
    },
    [pdfDoc]
  );

  useEffect(() => {
    if (!pdfDoc) return;
    const pages = pdfDoc.numPages || pageCount || 1;
    for (let i = 1; i <= pages; i++) {
      const canvas = canvasRefs.current[i];
      if (canvas) renderPage(i, canvas);
    }
  }, [pdfDoc, pageCount, renderPage]);

  const syncPlacements = (next) => {
    setLocalPlacements(next);
    onPlacementsChange?.(next.filter((p) => !p.readonly));
  };

  const addPlacement = (pageIndex, xPct, yPct) => {
    if (readOnly) return;
    const type = mode === 'initial' ? 'initial' : 'signature';
    const defaults = type === 'initial' ? DEFAULT_INIT : DEFAULT_SIG;
    const item = {
      page_index: pageIndex,
      type,
      x_pct: Math.max(0, Math.min(0.85, xPct - defaults.width_pct / 2)),
      y_pct: Math.max(0, Math.min(0.9, yPct - defaults.height_pct / 2)),
      width_pct: defaults.width_pct,
      height_pct: defaults.height_pct,
      readonly: false,
    };
    syncPlacements([...localPlacements, item]);
  };

  const handlePageClick = (pageIndex, e) => {
    if (readOnly) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;
    addPlacement(pageIndex, xPct, yPct);
  };

  const initialAllPages = () => {
    if (readOnly || !pdfDoc) return;
    const pages = pdfDoc.numPages || pageCount || 1;
    const next = [...localPlacements];
    for (let i = 0; i < pages; i++) {
      const has = next.some((p) => !p.readonly && p.page_index === i && p.type === 'initial');
      if (!has) {
        next.push({
          page_index: i,
          type: 'initial',
          x_pct: 0.82,
          y_pct: 0.92,
          width_pct: DEFAULT_INIT.width_pct,
          height_pct: DEFAULT_INIT.height_pct,
          readonly: false,
        });
      }
    }
    syncPlacements(next);
  };

  const removeMine = (idx) => {
    const editable = localPlacements.filter((p) => !p.readonly);
    const target = editable[idx];
    if (!target) return;
    let n = 0;
    syncPlacements(
      localPlacements.filter((p) => {
        if (p.readonly) return true;
        if (n === idx) {
          n++;
          return false;
        }
        n++;
        return true;
      })
    );
  };

  const pages = pdfDoc?.numPages || pageCount || 1;

  if (loadError) {
    return <p className="p-6 text-sm text-red-600">{loadError}</p>;
  }

  if (!pdfDoc) {
    return <p className="p-8 text-center text-surface-500">Loading document…</p>;
  }

  return (
    <div className="space-y-4">
      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
          <span className="text-sm font-medium text-surface-700 dark:text-surface-300">Place on document:</span>
          <button
            type="button"
            onClick={() => setMode('signature')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              mode === 'signature' ? 'bg-brand-600 text-white' : 'bg-white dark:bg-surface-800 border border-surface-300'
            }`}
          >
            Signature
          </button>
          <button
            type="button"
            onClick={() => setMode('initial')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              mode === 'initial' ? 'bg-brand-600 text-white' : 'bg-white dark:bg-surface-800 border border-surface-300'
            }`}
          >
            Initial
          </button>
          <button
            type="button"
            onClick={initialAllPages}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-surface-300 dark:border-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800"
          >
            Initial every page
          </button>
          <p className="text-xs text-surface-500 w-full sm:w-auto">
            Click where you want each {mode === 'initial' ? 'initial' : 'signature'} to appear.
          </p>
        </div>
      ) : null}

      {mine.length > 0 ? (
        <div className="px-4 text-sm text-surface-600 dark:text-surface-400">
          Your placements: {mine.length}
          {mine.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => removeMine(i)}
              className="ml-2 text-red-600 hover:underline text-xs"
            >
              Remove #{i + 1}
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-8 p-4 bg-surface-100 dark:bg-surface-950">
        {Array.from({ length: pages }, (_, i) => (
          <div key={i} className="relative mx-auto max-w-4xl shadow-md bg-white">
            <p className="text-xs text-surface-500 px-2 py-1 bg-surface-200">Page {i + 1}</p>
            <div
              className={`relative inline-block ${readOnly ? '' : 'cursor-crosshair'}`}
              onClick={(e) => handlePageClick(i, e)}
              role="presentation"
            >
              <canvas
                ref={(el) => {
                  canvasRefs.current[i + 1] = el;
                }}
                className="block max-w-full h-auto"
              />
              {allMarkers
                .filter((m) => m.page_index === i)
                .map((m, mi) => (
                  <div
                    key={`${m.type}-${mi}-${m.x_pct}`}
                    className="absolute border-2 border-dashed pointer-events-none flex items-center justify-center overflow-hidden"
                    style={{
                      left: `${m.x_pct * 100}%`,
                      top: `${m.y_pct * 100}%`,
                      width: `${m.width_pct * 100}%`,
                      height: `${m.height_pct * 100}%`,
                      borderColor: m.readonly ? '#94a3b8' : '#dc2626',
                      background: m.readonly ? 'rgba(148,163,184,0.15)' : 'rgba(220,38,38,0.08)',
                    }}
                  >
                    {signaturePreviewUrl && !m.readonly ? (
                      <img src={signaturePreviewUrl} alt="" className="max-w-full max-h-full object-contain opacity-90" />
                    ) : (
                      <span className="text-[10px] font-semibold text-surface-600 uppercase">
                        {m.readonly ? m.signer_name || 'Signed' : m.type}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
