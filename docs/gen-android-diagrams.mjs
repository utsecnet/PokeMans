import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrow, box, heading, step, svg, zone } from './diagram-kit.mjs';

/**
 * Generates the Android architecture diagrams.
 *
 *   node docs/gen-android-diagrams.mjs
 */
const OUT = dirname(fileURLToPath(import.meta.url));

const write = (name, content) => {
  writeFileSync(join(OUT, name), content, 'utf8');
  console.log(name.padEnd(32) + (content.length / 1024).toFixed(1) + ' KB');
};

/* ── A1 — what runs where ─────────────────────────────────────────────────── */

const figA1 = () => {
  let b = '';
  b += heading(40, 44, 'Figure A1 · What runs where — the app is the whole application, not a client');

  b += zone({ x: 40, y: 70, w: 640, h: 470, label: 'Android device', cost: 'app-private' });

  b += box({
    x: 64, y: 116, w: 592, h: 118,
    title: 'WebView',
    lines: [
      'The React app, unchanged. 10,451 lines including 1,507 of CSS 3D transforms,',
      '@property animations, mask compositing and drawn SVG — the tilt card, the foil',
      'reveal, the 57 line icons. None of it survives a React Native rewrite, which is',
      'the single reason this is a WebView shell and not RN.',
    ],
  });

  b += box({
    x: 64, y: 254, w: 288, h: 128,
    title: 'Query layer (was Express)',
    lines: [
      '`buildCardFilter · latestPricesFor',
      '`convert · ensureRates',
      'Ported to async and moved into the',
      'app. There is no localhost server on',
      'a phone.',
    ],
  });

  b += box({
    x: 368, y: 254, w: 288, h: 128, stripe: 'user',
    title: 'SQLite (native)',
    lines: [
      '`catalog.db  ~11 MB, re-downloadable',
      '`personal.db ~240 KB, irreplaceable',
      '/data/data/<pkg>/databases/',
      'Unreadable by other apps, removed on',
      'uninstall.',
    ],
  });

  b += box({
    x: 64, y: 402, w: 288, h: 112, stripe: 'secret',
    title: 'Android Keystore',
    lines: [
      'API keys via EncryptedShared-',
      'Preferences. Key material is',
      'hardware-backed and never enters',
      'the process — unlike ciphertext in a',
      'table with the key beside it.',
    ],
  });

  b += box({
    x: 368, y: 402, w: 288, h: 112,
    title: 'Auto Backup',
    lines: [
      'personal.db included (240 KB, well',
      'under the 25 MB ceiling).',
      'catalog.db excluded — it can be',
      'fetched again. This is the OS-level',
      'protection against an accidental wipe.',
    ],
  });

  /* Hosted */
  b += zone({ x: 720, y: 70, w: 640, h: 210, label: 'Hosted', cost: 'shared + live' });
  b += box({
    x: 744, y: 116, w: 288, h: 140, stripe: 'shared',
    title: 'Supabase · Postgres',
    lines: [
      '`price_current  ~39k rows, fixed',
      '`price_history  delta only, ~1.8M/yr',
      'Read through the app, not by the',
      'browser: the anon key would ship in',
      'the bundle.',
    ],
  });
  b += box({
    x: 1048, y: 116, w: 288, h: 140,
    title: 'GitHub Actions',
    lines: [
      'Daily price pass. 20,444 cards at',
      'concurrency 8 — measured 4.8 min,',
      '43 MB, zero failures.',
      'Triggered by pg_cron, not by',
      'schedule:, which self-disables.',
    ],
  });

  /* Third parties */
  b += zone({ x: 720, y: 300, w: 640, h: 240, label: 'Third parties · untrusted' });
  b += box({ x: 744, y: 346, w: 288, h: 92, title: 'TCGdex', lines: ['Catalogue + prices', 'Both marketplaces, daily'], alt: true });
  b += box({ x: 1048, y: 346, w: 288, h: 92, title: 'PokeAPI', lines: ['Species, stats, evolutions'], alt: true });
  b += box({
    x: 744, y: 458, w: 592, h: 62,
    title: 'Card art CDNs — fetched by the WebView directly, never proxied',
    lines: [],
    alt: true,
  });

  b += arrow({ pts: [[656, 175], [740, 175], [740, 178]], label: 'prices', lx: 698, ly: 166 });
  b += arrow({ pts: [[1192, 260], [1192, 342]], label: 'fetch', lx: 1200, ly: 302, anchor: 'start' });
  b += arrow({ pts: [[888, 260], [888, 342]], both: true });
  b += arrow({ pts: [[360, 175], [700, 175], [700, 470], [740, 470]], label: 'images', lx: 620, ly: 462, muted: true });

  return svg(1400, 570, b, 'What runs where: the Android app holds the query layer and both databases; Supabase holds prices; GitHub Actions refreshes them daily');
};

