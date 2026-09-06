export function cap(key: string) {
  return key[0].toUpperCase() + key.slice(1);
}

const ROMAN_TO_ARABIC: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
};

export function formatGeneration(gen: string) {
  const roman = gen.replace('generation-', '');
  return `Gen ${ROMAN_TO_ARABIC[roman] ?? roman}`;
}

export function formatName(name: string) {
  return name.replace(/-/g, ' ');
}
