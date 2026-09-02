"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DemoSwitcher, { type WebMcpStatus } from "./demo-switcher";
import { loadCatalogPage, type CatalogGame, type CatalogPage, type StorefrontNumericField, type StorefrontNumericFilter, type StorefrontRankingFactor, type StorefrontRankingField, type StorefrontTagGroupFilter } from "./catalog-data";
import { buildSimilarityRecoveryAction, catalogQueryForRecommendation, qualifyRecommendationCandidates, resolveRecommendationQueryScope, similarityProfileForReference, type SimilarityRecoveryAction } from "./storefront-recommendation-workflow";
import "./storefront.css";

const PAGE_SIZE = 12;
const DEFAULT_BROWSER_HEADLINE = "Tell your browser what you want to play next.";
const SEARCH_SESSION_KEY = "adaptive-interfaces.storefront-search/v1";
const CUSTOM_FACETS_KEY = "adaptive-interfaces.storefront-facets/v3";
const PREVIOUS_CUSTOM_FACETS_KEY = "adaptive-interfaces.storefront-facets/v2";
const LIBRARY_KEY = "adaptive-interfaces.storefront-library/v1";
const LEGACY_SEARCH_SESSION_KEY = "steam-desk.storefront-search/v1";
const LEGACY_CUSTOM_FACETS_KEY = "steam-desk.storefront-facets/v2";
const OLDER_LEGACY_CUSTOM_FACETS_KEY = "steam-desk.storefront-facets/v1";
const LEGACY_LIBRARY_KEY = "steam-desk.storefront-library/v1";
const PRICE_BANDS = ["All prices", "Free", "Under $10", "$10–$29.99", "$30–$59.99", "$60+"] as const;
const SORTS = ["ownersMax", "title", "priceCents", "positiveRatio", "reviewCount", "ccu", "releaseYear"] as const;
const LAYOUTS = ["grid", "list", "table", "ranking"] as const;
const NUMERIC_FIELDS: StorefrontNumericField[] = ["positiveRatio", "reviewCount", "priceCents", "ownersMax", "ccu", "averageForever", "releaseYear"];
const INTENT_FIELDS = ["intentFit", "tagCoverage"] as const;
const RANKING_FIELDS: StorefrontRankingField[] = [...INTENT_FIELDS, ...NUMERIC_FIELDS];
const HIGHLIGHT_FIELDS = ["intentFit", "tagCoverage", "positiveRatio", "reviewCount", "ownersMax", "ccu", "releaseYear", "averageForever", "publisher"] as const;
const SKELETON_ITEMS = Array.from({ length: PAGE_SIZE }, (_, index) => index);
const FACET_PROMPTS = [
  { label: "Family", prompt: "Add a facet so I can see what games are family friendly." },
  { label: "Activity", prompt: "Add a facet for active players with useful bands." },
  { label: "Playtime", prompt: "Add a facet for average playtime with short, medium, and long bands." },
  { label: "Release", prompt: "Add a facet for release year that separates new, recent, and classic games." },
] as const;
const STORE_PROMPTS = [
  { label: "Set a vibe", prompt: "Show me a cozy game I can finish in a weekend." },
  { label: "Play together", prompt: "Show me a great co-op game under $20." },
  { label: "Pick one", prompt: "Suggest my next great game" },
] as const;

type LayoutMode = typeof LAYOUTS[number];
type SortKey = typeof SORTS[number];
type HighlightField = typeof HIGHLIGHT_FIELDS[number];
type FacetBand = { id: string; label: string; min?: number; max?: number };
type NumericCustomFacet = { kind: "numeric"; id: string; label: string; field: StorefrontNumericField; bands: FacetBand[] };
type TagCustomFacet = { kind: "tag"; id: string; label: string; tag: string };
type TagGroupMatch = "any" | "all";
type FacetTagGroup = { id: string; label: string; tags: string[]; match: TagGroupMatch };
type TagGroupsCustomFacet = { kind: "tag_groups"; id: string; label: string; groups: FacetTagGroup[]; allowOverlap: true };
type CustomFacet = NumericCustomFacet | TagCustomFacet | TagGroupsCustomFacet;
type ActiveTagGroupSelection = { facetId: string; facetLabel: string; group: FacetTagGroup };
type FeaturedEditorial = { appId: number; badge: string; reason: string };
type EditorialCuration = { headline: string; summary: string; featured: FeaturedEditorial[]; orderedAppIds: number[] };
type StorefrontEmptyState = { title: string; message: string; allowClear: boolean };
type SearchPresentation = { title: string; explanation: string; mode: LayoutMode; highlights: HighlightField[]; ranking: StorefrontRankingFactor[]; excludeOwned: boolean; editorial?: EditorialCuration; emptyState?: StorefrontEmptyState };
type CurationPhase = "finding" | "curating" | "ready" | "applying" | "complete";
type CurationProgress = { phase: CurationPhase; query: string };
type PrivateTasteProfile = { genres: string[]; tags: string[] };
type PendingRecommendation = {
  id: string;
  search: string;
  priceBand: (typeof PRICE_BANDS)[number];
  genre: string;
  tag: string;
  minPositiveRatio?: number;
  minReviewCount?: number;
  sort: SortKey;
  direction: "asc" | "desc";
  presentation: SearchPresentation;
  results: CatalogGame[];
  resultTotal: number;
  curation?: EditorialCuration;
};
type ApplyReceipt = { rendered: true; featuredAppIds: number[]; visibleAppIds: number[]; summaryVisible: boolean };
type StorefrontRuntime = {
  catalog: { current: CatalogPage | null };
  customFacets: { current: CustomFacet[] };
  library: { current: Set<number> };
  setBrowserHeadline: (headline: string) => void;
  setCurationProgress: (phase: CurationPhase | null, query?: string) => void;
  applyRecommendation: (recommendation: PendingRecommendation) => Promise<ApplyReceipt>;
  showRecoveryState: (query: string, action: SimilarityRecoveryAction) => void;
  applyNoResults: (query: string, message: string) => Promise<ApplyReceipt>;
  saveFacet: (facets: CustomFacet[]) => void;
  removeFacet: (facetId: string) => void;
  clearSearch: () => void;
};
type StorefrontPageProps = { webMcpStatus: WebMcpStatus; onWebMcpStatusChange: (status: WebMcpStatus) => void };

let storefrontRuntime: StorefrontRuntime | null = null;
let privateTasteProfileState: PrivateTasteProfile | null = null;
const storefrontRecommendations = new Map<string, PendingRecommendation>();
const storefrontRegistrations = new WeakMap<NonNullable<Document["modelContext"]>, Promise<void>>();
let storefrontRecoveryContext: { query: string; action: SimilarityRecoveryAction; notice: string } | null = null;

const RECOMMEND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string", maxLength: 120, description: "Concise catalog search terms." },
    queryScope: { type: "string", enum: ["catalog", "creator"], default: "catalog", description: "Use creator for requests about games made or published by a named studio. Keep catalog for title, franchise, genre, tag, or experience requests so developer-name-only matches do not masquerade as game matches." },
    workingHeadline: { type: "string", minLength: 1, maxLength: 100, description: "Browser-authored present-tense headline shown immediately while the visible storefront is being curated, for example “Finding a cozy game for your weekend.”" },
    reference: { type: "string", maxLength: 120, description: "A known game or franchise that anchors similarity intent without being treated as a literal catalog search." },
    includeTags: { type: "array", maxItems: 12, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 80 }, description: "Relevant tags that candidates should cover. At least one must match when provided." },
    preferredTags: { type: "array", maxItems: 12, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 80 }, description: "Soft preference tags that improve intentFit and tagCoverage." },
    excludeTags: { type: "array", maxItems: 12, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 80 }, description: "Tags that disqualify candidates." },
    genre: { type: "string", maxLength: 80 },
    tag: { type: "string", maxLength: 80 },
    priceBand: { type: "string", enum: PRICE_BANDS },
    minPositiveRatio: { type: "number", minimum: 0, maximum: 1 },
    minReviewCount: { type: "integer", minimum: 0, maximum: 10000000 },
    sort: { type: "string", enum: SORTS },
    direction: { type: "string", enum: ["asc", "desc"] },
    personalization: { type: "string", enum: ["none", "local_library"], default: "none", description: "For self-directed requests, offer library personalization once when describe_storefront reports personalizationAvailable true, unless the user declines or requests an immediate answer. Use local_library only after explicit opt-in and a successful get_taste_profile call. Always use none when personalization is unavailable or the recipient is someone_else, shared_group, or unspecified." },
    recipientContext: { type: "string", enum: ["self", "someone_else", "shared_group", "unspecified"], default: "unspecified", description: "Use self only when the user is choosing or buying the game for themselves. Never offer library personalization for someone_else or shared_group. For gifts, another person, a household or group, or an unclear recipient, use the matching non-self value and keep personalization set to none." },
    excludeOwnedLocally: { type: "boolean", default: true, description: "Filter owned app IDs entirely inside the page. No owned IDs or titles are returned." },
    presentation: {
      type: "object", additionalProperties: false,
      properties: {
        mode: { type: "string", enum: LAYOUTS },
        highlightFields: { type: "array", maxItems: 5, items: { type: "string", enum: HIGHLIGHT_FIELDS } },
      },
      required: ["mode"],
    },
    ranking: {
      type: "object", additionalProperties: false,
      properties: {
        factors: {
          type: "array", minItems: 1, maxItems: 5,
          items: {
            type: "object", additionalProperties: false,
            properties: {
              field: { type: "string", enum: RANKING_FIELDS },
              weight: { type: "number", exclusiveMinimum: 0, maximum: 1 },
              direction: { type: "string", enum: ["higher", "lower"] },
              label: { type: "string", maxLength: 40 },
            },
            required: ["field", "weight", "direction"],
          },
        },
      },
      required: ["factors"],
    },
  },
  required: ["query", "workingHeadline"],
};

const CURATE_RECOMMENDATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendationId: { type: "string", minLength: 1, maxLength: 80, description: "The opaque ID returned by recommend_storefront." },
    headline: { type: "string", minLength: 1, maxLength: 90 },
    summary: { type: "string", minLength: 1, maxLength: 240, description: "Overall editorial rationale shown above the results." },
    featured: {
      type: "array", minItems: 1, maxItems: 6, description: "Games rendered in the prominent “Top picks” section. Cardinality is meaningful: one item represents a single winner; multiple items represent a shortlist or co-equal picks.",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          appId: { type: "integer", minimum: 1 },
          badge: { type: "string", minLength: 1, maxLength: 40 },
          reason: { type: "string", minLength: 1, maxLength: 220, description: "The Why it fits sentence for this featured game." },
        },
        required: ["appId", "badge", "reason"],
      },
    },
    orderedAppIds: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true, description: "Editorial result order. When featured contains one decisive winner, that app ID must be first; keep supporting alternatives after it.", items: { type: "integer", minimum: 1 } },
  },
  required: ["recommendationId", "headline", "summary", "featured", "orderedAppIds"],
};

const APPLY_RECOMMENDATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendationId: { type: "string", minLength: 1, maxLength: 80, description: "The opaque ID returned by recommend_storefront." },
  },
  required: ["recommendationId"],
};

const APPLY_NO_RESULTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reason: { type: "string", maxLength: 240, description: "Optional user-facing explanation. Use only after similarity recovery is unavailable or has been exhausted." },
  },
};

const EXCLUDE_OWNED_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    appIds: { type: "array", maxItems: 100, items: { type: "integer", minimum: 1 }, description: "Public candidate app IDs to compare with the page's local library." },
  },
  required: ["appIds"],
};

const TASTE_PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    userConfirmed: { type: "boolean", description: "Must be true only after the user explicitly agrees to use the locally saved library for personalization." },
    forSelf: { type: "boolean", description: "Must be true only when the user is choosing or buying the recommended game for themselves. Keep false for gifts, other people, households, groups, or an unclear recipient." },
  },
  required: ["userConfirmed", "forSelf"],
};