/* ── A2 — the storage model ───────────────────────────────────────────────── */

const figA2 = () => {
  let b = '';
  b += heading(40, 44, 'Figure A2 · Storage — where each kind of data goes, and why');

  b += zone({ x: 40, y: 70, w: 1320, h: 300, label: 'App-private internal storage · /data/data/net.utsec.pokemans/', cost: 'the %appdata% replacement' });

  b += box({
    x: 64, y: 116, w: 410, h: 234, stripe: 'user',
    title: 'databases/personal.db',
    lines: [
      '`collection_boxes · collection_entries',
      '`want_lists · want_list_entries',
      '`card_price_history · fx_rates',
      '`settings',
      'Irreplaceable. Nothing upstream can',
      'reconstruct which cards you own, and a',
      'price day not captured is gone —',
      'the sources only ever serve today.',
      'INCLUDED in Auto Backup.',
    ],
  });

  b += box({
    x: 494, y: 116, w: 410, h: 234,
    title: 'databases/catalog.db',
    lines: [
      '`tcg_cards · tcg_card_variants',
      '`tcg_sets · tcg_series',
      '`pokemon · abilities · evolutions',
      '~11 MB, 20,444 cards.',
      'Shared but static — changes a handful',
      'of times a year, when a set drops.',
      'Re-downloadable, so it is EXCLUDED',
      'from Auto Backup and shipped or',
      'fetched on first run.',
    ],
  });

  b += box({
    x: 924, y: 116, w: 412, h: 234, stripe: 'secret',
    title: 'EncryptedSharedPreferences',
    lines: [
      'PokemonPriceTracker API key',
      'Supabase read credential',
      'Moved out of the database entirely.',
      'linked_accounts held ciphertext with',
      'the key elsewhere on disk, which is a',
      'reasonable desktop compromise and the',
      'wrong answer on a device that has a',
      'hardware-backed Keystore.',
    ],
  });

  b += zone({ x: 40, y: 396, w: 1320, h: 150, label: 'Ruled out' });
  b += box({
    x: 64, y: 436, w: 410, h: 92,
    title: 'External / shared storage',
    lines: ['World-readable. Collection data has no business there,', 'and scoped storage makes it awkward regardless.'],
    alt: true,
  });
  b += box({
    x: 494, y: 436, w: 410, h: 92,
    title: 'localStorage / IndexedDB only',
    lines: ['The advanced query language is SQL. Reimplementing it', 'over IndexedDB means rewriting the feature, not porting it.'],
    alt: true,
  });
  b += box({
    x: 924, y: 436, w: 412, h: 92,
    title: 'Everything hosted, nothing local',
    lines: ['Kills offline. A collection app is used at shows and', 'conventions, which is exactly where signal is worst.'],
    alt: true,
  });

  return svg(1400, 576, b, 'Storage model: personal data and catalogue in app-private SQLite, secrets in the Keystore, with the rejected alternatives and why');
};

/* ── A3 — the async seam ──────────────────────────────────────────────────── */

