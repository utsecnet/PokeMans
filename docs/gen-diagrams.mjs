/**
 * Generates the architecture diagrams as standalone SVG files.
 *
 * The SVGs are written to be usable two ways without editing: opened on their own (where the
 * embedded fallback palette and its prefers-color-scheme block apply), or inlined into a page
 * that defines --dg-* tokens (which then win, so the diagrams follow the host page's theme,
 * including an explicit light/dark toggle that a media query alone would miss).
 *
 *   node docs/gen-diagrams.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Every paint reads a host token first and falls back to the file's own palette, which the
// media query below re-points for dark mode.
const STYLE = `
  svg {
    --f-ink:#0d1418; --f-muted:#5b6a77; --f-surface:#ffffff; --f-surface2:#f4f7f9;
    --f-line:#c9d3db; --f-zone:#e7edf2; --f-zoneline:#a9b8c4; --f-accent:#17607d;
    --f-shared:#1f6feb; --f-user:#7b4bb7; --f-secret:#a92e26;
    font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    svg {
      --f-ink:#e6edf3; --f-muted:#93a4b3; --f-surface:#1a2027; --f-surface2:#151b21;
      --f-line:#39444f; --f-zone:#161c22; --f-zoneline:#3d4954; --f-accent:#5cc2e8;
      --f-shared:#6ea8fe; --f-user:#c08cf5; --f-secret:#f0837a;
    }
  }
  .zn   { fill:var(--dg-zone,var(--f-zone)); stroke:var(--dg-zoneline,var(--f-zoneline)); stroke-width:1.25; stroke-dasharray:5 4; }
  .zt   { fill:var(--dg-muted,var(--f-muted)); font-size:12px; font-weight:600; letter-spacing:.09em; text-transform:uppercase;
          font-family:"IBM Plex Mono",ui-monospace,monospace; }
  .zc   { fill:var(--dg-muted,var(--f-muted)); font-size:11.5px; font-family:"IBM Plex Mono",ui-monospace,monospace; }
  .bx   { fill:var(--dg-surface,var(--f-surface)); stroke:var(--dg-line,var(--f-line)); stroke-width:1.25; }
  .bx2  { fill:var(--dg-surface2,var(--f-surface2)); stroke:var(--dg-line,var(--f-line)); stroke-width:1.25; }
  .bt   { fill:var(--dg-ink,var(--f-ink)); font-size:14px; font-weight:600; }
  .bs   { fill:var(--dg-muted,var(--f-muted)); font-size:12px; }
  .bm   { fill:var(--dg-muted,var(--f-muted)); font-size:11.5px; font-family:"IBM Plex Mono",ui-monospace,monospace; }
  .ar   { fill:none; stroke:var(--dg-accent,var(--f-accent)); stroke-width:1.6; }
  .ard  { fill:none; stroke:var(--dg-muted,var(--f-muted)); stroke-width:1.4; stroke-dasharray:5 4; }
  .al   { fill:var(--dg-accent,var(--f-accent)); font-size:11.5px; font-weight:500;
          font-family:"IBM Plex Mono",ui-monospace,monospace; }
  .alm  { fill:var(--dg-muted,var(--f-muted)); font-size:11.5px; font-family:"IBM Plex Mono",ui-monospace,monospace; }
  .tb   { fill:none; stroke:var(--dg-secret,var(--f-secret)); stroke-width:1.4; stroke-dasharray:7 5; opacity:.75; }
  .tbt  { fill:var(--dg-secret,var(--f-secret)); font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase;
          font-family:"IBM Plex Mono",ui-monospace,monospace; }
  .ttl  { fill:var(--dg-ink,var(--f-ink)); font-size:15px; font-weight:700; letter-spacing:.02em;
          font-family:"IBM Plex Sans Condensed","IBM Plex Sans",system-ui,sans-serif; }
  .num  { fill:var(--dg-surface,var(--f-surface)); font-size:11px; font-weight:700;
          font-family:"IBM Plex Mono",ui-monospace,monospace; }
`;

const svg = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>${STYLE}</style>
<defs>
  <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="var(--dg-accent,var(--f-accent))"/>
  </marker>
  <marker id="ahm" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="var(--dg-muted,var(--f-muted))"/>
  </marker>
</defs>
${body}
</svg>`;

const zone = ({ x, y, w, h, label, cost }) => `
<rect class="zn" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>
<text class="zt" x="${x + 14}" y="${y + 21}">${esc(label)}</text>
${cost ? `<text class="zc" x="${x + w - 14}" y="${y + 21}" text-anchor="end">${esc(cost)}</text>` : ''}`;

/** stripe: a classification colour down the left edge, or null. */
const box = ({ x, y, w, h, title, lines = [], stripe = null, alt = false }) => {
  const cls = alt ? 'bx2' : 'bx';
  let s = `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="5"/>`;
  if (stripe) s += `<path d="M${x + 0.5},${y + 5} a5,5 0 0 1 5,-5 h0 v${h - 10} h0 a5,5 0 0 1 -5,-5 z" fill="var(--dg-${stripe},var(--f-${stripe}))"/>
<rect x="${x + 1}" y="${y + 1}" width="4" height="${h - 2}" fill="var(--dg-${stripe},var(--f-${stripe}))"/>`;
  const tx = x + (stripe ? 18 : 14);
  s += `<text class="bt" x="${tx}" y="${y + 23}">${esc(title)}</text>`;
  lines.forEach((ln, i) => {
    const mono = ln.startsWith('`');
    const t = mono ? ln.slice(1) : ln;
    s += `<text class="${mono ? 'bm' : 'bs'}" x="${tx}" y="${y + 42 + i * 16}">${esc(t)}</text>`;
  });
  return s;
};

