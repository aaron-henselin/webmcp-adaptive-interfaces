# Steam catalog database

Steam Desk stores its runtime catalog in Cloudflare D1. The browser requests only paginated game rows, filter summaries, facets, or report results capped at 2,000 rows.

## Source and schema

The ignored source archive lives at `data/steam-catalog/raw/games.json`. `db/schema.ts` defines the relational schema. Drizzle-generated, hand-reviewed, and deployable catalog-load SQL migrations live in `drizzle/`.

The database contains a scalar `games` table plus normalized dimensions and junctions for developers, publishers, genres, categories, weighted tags, and languages. `game_search` is an FTS5 index over title and related text dimensions. `companies` unifies exact developer and publisher names with their catalog roles and game counts; `company_search` handles exact and prefix lookup, while indexed `company_search_grams` supplies a bounded candidate set for typo-tolerant audience onboarding.

Catalog imports apply the shared sexual-content policy before normalization. A title is excluded when Steam supplies an explicit Sexual Content, Nudity, Hentai, or NSFW tag, or when its mature-content note contains a direct sexual, nudity, erotic, pornographic, hentai, or NSFW indicator. catalog_content_exclusions records the source app IDs and matched signals for auditability. The same policy is applied when building the static SteamSpy snapshot used by the reports demo.

The Dashboard Demo also uses `engagement_shops`, `engagement_users`, and `engagement_sessions`. Each session references `games.app_id`, so Steam games remain the product dimension. Publisher, developer, genre, and category provide the dashboard's supplier, brand, product-category, and product-class semantics. These additional tables are not exposed by the Data Table Demo.

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

`GET /api/catalog` provides paginated browsing, facets, and aggregate quick views. `GET /api/catalog/companies` accepts a bounded company-name query and returns at most 12 ranked candidates plus a resolution status: matched, corrected, ambiguous, or not found. Fuzzy lookup searches no more than 48 query trigrams through `idx_company_search_grams_gram`, then ranks the bounded candidates in the application. `POST /api/catalog/report` accepts only the normalized analytics contract and compiles it through an allowlisted SQL builder. Client SQL, arbitrary identifiers, unbounded results, and unknown operations are rejected.

`GET /api/engagement` provides the Dashboard Demo's filtered overview, comparison metrics, active-user series, funnel, recent users, device distribution, and filter options. `POST /api/engagement/report` accepts the separate `customer_engagement` contract and compiles it through its own allowlisted SQL builder. The sessions and funnel views are dashboard-only.

Multi-valued dimensions use the `explode` operation before grouping. Supported explode sources are `genres`, `tags`, `categories`, `developers`, `publishers`, and `languages`; exploding tags also exposes `tagWeight`.