const figA3 = () => {
  let b = '';
  b += heading(40, 44, 'Figure A3 · The async port — the expensive part, done before Capacitor is in the picture');

  b += zone({ x: 40, y: 70, w: 1320, h: 176, label: 'Today · synchronous' });
  b += box({ x: 64, y: 112, w: 300, h: 110, title: 'Routes', lines: ['`const rows = all(sql, params)', 'Returns rows, not a promise.', '260 call sites, 27 files.'] });
  b += box({ x: 388, y: 112, w: 300, h: 110, title: 'node:sqlite', lines: ['`DatabaseSync', 'In-process. A query is a', 'function call.'] });
  b += box({ x: 712, y: 112, w: 300, h: 110, title: 'Express', lines: ['Runs on localhost.', 'Has no equivalent on a phone.'] });
  b += box({ x: 1036, y: 112, w: 300, h: 110, title: 'Browser', lines: ['Fetches /api/*'], alt: true });

  b += zone({ x: 40, y: 274, w: 1320, h: 176, label: 'After · asynchronous, still on the desktop' });
  b += box({ x: 64, y: 316, w: 300, h: 110, title: 'Routes', lines: ['`const rows = await db.all(...)', 'Await pushes up through every', 'caller. This is the whole job.'] });
  b += box({ x: 388, y: 316, w: 300, h: 110, stripe: 'shared', title: 'SqlDatabase', lines: ['`all · get · run · exec', '`transaction', 'One interface, two drivers.'] });
  b += box({ x: 712, y: 316, w: 300, h: 110, title: 'node:sqlite driver', lines: ['Wrapped to return promises.', 'Express still runs, browser still', 'works — so this step is testable.'] });
  b += box({ x: 1036, y: 316, w: 300, h: 110, title: 'Browser', lines: ['Unchanged'], alt: true });

  b += zone({ x: 40, y: 478, w: 1320, h: 176, label: 'Then · the same code on Android' });
  b += box({ x: 64, y: 520, w: 300, h: 110, title: 'Routes', lines: ['Unchanged from the step above.', 'Already async, already tested.'] });
  b += box({ x: 388, y: 520, w: 300, h: 110, stripe: 'shared', title: 'SqlDatabase', lines: ['Same interface.'] });
  b += box({ x: 712, y: 520, w: 300, h: 110, stripe: 'user', title: 'Capacitor SQLite driver', lines: ['Crosses the WebView bridge.', 'Cannot be synchronous — which is', 'why the conversion is unavoidable.'] });
  b += box({ x: 1036, y: 520, w: 300, h: 110, title: 'WebView', lines: ['Calls the query layer directly.', 'No HTTP, no server.'], alt: true });

  b += arrow({ pts: [[700, 226], [700, 310]], label: 'the work', lx: 708, ly: 270, anchor: 'start' });
  b += arrow({ pts: [[700, 430], [700, 514]], label: 'swap the driver', lx: 708, ly: 474, anchor: 'start' });

  b += `<text class="zc" x="64" y="676">Doing the conversion first means an async bug and a native-shell bug are never being diagnosed at the same time.</text>`;

  return svg(1400, 700, b, 'The async port in three stages: synchronous today, asynchronous on the desktop where it is testable, then the same code on Android with the driver swapped');
};

/* ── A4 — phases ──────────────────────────────────────────────────────────── */

const figA4 = () => {
  let b = '';
  b += heading(40, 44, 'Figure A4 · Order of work — each phase verifiable before the next begins');

  const phases = [
    ['Async port', 'The 260 call sites. Desktop only,', 'Express still running, browser still', 'testable. No Android SDK needed.'],
    ['Hosted prices', 'Supabase schema, the daily Action,', 'and the app reading price_current.', 'Independent of mobile.'],
    ['Capacitor shell', 'cap add android. Swap the driver.', 'First build on an emulator.', 'Needs Android Studio.'],
    ['Touch', 'Drag-and-drop is dead on touch.', 'Bottom sheet for the rail. Hit', 'targets. Swipe to remove.'],
    ['Play', 'Privacy policy, data safety form,', 'target API. Internal → closed →', 'production. 12 testers, 14 days.'],
  ];

  let x = 64;
  phases.forEach((p, i) => {
    b += box({ x, y: 96, w: 240, h: 168, title: p[0], lines: p.slice(1), stripe: i === 0 ? 'shared' : null });
    b += step(i + 1, x + 20, 296);
    if (i < phases.length - 1) b += arrow({ pts: [[x + 244, 180], [x + 260, 180]] });
    x += 264;
  });

  b += `<text class="zc" x="64" y="352">Phase 1 is the only one on the critical path. Everything after it is additive, and phase 2 is useful whether or not the app ships.</text>`;
  b += `<text class="zc" x="64" y="374">The 14-day tester gate in phase 5 is a calendar constraint, not a work item — start it as soon as anything installs.</text>`;

  return svg(1400, 400, b, 'Five phases: async port, hosted prices, Capacitor shell, touch redesign, Play Store');
};

write('android-system.svg', figA1());
write('android-storage.svg', figA2());
write('android-async-port.svg', figA3());
write('android-phases.svg', figA4());
