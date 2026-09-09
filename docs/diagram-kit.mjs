/**
 * Shared drawing kit for the architecture diagrams.
 *
 * The SVGs are written to be usable two ways without editing: opened on their own (where the
 * embedded fallback palette and its prefers-color-scheme block apply), or inlined into a page
 * that defines --dg-* tokens (which then win, so the diagrams follow the host page's theme,
 * including an explicit light/dark toggle that a media query alone would miss).
 *
 * Extracted so the desktop and Android figures cannot drift into two visual languages.
 */

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Every paint reads a host token first and falls back to the file's own palette, which the
// media query below re-points for dark mode.
export const STYLE = `
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

export const svg = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
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

export const zone = ({ x, y, w, h, label, cost }) => `
<rect class="zn" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>
<text class="zt" x="${x + 14}" y="${y + 21}">${esc(label)}</text>
${cost ? `<text class="zc" x="${x + w - 14}" y="${y + 21}" text-anchor="end">${esc(cost)}</text>` : ''}`;

/** stripe: a classification colour down the left edge, or null. */
export const box = ({ x, y, w, h, title, lines = [], stripe = null, alt = false }) => {
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

export const arrow = ({ pts, label, lx, ly, anchor = 'middle', muted = false, both = false }) => {
  const d = pts.map((p) => p.join(',')).join(' ');
  const m = muted ? 'ahm' : 'ah';
  let s = `<polyline class="${muted ? 'ard' : 'ar'}" points="${d}" marker-end="url(#${m})"${both ? ` marker-start="url(#${m})"` : ''}/>`;
  if (label) s += `<text class="${muted ? 'alm' : 'al'}" x="${lx}" y="${ly}" text-anchor="${anchor}">${esc(label)}</text>`;
  return s;
};

export const step = (n, x, y) => `<circle cx="${x}" cy="${y}" r="9" fill="var(--dg-accent,var(--f-accent))"/>
<text class="num" x="${x}" y="${y + 4}" text-anchor="middle">${n}</text>`;

export const heading = (x, y, t) => `<text class="ttl" x="${x}" y="${y}">${esc(t)}</text>`;
