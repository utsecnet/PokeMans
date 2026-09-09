import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds android-architecture.html.
 *
 * The stylesheet is lifted from architecture.html rather than rewritten, so the two
 * documents cannot drift into two house styles. The figures are inlined the same way that
 * document inlines its own — it references no .svg files, which is why regenerating the
 * diagrams alone never changes it.
 *
 *   node docs/gen-android-diagrams.mjs && node docs/gen-android-doc.mjs
 */
const OUT = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(OUT, f), 'utf8');

// The sibling document's head carries its own <title>; take the styling, not the name.
const head = read('architecture.html')
  .split('<header class="mast">')[0]
  .replace(/<title>[^<]*<\/title>/, '<title>PokéMans on Android</title>');

/** Inlines a generated SVG as a figure, matching the sibling document's markup. */
const figure = (file, label, caption) => `
    <figure>
      <div class="plate">${read(file).replace(/^<\?xml[^>]*\?>\s*/, '').trim()}</div>
      <figcaption><b>${label}</b><span>${caption}</span></figcaption>
    </figure>`;

const sections = [
  ['decision', '00', 'The decision'],
  ['system', '01', 'What runs where'],
  ['storage', '02', 'Storage'],
  ['port', '03', 'The async port'],
  ['touch', '04', 'Touch'],
  ['build', '05', 'Building and testing'],
  ['play', '06', 'Getting onto Play'],
  ['risks', '07', 'Risks'],
  ['phases', '08', 'Order of work'],
];

const toc = sections.map(([id, n, t]) => `      <li><a href="#${id}">${n} ${t}</a></li>`).join('\n');

