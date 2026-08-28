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

Steam Desk exposes two focused demos: the root route is a catalog grid with a saved-report library and one active report surface; `/builder` is the composable local page canvas.

The report-library demo registers three WebMCP tools. The builder also registers `compose_page`, which adds HTML widgets or tabs, selects/configures/removes blocks, changes widths, and moves blocks semantically.

- `describe_steam_catalog` returns database field metadata and the current page outline.
- `create_report` executes a bounded database report and places it inline on the page.
- `render_report` recreates an inline report as Markdown or a PNG.

Genre, tag, category, developer, publisher, and language reports use the analytics `explode` operation before grouping. Weighted tag reports can also use `tagWeight`.

## Data workflow

The ignored source archive is `data/steam-catalog/raw/games.json`. The runtime source of truth is D1; neither the 932 MB source file nor the full game catalog is downloaded by the browser.

The schema lives at `db/schema.ts`; deployable migrations live under `drizzle/`. Generated import files live under the ignored `work/steam-catalog/` directory. See [docs/database.md](docs/database.md) for refresh, local loading, and query-boundary details.

## Repository notes

- Local environment files, D1 state, generated imports, dependencies, and raw source data are ignored.
- `.openai/hosting.json` declares the Sites-managed D1 binding.
- The versioned page document is stored in browser local storage. Reports rerun against D1 inline. Demo 2 returns an explicit composition guide through WebMCP and supports safe date, time-of-day greeting, local first-name, page, and catalog bindings for personalized HTML widgets.
