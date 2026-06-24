import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

/**
 * Fetch a PDF with credentials and render all pages inline (scrollable).
 */
export default function PdfInlineViewer({ url, className = '', minHeight = '70vh', onError }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!url) {
      setLoading(false);
      setError('No document URL');
      return undefined;
    }
    let cancelled = false;
    const container = containerRef.current;
    if (container) container.innerHTML = '';

    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) throw new Error(res.status === 404 ? 'Document not found' : 'Could not load PDF');
        const buf = await res.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        if (cancelled || !containerRef.current) return;

        const wrap = containerRef.current;
        wrap.innerHTML = '';

        for (let p = 1; p <= doc.numPages; p += 1) {
          if (cancelled) return;
          const page = await doc.getPage(p);
          const baseVp = page.getViewport({ scale: 1 });
          const maxW = wrap.clientWidth > 40 ? wrap.clientWidth - 8 : 720;
          const scale = Math.min(maxW / baseVp.width, 2);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'mx-auto block shadow-md rounded-sm bg-white mb-4 max-w-full';
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
          wrap.appendChild(canvas);
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e?.message || 'Failed to load PDF';
          setError(msg);
          onError?.(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, onError]);

  return (
    <div className={`relative rounded-xl border border-surface-200 bg-surface-100 dark:bg-surface-900/40 overflow-hidden ${className}`} style={{ minHeight }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-50/90 dark:bg-surface-900/80 z-10">
          <p className="text-sm text-surface-600 font-medium">Loading document…</p>
        </div>
      )}
      {error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{error}</p>
        </div>
      )}
      <div
        ref={containerRef}
        className="h-full overflow-y-auto p-3 sm:p-4"
        style={{ maxHeight: minHeight }}
      />
    </div>
  );
}
