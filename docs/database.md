# Steam catalog database

Steam Desk stores its runtime catalog in Cloudflare D1. The browser requests only paginated game rows, filter summaries, facets, or report results capped at 2,000 rows.

## Source and schema

The ignored source archive lives at `data/steam-catalog/raw/games.json`. `db/schema.ts` defines the relational schema. Drizzle-generated, hand-reviewed, and deployable catalog-load SQL migrations live in `drizzle/`.

The database contains a scalar `games` table plus normalized dimensions and junctions for developers, publishers, genres, categories, weighted tags, and languages. `game_search` is an FTS5 index over title and related text dimensions. `companies` unifies exact developer and publisher names with their catalog roles and game counts; `company_search` is the dedicated FTS5 index used during audience onboarding.

The page builder also uses `engagement_shops`, `engagement_users`, and `engagement_sessions`. Each session references `games.app_id`, so Steam games remain the product dimension. Publisher, developer, genre, and category provide the builder's supplier, brand, product-category, and product-class semantics. These additional tables are not exposed by Demo 1.

## Refresh workflow

1. Put the source file at `data/steam-catalog/raw/games.json`.
2. Run `npm run catalog:profile` to validate counts, cardinalities, and the source hash.
3. Run `npm run catalog:build-import` to create `work/steam-catalog/import.sql`.
4. Run `npm run catalog:split-import` to create CPU-safe 500 KB SQL files and a checksum manifest under `work/steam-catalog/chunks/`.
5. Verify the chunk manifest, copy the chunks into numbered `drizzle/` migrations in manifest order, then deploy or apply them locally.

The raw archive and intermediate files under `work/` are ignored by Git. The schema, deployable migrations (including the checked catalog-load chunks), import code, and documentation are committed so a Site version can reproduce its database.

## Local database

The local D1 binding is `DB`. Wrangler and the development server share the project-local state under `.wrangler/`.

Apply the SQL files under `drizzle/` in filename order with `wrangler d1 execute DB --local --file <migration>`. The final catalog-load migration runs `PRAGMA optimize` after loading.

## Query boundary

`GET /api/catalog` provides paginated browsing, facets, and aggregate quick views. `GET /api/catalog/companies` accepts a bounded company-name query and returns at most 12 ranked candidates. `POST /api/catalog/report` accepts only the normalized analytics contract and compiles it through an allowlisted SQL builder. Client SQL, arbitrary identifiers, unbounded results, and unknown operations are rejected.

`GET /api/engagement` provides the page builder's filtered overview, comparison metrics, active-user series, funnel, recent users, device distribution, and filter options. `POST /api/engagement/report` accepts the separate `customer_engagement` contract and compiles it through its own allowlisted SQL builder. The sessions and funnel views are builder-only.

Multi-valued dimensions use the `explode` operation before grouping. Supported explode sources are `genres`, `tags`, `categories`, `developers`, `publishers`, and `languages`; exploding tags also exposes `tagWeight`.
