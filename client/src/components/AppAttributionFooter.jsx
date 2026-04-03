/** Subtle copyright / attribution line shown at the bottom of every screen. */
export default function AppAttributionFooter({ className = '' }) {
  const year = new Date().getFullYear();
  return (
    <footer
      role="contentinfo"
      className={`shrink-0 px-4 py-2.5 text-center text-[11px] leading-snug ${className}`}
    >
      © {year} Developed by Leanweb, Vincent and Maoto Tech Solutions
    </footer>
  );
}