const arrow = ({ pts, label, lx, ly, anchor = 'middle', muted = false, both = false }) => {
  const d = pts.map((p) => p.join(',')).join(' ');
  const m = muted ? 'ahm' : 'ah';
  let s = `<polyline class="${muted ? 'ard' : 'ar'}" points="${d}" marker-end="url(#${m})"${both ? ` marker-start="url(#${m})"` : ''}/>`;
  if (label) s += `<text class="${muted ? 'alm' : 'al'}" x="${lx}" y="${ly}" text-anchor="${anchor}">${esc(label)}</text>`;
  return s;
};

const step = (n, x, y) => `<circle cx="${x}" cy="${y}" r="9" fill="var(--dg-accent,var(--f-accent))"/>
<text class="num" x="${x}" y="${y + 4}" text-anchor="middle">${n}</text>`;

const heading = (x, y, t) => `<text class="ttl" x="${x}" y="${y}">${esc(t)}</text>`;

/* ── Figure 1 — deployment & hosting boundaries ───────────────────────────── */
const fig1 = () => {
  let b = zone({ x: 60, y: 64, w: 290, h: 190, label: 'Client', cost: 'untrusted' });
  b += box({ x: 80, y: 108, w: 250, h: 120, title: 'Browser', lines: ['React SPA (Vite build)', '`364 KB JS / 107 KB gzip', 'Holds: anon key, session JWT'] });

  b += zone({ x: 60, y: 286, w: 290, h: 118, label: 'Cloudflare Pages', cost: '$0' });
  b += box({ x: 80, y: 326, w: 250, h: 58, title: 'Static bundle + CDN', lines: ['No compute, no secrets'] });

  b += zone({ x: 60, y: 470, w: 290, h: 118, label: 'Image CDN · third party', cost: '$0' });
  b += box({ x: 80, y: 510, w: 250, h: 58, title: 'images.pokemontcg.io', lines: ['Hotlinked — never proxied'], alt: true });

  b += zone({ x: 412, y: 64, w: 320, h: 340, label: 'Fly.io · region iad', cost: '$3.32/mo' });
  b += box({ x: 432, y: 112, w: 280, h: 180, title: 'Machine — shared-cpu-1x, 512 MB' });
  b += box({ x: 448, y: 150, w: 248, h: 66, title: 'Express API (Node 24)', lines: ['`/api/* · /internal/sync'], alt: true });
  b += box({ x: 448, y: 226, w: 248, h: 50, title: 'Fly secrets', lines: ['`SECRETS_DEK, SERVICE_ROLE'], stripe: 'secret', alt: true });

  b += zone({ x: 412, y: 470, w: 320, h: 118, label: 'GitHub Actions', cost: '$0' });
  b += box({ x: 432, y: 510, w: 280, h: 58, title: 'Daily sync — 06:00 UTC', lines: ['Also keeps Supabase awake'] });

  b += zone({ x: 794, y: 64, w: 338, h: 340, label: 'Supabase · managed', cost: 'free tier — $0' });
  b += box({ x: 814, y: 112, w: 298, h: 76, title: 'Auth (GoTrue)', lines: ['Google · Facebook · Discord', '`50,000 MAU included'] });
  b += box({ x: 814, y: 214, w: 298, h: 90, title: 'Postgres 17', lines: ['Row Level Security enforced', '`500 MB — catalogue is 11 MB'] });
  b += box({ x: 814, y: 326, w: 298, h: 56, title: 'No code of ours runs here', lines: ['Managed service only'], alt: true });

  b += zone({ x: 794, y: 470, w: 338, h: 172, label: 'Third-party APIs', cost: 'untrusted' });
  b += box({ x: 814, y: 510, w: 298, h: 112, title: 'Outbound only', lines: ['TCGdex — catalogue + prices', 'PokemonPriceTracker — history', 'Frankfurter (ECB) — FX rates', 'PokeAPI — species data'], alt: true });

  // Flows
  b += arrow({ pts: [[205, 228], [205, 320]], label: 'static bundle', lx: 213, ly: 278, anchor: 'start' });
  b += arrow({ pts: [[80, 190], [36, 190], [36, 539], [74, 539]], label: 'card art', lx: 46, ly: 452, anchor: 'start', muted: true });
  b += arrow({ pts: [[330, 168], [381, 168], [381, 183], [426, 183]], label: 'HTTPS + JWT', lx: 356, ly: 152, anchor: 'middle' });
  b += arrow({ pts: [[205, 108], [205, 36], [963, 36], [963, 106]], label: 'OAuth redirect — Google / Facebook', lx: 584, ly: 28, anchor: 'middle' });
  b += arrow({ pts: [[696, 183], [753, 183], [753, 250], [808, 250]], label: 'SQL', lx: 757, ly: 218, anchor: 'start' });
  b += arrow({ pts: [[500, 510], [500, 298]], label: 'POST /internal/sync', lx: 492, ly: 440, anchor: 'end' });
  b += arrow({ pts: [[572, 292], [572, 432], [963, 432], [963, 504]], label: 'daily fetch', lx: 770, ly: 424, anchor: 'middle' });

  b += heading(60, 678, 'Figure 1 · Hosting boundaries — what runs where');

  return svg(1160, 700, b, 'Hosting boundaries: browser, Cloudflare Pages, Fly.io, Supabase, GitHub Actions and third-party APIs');
};

