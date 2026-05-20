import { useRef, useEffect, useCallback } from 'react';

/**
 * Canvas signature pad (mouse + touch). Calls onChange with PNG data URL when stroke ends.
 */
export default function SignaturePad({ onChange, width = 520, height = 160, className = '' }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const prevRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const getCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }, []);

  const startDraw = useCallback((e) => {
    e.preventDefault();
    const co = getCoords(e);
    if (!co) return;
    drawingRef.current = true;
    prevRef.current = co;
  }, [getCoords]);

  const moveDraw = useCallback((e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const co = getCoords(e);
    if (!canvas || !co) return;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#171717';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(prevRef.current.x, prevRef.current.y);
    ctx.lineTo(co.x, co.y);
    ctx.stroke();
    prevRef.current = co;
  }, [getCoords]);

  const endDraw = useCallback(() => {
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas && onChange) {
      try {
        onChange(canvas.toDataURL('image/png'));
      } catch (_) {}
    }
  }, [onChange]);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    onChange?.('');
  };

  return (
    <div className={className}>
      <div className="border border-surface-300 rounded-lg overflow-hidden bg-white touch-none">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full max-w-full cursor-crosshair block"
          style={{ height: `${height}px` }}
          onMouseDown={startDraw}
          onMouseMove={moveDraw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={moveDraw}
          onTouchEnd={endDraw}
        />
      </div>
      <button
        type="button"
        onClick={clear}
        className="mt-2 text-sm text-surface-600 hover:text-brand-600"
      >
        Clear signature
      </button>
    </div>
  );
}
