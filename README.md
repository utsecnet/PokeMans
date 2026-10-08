# PokéMans

A Pokémon card and species collection tracker. The catalogue is built from
[PokéAPI](https://pokeapi.co/) (species, stats, types, abilities, evolutions, artwork) and
the [pokemon-tcg-data](https://github.com/PokemonTCG/pokemon-tcg-data) dataset (every card
in every English set), enriched from [TCGdex](https://tcgdex.net/) (lighter images, and
which printings each card exists in). Daily prices come from
[tcgcsv.com](https://tcgcsv.com/), which republishes TCGplayer's.

Everything lives in Supabase: Postgres for the data, row level security so each account sees
only its own collection, and Edge Functions for the scheduled work. Images are served from
the laptop for now, by stable path, so moving them to object storage later is a deployment
change rather than an application one.

## Stack

- **Client**: React + Vite + Tailwind CSS v4. Dark mode follows the OS theme, with a manual
  light/dark/system toggle.
- **Data**: Supabase (Postgres + Auth + Edge Functions). The client talks to it directly
  through PostgREST and RPC — there is no API server of our own, and no public endpoint
  anyone could script against.

## Setup

```bash
npm install
```

Two environment files, both gitignored:

- `client/.env.local` — `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- `supabase/.env` — `SUPABASE_SERVICE_ROLE_KEY`

The anon key is safe in the browser; row level security is what protects the data. The
service role key bypasses that and must never reach `client/`. It is what lets the catalogue
and price scripts write to tables no user may write to.

## Running the app

```bash
npm run dev
```

Vite picks a port and prints it, usually `http://localhost:5173`.

## Building the catalogue

```bash
npm run catalogue                                        # everything
node supabase/scripts/catalogue/sync.mjs --only=cards    # one job
node supabase/scripts/catalogue/sync.mjs --start=1 --end=151
```

Four jobs, in order, because each depends on the one before: Pokémon, then cards, then the
TCGdex pass that fills in images and printings, then the set and series logos onto the
laptop. Safe to re-run — everything upserts on its key, so a second run changes nothing and
a run after a failure finishes the job.

## Prices

Captured daily by an Edge Function from tcgcsv.com: 220 requests for the whole catalogue
rather than one per card. Only values that changed are stored, and the chart carries the
last known price forward, so two and a half years of history fits in a few hundred MB.

```bash
npm run health                      # coverage, freshness, database usage
npm run prices:map                  # rebuild the card-to-product mapping
```

Retention, applied nightly: every day for the last week, Mondays and Thursdays out to a
month, Mondays only beyond that.

## Tests

```bash
npm test                            # client unit tests, then everything below
npm run test:regression             # every read and write, as a signed-in account
npm run test:supabase               # the regression suite plus the policy tests
```

`test:regression` is the one that matters most. It creates its own account, exercises every
read and write the app makes, checks five things that must be refused, and deletes the
account afterwards. It runs as an ordinary user rather than with the service key, because a
service-key read proves data exists and says nothing about whether anyone can reach it —
and those two came apart more than once while this was being built.

## Project layout

```
client/              React + Vite frontend
supabase/
  migrations/        schema, functions, row level security
  functions/         Edge Functions (daily price capture, retention)
  scripts/
    catalogue/       builds the catalogue from upstream, straight into Postgres
  tests/             policy and behaviour tests
docs/                generated architecture documents
```