const FACET_BANDS_SCHEMA = {
  type: "array", minItems: 2, maxItems: 8,
  description: "Two to eight non-overlapping numeric ranges. Each range needs a lower or upper bound.",
  items: {
    type: "object", additionalProperties: false,
    properties: { label: { type: "string", minLength: 1, maxLength: 40 }, min: { type: "number" }, max: { type: "number" } },
    required: ["label"],
  },
};

const FACET_SCHEMA = {
  type: "object",
  oneOf: [
    {
      title: "Numeric band facet",
      type: "object", additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["numeric"], description: "Use numeric for measurable fields such as price, activity, playtime, reviews, owners, or release year." },
        label: { type: "string", minLength: 1, maxLength: 40 },
        field: { type: "string", enum: NUMERIC_FIELDS },
        bands: FACET_BANDS_SCHEMA,
      },
      required: ["kind", "label", "field", "bands"],
    },
    {
      title: "Catalog tag facet",
      type: "object", additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["tag"], description: "Use tag for a reusable catalog-tag filter, including Family Friendly, Cozy, or Multiplayer." },
        label: { type: "string", minLength: 1, maxLength: 40, description: "The facet heading shown in the storefront." },
        tag: { type: "string", minLength: 1, maxLength: 80, description: "An available Steam catalog tag. For a family-friendly facet, use the exact catalog tag Family Friendly." },
      },
      required: ["kind", "label", "tag"],
    },
    {
      title: "Named tag-group facet",
      type: "object", additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["tag_groups"], description: "Use tag_groups when one facet needs two or more named choices made from several catalog tags." },
        label: { type: "string", minLength: 1, maxLength: 40, description: "The shared facet heading shown in the storefront." },
        groups: {
          type: "array", minItems: 2, maxItems: 8,
          description: "Named choices. Tag lists may overlap across choices.",
          items: {
            type: "object", additionalProperties: false,
            properties: {
              label: { type: "string", minLength: 1, maxLength: 40 },
              tags: { type: "array", minItems: 1, maxItems: 12, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 80 } },
              match: { type: "string", enum: ["any", "all"], description: "any matches at least one configured tag; all requires every configured tag." },
            },
            required: ["label", "tags", "match"],
          },
        },
        allowOverlap: { type: "boolean", enum: [true], description: "Tag-group membership may overlap and is always enabled." },
      },
      required: ["kind", "label", "groups"],
    },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, fallback = "", maxLength = 120) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text ? text.slice(0, maxLength) : fallback;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "facet";
}

function formatPrice(value: number) {
  return value === 0 ? "Free" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

function formatPercent(value: number | null) {
  return value === null ? "No reviews" : Math.round(value * 100) + "% positive";
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatPlaytime(minutes: number) {
  if (!minutes) return "—";
  const hours = minutes / 60;
  return hours < 10 ? hours.toFixed(1) + "h" : Math.round(hours) + "h";
}

function fieldLabel(field: StorefrontRankingField) {
  return {
    intentFit: "intent fit", tagCoverage: "tag coverage",
    positiveRatio: "review quality", reviewCount: "review confidence", priceCents: "lower price",
    ownersMax: "player reach", ccu: "active players", averageForever: "long-term playtime", releaseYear: "recency",
  }[field];
}

function metricValue(game: CatalogGame, field: HighlightField) {
  if (field === "intentFit") return Math.round(Number(game.intentFit ?? 0) * 100) + "% intent fit";
  if (field === "tagCoverage") return Math.round(Number(game.tagCoverage ?? 0) * 100) + "% tag coverage";
  if (field === "positiveRatio") return formatPercent(game.positiveRatio);
  if (field === "reviewCount") return formatCompact(game.reviewCount) + " reviews";
  if (field === "ownersMax") return formatCompact(game.ownersMax) + " owners";
  if (field === "ccu") return formatCompact(game.ccu) + " peak players";
  if (field === "releaseYear") return String(game.releaseYear ?? "Unknown year");
  if (field === "averageForever") return formatPlaytime(game.averageForever) + " avg. playtime";
  return game.publisher;
}

function GameArtwork({ game, compact = false }: { game: CatalogGame; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const initials = game.title.split(/\s+/).map((word) => word[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return <div className={"store-art" + (compact ? " compact" : "") + " art-" + Math.abs(game.id) % 6} aria-hidden="true">
    <span>{initials}</span>{game.headerImage && !failed ? <img src={game.headerImage} alt="" loading="lazy" onError={() => setFailed(true)} /> : null}
  </div>;
}

function BuyButton({ game, inLibrary, adding, onAdd }: { game: CatalogGame; inLibrary: boolean; adding: boolean; onAdd: (id: number) => void }) {
  return <button type="button" className={"store-buy" + (inLibrary ? " in-library" : "") + (adding ? " is-adding" : "")} disabled={inLibrary || adding} onClick={() => onAdd(game.id)} aria-live="polite">
    <span aria-hidden="true">{inLibrary ? "✓" : adding ? "···" : "+"}</span>
    {inLibrary ? "In library" : adding ? "Adding…" : game.priceCents === 0 ? "Add to library" : "Buy now"}
  </button>;
}

function FacetMatchReasons({ game, selections }: { game: CatalogGame; selections: ActiveTagGroupSelection[] }) {
  if (!selections.length) return null;
  const matched = new Map(game.matchedTags.map((tag) => [tag.toLocaleLowerCase(), tag]));
  return <div className="facet-match-reasons" aria-label="Why this game matches the selected groups">
    {selections.map(({ facetId, facetLabel, group }) => {
      const matchedTags = group.tags.flatMap((tag) => {
        const canonicalTag = matched.get(tag.toLocaleLowerCase());
        return canonicalTag ? [canonicalTag] : [];
      });
      const visibleTags = matchedTags.slice(0, 4);
      const remainder = matchedTags.length - visibleTags.length;
      const explanation = (group.match === "all" ? "All required tags: " : "Matched " + (matchedTags.length === 1 ? "tag: " : "tags: ")) + matchedTags.join(", ");
      return <span key={facetId + ":" + group.id} title={facetLabel + " / " + group.label + " — " + explanation}>
        <b>{group.label}</b><small>{group.match === "all" ? "All: " : "Via: "}{visibleTags.join(", ")}{remainder > 0 ? " +" + remainder : ""}</small>
      </span>;
    })}
  </div>;
}

type GameViewProps = { game: CatalogGame; highlights: HighlightField[]; tagGroupSelections: ActiveTagGroupSelection[]; inLibrary: boolean; adding: boolean; onAdd: (id: number) => void };

function FeaturedGameCard({ game, editorial, tagGroupSelections, inLibrary, adding, onAdd, isBestMatch = false }: Omit<GameViewProps, "highlights"> & { editorial: FeaturedEditorial; isBestMatch?: boolean }) {
  return <article className={"store-featured-card" + (isBestMatch ? " is-best-match" : "") + (inLibrary ? " is-owned" : "")}>
    <GameArtwork game={game} />
    <div className="store-featured-copy">
      <div className="store-featured-badges">
        {isBestMatch ? <span className="store-best-signal"><i aria-hidden="true">✦</i> Best match</span> : null}
        <span className="store-featured-badge">{editorial.badge}</span>
      </div>
      <div className="store-featured-title"><span>{game.genres.slice(0, 2).join(" · ") || "Game"}</span><h3>{game.title}</h3><p>{game.developer}</p></div>
      <p className="store-featured-reason"><b>Why it fits</b>{editorial.reason}</p>
      <FacetMatchReasons game={game} selections={tagGroupSelections} />
      <div className="store-featured-action"><strong>{formatPrice(game.priceCents)}</strong><BuyButton game={game} inLibrary={inLibrary} adding={adding} onAdd={onAdd} /></div>
    </div>
  </article>;
}

function GameCard({ game, highlights, tagGroupSelections, inLibrary, adding, onAdd }: GameViewProps) {
  const visible = highlights.length ? highlights : ["positiveRatio", "ccu"] as HighlightField[];
  return <article className={"store-card" + (inLibrary ? " is-owned" : "")}>
    <GameArtwork game={game} />
    <div className="store-card-body">
      <div className="store-card-kicker"><span>{game.genres[0] ?? "Game"}</span><b>{formatPrice(game.priceCents)}</b></div>
      <h3>{game.title}</h3><p>{game.developer}</p>
      <div className="store-card-tags">{visible.slice(0, 3).map((field) => <span key={field}>{metricValue(game, field)}</span>)}</div>
      <FacetMatchReasons game={game} selections={tagGroupSelections} />
      <BuyButton game={game} inLibrary={inLibrary} adding={adding} onAdd={onAdd} />
    </div>
  </article>;
}

function GameListItem({ game, highlights, tagGroupSelections, inLibrary, adding, onAdd }: GameViewProps) {
  const visible = highlights.length ? highlights : ["positiveRatio", "ownersMax"] as HighlightField[];
  return <article className={"store-list-item" + (inLibrary ? " is-owned" : "")}>
    <GameArtwork game={game} compact />
    <div className="store-list-copy"><span>{game.genres.slice(0, 2).join(" · ") || "Game"}</span><h3>{game.title}</h3><p>{game.developer}</p><FacetMatchReasons game={game} selections={tagGroupSelections} /></div>
    <div className="store-list-metrics">{visible.slice(0, 3).map((field) => <span key={field}>{metricValue(game, field)}</span>)}</div>
    <div className="store-list-action"><strong>{formatPrice(game.priceCents)}</strong><BuyButton game={game} inLibrary={inLibrary} adding={adding} onAdd={onAdd} /></div>
  </article>;
}

function RankingItem({ game, rank, highlights, tagGroupSelections, inLibrary, adding, onAdd }: GameViewProps & { rank: number }) {
  const visible = highlights.length ? highlights : ["positiveRatio", "reviewCount", "ccu"] as HighlightField[];
  const score = Math.max(0, Math.min(100, Math.round(Number(game.rankScore ?? 0) * 100)));
  return <article className={"store-rank-item" + (inLibrary ? " is-owned" : "")}>
    <div className="store-rank-number">{String(rank).padStart(2, "0")}</div><GameArtwork game={game} compact />
    <div className="store-rank-copy"><span>{game.genres.slice(0, 2).join(" · ") || "Game"}</span><h3>{game.title}</h3><p>{game.developer}</p><FacetMatchReasons game={game} selections={tagGroupSelections} /></div>
    <div className="store-rank-evidence">{visible.slice(0, 3).map((field) => <span key={field}><b>{metricValue(game, field)}</b><small>{field === "publisher" ? "publisher" : fieldLabel(field as StorefrontRankingField)}</small></span>)}</div>
    <div className="store-rank-score"><span><i style={{ width: score + "%" }} /></span><b>{score}</b><small>fit score</small></div>
    <div className="store-rank-action"><strong>{formatPrice(game.priceCents)}</strong><BuyButton game={game} inLibrary={inLibrary} adding={adding} onAdd={onAdd} /></div>
  </article>;
}

function GameTable({ games, tagGroupSelections, library, addingId, onAdd }: { games: CatalogGame[]; tagGroupSelections: ActiveTagGroupSelection[]; library: Set<number>; addingId: number | null; onAdd: (id: number) => void }) {
  return <div className="store-table-wrap"><table className="store-table"><thead><tr><th>Game</th><th>Reviews</th><th>Owners</th><th>Peak players</th><th>Price</th><th /></tr></thead><tbody>{games.map((game) => <tr key={game.id}>
    <td><div className="store-table-game"><GameArtwork game={game} compact /><span><strong>{game.title}</strong><small>{game.developer}</small><FacetMatchReasons game={game} selections={tagGroupSelections} /></span></div></td>
    <td>{formatPercent(game.positiveRatio)}</td><td>{formatCompact(game.ownersMax)}</td><td>{formatCompact(game.ccu)}</td><td>{formatPrice(game.priceCents)}</td>
    <td><BuyButton game={game} inLibrary={library.has(game.id)} adding={addingId === game.id} onAdd={onAdd} /></td>
  </tr>)}</tbody></table></div>;
}

function StorefrontResultsSkeleton({ mode }: { mode: LayoutMode }) {
  const itemCount = mode === "grid" ? PAGE_SIZE : mode === "table" ? 8 : 6;
  return <div className={"store-skeleton store-skeleton-" + mode} aria-hidden="true">
    {SKELETON_ITEMS.slice(0, itemCount).map((item) => <div className="store-skeleton-item" key={item}>
      {mode === "ranking" ? <span className="store-skeleton-block store-skeleton-rank-number" /> : null}
      <span className="store-skeleton-block store-skeleton-art" />
      <span className="store-skeleton-copy">
        <span className="store-skeleton-block store-skeleton-line short" />
        <span className="store-skeleton-block store-skeleton-line title" />
        <span className="store-skeleton-block store-skeleton-line medium" />
      </span>
      {mode !== "grid" ? <span className="store-skeleton-metrics">
        <span className="store-skeleton-block" /><span className="store-skeleton-block" /><span className="store-skeleton-block" />
      </span> : null}
      {mode === "ranking" ? <span className="store-skeleton-block store-skeleton-score" /> : null}
      <span className="store-skeleton-block store-skeleton-button" />
    </div>)}
  </div>;
}

const CURATION_STEPS: Array<{ phase: CurationPhase; label: string }> = [
  { phase: "finding", label: "Find matches" },
  { phase: "curating", label: "Compare signals" },
  { phase: "ready", label: "Build shortlist" },
];

function CurationProgressPanel({ progress }: { progress: CurationProgress }) {
  const phaseIndex = progress.phase === "finding" ? 0 : progress.phase === "curating" ? 1 : 2;
  const title = progress.phase === "finding"
    ? "Searching the catalog"
    : progress.phase === "curating"
      ? "Comparing the strongest matches"
      : progress.phase === "complete"
        ? "Your curated list is ready"
        : "Building your curated list";
  return <div className={"storefront-curation-progress phase-" + progress.phase} role="status" aria-live="polite">
    <div className="curation-progress-card">
      <div className="curation-sorter" aria-hidden="true"><span /><span /><span /></div>
      <div className="curation-progress-copy">
        <span className="curation-progress-eyebrow">Browser curation</span>
        <h3>{title}</h3>
        <p>{progress.query ? <>Working from <strong>“{progress.query}”</strong> while the next result set is prepared.</> : "Reviewing the catalog while the next result set is prepared."}</p>
      </div>
      <ol className="curation-progress-steps" aria-label="Curation progress">
        {CURATION_STEPS.map((step, index) => <li className={index < phaseIndex ? "is-complete" : index === phaseIndex ? "is-active" : ""} key={step.phase}>
          <span aria-hidden="true">{index < phaseIndex || progress.phase === "complete" ? "✓" : index + 1}</span><b>{step.label}</b>
        </li>)}
      </ol>
    </div>
  </div>;
}

function waitForCurationPaint(minimumMs: number) {
  const minimum = new Promise<void>((resolve) => window.setTimeout(resolve, minimumMs));
  const paint = new Promise<void>((resolve) => {
    let settled = false;
    const fallback = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, 800);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallback);
      resolve();
    }));
  });
  return Promise.all([minimum, paint]).then(() => undefined);
}