/* ── Figure 2 — data flow & trust boundaries ──────────────────────────────── */
const fig2 = () => {
  let b = heading(40, 34, 'Figure 2 · Data flow across trust boundaries (Postgres)');

  // Trust boundaries
  b += `<line class="tb" x1="300" y1="56" x2="300" y2="792"/>`;
  b += `<text class="tbt" x="306" y="70">TB1 · internet → API</text>`;
  b += `<line class="tb" x1="700" y1="56" x2="700" y2="660"/>`;
  b += `<text class="tbt" x="706" y="70">TB2 · API → data (RLS)</text>`;
  b += `<rect class="tb" x="336" y="686" width="792" height="106" rx="8"/>`;
  b += `<text class="tbt" x="352" y="706">TB3 · outbound to untrusted third parties</text>`;

  // External entities
  b += box({ x: 40, y: 92, w: 240, h: 78, title: 'User', lines: ['Browser · unauthenticated', 'until step 1 completes'] });
  b += box({ x: 40, y: 560, w: 240, h: 78, title: 'Scheduler', lines: ['GitHub Actions', '`shared secret header'] });

  // Processes
  b += box({ x: 340, y: 92, w: 300, h: 66, title: '1.0  Authenticate', lines: ['Supabase GoTrue · issues JWT'] });
  b += box({ x: 340, y: 186, w: 300, h: 66, title: '2.0  Browse catalogue', lines: ['Public read · no user context'] });
  b += box({ x: 340, y: 280, w: 300, h: 82, title: '3.0  Read / write collection', lines: ['`auth.uid() bound to every row', 'Express API on Fly'] });
  b += box({ x: 340, y: 390, w: 300, h: 82, title: '4.0  Read price history', lines: ['Filters on license_class', 'before any aggregate'] });
  b += box({ x: 340, y: 560, w: 300, h: 82, title: '5.0  Sync worker', lines: ['Catalogue + prices + FX', 'Service role — bypasses RLS'] });

  // Data stores — shared
  b += `<rect class="zn" x="736" y="86" width="392" height="228" rx="8"/>`;
  b += `<text class="zt" x="750" y="107">Shared · read-only to clients</text>`;
  b += box({ x: 752, y: 120, w: 360, h: 56, title: 'catalog.*', lines: ['`cards 20,444 · variants 32,974'], stripe: 'shared' });
  b += box({ x: 752, y: 184, w: 360, h: 56, title: 'market.price_history', lines: ["`license_class = 'shareable'"], stripe: 'shared' });
  b += box({ x: 752, y: 248, w: 360, h: 52, title: 'market.fx_rates', lines: ['`ECB daily, per-date'], stripe: 'shared' });

  // Data stores — per user
  b += `<rect class="zn" x="736" y="336" width="392" height="304" rx="8"/>`;
  b += `<text class="zt" x="750" y="357">Per user · RLS user_id = auth.uid()</text>`;
  b += box({ x: 752, y: 370, w: 360, h: 56, title: 'app.collection_boxes / entries', lines: ['`the irreplaceable data'], stripe: 'user' });
  b += box({ x: 752, y: 434, w: 360, h: 52, title: 'app.user_settings', lines: ['`display currency, theme'], stripe: 'user' });
  b += box({ x: 752, y: 494, w: 360, h: 56, title: 'market.price_history', lines: ["`license_class = 'per_user'"], stripe: 'user' });
  b += box({ x: 752, y: 558, w: 360, h: 66, title: 'app.linked_accounts', lines: ['AES-256-GCM ciphertext only', '`key never leaves Fly secrets'], stripe: 'secret' });

  // Third parties
  b += box({ x: 356, y: 716, w: 230, h: 58, title: 'TCGdex', lines: ['Catalogue + spot prices'], alt: true });
  b += box({ x: 606, y: 716, w: 250, h: 58, title: 'PokemonPriceTracker', lines: ["User's own key"], alt: true });
  b += box({ x: 876, y: 716, w: 232, h: 58, title: 'Frankfurter · PokeAPI', lines: ['FX + species'], alt: true });

  // Flows
  b += arrow({ pts: [[280, 118], [340, 118]] }) + step(1, 310, 118);
  b += arrow({ pts: [[280, 140], [312, 140], [312, 214], [340, 214]] }) + step(2, 312, 186);
  b += arrow({ pts: [[280, 152], [296, 152], [296, 316], [340, 316]] }) + step(3, 296, 280);
  b += arrow({ pts: [[280, 164], [288, 164], [288, 424], [340, 424]] }) + step(4, 288, 390);
  b += arrow({ pts: [[280, 596], [340, 596]] }) + step(5, 310, 596);

  b += arrow({ pts: [[640, 214], [700, 214], [700, 148], [746, 148]] });
  b += arrow({ pts: [[640, 320], [690, 320], [690, 398], [746, 398]] });
  b += arrow({ pts: [[640, 424], [676, 424], [676, 212], [746, 212]], muted: true });
  b += arrow({ pts: [[640, 448], [664, 448], [664, 522], [746, 522]], muted: true });
  b += arrow({ pts: [[640, 584], [716, 584], [716, 276], [746, 276]] });
  b += arrow({ pts: [[640, 616], [724, 616], [724, 586], [746, 586]] });

  b += arrow({ pts: [[490, 642], [490, 710]], label: 'fetch', lx: 498, ly: 672, anchor: 'start' });
  b += arrow({ pts: [[540, 642], [540, 672], [731, 672], [731, 710]], muted: true });

  return svg(1168, 812, b, 'Data flow diagram showing trust boundaries between browser, API, Postgres and third-party services');
};

