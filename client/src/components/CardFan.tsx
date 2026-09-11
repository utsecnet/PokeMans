/**
 * A few cards from a collection, fanned the way a hand of them sits.
 *
 * A collection tile used to show an icon standing for the collection. This shows the
 * collection: the first few cards actually in it, which is the only thing that distinguishes
 * one tile from another at a glance.
 *
 * Four at most. The fan is drawn from the outside in — later cards sit on top and further
 * right — and rotates about the bottom edge, so the cards pivot from a common point the way
 * they would if you were holding them.
 */
export function CardFan({
  cards,
  size = 'md',
}: {
  cards: { url: string; dimmed?: boolean }[];
  /** md fills a tile; sm suits a dense row. */
  size?: 'sm' | 'md';
}) {
  if (cards.length === 0) return null;

  const height = size === 'md' ? 64 : 44;
  const overlap = size === 'md' ? -16 : -11;
  const middle = (cards.length - 1) / 2;

  return (
    <span className="flex items-end justify-center" aria-hidden="true">
      {cards.map((card, i) => (
        <img
          key={`${card.url}-${i}`}
          src={card.url}
          alt=""
          loading="lazy"
          className="w-auto rounded-[3px] shadow-md ring-1 ring-black/25"
          style={{
            height,
            marginLeft: i === 0 ? 0 : overlap,
            transformOrigin: 'bottom center',
            transform: `rotate(${(i - middle) * 6}deg)`,
            zIndex: i,
            // A card you do not own yet, on a want list: present but not yours. Matches the
            // detail page, which states the same rule in words.
            filter: card.dimmed ? 'grayscale(1)' : undefined,
            opacity: card.dimmed ? 0.7 : 1,
          }}
        />
      ))}
    </span>
  );
}