function normalizeCustomFacet(input: Record<string, unknown>, availableTags?: string[], existingId?: string): CustomFacet {
  const label = cleanText(input.label, "", 40);
  if (input.kind !== undefined && input.kind !== "numeric" && input.kind !== "tag" && input.kind !== "tag_groups") throw new Error("The facet kind must be numeric, tag, or tag_groups.");
  const kind = input.kind === "tag_groups" || input.kind === undefined && Array.isArray(input.groups)
    ? "tag_groups"
    : input.kind === "tag" || input.kind === undefined && typeof input.tag === "string" ? "tag" : "numeric";
  const id = cleanText(existingId, "", 80) || slug(label) + "-" + Date.now().toString(36);
  if (kind === "tag") {
    const requestedTag = cleanText(input.tag, "", 80);
    if (!label || !requestedTag) throw new Error("A tag facet needs a valid label and catalog tag.");
    const canonicalTag = availableTags?.find((tag) => tag.toLocaleLowerCase() === requestedTag.toLocaleLowerCase());
    if (availableTags && !canonicalTag) throw new Error("The “" + requestedTag + "” tag is not available in this catalog.");
    return { kind: "tag", id, label, tag: canonicalTag ?? requestedTag };
  }
  if (kind === "tag_groups") {
    if (!label) throw new Error("A tag-group facet needs a valid label.");
    const canonicalTags = availableTags ? new Map(availableTags.map((tag) => [tag.toLocaleLowerCase(), tag])) : undefined;
    const rawGroups = Array.isArray(input.groups) ? input.groups : [];
    const groups = rawGroups.flatMap((value, index): FacetTagGroup[] => {
      if (!isRecord(value)) return [];
      const groupLabel = cleanText(value.label, "", 40);
      const requestedTags = normalizedTags(value.tags);
      if (!groupLabel || !requestedTags.length) return [];
      if (value.match !== undefined && value.match !== "any" && value.match !== "all") throw new Error("Each tag group must use any or all matching.");
      const tags = requestedTags.map((tag) => {
        const canonicalTag = canonicalTags?.get(tag.toLocaleLowerCase());
        if (canonicalTags && !canonicalTag) throw new Error("The “" + tag + "” tag is not available in this catalog.");
        return canonicalTag ?? tag;
      });
      return [{ id: cleanText(value.id, "", 80) || slug(groupLabel) + "-" + index, label: groupLabel, tags, match: value.match === "all" ? "all" : "any" }];
    });
    if (groups.length < 2) throw new Error("A tag-group facet needs at least two named groups with one or more tags each.");
    const labels = groups.map((group) => group.label.toLocaleLowerCase());
    if (new Set(labels).size !== labels.length) throw new Error("Each tag group needs a unique label.");
    return { kind: "tag_groups", id, label, groups: groups.slice(0, 8), allowOverlap: true };
  }
  const field = String(input.field ?? "") as StorefrontNumericField;
  if (!label || !NUMERIC_FIELDS.includes(field)) throw new Error("The facet needs a valid label and numeric catalog field.");
  const rawBands = Array.isArray(input.bands) ? input.bands : [];
  const bands = rawBands.flatMap((value, index): FacetBand[] => {
    if (!isRecord(value)) return [];
    const bandLabel = cleanText(value.label, "", 40);
    const min = typeof value.min === "number" && Number.isFinite(value.min) ? value.min : undefined;
    const max = typeof value.max === "number" && Number.isFinite(value.max) ? value.max : undefined;
    if (!bandLabel || min === undefined && max === undefined || min !== undefined && max !== undefined && min >= max) return [];
    return [{ id: cleanText(value.id, "", 80) || slug(bandLabel) + "-" + index, label: bandLabel, min, max }];
  });
  if (bands.length < 2) throw new Error("A custom facet needs at least two valid, bounded bands.");
  const sorted = [...bands].sort((left, right) => (left.min ?? Number.NEGATIVE_INFINITY) - (right.min ?? Number.NEGATIVE_INFINITY));
  for (let index = 1; index < sorted.length; index++) {
    if ((sorted[index - 1].max ?? Number.POSITIVE_INFINITY) > (sorted[index].min ?? Number.NEGATIVE_INFINITY)) throw new Error("Custom facet bands cannot overlap.");
  }
  return { kind: "numeric", id, label, field, bands: sorted };
}

function normalizeRanking(value: unknown): StorefrontRankingFactor[] {
  const input = isRecord(value) && Array.isArray(value.factors) ? value.factors : [];
  return input.flatMap((factor): StorefrontRankingFactor[] => {
    if (!isRecord(factor)) return [];
    const field = String(factor.field ?? "") as StorefrontRankingField;
    const weight = typeof factor.weight === "number" ? Math.min(1, Math.max(0, factor.weight)) : 0;
    if (!RANKING_FIELDS.includes(field) || !weight) return [];
    return [{ field, weight, direction: factor.direction === "lower" ? "lower" : "higher", label: cleanText(factor.label, fieldLabel(field), 40) }];
  }).slice(0, 5);
}

function normalizedTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, "", 80))
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.toLocaleLowerCase() === item.toLocaleLowerCase()) === index)
    .slice(0, 12);
}

async function resolveCatalogTags(tags: string[]) {
  const response = await fetch("/api/catalog/tags?names=" + encodeURIComponent(JSON.stringify(tags)), { cache: "no-store" });
  const value = await response.json() as { tags?: string[]; error?: string };
  if (!response.ok || !Array.isArray(value.tags)) throw new Error(value.error || "The catalog tags could not be checked.");
  return value.tags;
}

function normalizeCuration(input: Record<string, unknown>, recommendation: PendingRecommendation): EditorialCuration {
  const allowed = new Set(recommendation.results.map((game) => game.id));
  const orderedAppIds = Array.isArray(input.orderedAppIds) ? input.orderedAppIds.filter((id): id is number => Number.isInteger(id) && Number(id) > 0) : [];
  const featured = Array.isArray(input.featured) ? input.featured.flatMap((value): FeaturedEditorial[] => {
    if (!isRecord(value) || !Number.isInteger(value.appId) || Number(value.appId) <= 0) return [];
    const badge = cleanText(value.badge, "", 40);
    const reason = cleanText(value.reason, "", 220);
    return badge && reason ? [{ appId: Number(value.appId), badge, reason }] : [];
  }) : [];
  const allIds = [...orderedAppIds, ...featured.map((item) => item.appId)];
  const invalidIds = [...new Set(allIds.filter((id) => !allowed.has(id)))];
  if (invalidIds.length) throw new Error("Curation can use only app IDs returned by the original recommendation set.");
  if (!orderedAppIds.length || new Set(orderedAppIds).size !== orderedAppIds.length) throw new Error("orderedAppIds must contain at least one unique app ID from the recommendation set.");
  if (!featured.length) throw new Error("Curation requires at least one featured game.");
  if (new Set(featured.map((item) => item.appId)).size !== featured.length) throw new Error("Each featured app ID may appear only once.");
  if (featured.length === 1 && orderedAppIds[0] !== featured[0].appId) throw new Error("A single featured winner must be first in orderedAppIds.");
  const headline = cleanText(input.headline, "", 90);
  const summary = cleanText(input.summary, "", 240);
  if (!headline || !summary) throw new Error("Curation requires a headline and overall summary.");
  return { headline, summary, featured: featured.slice(0, 6), orderedAppIds: orderedAppIds.slice(0, 100) };
}