/* ── Figure 3 — price licence routing ─────────────────────────────────────── */
const fig3 = () => {
  let b = heading(40, 34, 'Figure 3 · How a price row is classified — the licence-critical path');

  b += box({ x: 372, y: 62, w: 264, h: 58, title: 'Price fetched for a card', lines: ['Sync worker, step 5.0'] });

  b += `<path d="M504,146 L616,196 L504,246 L392,196 Z" class="bx"/>`;
  b += `<text class="bt" x="504" y="192" text-anchor="middle">Whose credential</text>`;
  b += `<text class="bt" x="504" y="210" text-anchor="middle">paid for it?</text>`;
  b += arrow({ pts: [[504, 120], [504, 140]] });

  b += box({ x: 40, y: 300, w: 360, h: 82, title: 'Your business licence', lines: ['One server key, amortised', '`license_class = \'shareable\''], stripe: 'shared' });
  b += box({ x: 608, y: 300, w: 360, h: 82, title: "The user's own API key", lines: ['They hold the licence, not you', '`license_class = \'per_user\', user_id set'], stripe: 'user' });

  b += arrow({ pts: [[392, 196], [220, 196], [220, 294]], label: 'server key', lx: 300, ly: 186, anchor: 'middle' });
  b += arrow({ pts: [[616, 196], [788, 196], [788, 294]], label: 'user key', lx: 706, ly: 186, anchor: 'middle' });

  b += box({ x: 40, y: 424, w: 360, h: 96, title: 'Shared bucket', lines: ['Readable by every user', 'Feeds market aggregates and', 'the public price charts'], stripe: 'shared' });
  b += box({ x: 608, y: 424, w: 360, h: 96, title: 'Private to that user', lines: ['RLS: user_id = auth.uid()', 'Excluded from every aggregate', 'Deleted with their account'], stripe: 'user' });

  b += arrow({ pts: [[220, 382], [220, 418]] });
  b += arrow({ pts: [[788, 382], [788, 418]] });

  b += `<rect class="bx" x="40" y="562" width="928" height="82" rx="5"/>`;
  b += `<rect x="41" y="563" width="4" height="80" fill="var(--dg-secret,var(--f-secret))"/>`;
  b += `<text class="bt" x="58" y="588">The failure mode this prevents</text>`;
  b += `<text class="bs" x="58" y="609">A "market average" computed over whatever rows happen to be present republishes data one user</text>`;
  b += `<text class="bs" x="58" y="627">licensed privately to everyone else. Aggregates must filter on license_class — not on table membership.</text>`;

  return svg(1008, 672, b, 'Decision path classifying a price row as shareable or per-user, and what each classification permits');
};

