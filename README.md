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

Steam Desk exposes three focused demos: the root route is the Data Table Demo, with a catalog grid, saved reports, and one active report surface; `/builder` is the composable Dashboard Demo; and `/store` is a local-only Storefront Demo with adaptive search, rankings, reusable facets, and a simulated library.

The Data Table Demo registers three WebMCP tools and exposes only `steam_catalog`. The Dashboard Demo opens with a full-screen invitation to say “onboard me.” That phrase, or a natural equivalent such as “set me up” or “get started,” directs the agent to call `onboard_audience`. The tool surveys name, company, and role; resolves strong company typos against D1; and asks the user only when candidates are ambiguous. After saving the audience, the agent must propose the most useful page and receive approval through the temporary `request_page_composition` handoff before `compose_page` unlocks.

- Data Table Demo: `describe_steam_catalog` returns Steam catalog field metadata.
- Dashboard Demo: `describe_page_data` returns both the Steam product catalog and customer engagement fields, current shared filters, and the page outline.
- `onboard_audience` runs and submits the conversational survey, resolves company names, and stores the audience locally.
- `request_page_composition` appears after audience submission and records the user-approved page proposal before creation.
- `create_report` executes a bounded database report and places it inline on the page.
- `render_report` recreates an inline report as Markdown or a PNG.
- Storefront Demo: `describe_storefront` documents the public catalog, personalization capabilities, and privacy boundary, and exposes only a boolean `personalizationAvailable` signal—never library titles, IDs, playtime, or library-derived preferences.
- `recommend_storefront` is retrieval-only. For an eligible self-directed request it offers available library personalization once; declined, immediate-answer, unavailable, gift, and group flows use public data with no taste personalization. It supports reference/include/preferred/excluded-tag intent scoring, filters owned games inside the page, and returns only public game records plus an exclusion count.
- `curate_storefront_results` separately stages a headline, summary, featured badges, per-game reasons, and ordering after validating every app ID against the originating recommendation.
- `get_taste_profile` prepares private personalization only after explicit user opt-in and only for a game the user is choosing or buying for themselves; gifts, other people, groups, and unclear recipients default to no taste personalization. It never returns the library or profile; `exclude_owned_games` returns only a count.
- `apply_storefront_results` optionally applies a recommendation to session-scoped search, filters, ranking, editorial presentation, and layout, then reports the featured and visible app IDs after rendering completes.
- `save_storefront_facet` stores a removable numeric-band or catalog-tag facet in the local browser; `remove_storefront_facet` removes one.

Genre, tag, category, developer, publisher, and language reports use the analytics `explode` operation before grouping. Weighted tag reports can also use `tagWeight`.

## Data workflow

The ignored source archive is `data/steam-catalog/raw/games.json`. The runtime source of truth is D1; neither the 932 MB source file nor the full game catalog is downloaded by the browser.

The schema lives at `db/schema.ts`; deployable migrations live under `drizzle/`. Generated import files live under the ignored `work/steam-catalog/` directory. Customer engagement sessions reference the existing Steam games as products and are available only to the Dashboard Demo. See [docs/database.md](docs/database.md) for refresh, local loading, and query-boundary details. See [docs/page-composition.md](docs/page-composition.md) for the audience-confirmation and company-personalization contract. See [docs/storefront.md](docs/storefront.md) for storefront behavior, the agent operating contract, and why personalized discovery is a safe local demo action rather than a transaction.

## Repository notes

- Local environment files, D1 state, generated imports, dependencies, and raw source data are ignored.
- `.openai/hosting.json` declares the Sites-managed D1 binding.
- The versioned page document is stored in browser local storage. Reports rerun against D1 inline. The Dashboard Demo returns an explicit composition guide through WebMCP. Before creating a page it requires WebMCP to invoke onboarding, ask the name/company/role survey, save an exact or high-confidence corrected catalog company, propose the most useful page, and record the user's approval. Widgets then resolve safe greeting, name, role, company, date, page, and catalog bindings from that context.
