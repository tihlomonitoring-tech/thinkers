import { useState, useRef, useEffect } from 'react';

function CameraIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

/** Per-item photo capture (file or camera) for inspection checklists. */
export default function InspectionItemMedia({ itemCode, photo, onPhotoChange, compact = false }) {
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    if (!cameraOpen) return;
    setCameraError('');
    const video = videoRef.current;
    if (!video) return;
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    }).then((stream) => {
      streamRef.current = stream;
      video.srcObject = stream;
      video.play().catch(() => {});
    }).catch((err) => {
      setCameraError(err?.message || 'Could not open camera.');
      setCameraOpen(false);
    });
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (video?.srcObject) video.srcObject = null;
    };
  }, [cameraOpen]);

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current?.srcObject) videoRef.current.srcObject = null;
    setCameraOpen(false);
    setCameraError('');
  };

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      onPhotoChange(new File([blob], `${itemCode}-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      closeCamera();
    }, 'image/jpeg', 0.9);
  };

  const btnCls = compact
    ? 'py-1.5 px-2.5 rounded-lg text-[10px] font-medium border border-surface-300 bg-white hover:bg-surface-50'
    : 'py-2 px-3 rounded-lg text-xs font-medium border border-surface-300 bg-white hover:bg-surface-50';

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPhotoChange(f);
          e.target.value = '';
        }}
      />
      <button type="button" onClick={() => fileRef.current?.click()} className={btnCls}>Choose photo</button>
      <button type="button" onClick={() => setCameraOpen(true)} className={`${btnCls} flex items-center gap-1`}>
        <CameraIcon className="w-3.5 h-3.5" /> Camera
      </button>
      {photo && <span className="text-xs text-emerald-700 font-medium">Photo attached</span>}
      {photo && (
        <button type="button" onClick={() => onPhotoChange(null)} className="text-xs text-red-600 hover:underline">Remove</button>
      )}

      {cameraOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true">
          {cameraError ? (
            <div className="flex-1 flex items-center justify-center p-6 text-white text-center">
              <div>
                <p>{cameraError}</p>
                <button type="button" onClick={closeCamera} className="mt-4 py-2 px-4 rounded-xl bg-white/20">Close</button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 relative flex items-center justify-center min-h-0">
                <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
                <canvas ref={canvasRef} className="hidden" />
              </div>
              <div className="p-4 flex gap-3 bg-black/80">
                <button type="button" onClick={closeCamera} className="flex-1 py-3.5 rounded-xl font-medium bg-white/20 text-white">Cancel</button>
                <button type="button" onClick={capture} className="flex-1 py-3.5 rounded-xl font-semibold bg-brand-600 text-white">Capture</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
