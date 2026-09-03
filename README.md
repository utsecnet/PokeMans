# PokéDex

A single-user, local-first Pokédex. Data is synced from [PokeAPI](https://pokeapi.co/)
(species, stats, types, abilities, evolutions, official artwork) and the
[Pokémon TCG API](https://pokemontcg.io/) (trading card images), then stored in a local
SQLite database. No account or server needed to run it — just your own machine.

## Stack

- **Server**: Node.js + Express, using Node's built-in `node:sqlite` (no native build step)
- **Client**: React + Vite + Tailwind CSS v4, dark mode follows your OS theme by default
  (with a manual light/dark/system toggle)

## Setup

```bash
npm install
cp server/.env.example server/.env
```

To sync trading card images you need a free API key from
[dev.pokemontcg.io](https://dev.pokemontcg.io/) — add it to `server/.env` as `TCG_API_KEY`.
Without a key, the Pokédex still works fully (species, stats, evolutions, artwork) — you
just won't get the TCG card gallery on each Pokémon's detail page.

## Syncing data

```bash
npm run sync                     # full sync: all species + TCG cards
node server/src/sync/run.js --start=1 --end=151 --skip-tcg   # e.g. Gen 1 only, no cards
```

The sync is safe to re-run — it upserts, so nothing is duplicated. Progress and errors are
logged to the `sync_log` table (exposed at `GET /api/sync/status`).

## Running the app

```bash
npm run dev
```

This starts the API on `http://localhost:4000` and the Vite dev server (with `/api` proxied
to the API) on whatever port Vite picks — check the terminal output, usually
`http://localhost:5173`.

## Project layout

```
server/   Express API + SQLite + sync scripts (PokeAPI, Pokémon TCG API)
client/   React + Vite frontend
```

The SQLite database file lives at `server/data/pokedex.sqlite` and is gitignored — each
clone builds its own local copy via `npm run sync`.