const files = [['deployment.svg', fig1()], ['dataflow.svg', fig2()], ['price-licence-routing.svg', fig3()]];
for (const [name, content] of files) {
  writeFileSync(join(OUT, name), content, 'utf8');
  console.log(`${name.padEnd(28)} ${(content.length / 1024).toFixed(1)} KB`);
}

/* ── Figure 4 — the whole system, laptop to production ────────────────────── */
const fig4 = () => {
  let b = '';

  /* Row 1 — where code comes from */
  b += zone({ x: 40, y: 70, w: 380, h: 180, label: 'Your laptop' });
  b += box({ x: 60, y: 108, w: 340, h: 60, title: 'Claude Code', lines: ['Edits, builds, runs 298 tests'] });
  b += box({ x: 60, y: 186, w: 340, h: 54, title: 'One git repo', lines: ['`main + feature branches — no mirror'] });
  b += arrow({ pts: [[230, 168], [230, 180]] });

  b += zone({ x: 460, y: 70, w: 320, h: 180, label: 'GitHub · private', cost: '$0' });
  b += box({ x: 480, y: 108, w: 280, h: 58, title: 'main', lines: ['Merging here deploys'] });
  b += box({ x: 480, y: 182, w: 280, h: 58, title: 'feature/*', lines: ['PR → CI → preview URL'] });

  b += zone({ x: 820, y: 70, w: 540, h: 180, label: 'GitHub Actions', cost: '$0' });
  b += box({ x: 840, y: 104, w: 236, h: 54, title: 'ci.yml', lines: ['`lint · build · 298 tests'] });
  b += box({ x: 1104, y: 104, w: 236, h: 54, title: 'migrate.yml', lines: ['`supabase db push'] });
  b += box({ x: 840, y: 172, w: 236, h: 54, title: 'deploy-api.yml', lines: ['`flyctl deploy'] });
  b += box({ x: 1104, y: 172, w: 236, h: 54, title: 'sync-prices.yml', lines: ['`schedule · 06:00 UTC'] });

  b += arrow({ pts: [[400, 210], [474, 210]], label: 'git push', lx: 437, ly: 200 });
  b += arrow({ pts: [[760, 137], [800, 137], [800, 131], [834, 131]], label: 'push', lx: 800, ly: 154 });
  b += arrow({ pts: [[1076, 131], [1098, 131]] });
  b += arrow({ pts: [[1222, 158], [1222, 165], [958, 165], [958, 166]] });

  /* Row 2 — production */
  b += zone({ x: 40, y: 326, w: 380, h: 334, label: 'Cloudflare Pages', cost: '$0' });
  b += box({ x: 60, y: 370, w: 340, h: 66, title: 'Native GitHub integration', lines: ['Builds on push — no workflow'] });
  b += box({ x: 60, y: 452, w: 340, h: 66, title: 'Static bundle · global CDN', lines: ['`React SPA — 107 KB gzip'] });
  b += box({ x: 60, y: 534, w: 340, h: 66, title: 'Preview URL per branch', lines: ['Free, on every PR'] });

  b += zone({ x: 460, y: 326, w: 440, h: 334, label: 'Fly.io · region iad', cost: '$3.32/mo' });
  b += box({ x: 480, y: 370, w: 400, h: 190, title: 'Machine — shared-cpu-1x, 512 MB' });
  b += box({ x: 496, y: 408, w: 368, h: 58, title: 'Express API', lines: ['`/api/* — serves the browser'], alt: true });
  b += box({ x: 496, y: 478, w: 368, h: 58, title: 'Sync worker', lines: ['`/internal/sync — service role'], alt: true });
  b += box({ x: 480, y: 576, w: 400, h: 68, title: 'Fly secrets', lines: ['`SECRETS_DEK · SERVICE_ROLE', '`SYNC_SHARED_SECRET'], stripe: 'secret' });

  b += zone({ x: 940, y: 326, w: 420, h: 334, label: 'Supabase · managed', cost: 'free tier — $0' });
  b += box({ x: 960, y: 370, w: 380, h: 72, title: 'Auth (GoTrue)', lines: ['Issues and verifies the JWT', '`50,000 MAU included'] });
  b += box({ x: 960, y: 458, w: 380, h: 88, title: 'Postgres 17', lines: ['`catalog · market · app schemas', 'RLS on every per-user table'] });
  b += box({ x: 960, y: 562, w: 380, h: 82, title: 'One database', lines: ['No branching on the free tier —', 'migrations use expand / contract'], alt: true });

  /* Deploy paths */
  b += arrow({ pts: [[560, 250], [560, 306], [230, 306], [230, 320]], label: 'build on push', lx: 352, ly: 298 });
  b += arrow({ pts: [[900, 226], [900, 282], [620, 282], [620, 320]], label: 'flyctl deploy', lx: 742, ly: 274 });
  b += arrow({ pts: [[1222, 226], [1222, 300], [800, 300], [800, 320]], label: 'daily trigger', lx: 1010, ly: 292 });
  b += arrow({ pts: [[1340, 131], [1376, 131], [1376, 312], [1150, 312], [1150, 320]], label: 'db push', lx: 1264, ly: 304 });

  /* Runtime */
  b += zone({ x: 40, y: 710, w: 380, h: 210, label: 'Anyone with the link', cost: 'untrusted' });
  b += box({ x: 60, y: 752, w: 340, h: 120, title: 'Browser', lines: ['React SPA', '`anon key + session JWT', 'Fetches card art directly'] });

  b += zone({ x: 460, y: 710, w: 900, h: 210, label: 'Third parties · untrusted' });
  b += box({ x: 480, y: 752, w: 190, h: 120, title: 'Card art', lines: ['images.', 'pokemontcg.io', 'Hotlinked'], alt: true });
  b += box({ x: 686, y: 752, w: 220, h: 120, title: 'Catalogue', lines: ['TCGdex', 'PokeAPI'], alt: true });
  b += box({ x: 922, y: 752, w: 210, h: 120, title: 'Prices + FX', lines: ['PokemonPrice-', 'Tracker', 'Frankfurter (ECB)'], alt: true });
  b += box({ x: 1148, y: 752, w: 192, h: 120, title: 'Social OAuth', lines: ['Google', 'Facebook'], alt: true });

  b += arrow({ pts: [[230, 748], [230, 666]], label: 'loads the SPA', lx: 238, ly: 706, anchor: 'start' });
  b += arrow({ pts: [[400, 786], [436, 786], [436, 692], [620, 692], [620, 666]], label: 'API calls · JWT', lx: 530, ly: 686 });
  b += arrow({ pts: [[400, 884], [1244, 884], [1244, 876]], label: 'sign-in redirect', lx: 700, ly: 906 });
  b += arrow({ pts: [[1244, 664], [1244, 746]], label: 'callback + JWT', lx: 1252, ly: 706, anchor: 'start', both: true });
  b += arrow({ pts: [[400, 812], [474, 812]], label: 'card art', lx: 437, ly: 803, muted: true });
  b += arrow({ pts: [[796, 664], [796, 746]], label: 'fetch', lx: 804, ly: 706, anchor: 'start' });
  b += arrow({ pts: [[880, 664], [880, 716], [1027, 716], [1027, 746]] });
  b += arrow({ pts: [[864, 437], [912, 437], [912, 502], [954, 502]], label: 'SQL', lx: 916, ly: 470, anchor: 'start' });

  b += heading(40, 962, 'Figure 4 · The whole system — laptop to production');
  return svg(1400, 984, b, 'End-to-end map from Claude Code on the laptop through GitHub and CI to Cloudflare, Fly.io, Supabase and third-party services');
};

