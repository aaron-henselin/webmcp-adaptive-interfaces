# Storefront privacy and personalization

The Storefront Demo at `/store` is a product-discovery demonstration built on the public Steam catalog. Personalization can use a simulated game library saved in the current browser, but the WebMCP contract keeps that personal data inside the page.

## Why automated review denied the earlier flow

The earlier `get_storefront_library` tool returned owned app IDs, owned game records, average playtime, and a derived taste profile. Its guidance required that tool before every recommendation—even when the page displayed an empty library.

That made an ordinary public-catalog search look like an unnecessary personal-data access. Store and “Buy now” language added ambiguity, but the primary problem was the over-broad library read and disclosure.

## Privacy-preserving tool split

| Tool | Agent-visible result | Personal-data behavior | UI effect |
| --- | --- | --- | --- |
| `describe_storefront` | Public schema, capabilities, safety rules, and the boolean `personalizationAvailable` signal | Returns no library titles, IDs, playtime, taste preferences, or profile data | None |
| `exclude_owned_games` | `excludedCount` only | Matches public candidate IDs inside the page; returns no owned IDs or titles | None |
| `get_taste_profile` | Only whether private personalization is ready | Requires explicit user opt-in and a game the user is choosing or buying for themselves; computes the profile inside the page and returns no library, playtime, preferences, or profile fields | None |
| `recommend_storefront` | Public game records, intent scores, `excludedOwnedCount`, and an opaque `recommendationId` | Defaults to `personalization: "none"`; optional owned filtering remains inside the page | None |
| `curate_storefront_results` | A validated editorial-curation receipt | Uses only public app IDs from the original recommendation set | None; stages headline, summary, featured badges, reasons, and ordering |
| `apply_storefront_results` | A render-completion receipt with featured and visible app IDs | Reads no additional personal data | Changes only session-scoped filters, ranking, editorial presentation, and layout |
| `save_storefront_facet` | The saved local facet | Reads no library data | Saves a removable browser preference |
| `remove_storefront_facet` | The removed facet ID | Reads no library data | Removes one browser preference |

The deprecated `get_storefront_library` and `search_storefront` tools are no longer registered.

## Agent workflow

For an ordinary discovery, comparison, or ranking request:

1. Call `recommend_storefront` with `personalization: "none"`. Do not call `get_taste_profile`. For similarity requests, express the reference separately and supply positive, preferred, and excluded tags.
2. Keep `excludeOwnedLocally: true` unless the user asks to include owned games. Matching happens inside the page and only the count is returned. When the library is empty, this path immediately skips owned-data matching.
3. Present the returned public game records.
4. If an editorial presentation is useful, call `curate_storefront_results` with only app IDs returned by that recommendation.
5. Call `apply_storefront_results` with the returned `recommendationId` only when the user asked to change the visible storefront. It resolves after the summary, featured cards, and ordered list have rendered.

Example:

```json
{
  "query": "platformers",
  "reference": "Super Mario",
  "includeTags": ["3D Platformer", "Collectathon", "Colorful"],
  "preferredTags": ["Family Friendly", "Cute"],
  "excludeTags": ["Battle Royale", "FPS", "MMO"],
  "ranking": {
    "factors": [
      { "field": "intentFit", "weight": 0.7, "direction": "higher" },
      { "field": "positiveRatio", "weight": 0.3, "direction": "higher" }
    ]
  },
  "personalization": "none",
  "recipientContext": "unspecified",
  "excludeOwnedLocally": true
}
```

The include tags require at least one relevant match, excluded tags are hard exclusions, and `intentFit` and `tagCoverage` keep weak but popular matches from dominating the list.

Editorial curation is a separate call:

```json
{
  "recommendationId": "store-rec-...",
  "headline": "Best Mario-like games",
  "summary": "Colorful, approachable platformers centered on exploration and collecting.",
  "featured": [
    {
      "appId": 253230,
      "badge": "Best overall",
      "reason": "The closest match to Mario’s 3D platforming and collectathon structure."
    }
  ],
  "orderedAppIds": [253230, 1586800, 969990]
}
```

Every ID in `featured` and `orderedAppIds` is rejected unless it came from the original recommendation. Recommendation IDs remain valid for the document session until `clear_storefront_search` or the visible Clear control resets the search.

After the committed render, `apply_storefront_results` returns:

```json
{
  "rendered": true,
  "featuredAppIds": [253230],
  "visibleAppIds": [253230, 1586800, 969990],
  "summaryVisible": true
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

The library taste profile applies only when the user is choosing or buying the recommended game for themselves. Never use it for a gift, a friend or relative, a child, a household or group, or when the intended recipient is unclear. Those requests must keep `personalization: "none"`; owned-game filtering remains a separate local-only feature.

`describe_storefront` exposes only a non-sensitive boolean capability signal:

```json
{
  "personalizationAvailable": true
}
```

When the recipient is the user and that signal is true, ask once whether they want library-based personalization before recommending. If they decline, if they request an immediate answer, or if the signal is false, continue with `personalization: "none"`. Never offer library personalization for `someone_else` or `shared_group`.

- “Find me a game” → offer personalization once.
- “Find my nephew a game” → do not offer; use public data.
- “Use my library” → treat this as explicit consent and call `get_taste_profile`.
- “Just recommend something” → skip the question and use public data.

The opt-in should name the local library and the self-directed purpose, for example:

> Use my locally saved game library to personalize recommendations for a game I'm choosing for myself.

After the user agrees, call `get_taste_profile` with `userConfirmed: true` and `forSelf: true`, then call `recommend_storefront` with `personalization: "local_library"` and `recipientContext: "self"`. Both tools reject local-library taste personalization unless the self-directed context is explicit. If the local library is empty, `get_taste_profile` returns `ready: false` without querying owned catalog records.

The derived genres and tags remain in page memory. They may influence the public catalog query, but neither they nor the source games are returned to the agent.

## Registration lifecycle

The storefront registers each WebMCP tool once per model context for the document lifetime. A current-page bridge supplies live catalog and UI state across React renders or remounts, while recommendation records remain in document memory until the search is explicitly cleared.

## Remaining safety boundary

The demo has no cart, checkout, order, reservation, payment, billing, authentication, Steam-account integration, software installation, outbound messaging, or external write path. The visible “Buy now” control only adds an app ID to the simulated local library.

Treat “Mario games” or another franchise name as a public catalog-discovery request. Search only available Steam records, do not invent unavailable titles or affiliations, and do not source or reproduce protected franchise assets.
