import { useEffect, useRef, useState } from 'react';

/**
 * Guided “AI camera” capture for fuel slips: live preview, tips for a sharp frame,
 * then JPEG capture passed to parent (same pipeline as file upload).
 */
export default function FuelSlipAiCameraModal({ open, onClose, onCapture, busy }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [camError, setCamError] = useState('');

  useEffect(() => {
    if (!open) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      setCamError('');
      return undefined;
    }

    let cancelled = false;
    setCamError('');

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setCamError('Camera unavailable. Check browser permissions, use HTTPS, or upload a photo from your gallery instead.');
      }
    })();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open]);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || camError) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `fuel-slip-${Date.now()}.jpg`, { type: 'image/jpeg' });
        onCapture(file);
      },
      'image/jpeg',
      0.9
    );
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fuel-slip-camera-title"
    >
      <div className="bg-white dark:bg-surface-900 rounded-2xl shadow-2xl max-w-lg w-full max-h-[95vh] overflow-y-auto border border-surface-200 dark:border-surface-700">
        <div className="p-4 border-b border-surface-100 dark:border-surface-800 flex justify-between items-start gap-2">
          <div>
            <h2 id="fuel-slip-camera-title" className="text-lg font-semibold text-surface-900 dark:text-surface-50">
              AI camera — slip photo
            </h2>
            <p className="text-xs text-surface-500 mt-1">Same as uploading: we send this image to read your slip.</p>
          </div>
          <button
            type="button"
            className="shrink-0 text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 px-2 py-1 rounded-lg text-lg leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 px-3 py-3 text-sm text-amber-950 dark:text-amber-100">
            <p className="font-medium text-amber-900 dark:text-amber-50 mb-2">For a clear read</p>
            <ul className="list-disc pl-4 space-y-1.5 text-amber-900/90 dark:text-amber-100/95">
              <li>Use good light; avoid hard shadow across handwriting.</li>
              <li>Hold the phone parallel to the slip — not at a steep angle.</li>
              <li>Fill the frame with the whole slip (all edges visible).</li>
              <li>Tap the slip on screen to focus, then hold steady for a second.</li>
              <li>Avoid blur: brace your elbows or rest the phone on a surface.</li>
            </ul>
          </div>

          {camError ? (
            <p className="text-sm text-red-700 dark:text-red-300">{camError}</p>
          ) : (
            <div className="rounded-xl overflow-hidden bg-black aspect-[4/3] flex items-center justify-center">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
            </div>
          )}

          <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

          <div className="flex flex-wrap gap-2 justify-end pt-1">
            <button type="button" className="px-4 py-2 rounded-lg border border-surface-300 text-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !!camError}
              onClick={handleCapture}
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Reading slip…' : 'Capture & read slip'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