writeFileSync(join(OUT, 'system-map.svg'), fig4(), 'utf8');
console.log('system-map.svg'.padEnd(28) + (fig4().length / 1024).toFixed(1) + ' KB');


/* ── Figure 5 — hosted price schema ───────────────────────────────────────── */

const fig5 = () => {
  let b = '';

  b += heading(40, 44, 'Figure 5 · Hosted price schema — what lives in Postgres and what stays on the device');

  /* Hosted */
  b += zone({ x: 40, y: 70, w: 700, h: 470, label: 'Supabase · Postgres', cost: 'shared + live' });

  b += box({
    x: 64, y: 116, w: 320, h: 176, stripe: 'shared',
    title: 'price_current',
    lines: [
      '`PK card_id, variant_position, source',
      '`currency, market, low',
      '`captured_on, updated_at',
      'One row per priced thing. Rewritten',
      'every run, changed or not, so a lookup',
      'is a PK hit. ~39k rows, fixed size.',
    ],
  });

  b += box({
    x: 400, y: 116, w: 320, h: 176, stripe: 'shared',
    title: 'price_history',
    lines: [
      '`PK id · UQ card, variant, source, day',
      '`currency, market, low, captured_on',
      'Append-only, changes only. 87.3% of',
      'days are unchanged, so this holds ~13%',
      'of a full snapshot. A step series, not',
      'a line. ~5k rows/day · ~1.8M/year',
    ],
  });

  b += box({
    x: 64, y: 316, w: 320, h: 128,
    title: 'sync_run',
    lines: [
      '`started_at, finished_at, status',
      '`cards_seen, changed, failed',
      'The job fails silently otherwise, and',
      'a missed day cannot be recovered —',
      'upstreams only ever serve today.',
    ],
  });

  b += box({
    x: 400, y: 316, w: 320, h: 128,
    title: 'record_prices(jsonb)',
    lines: [
      'Upserts the batch into current and',
      'appends only genuine changes to',
      'history. The diff happens in the',
      'database, so the job never fetches',
      'previous values to compare.',
    ],
  });

  b += `<text class="zc" x="64" y="472">RLS on, no read policy — the anon key ships in any client bundle that uses it,</text>`;
  b += `<text class="zc" x="64" y="492">and that would be public redistribution of free-tier price data.</text>`;

  /* On the device */
  b += zone({ x: 780, y: 70, w: 580, h: 470, label: 'On the device · SQLite', cost: 'static + personal' });

  b += box({
    x: 804, y: 116, w: 252, h: 176,
    title: 'catalog.sqlite',
    lines: [
      '`tcg_cards · tcg_card_variants',
      '`tcg_sets · pokemon · abilities',
      'Shared, but static — changes a',
      'few times a year. Synced down,',
      'queried locally. 11 MB.',
    ],
    alt: true,
  });

  b += box({
    x: 1072, y: 116, w: 264, h: 176, stripe: 'user',
    title: 'personal.sqlite',
    lines: [
      '`collection_boxes · collection_entries',
      '`want_lists · want_list_entries',
      '`settings · linked_accounts · fx_rates',
      'User data. Never leaves the device',
      'until there are users to scope it to.',
    ],
    alt: true,
  });

  b += box({
    x: 804, y: 316, w: 532, h: 150,
    title: 'Why the catalogue is not hosted',
    lines: [
      'The advanced search falls back to filtering the whole catalogue in the',
      'client when a query uses operators SQL cannot push down. Measured at',
      '12.4 MB and 8.7 s over loopback. Remote, that is not a slow feature —',
      'it is a broken one, and the app stops working offline.',
    ],
  });

  /* Runtime */
  b += zone({ x: 40, y: 566, w: 1320, h: 150, label: 'Daily refresh' });

  b += box({ x: 64, y: 606, w: 250, h: 88, title: 'GitHub Action', lines: ['20,444 cards, concurrency 8', 'Measured: 4.8 min · 43 MB'] });
  b += box({ x: 350, y: 606, w: 230, h: 88, title: 'TCGdex', lines: ['One request per card', 'Both marketplaces, daily'], alt: true });
  b += box({ x: 1090, y: 606, w: 246, h: 88, title: 'App server', lines: ['convert() · ensureRates()', 'latestPricesFor() unchanged'] });

  b += arrow({ pts: [[314, 650], [344, 650]], label: 'fetch', lx: 329, ly: 641, both: true });
  // The write path runs up the left margin, outside both zones, so it crosses nothing.
  b += arrow({ pts: [[189, 604], [189, 552], [26, 552], [26, 200], [58, 200]], label: 'record_prices()', lx: 112, ly: 544 });
  // The read path uses the 40px gap between the two zones for its vertical leg.
  b += arrow({ pts: [[1086, 660], [760, 660], [760, 300], [744, 300]], label: 'reads current + history', lx: 925, ly: 652 });

  b += `<text class="zc" x="596" y="706">Do not trust GitHub’s schedule: trigger · late by 10–60 min, self-disables after 60 days idle</text>`;

  return svg(1400, 740, b, 'Hosted price schema: price_current, price_history and sync_run in Supabase, with catalogue and personal data on the device');
};

writeFileSync(join(OUT, 'price-schema.svg'), fig5(), 'utf8');
console.log('price-schema.svg'.padEnd(28) + (fig5().length / 1024).toFixed(1) + ' KB');