function mostCommon(values: string[], limit = 5) {
  const counts = new Map<string, number>();
  for (const value of values.map((item) => item.trim()).filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function privateTasteProfile(games: CatalogGame[]): PrivateTasteProfile {
  return {
    genres: mostCommon(games.flatMap((game) => game.genres)).map((item) => item.label),
    tags: mostCommon(games.flatMap((game) => game.tags), 8).map((item) => item.label),
  };
}

function publicGame(game: CatalogGame) {
  return {
    id: game.id,
    title: game.title,
    headerImage: game.headerImage,
    developer: game.developer,
    publisher: game.publisher,
    genres: game.genres,
    tags: game.tags,
    priceCents: game.priceCents,
    discountPercent: game.discountPercent,
    positiveRatio: game.positiveRatio,
    reviewCount: game.reviewCount,
    ownersMax: game.ownersMax,
    ccu: game.ccu,
    averageForever: game.averageForever,
    releaseDate: game.releaseDate,
    releaseYear: game.releaseYear,
    rankScore: game.rankScore ?? null,
    intentFit: game.intentFit ?? null,
    tagCoverage: game.tagCoverage ?? null,
  };
}

export default function StorefrontPage({ onWebMcpStatusChange }: StorefrontPageProps) {
  const [catalog, setCatalog] = useState<CatalogPage | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [resolvedKey, setResolvedKey] = useState("");
  const [search, setSearch] = useState("");
  const [priceBand, setPriceBand] = useState<(typeof PRICE_BANDS)[number]>("All prices");
  const [genre, setGenre] = useState("");
  const [tag, setTag] = useState("");
  const [minPositiveRatio, setMinPositiveRatio] = useState<number | undefined>();
  const [minReviewCount, setMinReviewCount] = useState<number | undefined>();
  const [sort, setSort] = useState<SortKey>("ownersMax");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [presentation, setPresentation] = useState<SearchPresentation | null>(null);
  const [appliedRecommendation, setAppliedRecommendation] = useState<PendingRecommendation | null>(null);
  const [curationProgress, setCurationProgressState] = useState<CurationProgress | null>(null);
  const [browserHeadline, setBrowserHeadline] = useState(DEFAULT_BROWSER_HEADLINE);
  const [renderRequestVersion, setRenderRequestVersion] = useState(0);
  const [customFacets, setCustomFacets] = useState<CustomFacet[]>([]);
  const [selectedCustomBands, setSelectedCustomBands] = useState<Record<string, string>>({});
  const [copiedFacetPrompt, setCopiedFacetPrompt] = useState<string | null>(null);
  const [copiedStorePrompt, setCopiedStorePrompt] = useState<string | null>(null);
  const [library, setLibrary] = useState<Set<number>>(new Set());
  const [addingId, setAddingId] = useState<number | null>(null);
  const customFacetsRef = useRef<CustomFacet[]>([]);
  const libraryRef = useRef<Set<number>>(new Set());
  const catalogRef = useRef<CatalogPage | null>(null);
  const statusChangeRef = useRef(onWebMcpStatusChange);
  const storageLoadedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const curationCleanupTimerRef = useRef<number | null>(null);
  const renderWaiterRef = useRef<{ recommendationId: string; resolve: (receipt: ApplyReceipt) => void } | null>(null);

  useEffect(() => { catalogRef.current = catalog; }, [catalog]);
  useEffect(() => { statusChangeRef.current = onWebMcpStatusChange; }, [onWebMcpStatusChange]);

  const numericFilters = useMemo<StorefrontNumericFilter[]>(() => customFacets.flatMap((facet) => {
    if (facet.kind !== "numeric") return [];
    const selected = facet.bands.find((band) => band.id === selectedCustomBands[facet.id]);
    return selected ? [{ field: facet.field, min: selected.min, max: selected.max }] : [];
  }), [customFacets, selectedCustomBands]);
  const requiredTags = useMemo(() => customFacets.flatMap((facet) => facet.kind === "tag" && selectedCustomBands[facet.id] === facet.tag ? [facet.tag] : []), [customFacets, selectedCustomBands]);
  const activeTagGroupSelections = useMemo<ActiveTagGroupSelection[]>(() => customFacets.flatMap((facet) => {
    if (facet.kind !== "tag_groups") return [];
    const group = facet.groups.find((item) => item.id === selectedCustomBands[facet.id]);
    return group ? [{ facetId: facet.id, facetLabel: facet.label, group }] : [];
  }), [customFacets, selectedCustomBands]);
  const tagGroupFilters = useMemo<StorefrontTagGroupFilter[]>(() => activeTagGroupSelections.map(({ group }) => ({ tags: group.tags, match: group.match })), [activeTagGroupSelections]);
  const ranking = presentation?.ranking ?? [];
  const ownedExclusions = useMemo(() => presentation?.excludeOwned ? [...library].slice(0, 200) : [], [library, presentation?.excludeOwned]);
  const requestKey = JSON.stringify([search, priceBand, genre, tag, requiredTags, tagGroupFilters, minPositiveRatio, minReviewCount, sort, direction, page, numericFilters, ranking, ownedExclusions]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const facets = JSON.parse(window.localStorage.getItem(CUSTOM_FACETS_KEY) ?? window.localStorage.getItem(PREVIOUS_CUSTOM_FACETS_KEY) ?? window.localStorage.getItem(LEGACY_CUSTOM_FACETS_KEY) ?? window.localStorage.getItem(OLDER_LEGACY_CUSTOM_FACETS_KEY) ?? "[]") as unknown;
        if (Array.isArray(facets)) {
          const valid = facets.flatMap((item): CustomFacet[] => {
            if (!isRecord(item)) return [];
            try { return [normalizeCustomFacet(item, undefined, cleanText(item.id, "", 80))]; } catch { return []; }
          }).slice(0, 8);
          customFacetsRef.current = valid; setCustomFacets(valid);
        }
        const owned = JSON.parse(window.localStorage.getItem(LIBRARY_KEY) ?? window.localStorage.getItem(LEGACY_LIBRARY_KEY) ?? "[]") as unknown;
        if (Array.isArray(owned)) {
          const nextLibrary = new Set(owned.filter((id): id is number => Number.isInteger(id) && id > 0).slice(0, 2000));
          libraryRef.current = nextLibrary;
          setLibrary(nextLibrary);
        }
        const session = JSON.parse(window.sessionStorage.getItem(SEARCH_SESSION_KEY) ?? window.sessionStorage.getItem(LEGACY_SEARCH_SESSION_KEY) ?? "null") as unknown;
        if (isRecord(session) && isRecord(session.presentation)) {
          const stored = session.presentation as unknown as SearchPresentation;
          if (LAYOUTS.includes(stored.mode) && Array.isArray(stored.highlights) && Array.isArray(stored.ranking)) {
            setPresentation({ ...stored, excludeOwned: stored.excludeOwned !== false }); setSearch(cleanText(session.search, "", 120));
            if (PRICE_BANDS.includes(session.priceBand as (typeof PRICE_BANDS)[number])) setPriceBand(session.priceBand as (typeof PRICE_BANDS)[number]);
            setGenre(cleanText(session.genre, "", 80)); setTag(cleanText(session.tag, "", 80));
            if (typeof session.minPositiveRatio === "number") setMinPositiveRatio(session.minPositiveRatio);
            if (typeof session.minReviewCount === "number") setMinReviewCount(session.minReviewCount);
            if (SORTS.includes(session.sort as SortKey)) setSort(session.sort as SortKey);
            if (session.direction === "asc" || session.direction === "desc") setDirection(session.direction);
          }
        }
      } catch { /* Malformed storage falls back to defaults. */ }
      storageLoadedRef.current = true;
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!storageLoadedRef.current) return;
    try { window.localStorage.setItem(CUSTOM_FACETS_KEY, JSON.stringify(customFacets)); window.localStorage.removeItem(PREVIOUS_CUSTOM_FACETS_KEY); window.localStorage.removeItem(LEGACY_CUSTOM_FACETS_KEY); window.localStorage.removeItem(OLDER_LEGACY_CUSTOM_FACETS_KEY); } catch { /* Session fallback. */ }
    customFacetsRef.current = customFacets;
  }, [customFacets]);

  useEffect(() => {
    if (!storageLoadedRef.current) return;
    libraryRef.current = library;
    try { window.localStorage.setItem(LIBRARY_KEY, JSON.stringify([...library])); window.localStorage.removeItem(LEGACY_LIBRARY_KEY); } catch { /* Session fallback. */ }
  }, [library]);

  useEffect(() => {
    if (!storageLoadedRef.current) return;
    try {
      if (!presentation) window.sessionStorage.removeItem(SEARCH_SESSION_KEY);
      else window.sessionStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify({ presentation, search, priceBand, genre, tag, minPositiveRatio, minReviewCount, sort, direction }));
      window.sessionStorage.removeItem(LEGACY_SEARCH_SESSION_KEY);
    } catch { /* In-memory state remains usable. */ }
  }, [presentation, search, priceBand, genre, tag, minPositiveRatio, minReviewCount, sort, direction]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      loadCatalogPage({ search, ownerBand: "All owner ranges", priceBand, sort, direction, page, pageSize: PAGE_SIZE, genre, tag, requiredTags, tagGroupFilters, minPositiveRatio, minReviewCount, numericFilters, ranking, excludeAppIds: ownedExclusions }, controller.signal)
        .then((value) => { if (!controller.signal.aborted) { setCatalog(value); setCatalogError(""); setResolvedKey(requestKey); } })
        .catch((error: unknown) => { if (!controller.signal.aborted) { setCatalogError(error instanceof Error ? error.message : "Store catalog unavailable."); setResolvedKey(requestKey); } });
    }, search ? 160 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  // requestKey is the serialized query identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    if (curationCleanupTimerRef.current) window.clearTimeout(curationCleanupTimerRef.current);
  }, []);

  const copyFacetPrompt = useCallback((prompt: string) => {
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopiedFacetPrompt(prompt);
      timersRef.current.push(window.setTimeout(() => setCopiedFacetPrompt(null), 1600));
    });
  }, []);

  const copyStorePrompt = useCallback((prompt: string) => {
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopiedStorePrompt(prompt);
      timersRef.current.push(window.setTimeout(() => setCopiedStorePrompt(null), 1600));
    });
  }, []);

  const clearSearch = useCallback(() => {
    setSearch(""); setPriceBand("All prices"); setGenre(""); setTag(""); setMinPositiveRatio(undefined); setMinReviewCount(undefined);
    setSort("ownersMax"); setDirection("desc"); setPage(0); setPresentation(null); setAppliedRecommendation(null); setCurationProgressState(null); setBrowserHeadline(DEFAULT_BROWSER_HEADLINE); setSelectedCustomBands({});
    storefrontRecommendations.clear();
    storefrontRecoveryContext = null;
    try { window.sessionStorage.removeItem(SEARCH_SESSION_KEY); window.sessionStorage.removeItem(LEGACY_SEARCH_SESSION_KEY); } catch { /* State is reset in memory. */ }
  }, []);

  const setCurationProgress = useCallback((phase: CurationPhase | null, query?: string) => {
    if (curationCleanupTimerRef.current) window.clearTimeout(curationCleanupTimerRef.current);
    curationCleanupTimerRef.current = null;
    if (!phase) { setCurationProgressState(null); return; }
    setCurationProgressState((current) => ({ phase, query: query ?? current?.query ?? "" }));
    const timeout = phase === "ready" ? 12_000 : 60_000;
    curationCleanupTimerRef.current = window.setTimeout(() => {
      curationCleanupTimerRef.current = null;
      setCurationProgressState((current) => current?.phase === phase ? null : current);
    }, timeout);
  }, []);

  const applyRecommendation = useCallback((pending: PendingRecommendation) => new Promise<ApplyReceipt>((resolve) => {
    const editorial = pending.curation;
    pending.presentation = {
      ...pending.presentation,
      title: editorial?.headline ?? pending.presentation.title,
      explanation: editorial?.summary ?? pending.presentation.explanation,
      editorial,
    };
    renderWaiterRef.current = { recommendationId: pending.id, resolve };
    setCurationProgress("applying", pending.search);
    setSearch(pending.search); setPriceBand(pending.priceBand); setGenre(pending.genre); setTag(pending.tag);
    setMinPositiveRatio(pending.minPositiveRatio); setMinReviewCount(pending.minReviewCount);
    setSort(pending.sort); setDirection(pending.direction); setPresentation(pending.presentation); setAppliedRecommendation(pending); setPage(0);
    setRenderRequestVersion((version) => version + 1);
  }), [setCurationProgress]);

  const showRecoveryState = useCallback((query: string, action: SimilarityRecoveryAction) => {
    const pending: PendingRecommendation = {
      id: "store-recovery-" + Date.now().toString(36),
      search: "",
      priceBand: "All prices",
      genre: "",
      tag: "",
      sort: "positiveRatio",
      direction: "desc",
      presentation: {
        title: "Finding a better catalog match",
        explanation: "The literal catalog matches were not relevant, so the browser is switching to similarity retrieval.",
        mode: "ranking",
        highlights: ["intentFit", "tagCoverage", "positiveRatio", "reviewCount"],
        ranking: [],
        excludeOwned: false,
        emptyState: {
          title: "Literal matches were not relevant",
          message: "Trying games similar to “" + action.reference + "” instead.",
          allowClear: false,
        },
      },
      results: [],
      resultTotal: 0,
    };
    setSearch(""); setPriceBand("All prices"); setGenre(""); setTag("");
    setMinPositiveRatio(undefined); setMinReviewCount(undefined); setSort("positiveRatio"); setDirection("desc");
    setPresentation(pending.presentation); setAppliedRecommendation(pending); setPage(0);
    setCurationProgress("finding", "games similar to " + action.reference);
  }, [setCurationProgress]);

  const applyNoResults = useCallback((query: string, message: string) => {
    const pending: PendingRecommendation = {
      id: "store-no-results-" + Date.now().toString(36),
      search: "",
      priceBand: "All prices",
      genre: "",
      tag: "",
      sort: "positiveRatio",
      direction: "desc",
      presentation: {
        title: "No suitable catalog matches",
        explanation: message,
        mode: "ranking",
        highlights: [],
        ranking: [],
        excludeOwned: false,
        emptyState: { title: "No suitable games found", message, allowClear: true },
      },
      results: [],
      resultTotal: 0,
    };
    storefrontRecoveryContext = null;
    return applyRecommendation(pending);
  }, [applyRecommendation]);

  const saveFacet = useCallback((facets: CustomFacet[]) => {
    customFacetsRef.current = facets;
    setCustomFacets(facets);
  }, []);

  const removeFacet = useCallback((facetId: string) => {
    setCustomFacets((items) => items.filter((item) => item.id !== facetId));
    setSelectedCustomBands((selected) => { const copy = { ...selected }; delete copy[facetId]; return copy; });
  }, []);

  useEffect(() => {
    const runtime: StorefrontRuntime = {
      catalog: catalogRef,
      customFacets: customFacetsRef,
      library: libraryRef,
      setBrowserHeadline,
      setCurationProgress,
      applyRecommendation,
      showRecoveryState,
      applyNoResults,
      saveFacet,
      removeFacet,
      clearSearch,
    };
    storefrontRuntime = runtime;
    const context = document.modelContext ?? navigator.modelContext;
    if (!context) {
      queueMicrotask(() => statusChangeRef.current("preview"));
      return () => { if (storefrontRuntime === runtime) storefrontRuntime = null; };
    }
    const existingRegistration = storefrontRegistrations.get(context);
    if (existingRegistration) {
      void existingRegistration
        .then(() => statusChangeRef.current("connected"))
        .catch(() => statusChangeRef.current("preview"));
      return () => { if (storefrontRuntime === runtime) storefrontRuntime = null; };
    }
    const controller = new AbortController();
    const tools = [
      {
        name: "describe_storefront",
        description: "Describe the local-only Steam storefront demo, including its public catalog fields, filters, ranking formulas, adaptive templates, local personalization controls, and safety boundary. Returns the non-sensitive personalizationAvailable capability signal without exposing owned titles, app IDs, playtime, library-derived preferences, or taste data.",
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, untrustedContentHint: false },
        execute: () => {
          const currentRuntime = storefrontRuntime;
          const current = currentRuntime?.catalog.current;
          return {
            content: [{ type: "text", text: "Described the storefront's public discovery and local personalization capabilities without disclosing personal library data." }],
            structuredContent: {
              schemaVersion: "adaptive-interfaces.storefront/v2",
              personalizationAvailable: Boolean(currentRuntime?.library.current.size),
              catalog: { recordCount: current?.meta.recordCount ?? null, genres: current?.facets.genres.slice(0, 30).map((item) => item.label) ?? [], tags: current?.facets.tags.slice(0, 40).map((item) => item.label) ?? [] },
              presentationModes: LAYOUTS,
              rankingFields: RANKING_FIELDS.map((field) => ({ field, meaning: fieldLabel(field) })),
              customFacets: currentRuntime?.customFacets.current ?? [],
              personalization: {
                default: "none",
                ownedFiltering: "Local-only; returns only excludedOwnedCount.",
                tasteProfile: "Available only with explicit opt-in when the user is choosing or buying a game for themselves; profile data remains inside the page.",
              },
              safetyBoundary: {
                environment: "local storefront demonstration",
                commerce: "No cart, checkout, order, reservation, payment, billing, or real purchase capability exists.",
                personalData: "No tool returns owned titles, app IDs, playtime, or a derived taste profile.",
                writes: "recommend_storefront changes no result data and shows only ephemeral curation progress. curate_storefront_results stages editorial metadata and advances that progress. apply_storefront_results changes session UI only. Facets are removable local preferences.",
                externalEffects: "Tools do not message another party or change any external service, retailer, account, or catalog record.",
              },
              guidance: [
                "For a self-directed request, when personalizationAvailable is true, ask once whether the user wants library-based personalization before recommending.",
                "If the user declines, requests an immediate answer, or personalizationAvailable is false, continue immediately with personalization none.",
                "Never offer library personalization for recipientContext someone_else or shared_group. Keep personalization none for those requests and for an unclear recipient.",
                "Examples: “Show me a game” → offer personalization once; “Find my nephew a game” → do not offer and use public data; “Use my library” → explicit consent, so call get_taste_profile; “Just recommend something” → skip the question and use public data.",
                "Owned-game exclusion is local and returns only excludedOwnedCount. When the visible library count is zero, the page skips owned-data matching.",
                "Library taste personalization applies only when the user is choosing or buying a game for themselves. For a gift, another person, a household or group, or an unclear recipient, keep personalization none.",
                "Only call get_taste_profile after the user explicitly agrees to use the locally saved library for this self-directed choice. The profile remains private inside the page.",
                "When calling recommend_storefront, write a concise present-tense workingHeadline in the browser's voice. It immediately replaces the default storefront invitation and remains visible while the recommendation is prepared.",
                "recommend_storefront is the retrieval step, not the preferred final presentation. For discovery, comparison, ranking, or recommendation requests, follow it with curate_storefront_results by default so the result has an intentional headline, rationale, featured choice, reasons, and ordering. Return an uncurated search list only when the user explicitly asks for raw or conventional search results.",
                "Use reference, includeTags, preferredTags, and excludeTags for intent relevance; rank with intentFit or tagCoverage when similarity matters.",
                "Set queryScope to creator only for developer, publisher, or studio requests. Creator scope deliberately keeps developer and publisher matches eligible; catalog scope requires title, genre, tag, or explicit intent evidence.",
                "Do not finish after an unsuccessful literal search when similarity retrieval can reasonably satisfy the request. When workflowStatus is recovery_required, call recommend_storefront again with the retry_as_similarity action, compare the recovered signals, curate a shortlist or winner, and apply it before responding.",
                "A candidate with zero intentFit and zero tagCoverage is not qualified for a targeted recommendation. If a similarity recovery returns no qualified candidates, the page applies an explicit no-results state so an earlier recommendation cannot remain visible.",
                "Prefer curate_storefront_results over stopping after catalog retrieval. Call it separately after recommend_storefront for ordinary discovery, comparison, ranking, and recommendation requests; skip it only for an explicit raw or conventional search-results request. Every app ID must come from the original recommendation set.",
                "Call apply_storefront_results only when the user asked to update the visible storefront. It preserves any staged editorial metadata and waits for rendering.",
                "Use save_storefront_facet only for a user-requested reusable facet. Choose kind tag for one catalog concept, kind tag_groups for two or more named multi-tag choices that may overlap, or kind numeric for non-overlapping measurable bands. Tag groups compose with price and other active filters.",
                "Treat named games as examples of the experience the user wants. If a game or franchise is not available on Steam, search for similar games that are instead of searching for the exact franchise.",
                "Do not offer cart, checkout, ordering, payment, installation, or account access; none of those capabilities exists.",
              ],
            },
          };
        },
      },
      {
        name: "exclude_owned_games",
        description: "Compare public candidate app IDs with the simulated library entirely inside the page and return only excludedCount. This never returns owned IDs, titles, playtime, or preferences. If the local library is empty, it immediately returns zero without reading catalog records.",
        inputSchema: EXCLUDE_OWNED_SCHEMA,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const candidates = Array.isArray(input.appIds) ? input.appIds.filter((id): id is number => Number.isInteger(id) && Number(id) > 0).slice(0, 100) : [];
          const owned = storefrontRuntime?.library.current ?? new Set<number>();
          const excludedCount = owned.size ? candidates.reduce((count, id) => count + (owned.has(id) ? 1 : 0), 0) : 0;
          return {
            content: [{ type: "text", text: excludedCount ? "Excluded " + excludedCount + " locally owned candidate games." : "No candidate games were excluded." }],
            structuredContent: { schemaVersion: "adaptive-interfaces.owned-exclusion/v1", excludedCount },
          };
        },
      },
      {
        name: "get_taste_profile",
        description: "Privately prepare a taste profile inside the page only after the user explicitly agrees and only when they are choosing or buying the recommended game for themselves. Never use it for gifts, another person, a household or group, or an unclear recipient. This tool never returns owned titles, app IDs, playtime, preferences, or the derived profile.",
        inputSchema: TASTE_PROFILE_SCHEMA,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          if (input.userConfirmed !== true) return {
            isError: true,
            content: [{ type: "text", text: "Explicit user agreement is required before local-library taste profiling." }],
            structuredContent: { ok: false, code: "PERSONALIZATION_CONFIRMATION_REQUIRED" },
          };
          if (input.forSelf !== true) return {
            isError: true,
            content: [{ type: "text", text: "Library taste profiling is available only when the user is choosing or buying a game for themselves. Use no taste personalization for gifts, other people, groups, or unclear recipients." }],
            structuredContent: { ok: false, code: "SELF_PURCHASE_CONTEXT_REQUIRED" },
          };
          const ids = [...(storefrontRuntime?.library.current ?? new Set<number>())].slice(0, 100);
          if (!ids.length) {
            privateTasteProfileState = null;
            return {
              content: [{ type: "text", text: "The local library is empty, so no taste profile was read or created." }],
              structuredContent: { schemaVersion: "adaptive-interfaces.private-taste-profile/v1", ok: true, ready: false, reason: "empty_library" },
            };
          }
          try {
            const libraryCatalog = await loadCatalogPage({
              search: "", ownerBand: "All owner ranges", priceBand: "All prices", sort: "title", direction: "asc", page: 0, pageSize: 100, appIds: ids,
            }, controller.signal);
            privateTasteProfileState = privateTasteProfile(libraryCatalog.games);
            return {
              content: [{ type: "text", text: "Prepared private local-library personalization. No library or profile data was disclosed." }],
              structuredContent: { schemaVersion: "adaptive-interfaces.private-taste-profile/v1", ok: true, ready: true },
            };
          } catch (error) {
            privateTasteProfileState = null;
            return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Private taste personalization could not be prepared." }], structuredContent: { ok: false } };
          }
        },
      },
      {
        name: "recommend_storefront",
        description: "Retrieve public Steam catalog candidates without applying them to the visible result set. Set workingHeadline to a concise present-tense message in the browser's voice. Use queryScope creator only for developer, publisher, or studio requests; otherwise keep catalog scope so developer-name-only matches cannot masquerade as title, franchise, genre, or tag matches. Treat named games as examples of the experience the user wants. If a literal search has no qualified candidates, workflowStatus is recovery_required and stale results are replaced by a recovery state: do not finish. Call recommend_storefront again with the returned retry_as_similarity action, compare intent fit, tag coverage, review quality, and review confidence, curate a shortlist or winner, and apply it before responding. A targeted candidate with zero intentFit and zero tagCoverage is not qualified. If similarity recovery also fails, the tool applies an explicit no-results state. This is a retrieval step, not the preferred final presentation: for discovery, comparison, ranking, or recommendation requests, follow a successful retrieval with curate_storefront_results by default. Stop at an uncurated search list only when the user explicitly asks for raw or conventional search results. Consent protocol before recommending: when recipientContext is self and describe_storefront reports personalizationAvailable true, ask once whether the user wants library-based personalization. If they agree—or explicitly say “Use my library”—call get_taste_profile first, then use personalization local_library. If they decline, if they request an immediate answer, or if personalization is unavailable, continue immediately with personalization none. Never offer library personalization for someone_else or shared_group; use public data with personalization none. Use reference, includeTags, preferredTags, and excludeTags to express intent, and intentFit or tagCoverage as ranking factors. Owned-game exclusion happens inside the page and returns only excludedOwnedCount; no owned titles, IDs, playtime, preferences, or taste data are disclosed.",
        inputSchema: RECOMMEND_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const personalization = input.personalization === "local_library" ? "local_library" : "none";
          const recipientContext = input.recipientContext === "self" || input.recipientContext === "someone_else" || input.recipientContext === "shared_group" ? input.recipientContext : "unspecified";
          if (personalization === "local_library" && recipientContext !== "self") return {
            isError: true,
            content: [{ type: "text", text: "Local-library taste personalization is limited to games the user is choosing or buying for themselves. Use personalization none for gifts, other people, groups, or an unclear recipient." }],
            structuredContent: { ok: false, code: "SELF_PURCHASE_CONTEXT_REQUIRED", recipientContext },
          };
          const profile = personalization === "local_library" ? privateTasteProfileState : null;
          if (personalization === "local_library" && !profile) return {
            isError: true,
            content: [{ type: "text", text: "Local-library personalization is not ready. Ask the user to opt in, then call get_taste_profile first." }],
            structuredContent: { ok: false, code: "PERSONALIZATION_OPT_IN_REQUIRED" },
          };
          const progressQuery = cleanText(input.query, "", 120);
          const queryScope = resolveRecommendationQueryScope(input.queryScope, progressQuery);
          const workingHeadline = cleanText(input.workingHeadline, DEFAULT_BROWSER_HEADLINE, 100);
          storefrontRuntime?.setBrowserHeadline(workingHeadline);
          storefrontRuntime?.setCurationProgress("finding", progressQuery);
          const initialPaint = waitForCurationPaint(650);
          try {
            const rawPresentation = isRecord(input.presentation) ? input.presentation : {};
            const mode = LAYOUTS.includes(rawPresentation.mode as LayoutMode) ? rawPresentation.mode as LayoutMode : "ranking";
            const highlights = Array.isArray(rawPresentation.highlightFields) ? rawPresentation.highlightFields.filter((field): field is HighlightField => HIGHLIGHT_FIELDS.includes(field as HighlightField)).slice(0, 5) : [];
            const reference = cleanText(input.reference, "", 120);
            const requestedIncludeTags = normalizedTags(input.includeTags);
            const requestedPreferredTags = normalizedTags(input.preferredTags);
            const referenceProfile = !requestedIncludeTags.length && !requestedPreferredTags.length ? similarityProfileForReference(reference) : null;
            const includeTags = referenceProfile?.includeTags ?? requestedIncludeTags;
            const preferredTags = [...(referenceProfile?.preferredTags ?? requestedPreferredTags), ...(profile?.tags ?? [])]
              .filter((item, index, items) => items.findIndex((candidate) => candidate.toLocaleLowerCase() === item.toLocaleLowerCase()) === index)
              .slice(0, 12);
            const excludeTags = normalizedTags(input.excludeTags);
            const hasIntent = Boolean(reference || includeTags.length || preferredTags.length || excludeTags.length);
            let nextRanking = normalizeRanking(input.ranking);
            if (mode === "ranking" && !nextRanking.length) nextRanking = hasIntent ? [
              { field: "intentFit", weight: .55, direction: "higher", label: "intent fit" },
              { field: "tagCoverage", weight: .2, direction: "higher", label: "tag coverage" },
              { field: "positiveRatio", weight: .15, direction: "higher", label: "review quality" },
              { field: "reviewCount", weight: .1, direction: "higher", label: "review confidence" },
            ] : [
              { field: "positiveRatio", weight: .5, direction: "higher", label: "review quality" },
              { field: "reviewCount", weight: .2, direction: "higher", label: "review confidence" },
              { field: "ownersMax", weight: .2, direction: "higher", label: "player reach" },
              { field: "ccu", weight: .1, direction: "higher", label: "active players" },
            ];
            const query = reference ? "" : catalogQueryForRecommendation(progressQuery, queryScope);
            const genre = cleanText(input.genre, profile?.genres[0] ?? "", 80);
            const tag = cleanText(input.tag, profile?.tags[0] ?? "", 80);
            const price = PRICE_BANDS.includes(input.priceBand as (typeof PRICE_BANDS)[number]) ? input.priceBand as (typeof PRICE_BANDS)[number] : "All prices";
            const minRatio = typeof input.minPositiveRatio === "number" ? Math.min(1, Math.max(0, input.minPositiveRatio)) : undefined;
            const minReviews = typeof input.minReviewCount === "number" ? Math.max(0, Math.round(input.minReviewCount)) : undefined;
            const sortKey = SORTS.includes(input.sort as SortKey) ? input.sort as SortKey : nextRanking.length ? "positiveRatio" : "ownersMax";
            const sortDirection: "asc" | "desc" = input.direction === "asc" ? "asc" : "desc";
            const excludeOwned = input.excludeOwnedLocally !== false;
            const currentLibrary = storefrontRuntime?.library.current ?? new Set<number>();
            const ownedIds = excludeOwned && currentLibrary.size ? [...currentLibrary].slice(0, 200) : [];
            const options = {
              search: query, ownerBand: "All owner ranges", priceBand: price, sort: sortKey, direction: sortDirection, page: 0, pageSize: PAGE_SIZE,
              genre, tag, minPositiveRatio: minRatio, minReviewCount: minReviews, ranking: nextRanking,
              reference, includeTags, preferredTags, excludeTags,
            };
            const recommendationRequest = loadCatalogPage({ ...options, excludeAppIds: ownedIds }, controller.signal);
            const inclusiveCountRequest = ownedIds.length ? loadCatalogPage({ ...options, pageSize: 1 }, controller.signal) : null;
            const [result, inclusive] = await Promise.all([recommendationRequest, inclusiveCountRequest, initialPaint]);
            const excludedOwnedCount = inclusive ? Math.max(0, inclusive.query.total - result.query.total) : 0;
            const qualifiedResults = qualifyRecommendationCandidates(result.games, { query: progressQuery, queryScope, hasIntentSignals: hasIntent });
            const priorRecovery = storefrontRecoveryContext && reference && storefrontRecoveryContext.action.reference.toLocaleLowerCase() === reference.toLocaleLowerCase()
              ? storefrontRecoveryContext
              : null;
            if (!qualifiedResults.length) {
              if (!reference && progressQuery) {
                const action = buildSimilarityRecoveryAction(progressQuery);
                const notice = action.reference === "Super Mario"
                  ? "The catalog has no official Mario title among the literal matches, so use similar platformers instead."
                  : "The literal catalog matches did not fit the requested game or franchise, so use similarity retrieval instead.";
                storefrontRecoveryContext = { query: progressQuery, action, notice };
                storefrontRuntime?.showRecoveryState(progressQuery, action);
                return {
                  content: [{ type: "text", text: "No literal candidates qualified. Recovery is required: call recommend_storefront again using the retry_as_similarity action, then compare, curate, and apply the recovered candidates before responding." }],
                  structuredContent: {
                    schemaVersion: "adaptive-interfaces.storefront-recommendations/v2",
                    ok: true,
                    qualifiedCandidateCount: 0,
                    workflowStatus: "recovery_required",
                    uiUpdated: false,
                    staleResultsCleared: true,
                    allowedNextActions: [action, { action: "broaden_search" }, { action: "apply_no_results", tool: "apply_storefront_no_results" }],
                    catalogNotice: notice,
                  },
                };
              }
              const noResultsMessage = priorRecovery?.notice
                ? priorRecovery.notice + " The similarity search also produced no suitable catalog candidates."
                : "The search produced no suitable catalog candidates. Try broader terms or clear the search.";
              const noResultsQuery = priorRecovery?.query ?? (progressQuery || reference);
              const receipt = storefrontRuntime ? await storefrontRuntime.applyNoResults(noResultsQuery, noResultsMessage) : null;
              return {
                content: [{ type: "text", text: "No candidates qualified after recovery. The storefront now shows an explicit no-results state instead of the previous recommendation." }],
                structuredContent: {
                  schemaVersion: "adaptive-interfaces.storefront-recommendations/v2",
                  ok: true,
                  qualifiedCandidateCount: 0,
                  workflowStatus: "no_results_applied",
                  uiUpdated: Boolean(receipt),
                  allowedNextActions: [{ action: "broaden_search" }],
                  ...(receipt ?? {}),
                },
              };
            }
            const nextPresentation: SearchPresentation = {
              title: "Recommendations shaped around your request",
              explanation: priorRecovery?.notice ?? (personalization === "local_library" ? "Public catalog results ranked with a private profile computed inside this page." : "Public catalog results ranked for the stated intent without reading personal taste data."),
              mode, highlights, ranking: nextRanking, excludeOwned,
            };
            const recommendationId = "store-rec-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
            const recommendation: PendingRecommendation = {
              id: recommendationId, search: query, priceBand: price, genre, tag, minPositiveRatio: minRatio, minReviewCount: minReviews,
              sort: sortKey, direction: sortDirection, presentation: nextPresentation, results: qualifiedResults, resultTotal: qualifiedResults.length,
            };
            storefrontRecommendations.set(recommendationId, recommendation);
            storefrontRuntime?.setCurationProgress("curating", query);
            await waitForCurationPaint(240);
            return {
              content: [{ type: "text", text: (priorRecovery ? "Recovered " : "Found ") + qualifiedResults.length + " qualified public game candidates without applying them. Compare the ranking signals, call curate_storefront_results, and then apply_storefront_results before responding." }],
              structuredContent: {
                schemaVersion: "adaptive-interfaces.storefront-recommendations/v2",
                ok: true,
                recommendationId,
                qualifiedCandidateCount: qualifiedResults.length,
                workflowStatus: "ready_for_curation",
                uiUpdated: false,
                personalization,
                recipientContext,
                queryScope,
                intent: { reference, includeTags, preferredTags, excludeTags },
                rankingSignals: nextRanking.map((factor) => factor.field),
                results: qualifiedResults.map(publicGame),
                excludedOwnedCount,
                allowedNextActions: [{ action: "curate_shortlist", recommendationId }],
                ...(priorRecovery ? { recovery: { from: priorRecovery.query, reference, catalogNotice: priorRecovery.notice } } : {}),
              },
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : "Storefront recommendations could not be created.";
            const currentRuntime = storefrontRuntime;
            if (currentRuntime) {
              const receipt = await currentRuntime.applyNoResults(progressQuery, "The latest storefront request could not be completed: " + message);
              return { isError: true, content: [{ type: "text", text: message + " The storefront now shows an explicit failure state instead of older results." }], structuredContent: { ok: false, code: "RECOMMENDATION_FAILED", uiUpdated: true, ...receipt } };
            }
            return { isError: true, content: [{ type: "text", text: message }], structuredContent: { ok: false, code: "RECOMMENDATION_FAILED", uiUpdated: false } };
          }
        },
      },
      {
        name: "curate_storefront_results",
        description: "Stage the preferred editorial presentation for one recommendation set. Use this after recommend_storefront by default for discovery, comparison, ranking, or recommendation requests; an uncurated search list is appropriate only when the user explicitly asks for raw or conventional search results. The visible storefront must match the assistant’s stated recommendation. If the assistant names one decisive winner—for example, “Play X next,” “X is my pick,” or “X is the best choice”—include exactly that game in featured and place it first in orderedAppIds. Keep other games as unfeatured alternatives. Use multiple featured games only when the assistant explicitly presents a shortlist, several equal options, or category winners. Do not turn supporting alternatives into co-equal featured recommendations when a single winner was stated. Give every featured game a badge and a Why it fits reason that reflects its role. This tool does not retrieve new games or change the visible UI, and every app ID is validated against the original recommendation set.",
        inputSchema: CURATE_RECOMMENDATION_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const recommendationId = cleanText(input.recommendationId, "", 80);
          const recommendation = storefrontRecommendations.get(recommendationId);
          if (!recommendation) return {
            isError: true,
            content: [{ type: "text", text: "That recommendation is unavailable or stale. Call recommend_storefront again." }],
            structuredContent: { ok: false, code: "RECOMMENDATION_NOT_FOUND" },
          };
          try {
            storefrontRuntime?.setCurationProgress("curating", recommendation.search);
            const curation = normalizeCuration(input, recommendation);
            recommendation.curation = curation;
            storefrontRuntime?.setCurationProgress("ready", recommendation.search);
            await waitForCurationPaint(360);
            return {
              content: [{ type: "text", text: "Curated “" + curation.headline + "” using only games from the original recommendation set." }],
              structuredContent: {
                schemaVersion: "adaptive-interfaces.storefront-curation/v1",
                ok: true,
                recommendationId,
                headline: curation.headline,
                featuredAppIds: curation.featured.map((item) => item.appId),
                orderedAppIds: curation.orderedAppIds,
              },
            };
          } catch (error) {
            storefrontRuntime?.setCurationProgress(null);
            return {
              isError: true,
              content: [{ type: "text", text: error instanceof Error ? error.message : "The recommendation could not be curated." }],
              structuredContent: { ok: false, code: "INVALID_CURATION" },
            };
          }
        },
      },
      {
        name: "apply_storefront_results",
        description: "Apply one staged recommendation to the visible storefront session. Prefer applying after curate_storefront_results so the storefront preserves an editorial summary, featured badges, Why it fits reasons, and intentional ordering; apply an uncurated recommendation only when the user explicitly asked for raw or conventional search results. Featured games render before the algorithmic list. The tool waits for the UI render to commit before returning. This cannot purchase, install, access an account, or write to an external service.",
        inputSchema: APPLY_RECOMMENDATION_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const recommendationId = cleanText(input.recommendationId, "", 80);
          const pending = storefrontRecommendations.get(recommendationId);
          if (!pending) return {
            isError: true,
            content: [{ type: "text", text: "That recommendation is unavailable or stale. Call recommend_storefront again." }],
            structuredContent: { ok: false, code: "RECOMMENDATION_NOT_FOUND" },
          };
          const currentRuntime = storefrontRuntime;
          if (!currentRuntime) return {
            isError: true,
            content: [{ type: "text", text: "The storefront page is not currently available to render this recommendation." }],
            structuredContent: { ok: false, code: "STOREFRONT_NOT_MOUNTED" },
          };
          const receipt = await currentRuntime.applyRecommendation(pending);
          return {
            content: [{ type: "text", text: "Applied “" + pending.presentation.title + "” to the visible " + pending.presentation.mode + " storefront layout." }],
            structuredContent: { schemaVersion: "adaptive-interfaces.storefront-apply-receipt/v2", ok: true, recommendationId, persistence: "session until search is cleared", ...receipt },
          };
        },
      },
      {
        name: "apply_storefront_no_results",
        description: "Replace the visible storefront with an explicit no-results state for the latest failed recommendation. Use only after workflowStatus recovery_required when similarity retrieval is unavailable, or after a broader recovery attempt has also failed. Do not use this to skip a reasonable similarity recovery. The tool waits for the empty state to render, ensuring an earlier recommendation cannot remain visible as the answer to the new request.",
        inputSchema: APPLY_NO_RESULTS_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const recovery = storefrontRecoveryContext;
          if (!recovery) return {
            isError: true,
            content: [{ type: "text", text: "There is no failed storefront retrieval waiting for a no-results state." }],
            structuredContent: { ok: false, code: "RECOVERY_NOT_PENDING" },
          };
          const currentRuntime = storefrontRuntime;
          if (!currentRuntime) return {
            isError: true,
            content: [{ type: "text", text: "The storefront page is not currently available to render the no-results state." }],
            structuredContent: { ok: false, code: "STOREFRONT_NOT_MOUNTED" },
          };
          const message = cleanText(input.reason, recovery.notice + " No suitable alternatives were found.", 240);
          const receipt = await currentRuntime.applyNoResults(recovery.query, message);
          return {
            content: [{ type: "text", text: "Applied an explicit no-results state for “" + recovery.query + "”." }],
            structuredContent: { schemaVersion: "adaptive-interfaces.storefront-apply-receipt/v2", ok: true, workflowStatus: "no_results_applied", ...receipt },
          };
        },
      },
      {
        name: "save_storefront_facet",
        description: "Add a user-requested reusable storefront facet. Use tag for one catalog concept, tag_groups for one categorical facet with two or more named choices made from multiple tags, or numeric for non-overlapping measurable bands. Each tag group supports any or all matching, and tags may overlap across groups. Active groups compose with price and other filters. Tag matches reflect Steam catalog metadata, not an age rating or suitability guarantee. This saves only a removable preference in this browser's local storage and does not change an account, retailer, catalog, order, or external service.",
        inputSchema: FACET_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          try {
            const currentRuntime = storefrontRuntime;
            if (!currentRuntime) throw new Error("The storefront page is not currently available.");
            const wantsTagFacet = input.kind === "tag" || input.kind === "tag_groups" || input.kind === undefined && (typeof input.tag === "string" || Array.isArray(input.groups));
            const requestedTags = wantsTagFacet
              ? input.kind === "tag" || input.kind === undefined && typeof input.tag === "string"
                ? [cleanText(input.tag, "", 80)].filter(Boolean)
                : (Array.isArray(input.groups) ? input.groups : []).flatMap((group) => isRecord(group) ? normalizedTags(group.tags) : [])
              : [];
            const availableTags = wantsTagFacet ? await resolveCatalogTags(requestedTags) : undefined;
            const facet = normalizeCustomFacet(input, wantsTagFacet ? availableTags : undefined);
            const next = [facet, ...currentRuntime.customFacets.current].slice(0, 8);
            currentRuntime.saveFacet(next);
            const message = facet.kind === "tag"
              ? "Added the local “" + facet.label + "” facet for games tagged “" + facet.tag + ".”"
              : facet.kind === "tag_groups"
                ? "Added the local “" + facet.label + "” facet with " + facet.groups.length + " overlapping tag groups."
                : "Added the local “" + facet.label + "” facet with " + facet.bands.length + " formula bands.";
            return { content: [{ type: "text", text: message }], structuredContent: { schemaVersion: "adaptive-interfaces.storefront-facet-receipt/v2", ok: true, saved: true, storage: "local", facet } };
          } catch (error) {
            return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The custom facet could not be saved." }], structuredContent: { ok: false } };
          }
        },
      },
      {
        name: "remove_storefront_facet",
        description: "Remove one saved custom facet from this browser's local demo preferences. This does not affect an account, retailer, catalog, order, or external service; the facet can be recreated with save_storefront_facet.",
        inputSchema: { type: "object", additionalProperties: false, properties: { facetId: { type: "string", minLength: 1, maxLength: 80 } }, required: ["facetId"] },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, untrustedContentHint: false },
        execute: (input: Record<string, unknown>) => {
          const facetId = cleanText(input.facetId, "", 80);
          const currentRuntime = storefrontRuntime;
          const existing = currentRuntime?.customFacets.current.find((facet) => facet.id === facetId);
          if (!existing) return { isError: true, content: [{ type: "text", text: "Saved facet not found." }] };
          currentRuntime?.removeFacet(facetId);
          return { content: [{ type: "text", text: "Removed the “" + existing.label + "” facet." }], structuredContent: { ok: true, removed: facetId } };
        },
      },
      {
        name: "clear_storefront_search",
        description: "Reset the current browser session's demo search, filters, ranking formula, and adaptive template while preserving custom facets and the simulated local library. This is a safe local UI reset with no external effect.",
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, untrustedContentHint: false },
        execute: () => {
          storefrontRuntime?.clearSearch();
          return { content: [{ type: "text", text: "Cleared the adaptive search and restored the conventional storefront and default headline." }], structuredContent: { ok: true, layout: "grid", headlineReset: true, customFacetsPreserved: true, libraryPreserved: true } };
        },
      },
    ];
    const registration = Promise.all(tools.map((tool) => context.registerTool(tool, { signal: controller.signal }))).then(() => undefined);
    storefrontRegistrations.set(context, registration);
    void registration
      .then(() => statusChangeRef.current("connected"))
      .catch(() => statusChangeRef.current("preview"));
    return () => { if (storefrontRuntime === runtime) storefrontRuntime = null; };
  }, [applyNoResults, applyRecommendation, clearSearch, removeFacet, saveFacet, setCurationProgress, showRecoveryState]);

  const addToLibrary = useCallback((id: number) => {
    if (library.has(id) || addingId !== null) return;
    setAddingId(id);
    const timer = window.setTimeout(() => { setLibrary((items) => { const next = new Set(items); next.add(id); libraryRef.current = next; return next; }); setAddingId(null); }, 760);
    timersRef.current.push(timer);
  }, [addingId, library]);

  const updateTextSearch = (value: string) => { setSearch(value); setAppliedRecommendation(null); setPage(0); if (!value) setPresentation(null); };
  const loading = appliedRecommendation ? false : resolvedKey !== requestKey;
  const games = useMemo(() => {
    const source = appliedRecommendation?.results ?? catalog?.games ?? [];
    const orderedIds = appliedRecommendation?.curation?.orderedAppIds ?? source.map((game) => game.id);
    const byId = new Map(source.map((game) => [game.id, game]));
    const ordered = orderedIds.flatMap((id) => {
      const game = byId.get(id);
      if (!game) return [];
      byId.delete(id);
      return [game];
    });
    return [...ordered, ...byId.values()];
  }, [appliedRecommendation, catalog]);
  const editorial = presentation?.editorial;
  const emptyState = presentation?.emptyState;
  const featuredById = useMemo(() => new Map((editorial?.featured ?? []).map((item) => [item.appId, item])), [editorial]);
  const featuredGames = useMemo(() => {
    const gamesById = new Map(games.map((game) => [game.id, game]));
    return (editorial?.featured ?? []).flatMap((item) => {
      const game = gamesById.get(item.appId);
      return game ? [{ game, editorial: item }] : [];
    });
  }, [editorial, games]);
  const algorithmicGames = useMemo(() => games.filter((game) => !featuredById.has(game.id)), [featuredById, games]);
  const visibleAppIds = useMemo(() => [...featuredGames.map((item) => item.game.id), ...algorithmicGames.map((game) => game.id)], [algorithmicGames, featuredGames]);
  const total = appliedRecommendation ? games.length : catalog?.query.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visiblePage = appliedRecommendation ? 0 : Math.min(page, totalPages - 1);
  const activeMode = presentation?.mode ?? "grid";
  const highlights = presentation?.highlights ?? [];
  const resultStart = total ? visiblePage * PAGE_SIZE + 1 : 0;
  const resultEnd = Math.min((visiblePage + 1) * PAGE_SIZE, total);
  const activeFilterCount = [search, priceBand !== "All prices", genre, tag, minPositiveRatio !== undefined, minReviewCount !== undefined, ...Object.values(selectedCustomBands)].filter(Boolean).length;

  useEffect(() => {
    const waiter = renderWaiterRef.current;
    if (!waiter || waiter.recommendationId !== appliedRecommendation?.id) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (renderWaiterRef.current !== waiter) return;
        renderWaiterRef.current = null;
        if (curationCleanupTimerRef.current) window.clearTimeout(curationCleanupTimerRef.current);
        curationCleanupTimerRef.current = null;
        setCurationProgressState((current) => current ? { ...current, phase: "complete" } : null);
        timersRef.current.push(window.setTimeout(() => setCurationProgressState((current) => current?.phase === "complete" ? null : current), 280));
        waiter.resolve({
          rendered: true,
          featuredAppIds: featuredGames.map((item) => item.game.id),
          visibleAppIds,
          summaryVisible: Boolean(editorial?.summary),
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [appliedRecommendation?.id, editorial?.summary, featuredGames, renderRequestVersion, visibleAppIds]);

  return <><DemoSwitcher active="store" /><main className="storefront-shell">
    <section className="storefront" aria-label="Steam storefront">
      {!presentation ? <form className="storefront-search" role="search" onSubmit={(event) => event.preventDefault()}>
        <section className="storefront-browser-hero" aria-labelledby="storefront-browser-title"><div className="storefront-browser-copy"><h2 id="storefront-browser-title" aria-live="polite"><span key={browserHeadline}>{browserHeadline}</span></h2></div><div className="storefront-prompt-starters" aria-label="Prompt ideas">{STORE_PROMPTS.map((item) => <button type="button" key={item.prompt} onClick={() => copyStorePrompt(item.prompt)}><span>{item.label}</span><b>“{item.prompt}”</b><small aria-live="polite">{copiedStorePrompt === item.prompt ? "Copied ✓" : "Copy to ask ↗"}</small></button>)}</div></section>
        <div className="storefront-manual-search"><label><span aria-hidden="true">⌕</span><span className="sr-only">Search the store</span><input value={search} onChange={(event) => updateTextSearch(event.target.value)} placeholder="Search games, studios, genres, or tags" /></label><select aria-label="Sort games" value={sort} onChange={(event) => { setSort(event.target.value as SortKey); setDirection(event.target.value === "title" ? "asc" : "desc"); setPage(0); }}><option value="ownersMax">Most popular</option><option value="positiveRatio">Best reviewed</option><option value="reviewCount">Most reviewed</option><option value="ccu">Most active</option><option value="releaseYear">Newest</option><option value="priceCents">Price</option><option value="title">Title</option></select><button type="button" className="storefront-clear" onClick={clearSearch} disabled={!activeFilterCount && !presentation}>Clear</button></div>
      </form> : null}

      {presentation ? <section className={"result-briefing mode-" + presentation.mode} aria-labelledby="result-briefing-title">
        <div><h2 id="result-briefing-title">{presentation.title}</h2><p>{presentation.explanation}</p></div>
        <div className="briefing-recipe"><b>{presentation.mode}</b>{presentation.ranking.length ? <span>{presentation.ranking.map((factor) => Math.round(factor.weight * 100) + "% " + (factor.label || fieldLabel(factor.field))).join(" · ")}</span> : <span>{highlights.length ? highlights.map((field) => field === "publisher" ? "publisher" : fieldLabel(field as StorefrontRankingField)).join(" · ") : "Visual discovery"}</span>}{presentation.excludeOwned && ownedExclusions.length ? <span>{ownedExclusions.length} owned games excluded</span> : null}<button type="button" onClick={clearSearch}><span aria-hidden="true">×</span> Clear personalized search</button></div>
      </section> : null}

      <div className={"storefront-body" + (editorial ? " is-curated" : "")}>
        {!editorial ? <aside className="storefront-facets" aria-label="Store filters">
          <div className="facet-heading"><div><span>Refine</span><b>{activeFilterCount || "All"} filters</b></div>{activeFilterCount ? <button type="button" onClick={clearSearch}>Reset</button> : null}</div>
          <details className="facet-add"><summary><span className="facet-add-copy"><b>Add a facet</b></span><span className="facet-add-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M10.5 2.75c.45 4.25 2.5 6.3 6.75 6.75-4.25.45-6.3 2.5-6.75 6.75-.45-4.25-2.5-6.3-6.75-6.75 4.25-.45 6.3-2.5 6.75-6.75Z" /><path d="M18.5 14.75c.2 1.9 1.1 2.8 3 3-1.9.2-2.8 1.1-3 3-.2-1.9-1.1-2.8-3-3 1.9-.2 2.8-1.1 3-3Z" /></svg></span></summary><section className="facet-prompt-menu" role="dialog" aria-modal="false" aria-labelledby="facet-prompt-title"><header><span>Browser shortcut</span><h2 id="facet-prompt-title">You can say</h2><p>Your browser will configure and save the facet here.</p></header><div>{FACET_PROMPTS.map((item) => <button type="button" key={item.prompt} onClick={() => copyFacetPrompt(item.prompt)}><span>{item.label}</span><b>“{item.prompt}”</b><small>{copiedFacetPrompt === item.prompt ? "Copied ✓" : "Copy prompt ↗"}</small></button>)}</div></section></details>
          <fieldset><legend>Price</legend><select value={priceBand} onChange={(event) => { setPriceBand(event.target.value as (typeof PRICE_BANDS)[number]); setPage(0); }}>{PRICE_BANDS.map((band) => <option key={band}>{band}</option>)}</select></fieldset>
          <fieldset><legend>Genre</legend><select value={genre} onChange={(event) => { setGenre(event.target.value); setPage(0); }}><option value="">All genres</option>{(catalog?.facets.genres ?? []).slice(0, 28).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}</select></fieldset>
          <fieldset><legend>Popular tags</legend><div className="facet-chips">{(catalog?.facets.tags ?? []).slice(0, 9).map((item) => <button type="button" className={tag === item.label ? "active" : ""} key={item.label} onClick={() => { setTag((value) => value === item.label ? "" : item.label); setPage(0); }}>{item.label}</button>)}</div></fieldset>
          {customFacets.map((facet) => <fieldset className="custom-facet" key={facet.id}>
            <legend><span>{facet.label}</span><button type="button" aria-label={"Remove " + facet.label + " facet"} onClick={() => removeFacet(facet.id)}>×</button></legend>
            <div className="facet-options">
              <button type="button" className={!selectedCustomBands[facet.id] ? "active" : ""} onClick={() => { setSelectedCustomBands((selected) => { const copy = { ...selected }; delete copy[facet.id]; return copy; }); setPage(0); }}>Any</button>
              {facet.kind === "numeric" ? facet.bands.map((band) => <button type="button" className={selectedCustomBands[facet.id] === band.id ? "active" : ""} key={band.id} onClick={() => { setSelectedCustomBands((selected) => ({ ...selected, [facet.id]: band.id })); setPage(0); }}>{band.label}</button>)
                : facet.kind === "tag" ? <button type="button" className={selectedCustomBands[facet.id] === facet.tag ? "active" : ""} onClick={() => { setSelectedCustomBands((selected) => ({ ...selected, [facet.id]: facet.tag })); setPage(0); }}>{facet.tag}</button>
                  : facet.groups.map((group) => <button type="button" className={selectedCustomBands[facet.id] === group.id ? "active" : ""} key={group.id} title={(group.match === "all" ? "All of: " : "Any of: ") + group.tags.join(", ")} onClick={() => { setSelectedCustomBands((selected) => ({ ...selected, [facet.id]: group.id })); setPage(0); }}><b>{group.label}</b><small>{group.match === "all" ? "All of " : "Any of "}{group.tags.length} tags</small></button>)}
            </div>
            <small>{facet.kind === "numeric" ? fieldLabel(facet.field) : facet.kind === "tag" ? "Catalog tag" : "Named tag groups · overlap allowed"} · saved in this browser</small>
          </fieldset>)}
        </aside> : null}

        <section className="storefront-results" aria-busy={loading || Boolean(curationProgress)} aria-live="polite">
          <div className="storefront-results-bar"><div><strong>{loading ? "Updating…" : total.toLocaleString() + " games"}</strong><span>{presentation ? activeMode + " view selected for this search" : "Conventional store results"}</span></div><div><span>{library.size} in library</span><b>{activeMode}</b></div></div>
          {curationProgress ? <CurationProgressPanel progress={curationProgress} /> : null}
          {loading ? <StorefrontResultsSkeleton mode={activeMode} /> : catalogError && !appliedRecommendation ? <div className="storefront-empty"><strong>Store catalog unavailable</strong><p>{catalogError}</p></div> : !games.length ? <div className="storefront-empty"><strong>{emptyState?.title ?? "No games match this search"}</strong><p>{emptyState?.message ?? "Clear a filter or try broader terms."}</p>{emptyState?.allowClear !== false ? <button type="button" onClick={clearSearch}>Clear search</button> : null}</div> : <>
            {featuredGames.length ? <section className={"store-featured" + (featuredGames.length === 1 ? " is-single" : "")} aria-labelledby="store-featured-title">
              <div className="store-featured-heading"><span>{featuredGames.length === 1 ? "Curated standout" : "Curated shortlist"}</span><h3 id="store-featured-title">{featuredGames.length === 1 ? "Our best match for you" : "Top picks for you"}</h3></div>
              <div className="store-featured-grid">{featuredGames.map(({ game, editorial: item }) => <FeaturedGameCard key={game.id} game={game} editorial={item} tagGroupSelections={activeTagGroupSelections} isBestMatch={featuredGames.length === 1} inLibrary={library.has(game.id)} adding={addingId === game.id} onAdd={addToLibrary} />)}</div>
            </section> : null}
            {algorithmicGames.length ? activeMode === "table" ? <GameTable games={algorithmicGames} tagGroupSelections={activeTagGroupSelections} library={library} addingId={addingId} onAdd={addToLibrary} /> : activeMode === "ranking" ? <div className="store-ranking">{algorithmicGames.map((game, index) => <RankingItem key={game.id} game={game} rank={featuredGames.length + visiblePage * PAGE_SIZE + index + 1} highlights={highlights} tagGroupSelections={activeTagGroupSelections} inLibrary={library.has(game.id)} adding={addingId === game.id} onAdd={addToLibrary} />)}</div> : activeMode === "list" ? <div className="store-list">{algorithmicGames.map((game) => <GameListItem key={game.id} game={game} highlights={highlights} tagGroupSelections={activeTagGroupSelections} inLibrary={library.has(game.id)} adding={addingId === game.id} onAdd={addToLibrary} />)}</div> : <div className="store-grid">{algorithmicGames.map((game) => <GameCard key={game.id} game={game} highlights={highlights} tagGroupSelections={activeTagGroupSelections} inLibrary={library.has(game.id)} adding={addingId === game.id} onAdd={addToLibrary} />)}</div> : null}
          </>}
          <footer className="store-pagination"><span>{loading ? "Updating results…" : "Showing " + resultStart.toLocaleString() + "–" + resultEnd.toLocaleString() + " of " + total.toLocaleString()}</span><div><button type="button" disabled={loading || visiblePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>←</button><span>Page {visiblePage + 1} / {totalPages}</span><button type="button" disabled={loading || visiblePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>→</button></div></footer>
        </section>
      </div>
    </section>
    <footer className="valve-attribution"><span>Independent demo. Not affiliated with or endorsed by Valve.</span><span>©2026 Valve Corporation. Steam and the Steam logo are trademarks and/or registered trademarks of Valve Corporation in the U.S. and/or other countries.</span><a href="https://partner.steamgames.com/doc/marketing/branding" target="_blank" rel="noreferrer">Steam brand guidelines ↗</a></footer>
  </main></>;
}
