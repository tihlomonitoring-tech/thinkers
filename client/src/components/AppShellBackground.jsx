/**
 * Full-viewport backdrop for the authenticated shell (Layout).
 * Mining / colliery imagery — same sources as login, tuned for light/dark.
 */
import ShellBackgroundImage from './ShellBackgroundImage.jsx';

const NOISE_SVG = encodeURIComponent(
  `<svg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`
);

export default function AppShellBackground({ isDark }) {
  const noise = `url("data:image/svg+xml,${NOISE_SVG}")`;

  if (isDark) {
    return (
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <ShellBackgroundImage className="absolute inset-0 h-full w-full object-cover scale-[1.03] saturate-[0.85] contrast-[1.08]" />
        <div className="absolute inset-0 bg-gradient-to-br from-stone-950/90 via-[#0c0a09]/88 to-stone-950/92" />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-950/85 via-transparent to-amber-950/30" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_70%_at_70%_0%,rgba(251,146,60,0.14),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_0%_100%,rgba(120,53,15,0.12),transparent_45%)]" />
        <div
          className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
          style={{ backgroundImage: noise }}
        />
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <ShellBackgroundImage className="absolute inset-0 h-full w-full object-cover scale-[1.03] opacity-[0.48] saturate-[0.85] contrast-[1.05]" />
      <div className="absolute inset-0 bg-gradient-to-br from-stone-50/80 via-white/76 to-amber-50/75" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_60%_at_80%_-10%,rgba(251,146,60,0.12),transparent_52%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_0%_100%,rgba(120,113,108,0.16),transparent_45%)]" />
      <div
        className="absolute inset-0 opacity-[0.03] mix-blend-multiply"
        style={{ backgroundImage: noise }}
      />
    </div>
  );
}
