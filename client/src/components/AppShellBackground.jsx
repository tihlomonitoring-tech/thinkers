/**
 * Full-viewport backdrop for the authenticated shell (Layout).
 * Same photo language as the login page, tuned separately for light/dark.
 */
const SHELL_BG =
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2400&q=82';

const NOISE_SVG = encodeURIComponent(
  `<svg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`
);

export default function AppShellBackground({ isDark }) {
  const noise = `url("data:image/svg+xml,${NOISE_SVG}")`;

  if (isDark) {
    return (
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <img
          src={SHELL_BG}
          alt=""
          className="absolute inset-0 h-full w-full object-cover scale-[1.03] saturate-[0.85] contrast-[1.05]"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950/94 via-[#060b14]/92 to-slate-950/[0.97]" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-cyan-950/20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_70%_at_70%_0%,rgba(34,211,238,0.11),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_0%_100%,rgba(59,130,246,0.07),transparent_45%)]" />
        <div
          className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
          style={{ backgroundImage: noise }}
        />
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <img
        src={SHELL_BG}
        alt=""
        className="absolute inset-0 h-full w-full object-cover scale-[1.03] opacity-[0.22] saturate-[0.75]"
      />
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50/97 via-white/95 to-sky-50/92" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_60%_at_80%_-10%,rgba(6,182,212,0.09),transparent_52%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_0%_100%,rgba(148,163,184,0.12),transparent_45%)]" />
      <div
        className="absolute inset-0 opacity-[0.025] mix-blend-multiply"
        style={{ backgroundImage: noise }}
      />
    </div>
  );
}
