# Storefront privacy and personalization

The Storefront Demo at `/store` is a product-discovery demonstration built on the public Steam catalog. Personalization can use a simulated game library saved in the current browser, but the WebMCP contract keeps that personal data inside the page.

## Why automated review denied the earlier flow

The earlier `get_storefront_library` tool returned owned app IDs, owned game records, average playtime, and a derived taste profile. Its guidance required that tool before every recommendation—even when the page displayed an empty library.

That made an ordinary public-catalog search look like an unnecessary personal-data access. Store and “Buy now” language added ambiguity, but the primary problem was the over-broad library read and disclosure.

## Privacy-preserving tool split

| Tool | Agent-visible result | Personal-data behavior | UI effect |
| --- | --- | --- | --- |
| `describe_storefront` | Public schema, capabilities, and safety rules | Does not read or return library data | None |
| `exclude_owned_games` | `excludedCount` only | Matches public candidate IDs inside the page; returns no owned IDs or titles | None |
| `get_taste_profile` | Only whether private personalization is ready | Requires explicit user opt-in; computes the profile inside the page and returns no library, playtime, preferences, or profile fields | None |
| `recommend_storefront` | Public game records, `excludedOwnedCount`, and an opaque `recommendationId` | Defaults to `personalization: "none"`; optional owned filtering remains inside the page | None |
| `apply_storefront_results` | A compact application receipt | Reads no additional personal data | Changes only session-scoped filters, ranking, and layout |
| `save_storefront_facet` | The saved local facet | Reads no library data | Saves a removable browser preference |
| `remove_storefront_facet` | The removed facet ID | Reads no library data | Removes one browser preference |

The deprecated `get_storefront_library` and `search_storefront` tools are no longer registered.

## Agent workflow

For an ordinary discovery, comparison, or ranking request:

1. Call `recommend_storefront` with `personalization: "none"`. Do not call `get_taste_profile`.
2. Keep `excludeOwnedLocally: true` unless the user asks to include owned games. Matching happens inside the page and only the count is returned. When the library is empty, this path immediately skips owned-data matching.
3. Present the returned public game records.
4. Call `apply_storefront_results` with the returned `recommendationId` only when the user asked to change the visible storefront.

Example:

```json
{
  "query": "family-friendly Mario-like platformers",
  "personalization": "none",
  "excludeOwnedLocally": true
}
```

The relevant response shape is:

```json
{
  "results": [],
  "excludedOwnedCount": 0,
  "recommendationId": "opaque-session-id"
}
```

The response never includes the underlying library or taste profile.

## Explicit taste personalization

Only offer taste personalization as an explicit choice, for example:

> Use my locally saved game library to personalize these recommendations.

After the user agrees, call `get_taste_profile` with `userConfirmed: true`, then call `recommend_storefront` with `personalization: "local_library"`. If the local library is empty, `get_taste_profile` returns `ready: false` without querying owned catalog records.

The derived genres and tags remain in page memory. They may influence the public catalog query, but neither they nor the source games are returned to the agent.

## Registration lifecycle

The storefront registers its WebMCP tools from one mount-only effect. Tool implementations read current catalog and local state through refs, so ordinary React renders and catalog updates do not unregister and recreate tools or freeze old snapshots into their closures.

## Remaining safety boundary

The demo has no cart, checkout, order, reservation, payment, billing, authentication, Steam-account integration, software installation, outbound messaging, or external write path. The visible “Buy now” control only adds an app ID to the simulated local library.

Treat “Mario games” or another franchise name as a public catalog-discovery request. Search only available Steam records, do not invent unavailable titles or affiliations, and do not source or reproduce protected franchise assets.
