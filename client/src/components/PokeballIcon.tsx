/**
 * Poké Ball: outer shell, the band broken either side of the centre button, and the button
 * itself — the band segments stop at the button's edge (x=9 and x=15) so the stroke doesn't
 * run through it.
 *
 * Shared so the header and the collection cards can't drift apart.
 */
export function PokeballIcon({
  className = 'h-5 w-5',
  strokeWidth = 2,
  style,
}: {
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      className={className}
      style={style}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M3 12h6m6 0h6" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
