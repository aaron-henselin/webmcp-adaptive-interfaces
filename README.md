# Steam Desk

Steam Desk is an interactive dashboard for exploring a database-backed catalog of 139,556 Steam games. Browsing, full-text search, genre/tag analysis, and report execution run against Cloudflare D1; the browser receives only bounded result sets.

## Requirements

- Node.js 22.13 or newer
- npm

## Local setup

```sh
npm ci
copy .env.example .env.local
npm run dev
```

On macOS or Linux, use `cp .env.example .env.local`. `SITE_ORIGIN` controls the absolute base URL used by social metadata.

## Commands

- `npm run dev` starts the local development server.
- `npm run build` creates a production build.
- `npm run lint` checks the source.
- `npm run db:generate` generates Drizzle migrations.
- `npm run catalog:profile` profiles and validates the ignored source archive.
- `npm run catalog:build-import` creates a normalized D1 SQL import.
- `npm run catalog:split-import` splits that import into bounded, checksummed files.

## Site tools

Steam Desk registers three WebMCP tools:

- `describe_steam_catalog` returns database field and analytics metadata.
- `create_report` executes and saves a bounded database report.
- `render_report` recreates a saved report as Markdown or a PNG.

Genre, tag, category, developer, publisher, and language reports use the analytics `explode` operation before grouping. Weighted tag reports can also use `tagWeight`.

## Data workflow

The ignored source archive is `data/steam-catalog/raw/games.json`. The runtime source of truth is D1; neither the 932 MB source file nor the full game catalog is downloaded by the browser.

The schema lives at `db/schema.ts`; deployable migrations live under `drizzle/`. Generated import files live under the ignored `work/steam-catalog/` directory. See [docs/database.md](docs/database.md) for refresh, local loading, and query-boundary details.

## Repository notes

- Local environment files, D1 state, generated imports, dependencies, and raw source data are ignored.
- `.openai/hosting.json` declares the Sites-managed D1 binding.
- Saved report definitions remain device-local and rerun against D1 when opened.
