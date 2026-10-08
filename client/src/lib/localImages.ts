/**
 * Upstream image addresses, rewritten to our own copies.
 *
 * The server used to do this, and it could check whether each file existed before
 * rewriting, falling back to the original address when a sync had not fetched it. A
 * browser cannot stat a file, so this always rewrites and never falls back.
 *
 * That is deliberate rather than a limitation worked around. Falling back would mean
 * quietly fetching artwork from raw.githubusercontent.com and assets.tcgdex.net at render
 * time, which is exactly what vendoring these images was meant to stop. A missing file
 * gives a broken image, which is visible and fixable; a silent external request is
 * neither.
 */

/**
 * Where the images are served from.
 *
 * Empty today, so every path stays relative and the dev server answers from
 * client/public — ~23,000 files and 340 MB that live on one machine.
 *
 * They will move to object storage, and when they do this is the only thing that changes:
 * set VITE_IMAGE_BASE_URL to the bucket's address and every image in the app follows. The
 * folder names and filenames below are therefore fixed, not incidental — the move is a
 * straight copy of client/public with nothing renamed, and renaming anything afterwards
 * would mean re-uploading all of it.
 *
 * No trailing slash: one is added here, so both "https://img.example.com" and
 * "https://img.example.com/" behave the same.
 */
const BASE = (import.meta.env.VITE_IMAGE_BASE_URL ?? '').replace(/\/+$/, '');

/** A path under the image root, wherever that currently is. */
function at(folder: string, file: string): string {
  return `${BASE}/${folder}/${file}`;
}

/**
 * The filename encoding vendorCards.mjs and the logo sync wrote with: anything outside
 * [A-Za-z0-9.-] becomes an underscore and the character's hex code. Must stay byte-exact
 * with server/src/lib/artwork.js — "Black & White" is stored as Black_20_26_20White, and
 * a mismatch here produces a 404 rather than an error anyone would notice.
 */
function safeFileName(value: string | number): string {
  return String(value).replace(
    /[^a-zA-Z0-9.-]/g,
    (c) => '_' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'),
  );
}

/** The 245px card thumbnail that ships with the app. */
export function localCard(id: string | null | undefined): string | null {
  return id ? at('cards', `${safeFileName(id)}.avif`) : null;
}

/** The full-size scan, fetched on demand and cached. Null until something warms it. */
export function localCardLarge(id: string | null | undefined): string | null {
  return id ? at('cards-hi', `${safeFileName(id)}.avif`) : null;
}

export function localSetSymbol(setId: string | null | undefined): string | null {
  return setId ? at('logos', `set-${safeFileName(setId)}-symbol.avif`) : null;
}

function localSetLogo(setId: string | null | undefined): string | null {
  return setId ? at('logos', `set-${safeFileName(setId)}-logo.avif`) : null;
}

function localSeriesLogo(series: string | null | undefined): string | null {
  return series ? at('logos', `series-${safeFileName(series)}.avif`) : null;
}

export function localSprite(dexId: number | null | undefined): string | null {
  return dexId ? at('sprites', `${dexId}.webp`) : null;
}

export function localArtwork(dexId: number | null | undefined): string | null {
  return dexId ? at('artwork', `${dexId}.avif`) : null;
}

/**
 * Rewrites every image address on a card row, in place.
 *
 * In place because a card page holds up to 25,000 of these and copying them all to change
 * five fields is wasted work on a list the user is already waiting for.
 */
export function localiseCard<T extends Record<string, unknown>>(row: T): T {
  const id = row.id as string | undefined;
  const setId = row.setId as string | undefined;
  const series = row.series as string | undefined;

  if ('imageSmall' in row) (row as Record<string, unknown>).imageSmall = localCard(id);
  if ('imageLarge' in row) (row as Record<string, unknown>).imageLarge = localCardLarge(id);
  if ('setSymbolUrl' in row) (row as Record<string, unknown>).setSymbolUrl = localSetSymbol(setId);
  if ('setLogoUrl' in row) (row as Record<string, unknown>).setLogoUrl = localSetLogo(setId);
  if ('seriesLogoUrl' in row) (row as Record<string, unknown>).seriesLogoUrl = localSeriesLogo(series);
  return row;
}

export function localiseCards<T extends Record<string, unknown>>(rows: T[]): T[] {
  for (const row of rows) localiseCard(row);
  return rows;
}