const body = `<header class="mast">
  <p class="eyebrow">Android architecture &middot; plan for review</p>
  <h1>PokéMans on Android</h1>
  <p class="standfirst">Taking a desktop application whose data lives in <code>%appdata%</code> and whose queries
  run against synchronous SQLite in an Express server, and making it a Play Store app &mdash; without discarding
  the part that took the longest to build.</p>
  <div class="meta">
    <span>Shell <b>Capacitor WebView</b></span>
    <span>Store <b>on-device SQLite</b></span>
    <span>Critical path <b>260 call sites</b></span>
    <span>Rebuild <b>not required</b></span>
  </div>
</header>

<div class="cols">
  <nav class="toc" aria-label="Contents">
    <ol>
${toc}
    </ol>
  </nav>

  <main>

  <section id="decision">
    <h2><span class="n">00</span>The decision</h2>
    <p class="lede">Three routes were open: wrap the website, rebuild in React Native, or wrap the existing app
    in a native shell. The first is disqualified by policy, the second by 1,507 lines of CSS.</p>

    <p><b>Wrapping the website is out.</b> Play&rsquo;s Policy 4.3 rejects apps that mirror a site without
    app-specific value, and it is enforced strictly. A Trusted Web Activity fails for a second, separate reason:
    production requires twelve testers active for fourteen days, but a TWA&rsquo;s activity happens inside Chrome
    rather than inside the app, so review sees no in-app usage and fails the test regardless of how active the
    testers were. The documented remedy is to ship a standard WebView app instead.</p>

    <p><b>React Native is out</b> on arithmetic. Of roughly 15,000 lines, 1,507 are CSS 3D transforms,
    <code>@property</code> interpolation, mask compositing and hand-drawn SVG &mdash; <code>index.css</code> at 478,
    <code>TiltCard.tsx</code> at 231, <code>collectionIcons.tsx</code> at 669, <code>TypeIcon.tsx</code> at 129.
    That is the tilt card&rsquo;s fixed-light reflection, the prismatic foil revealed through a moving mask, the
    clear coat, and all 57 line icons. React Native runs none of it. There is no <code>mask-composite</code>, no
    registered-property interpolation, no CSS 3D, and the foil-through-mask effect has no equivalent at all. It
    would all be rebuilt in Skia and Reanimated for no user-visible gain.</p>

    <p><b>Capacitor keeps it.</b> A real WebView runs the CSS as written, native plugins provide on-device SQLite
    and the Keystore, and the result is a standard WebView app &mdash; the shape that passes 4.3. The cost is that
    the Express server has to move into the app, which is section 03 and the only genuinely hard part.</p>

    <p>Underneath all of it is one question: <b>does this work offline?</b> For a collection tracker the answer is
    yes and it is not close &mdash; the moment you most want it is standing at a table in a convention hall, where
    the signal is worst. Offline means an on-device database, and an on-device database means a real app.</p>
  </section>

  <section id="system">
    <h2><span class="n">01</span>What runs where</h2>
    <p class="lede">The app stops being a client. It holds the UI, the query layer and both databases; the network
    is for prices and refreshes only.</p>
${figure('android-system.svg', 'Figure A1', 'The Express server does not survive the move — there is no localhost on a phone — so its query layer moves into the app rather than being hosted.')}
    <p>Two things are worth drawing out. Card art is fetched by the WebView <em>directly</em> from the image CDNs
    and never passes through anything of ours, which keeps egress at zero and is also the arrangement most likely
    to attract attention at scale (section 07). And Supabase is read <em>through the app&rsquo;s query layer</em>,
    not from the browser: a direct read needs the anon key, the anon key ships inside the bundle, and a bundled key
    makes the price tables readable by anyone who unpacks the APK.</p>
  </section>

  <section id="storage">
    <h2><span class="n">02</span>Storage</h2>
    <p class="lede">The direct answer to &ldquo;<code>%appdata%</code> is no longer an option&rdquo;: app-private
    internal storage, which is the same idea with the operating system enforcing it.</p>
${figure('android-storage.svg', 'Figure A2', 'Both databases in app-private storage, secrets moved out of the database into the Keystore, and the three alternatives that were considered and rejected.')}
    <p>The split between the two databases earns its keep here. <code>personal.db</code> is 240 KB and cannot be
    reconstructed from anywhere &mdash; no upstream knows which cards you own, and a price day not captured is gone
    because the sources only ever serve today&rsquo;s number. <code>catalog.db</code> is 11 MB and can be fetched
    again from TCGdex. So Auto Backup includes the first and excludes the second, which puts the irreplaceable
    240 KB comfortably inside the 25 MB ceiling.</p>

    <p>That is not a theoretical benefit. A collection was deleted by accident during development and the undo
    failed; the data was unrecoverable because nothing outside the local file had a copy. On Android the operating
    system would have held one.</p>

    <p>The API keys move out of the database entirely. <code>linked_accounts</code> currently stores ciphertext
    with the key material elsewhere on the same disk &mdash; a fair compromise on a desktop, and the wrong answer
    on a device with a hardware-backed Keystore. <code>EncryptedSharedPreferences</code> keeps the key out of the
    process.</p>
  </section>

  <section id="port">
    <h2><span class="n">03</span>The async port</h2>
    <p class="lede">The expensive part, and the reason this is a phased migration rather than a rewrite.</p>
${figure('android-async-port.svg', 'Figure A3', 'The conversion is done on the desktop, where Express still runs and a browser can still test it, before the native shell is introduced.')}
    <p><code>node:sqlite</code> is synchronous: <code>all()</code> returns rows. The Capacitor plugin cannot be,
    because the query crosses the WebView bridge into native code, and there is no synchronous shim for a message
    pass. So every data access becomes <code>await</code>, and <code>await</code> propagates up through every
    caller.</p>

    <p class="lede" style="margin-top:1.1rem">260 call sites across 27 files &mdash; 107 <code>get()</code>,
    60 <code>all()</code>, 25 <code>run()</code>, and 69 more through the personal-database helpers.</p>

    <p>This is done <em>first</em>, and deliberately while Express is still standing. An async codebase runs
    perfectly well against <code>node:sqlite</code> wrapped to return promises, which means the conversion is
    verifiable in the browser exactly as the app is developed today. Doing it after Capacitor arrives would mean an
    async bug and a native-shell bug are never being diagnosed at the same time &mdash; and they would be.</p>

    <p><code>src/data/sqlite.ts</code> already declares the interface, including an explicit
    <code>transaction()</code>. That is not decoration: on native each statement is a separate bridge call, so
    without it, filing a card or rewriting collection order becomes several independent transactions and a failure
    halfway leaves an order with duplicate positions.</p>
  </section>

  <section id="touch">
    <h2><span class="n">04</span>Touch</h2>
    <p class="lede">Some of the interface is already touch-ready. One part of it is dead on arrival.</p>

    <ul class="legend" style="display:block">
      <li style="display:block;margin-bottom:.55rem"><b>Collection reorder does not work at all.</b> It uses HTML5
      drag events, which never fire on a touchscreen. This is known, not discovered &mdash; the arrow controls that
      used to provide a touch path were removed in favour of dragging. It needs rebuilding on pointer events.</li>
      <li style="display:block;margin-bottom:.55rem"><b>Advanced search fixes itself.</b> Its fallback ships the
      whole catalogue to the client when a query uses operators SQL cannot push down: 12.4 MB and 8.7 s measured
      over loopback. With SQLite on the device that becomes a local query again.</li>
      <li style="display:block;margin-bottom:.55rem"><b>The tilt card already works.</b> It is built on pointer
      events with <code>touch-action: none</code>, so drag-to-rotate behaves on a phone.</li>
      <li style="display:block;margin-bottom:.55rem"><b>Tap-to-file already works.</b> The collection rail is taps,
      not drags.</li>
      <li style="display:block"><b>Unverified:</b> the rail&rsquo;s mobile collapse was built but never rendered at
      phone width &mdash; the browser would not resize below the display. First real device build settles it.</li>
    </ul>

    <p>Beyond that: a bottom sheet in place of the right-hand rail, larger hit targets, and swipe-to-remove on
    collection rows. None of it is structural, and none of it should start before the app installs.</p>
  </section>

  <section id="build">
    <h2><span class="n">05</span>Building and testing</h2>
    <p class="lede">Better than it looks, precisely because it is a WebView.</p>
    <table>
      <thead><tr><th>Task</th><th>How</th></tr></thead>
      <tbody>
        <tr><td class="id">Emulator</td><td>Android Studio AVD, or <code>npx cap run android</code></td></tr>
        <tr><td class="id">Live reload on a device</td><td><code>npx cap run android --livereload --external</code> &mdash; edit React, see it on the phone</td></tr>
        <tr><td class="id">Full DevTools</td><td><code>chrome://inspect</code> attaches to the app&rsquo;s WebView: same console, same element inspector, same network tab</td></tr>
        <tr><td class="id">Install a build</td><td><code>adb install app-debug.apk</code></td></tr>
        <tr><td class="id">Distribution</td><td>Play Console internal testing track</td></tr>
      </tbody>
    </table>
    <p>The DevTools line is the one that matters. Every diagnosis in this project so far has come from inspecting
    computed styles and DOM state in a browser; that method survives the move intact, which it would not under
    React Native.</p>
    <p><b>Prerequisite:</b> none of it is installed. No JDK, no <code>ANDROID_HOME</code>, no SDK, no Android
    Studio. Installing Android Studio brings all four. Nothing before phase 3 needs it.</p>
  </section>

  <section id="play">
    <h2><span class="n">06</span>Getting onto Play</h2>
    <ul class="legend" style="display:block">
      <li style="display:block;margin-bottom:.55rem"><b>Policy 4.3, minimum functionality.</b> Cleared by being a
      real app with offline capability rather than a site mirror.</li>
      <li style="display:block;margin-bottom:.55rem"><b>Privacy policy and Data safety form.</b> Mandatory. The
      honest answers are short: data stays on the device, nothing is collected, the only outbound calls are to
      public card APIs.</li>
      <li style="display:block;margin-bottom:.55rem"><b>Target API level.</b> Play enforces a recent minimum and
      raises it annually; Capacitor tracks this.</li>
      <li style="display:block"><b>Twelve testers, fourteen days.</b> A calendar constraint, not a work item.
      Start it the moment anything installs.</li>
    </ul>
  </section>

  <section id="risks">
    <h2><span class="n">07</span>Risks</h2>
    <p class="lede">Two worth settling before phase 1, because both are cheaper to act on now than after the port.</p>

    <p><b>Intellectual property.</b> The app shows Pokémon card artwork, uses Pokémon names, and is branded
    &ldquo;PokéMans&rdquo;. Publishing that on a public store is a materially different exposure from running it on
    one laptop, and The Pokémon Company enforces actively. This is a decision to take deliberately rather than
    discover.</p>

    <p><b>Hotlinking at distribution scale.</b> Card art is fetched straight from
    <code>images.pokemontcg.io</code> and <code>assets.tcgdex.net</code>. One developer&rsquo;s browser is
    unremarkable; an installed base pointing at someone else&rsquo;s CDN is a different proposition, and their
    terms may not permit it. Caching art into app storage on first view would reduce both the exposure and the
    dependence.</p>
  </section>

  <section id="phases">
    <h2><span class="n">08</span>Order of work</h2>
${figure('android-phases.svg', 'Figure A4', 'Only phase 1 is on the critical path. Phase 2 is worth doing whether or not the app ships, and phase 5 has a fixed calendar cost.')}
    <p>The sequence exists to keep each step independently verifiable. Phase 1 changes 260 call sites but leaves
    the app runnable and testable throughout. Phase 3 changes one line &mdash; which driver is constructed &mdash;
    and if it breaks, the async layer is already known good.</p>
  </section>

  <footer>
    Drafted 8 September 2026 &middot; figures generated by <code>docs/gen-android-diagrams.mjs</code>, document by
    <code>docs/gen-android-doc.mjs</code> &middot; measurements taken from the working application
  </footer>

  </main>
</div>
</div>
`;

writeFileSync(join(OUT, 'android-architecture.html'), head + body, 'utf8');
console.log('android-architecture.html'.padEnd(32) + ((head + body).length / 1024).toFixed(1) + ' KB');
