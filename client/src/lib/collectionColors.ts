// A curated palette rather than a free-form color picker — every entry is chosen to stay
// readable as both a small dot and a tinted badge background, in light and dark theme.
export interface CollectionColor {
  key: string;
  label: string;
  hex: string;
}

export const COLLECTION_COLORS: CollectionColor[] = [
  { key: 'red', label: 'Red', hex: '#ef4444' },
  { key: 'orange', label: 'Orange', hex: '#f97316' },
  { key: 'amber', label: 'Amber', hex: '#f59e0b' },
  { key: 'green', label: 'Green', hex: '#22c55e' },
  { key: 'teal', label: 'Teal', hex: '#14b8a6' },
  { key: 'blue', label: 'Blue', hex: '#3b82f6' },
  { key: 'indigo', label: 'Indigo', hex: '#6366f1' },
  { key: 'purple', label: 'Purple', hex: '#a855f7' },
  { key: 'pink', label: 'Pink', hex: '#ec4899' },
  { key: 'gray', label: 'Gray', hex: '#6b7280' },
];

const BY_KEY = new Map(COLLECTION_COLORS.map((c) => [c.key, c]));

export function collectionColorHex(key: string | null | undefined): string | null {
  if (!key) return null;
  return BY_KEY.get(key)?.hex ?? null;
}
