import { Link } from 'react-router-dom';

function Code({ children }: { children: string }) {
  return (
    <code className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 font-mono text-[13px] text-[var(--color-accent)]">
      {children}
    </code>
  );
}

function Example({ query, note }: { query: string; note: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <code className="font-mono text-sm text-[var(--color-accent)]">{query}</code>
      <span className="text-xs text-[var(--color-text-muted)]">{note}</span>
    </div>
  );
}

function FieldRow({ names, type, note }: { names: string; type: string; note: string }) {
  return (
    <tr className="border-t border-[var(--color-border)]">
      <td className="py-1.5 pr-3 font-mono text-[var(--color-accent)]">{names}</td>
      <td className="py-1.5 pr-3 text-[var(--color-text-muted)]">{type}</td>
      <td className="py-1.5 text-[var(--color-text-muted)]">{note}</td>
    </tr>
  );
}

export function SearchHelp() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link to="/" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        ← Back
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Advanced Search</h1>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Both the Pokémon and Cards search bars accept a small query language for filtering
        with more precision than plain text alone.
      </p>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">The basics</h2>
        <p className="text-sm">
          Type a bare word to search names — <Code>pikachu</Code>. To target a specific field,
          use <Code>field:value</Code>. Values with spaces need quotes:{' '}
          <Code>set:"Temporal Forces"</Code>.
        </p>
        <p className="text-sm">
          Autocomplete kicks in as you type: a dropdown of matching fields, keywords, or known
          values appears below the box. Press <Code>Tab</Code> (or <Code>Enter</Code>) to accept
          the highlighted suggestion, <Code>↑</Code>/<Code>↓</Code> to change it, and{' '}
          <Code>Esc</Code> to dismiss it.
        </p>
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">Operators</h2>
        <table className="w-full text-left text-sm">
          <tbody>
            <FieldRow names=":  =" type="equals / contains" note='type:fire  —  name:"char"' />
            <FieldRow names="!=" type="not equal" note="rarity!=common" />
            <FieldRow names="&gt;  &gt;=  &lt;  &lt;=" type="comparison (number/date fields)" note="hp>=80" />
            <FieldRow names="a..b" type="range (number fields)" note="hp:80..120" />
          </tbody>
        </table>
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">Wildcards</h2>
        <p className="text-sm">
          <Code>*</Code> matches any run of characters, <Code>?</Code> matches exactly one,
          in text and type fields. A wildcard pattern matches the whole value, so{' '}
          <Code>char*</Code> means "starts with char" — bookend with <Code>*</Code> on both
          sides for a "contains" match.
        </p>
        <div className="space-y-2">
          <Example query="name:char*" note='starts with "char" — charmander, charizard, …' />
          <Example query="name:*saur" note='ends with "saur" — bulbasaur, ivysaur, venusaur' />
          <Example query="name:*chu*" note='contains "chu" anywhere' />
          <Example query="rarity:*rare*" note='any rarity containing "rare"' />
        </div>
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">Negation</h2>
        <p className="text-sm">
          Two ways to negate a clause — a leading <Code>!</Code>, or the <Code>NOT</Code> keyword.
          Both work the same:
        </p>
        <div className="space-y-2">
          <Example query="!type:water" note="exclude Water types" />
          <Example query="NOT type:water" note="same thing" />
          <Example query="NOT owned:true" note="cards you don't own" />
        </div>
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">Combining clauses — AND / OR</h2>
        <p className="text-sm">
          Space-separated clauses are ANDed together automatically — the word{' '}
          <Code>AND</Code> is optional. Use <Code>OR</Code> explicitly to widen a match.{' '}
          <Code>AND</Code> binds tighter than <Code>OR</Code>, so <Code>a OR b AND c</Code>{' '}
          means <Code>a OR (b AND c)</Code>.
        </p>
        <div className="space-y-2">
          <Example query="type:fire hp>80" note="Fire type AND HP over 80" />
          <Example query="type:fire OR type:water" note="Fire type OR Water type" />
          <Example
            query="gen:1 OR gen:2 legendary"
            note='gen 1, OR (gen 2 AND name contains "legendary")'
          />
        </div>
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">Grouping — ( )</h2>
        <p className="text-sm">
          Wrap clauses in parentheses to override the default AND-before-OR precedence, and
          nest them as deeply as you need.
        </p>
        <div className="space-y-2">
          <Example
            query="(gen:1 AND type:fire) AND NOT name:charmander"
            note="Gen 1 Fire types, excluding Charmander"
          />
          <Example query="(type:fire OR type:water) AND gen:1" note="(Fire or Water) AND Gen 1" />
          <Example query="NOT (type:fire OR type:water)" note='everything except Fire or Water' />
        </div>
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">Pokémon fields</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-[var(--color-text-muted)]">
            <tr>
              <th className="pb-1 pr-3 font-medium">Field</th>
              <th className="pb-1 pr-3 font-medium">Type</th>
              <th className="pb-1 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            <FieldRow names="name" type="text" note="default field for bare words" />
            <FieldRow names="type" type="list" note="fire, water, grass, …" />
            <FieldRow names="gen, generation" type="text" note="1–9" />
            <FieldRow names="hp, attack (atk), defense (def)" type="number" note="base stats" />
            <FieldRow names="spa (specialattack), spd (specialdefense), spe (speed)" type="number" note="base stats" />
            <FieldRow names="height" type="number" note="meters, e.g. height>1.5" />
            <FieldRow names="weight" type="number" note="kg" />
            <FieldRow names="xp, baseexperience" type="number" note="base experience yield" />
          </tbody>
        </table>
        <p className="text-xs text-[var(--color-text-muted)]">
          Abilities and expansions aren't queryable here — the list endpoint that feeds this
          search doesn't carry that data per Pokémon. Use the sidebar filters (tile view) or the
          matching column filter (table view) for those instead.
        </p>
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">Card fields</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-[var(--color-text-muted)]">
            <tr>
              <th className="pb-1 pr-3 font-medium">Field</th>
              <th className="pb-1 pr-3 font-medium">Type</th>
              <th className="pb-1 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            <FieldRow names="name" type="text" note="card name — default field for bare words" />
            <FieldRow names="pokemon" type="text" note="Pokémon name — also a default field" />
            <FieldRow names="set, expansion" type="text" note='e.g. set:"Temporal Forces"' />
            <FieldRow names="series" type="text" note={'e.g. series:"Scarlet & Violet"'} />
            <FieldRow names="rarity" type="text" note={'e.g. rarity:"Double Rare"'} />
            <FieldRow names="type" type="list" note="the card's Pokémon type(s)" />
            <FieldRow names="number" type="text" note="card number within its set" />
            <FieldRow names="owned" type="boolean" note="owned:true / owned:false" />
            <FieldRow
              names="collection, box, location"
              type="list"
              note={'which collection(s) a card is in — e.g. collection:"Charizard Deck"'}
            />
            <FieldRow names="release, releasedate" type="date" note="YYYY/MM/DD — supports > < >= <=" />
          </tbody>
        </table>
        <p className="text-xs text-[var(--color-text-muted)]">
          Generation isn't queryable on cards for the same reason — it isn't part of the card
          list data.
        </p>
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">More examples</h2>
        <div className="space-y-2">
          <Example query="hp>=100 speed>90" note="bulky and fast Pokémon" />
          <Example query="height:1.5..2.5 type:dragon" note="Dragon types between 1.5–2.5 m tall" />
          <Example
            query={'set:"Temporal Forces" rarity!=common'}
            note="uncommon-or-better cards from one set"
          />
          <Example query="owned:false rarity:common" note="Common cards you don't have yet" />
          <Example query={'collection:"Charizard Deck"'} note="every card in one collection" />
          <Example query="pikachu NOT collection:*" note="Pikachu cards you haven't filed anywhere yet" />
        </div>
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-semibold">How it runs</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          A plain word (no field, no <Code>AND</Code>/<Code>OR</Code>/<Code>NOT</Code>, no
          operators) stays fast and server-side, with normal pagination. The moment you use
          any advanced syntax, the page fetches the full matching
          dataset once and filters, sorts, and paginates it locally, so results are always
          complete and correctly counted — it just means the very first keystroke that turns a
          query "advanced" takes a beat longer than the rest.
        </p>
      </section>
    </div>
  );
}
