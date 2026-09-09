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
  /**
   * Draws the ball as a broken outline — the want-list marker. A dashed Poké Ball reads as
   * "not caught yet" without introducing a second, unrelated glyph, so wants and
   * collections stay visibly the same family while never being mistaken for each other.
   */
  dashed = false,
}: {
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
  dashed?: boolean;
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
      <circle cx="12" cy="12" r="9" strokeDasharray={dashed ? '3 2.5' : undefined} />
      <path strokeLinecap="round" d="M3 12h6m6 0h6" />
      <circle cx="12" cy="12" r="3" strokeDasharray={dashed ? '2 2' : undefined} />
    </svg>
  );
}
