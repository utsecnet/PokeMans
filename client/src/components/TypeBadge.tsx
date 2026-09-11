import { typeColor } from '../lib/typeColor';

export function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize tracking-wide text-white shadow-sm"
      style={{ backgroundColor: typeColor(type) }}
    >
      {type}
    </span>
  );
}
