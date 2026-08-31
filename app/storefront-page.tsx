"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DemoSwitcher, { type WebMcpStatus } from "./demo-switcher";
import { loadCatalogPage, type CatalogGame, type CatalogPage, type StorefrontNumericField, type StorefrontNumericFilter, type StorefrontRankingFactor, type StorefrontRankingField } from "./catalog-data";
import "./storefront.css";

const PAGE_SIZE = 12;
const SEARCH_SESSION_KEY = "steam-desk.storefront-search/v1";
const CUSTOM_FACETS_KEY = "steam-desk.storefront-facets/v1";
const LIBRARY_KEY = "steam-desk.storefront-library/v1";
const PRICE_BANDS = ["All prices", "Free", "Under $10", "$10–$29.99", "$30–$59.99", "$60+"] as const;
const SORTS = ["ownersMax", "title", "priceCents", "positiveRatio", "reviewCount", "ccu", "releaseYear"] as const;
const LAYOUTS = ["grid", "list", "table", "ranking"] as const;
const NUMERIC_FIELDS: StorefrontNumericField[] = ["positiveRatio", "reviewCount", "priceCents", "ownersMax", "ccu", "averageForever", "releaseYear"];
const INTENT_FIELDS = ["intentFit", "tagCoverage"] as const;
const RANKING_FIELDS: StorefrontRankingField[] = [...INTENT_FIELDS, ...NUMERIC_FIELDS];
const HIGHLIGHT_FIELDS = ["intentFit", "tagCoverage", "positiveRatio", "reviewCount", "ownersMax", "ccu", "releaseYear", "averageForever", "publisher"] as const;
const SKELETON_ITEMS = Array.from({ length: PAGE_SIZE }, (_, index) => index);
const FACET_PROMPTS = [
  { label: "Activity", prompt: "Add a facet for active players with useful bands." },
  { label: "Playtime", prompt: "Add a facet for average playtime with short, medium, and long bands." },
  { label: "Release", prompt: "Add a facet for release year that separates new, recent, and classic games." },
] as const;
const STORE_PROMPTS = [
  { label: "Set a vibe", prompt: "Find me a cozy game I can finish in a weekend." },
  { label: "Play together", prompt: "Show me a great co-op game under $20." },
  { label: "Pick one", prompt: "Suggest my next great game" },
] as const;

type LayoutMode = typeof LAYOUTS[number];
type SortKey = typeof SORTS[number];
type HighlightField = typeof HIGHLIGHT_FIELDS[number];
type FacetBand = { id: string; label: string; min?: number; max?: number };
type CustomFacet = { id: string; label: string; field: StorefrontNumericField; bands: FacetBand[] };
type FeaturedEditorial = { appId: number; badge: string; reason: string };
type EditorialCuration = { headline: string; summary: string; featured: FeaturedEditorial[]; orderedAppIds: number[] };
type SearchPresentation = { title: string; explanation: string; mode: LayoutMode; highlights: HighlightField[]; ranking: StorefrontRankingFactor[]; excludeOwned: boolean; editorial?: EditorialCuration };
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
  applyRecommendation: (recommendation: PendingRecommendation) => Promise<ApplyReceipt>;
  saveFacet: (facets: CustomFacet[]) => void;
  removeFacet: (facetId: string) => void;
  clearSearch: () => void;
};
type StorefrontPageProps = { webMcpStatus: WebMcpStatus; onWebMcpStatusChange: (status: WebMcpStatus) => void };

let storefrontRuntime: StorefrontRuntime | null = null;
let privateTasteProfileState: PrivateTasteProfile | null = null;
const storefrontRecommendations = new Map<string, PendingRecommendation>();
const storefrontRegistrations = new WeakMap<WebMCPContext, Promise<void>>();

const RECOMMEND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string", maxLength: 120, description: "Concise catalog search terms." },
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
  required: ["query"],
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

const FACET_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    label: { type: "string", minLength: 1, maxLength: 40 },
    field: { type: "string", enum: NUMERIC_FIELDS },
    bands: {
      type: "array", minItems: 2, maxItems: 8,
      items: {
        type: "object", additionalProperties: false,
        properties: { label: { type: "string", minLength: 1, maxLength: 40 }, min: { type: "number" }, max: { type: "number" } },
        required: ["label"],
      },
    },
  },
  required: ["label", "field", "bands"],
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

type GameViewProps = { game: CatalogGame; highlights: HighlightField[]; inLibrary: boolean; adding: boolean; onAdd: (id: number) => void };

function FeaturedGameCard({ game, editorial, inLibrary, adding, onAdd, isBestMatch = false }: Omit<GameViewProps, "highlights"> & { editorial: FeaturedEditorial; isBestMatch?: boolean }) {
  return <article className={"store-featured-card" + (isBestMatch ? " is-best-match" : "") + (inLibrary ? " is-owned" : "")}>
    <GameArtwork game={game} />
    <div className="store-featured-copy">
      <div className="store-featured-badges">
        {isBestMatch ? <span className="store-best-signal"><i aria-hidden="true">✦</i> Best match</span> : null}
        <span className="store-featured-badge">{editorial.badge}</span>
      </div>
      <div className="store-featured-title"><span>{game.genres.slice(0, 2).join(" · ") || "Game"}</span><h3>{game.title}</h3><p>{game.developer}</p></div>
      <p className="store-featured-reason"><b>Why it fits</b>{editorial.reason}</p>
      <div className="store-featured-action"><strong>{formatPrice(game.priceCents)}</strong><BuyButton game={game} inLibrary={inLibrary} adding={adding} onAdd={onAdd} /></div>
    </div>
  </article>;
}

function GameCard({ game, highlights, inLibrary, adding, onAdd }: GameViewProps) {
  const visible = highlights.length ? highlights : ["positiveRatio", "ccu"] as HighlightField[];
  return <article className={"store-card" + (inLibrary ? " is-owned" : "")}>
    <GameArtwork game={game} />
    <div className="store-card-body">
      <div className="store-card-kicker"><span>{game.genres[0] ?? "Game"}</span><b>{formatPrice(game.priceCents)}</b></div>
      <h3>{game.title}</h3><p>{game.developer}</p>
      <div className="store-card-tags">{visible.slice(0, 3).map((field) => <span key={field}>{metricValue(game, field)}</span>)}</div>
      <BuyButton game={game} inLibrary={inLibrary} adding={adding} onAdd={onAdd} />
    </div>
  </article>;
}

function GameListItem({ game, highlights, inLibrary, adding, onAdd }: GameViewProps) {
  const visible = highlights.length ? highlights : ["positiveRatio", "ownersMax"] as HighlightField[];
  return <article className={"store-list-item" + (inLibrary ? " is-owned" : "")}>
    <GameArtwork game={game} compact />
    <div className="store-list-copy"><span>{game.genres.slice(0, 2).join(" · ") || "Game"}</span><h3>{game.title}</h3><p>{game.developer}</p></div>
    <div className="store-list-metrics">{visible.slice(0, 3).map((field) => <span key={field}>{metricValue(game, field)}</span>)}</div>
    <div className="store-list-action"><strong>{formatPrice(game.priceCents)}</strong><BuyButton game={game} inLibrary={inLibrary} adding={adding} onAdd={onAdd} /></div>
  </article>;
}

function RankingItem({ game, rank, highlights, inLibrary, adding, onAdd }: GameViewProps & { rank: number }) {
  const visible = highlights.length ? highlights : ["positiveRatio", "reviewCount", "ccu"] as HighlightField[];
  const score = Math.max(0, Math.min(100, Math.round(Number(game.rankScore ?? 0) * 100)));
  return <article className={"store-rank-item" + (inLibrary ? " is-owned" : "")}>
    <div className="store-rank-number">{String(rank).padStart(2, "0")}</div><GameArtwork game={game} compact />
    <div className="store-rank-copy"><span>{game.genres.slice(0, 2).join(" · ") || "Game"}</span><h3>{game.title}</h3><p>{game.developer}</p></div>
    <div className="store-rank-evidence">{visible.slice(0, 3).map((field) => <span key={field}><b>{metricValue(game, field)}</b><small>{field === "publisher" ? "publisher" : fieldLabel(field as StorefrontRankingField)}</small></span>)}</div>
    <div className="store-rank-score"><span><i style={{ width: score + "%" }} /></span><b>{score}</b><small>fit score</small></div>
    <div className="store-rank-action"><strong>{formatPrice(game.priceCents)}</strong><BuyButton game={game} inLibrary={inLibrary} adding={adding} onAdd={onAdd} /></div>
  </article>;
}

function GameTable({ games, library, addingId, onAdd }: { games: CatalogGame[]; library: Set<number>; addingId: number | null; onAdd: (id: number) => void }) {
  return <div className="store-table-wrap"><table className="store-table"><thead><tr><th>Game</th><th>Reviews</th><th>Owners</th><th>Peak players</th><th>Price</th><th /></tr></thead><tbody>{games.map((game) => <tr key={game.id}>
    <td><div className="store-table-game"><GameArtwork game={game} compact /><span><strong>{game.title}</strong><small>{game.developer}</small></span></div></td>
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

function normalizeCustomFacet(input: Record<string, unknown>): CustomFacet {
  const label = cleanText(input.label, "", 40);
  const field = String(input.field ?? "") as StorefrontNumericField;
  if (!label || !NUMERIC_FIELDS.includes(field)) throw new Error("The facet needs a valid label and numeric catalog field.");
  const rawBands = Array.isArray(input.bands) ? input.bands : [];
  const bands = rawBands.flatMap((value, index): FacetBand[] => {
    if (!isRecord(value)) return [];
    const bandLabel = cleanText(value.label, "", 40);
    const min = typeof value.min === "number" && Number.isFinite(value.min) ? value.min : undefined;
    const max = typeof value.max === "number" && Number.isFinite(value.max) ? value.max : undefined;
    if (!bandLabel || min === undefined && max === undefined || min !== undefined && max !== undefined && min >= max) return [];
    return [{ id: slug(bandLabel) + "-" + index, label: bandLabel, min, max }];
  });
  if (bands.length < 2) throw new Error("A custom facet needs at least two valid, bounded bands.");
  const sorted = [...bands].sort((left, right) => (left.min ?? Number.NEGATIVE_INFINITY) - (right.min ?? Number.NEGATIVE_INFINITY));
  for (let index = 1; index < sorted.length; index++) {
    if ((sorted[index - 1].max ?? Number.POSITIVE_INFINITY) > (sorted[index].min ?? Number.NEGATIVE_INFINITY)) throw new Error("Custom facet bands cannot overlap.");
  }
  return { id: slug(label) + "-" + Date.now().toString(36), label, field, bands: sorted };
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
  const renderWaiterRef = useRef<{ recommendationId: string; resolve: (receipt: ApplyReceipt) => void } | null>(null);

  useEffect(() => { catalogRef.current = catalog; }, [catalog]);
  useEffect(() => { statusChangeRef.current = onWebMcpStatusChange; }, [onWebMcpStatusChange]);

  const numericFilters = useMemo<StorefrontNumericFilter[]>(() => customFacets.flatMap((facet) => {
    const selected = facet.bands.find((band) => band.id === selectedCustomBands[facet.id]);
    return selected ? [{ field: facet.field, min: selected.min, max: selected.max }] : [];
  }), [customFacets, selectedCustomBands]);
  const ranking = presentation?.ranking ?? [];
  const ownedExclusions = useMemo(() => presentation?.excludeOwned ? [...library].slice(0, 200) : [], [library, presentation?.excludeOwned]);
  const requestKey = JSON.stringify([search, priceBand, genre, tag, minPositiveRatio, minReviewCount, sort, direction, page, numericFilters, ranking, ownedExclusions]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const facets = JSON.parse(window.localStorage.getItem(CUSTOM_FACETS_KEY) ?? "[]") as unknown;
        if (Array.isArray(facets)) {
          const valid = facets.filter((item): item is CustomFacet => isRecord(item) && typeof item.id === "string" && typeof item.label === "string" && NUMERIC_FIELDS.includes(item.field as StorefrontNumericField) && Array.isArray(item.bands)).slice(0, 8);
          customFacetsRef.current = valid; setCustomFacets(valid);
        }
        const owned = JSON.parse(window.localStorage.getItem(LIBRARY_KEY) ?? "[]") as unknown;
        if (Array.isArray(owned)) {
          const nextLibrary = new Set(owned.filter((id): id is number => Number.isInteger(id) && id > 0).slice(0, 2000));
          libraryRef.current = nextLibrary;
          setLibrary(nextLibrary);
        }
        const session = JSON.parse(window.sessionStorage.getItem(SEARCH_SESSION_KEY) ?? "null") as unknown;
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
    try { window.localStorage.setItem(CUSTOM_FACETS_KEY, JSON.stringify(customFacets)); } catch { /* Session fallback. */ }
    customFacetsRef.current = customFacets;
  }, [customFacets]);

  useEffect(() => {
    if (!storageLoadedRef.current) return;
    libraryRef.current = library;
    try { window.localStorage.setItem(LIBRARY_KEY, JSON.stringify([...library])); } catch { /* Session fallback. */ }
  }, [library]);

  useEffect(() => {
    if (!storageLoadedRef.current) return;
    try {
      if (!presentation) window.sessionStorage.removeItem(SEARCH_SESSION_KEY);
      else window.sessionStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify({ presentation, search, priceBand, genre, tag, minPositiveRatio, minReviewCount, sort, direction }));
    } catch { /* In-memory state remains usable. */ }
  }, [presentation, search, priceBand, genre, tag, minPositiveRatio, minReviewCount, sort, direction]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      loadCatalogPage({ search, ownerBand: "All owner ranges", priceBand, sort, direction, page, pageSize: PAGE_SIZE, genre, tag, minPositiveRatio, minReviewCount, numericFilters, ranking, excludeAppIds: ownedExclusions }, controller.signal)
        .then((value) => { if (!controller.signal.aborted) { setCatalog(value); setCatalogError(""); setResolvedKey(requestKey); } })
        .catch((error: unknown) => { if (!controller.signal.aborted) { setCatalogError(error instanceof Error ? error.message : "Store catalog unavailable."); setResolvedKey(requestKey); } });
    }, search ? 160 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  // requestKey is the serialized query identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  useEffect(() => () => timersRef.current.forEach((timer) => window.clearTimeout(timer)), []);

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
    setSort("ownersMax"); setDirection("desc"); setPage(0); setPresentation(null); setAppliedRecommendation(null); setSelectedCustomBands({});
    storefrontRecommendations.clear();
    try { window.sessionStorage.removeItem(SEARCH_SESSION_KEY); } catch { /* State is reset in memory. */ }
  }, []);

  const applyRecommendation = useCallback((pending: PendingRecommendation) => new Promise<ApplyReceipt>((resolve) => {
    const editorial = pending.curation;
    pending.presentation = {
      ...pending.presentation,
      title: editorial?.headline ?? "Recommendations shaped around your request",
      explanation: editorial?.summary ?? "Public catalog results ranked for the stated intent without reading personal taste data.",
      editorial,
    };
    renderWaiterRef.current = { recommendationId: pending.id, resolve };
    setSearch(pending.search); setPriceBand(pending.priceBand); setGenre(pending.genre); setTag(pending.tag);
    setMinPositiveRatio(pending.minPositiveRatio); setMinReviewCount(pending.minReviewCount);
    setSort(pending.sort); setDirection(pending.direction); setPresentation(pending.presentation); setAppliedRecommendation(pending); setPage(0);
    setRenderRequestVersion((version) => version + 1);
  }), []);

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
      applyRecommendation,
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
              schemaVersion: "steam-desk.storefront/v2",
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
                writes: "recommend_storefront is read-only. curate_storefront_results stages editorial metadata. apply_storefront_results changes session UI only. Facets are removable local preferences.",
                externalEffects: "Tools do not message another party or change any external service, retailer, account, or catalog record.",
              },
              guidance: [
                "For a self-directed request, when personalizationAvailable is true, ask once whether the user wants library-based personalization before recommending.",
                "If the user declines, requests an immediate answer, or personalizationAvailable is false, continue immediately with personalization none.",
                "Never offer library personalization for recipientContext someone_else or shared_group. Keep personalization none for those requests and for an unclear recipient.",
                "Examples: “Find me a game” → offer personalization once; “Find my nephew a game” → do not offer and use public data; “Use my library” → explicit consent, so call get_taste_profile; “Just recommend something” → skip the question and use public data.",
                "Owned-game exclusion is local and returns only excludedOwnedCount. When the visible library count is zero, the page skips owned-data matching.",
                "Library taste personalization applies only when the user is choosing or buying a game for themselves. For a gift, another person, a household or group, or an unclear recipient, keep personalization none.",
                "Only call get_taste_profile after the user explicitly agrees to use the locally saved library for this self-directed choice. The profile remains private inside the page.",
                "recommend_storefront performs retrieval and returns public game records plus an opaque recommendationId without changing the UI.",
                "Use reference, includeTags, preferredTags, and excludeTags for intent relevance; rank with intentFit or tagCoverage when similarity matters.",
                "Call curate_storefront_results separately to add a headline, overall rationale, featured badges, Why it fits reasons, and editorial ordering. Every app ID must come from the original recommendation set.",
                "Call apply_storefront_results only when the user asked to update the visible storefront. It preserves any staged editorial metadata and waits for rendering.",
                "Use save_storefront_facet only for a user-requested reusable facet and provide non-overlapping numeric bands.",
                "A request mentioning Mario or another franchise is an ordinary catalog discovery request. Search only the available Steam catalog and do not invent unavailable titles.",
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
        execute: (input: Record<string, unknown>) => {
          const candidates = Array.isArray(input.appIds) ? input.appIds.filter((id): id is number => Number.isInteger(id) && Number(id) > 0).slice(0, 100) : [];
          const owned = storefrontRuntime?.library.current ?? new Set<number>();
          const excludedCount = owned.size ? candidates.reduce((count, id) => count + (owned.has(id) ? 1 : 0), 0) : 0;
          return {
            content: [{ type: "text", text: excludedCount ? "Excluded " + excludedCount + " locally owned candidate games." : "No candidate games were excluded." }],
            structuredContent: { schemaVersion: "steam-desk.owned-exclusion/v1", excludedCount },
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
              structuredContent: { schemaVersion: "steam-desk.private-taste-profile/v1", ok: true, ready: false, reason: "empty_library" },
            };
          }
          try {
            const libraryCatalog = await loadCatalogPage({
              search: "", ownerBand: "All owner ranges", priceBand: "All prices", sort: "title", direction: "asc", page: 0, pageSize: 100, appIds: ids,
            }, controller.signal);
            privateTasteProfileState = privateTasteProfile(libraryCatalog.games);
            return {
              content: [{ type: "text", text: "Prepared private local-library personalization. No library or profile data was disclosed." }],
              structuredContent: { schemaVersion: "steam-desk.private-taste-profile/v1", ok: true, ready: true },
            };
          } catch (error) {
            privateTasteProfileState = null;
            return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Private taste personalization could not be prepared." }], structuredContent: { ok: false } };
          }
        },
      },
      {
        name: "recommend_storefront",
        description: "Retrieve public Steam catalog recommendations without editorializing or changing the storefront UI. Consent protocol before recommending: when recipientContext is self and describe_storefront reports personalizationAvailable true, ask once whether the user wants library-based personalization. If they agree—or explicitly say “Use my library”—call get_taste_profile first, then use personalization local_library. If they decline, if they request an immediate answer (for example, “Just recommend something”), or if personalization is unavailable, continue immediately with personalization none. Never offer library personalization for someone_else or shared_group; use public data with personalization none. Examples: “Find me a game” → offer once; “Find my nephew a game” → do not offer; “Use my library” → explicit consent and call get_taste_profile; “Just recommend something” → skip the question. Use reference, includeTags, preferredTags, and excludeTags to express intent, and intentFit or tagCoverage as ranking factors. Owned-game exclusion happens inside the page and returns only excludedOwnedCount; no owned titles, IDs, playtime, preferences, or taste data are disclosed.",
        inputSchema: RECOMMEND_SCHEMA,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false, untrustedContentHint: false },
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
          try {
            const rawPresentation = isRecord(input.presentation) ? input.presentation : {};
            const mode = LAYOUTS.includes(rawPresentation.mode as LayoutMode) ? rawPresentation.mode as LayoutMode : "ranking";
            const highlights = Array.isArray(rawPresentation.highlightFields) ? rawPresentation.highlightFields.filter((field): field is HighlightField => HIGHLIGHT_FIELDS.includes(field as HighlightField)).slice(0, 5) : [];
            const reference = cleanText(input.reference, "", 120);
            const includeTags = normalizedTags(input.includeTags);
            const preferredTags = [...normalizedTags(input.preferredTags), ...(profile?.tags ?? [])]
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
            const query = cleanText(input.query, "", 120);
            const genre = cleanText(input.genre, profile?.genres[0] ?? "", 80);
            const tag = cleanText(input.tag, profile?.tags[0] ?? "", 80);
            const price = PRICE_BANDS.includes(input.priceBand as (typeof PRICE_BANDS)[number]) ? input.priceBand as (typeof PRICE_BANDS)[number] : "All prices";
            const minRatio = typeof input.minPositiveRatio === "number" ? Math.min(1, Math.max(0, input.minPositiveRatio)) : undefined;
            const minReviews = typeof input.minReviewCount === "number" ? Math.max(0, Math.round(input.minReviewCount)) : undefined;
            const sortKey = SORTS.includes(input.sort as SortKey) ? input.sort as SortKey : nextRanking.length ? "positiveRatio" : "ownersMax";
            const sortDirection = input.direction === "asc" ? "asc" : "desc";
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
            const [result, inclusive] = await Promise.all([recommendationRequest, inclusiveCountRequest]);
            const excludedOwnedCount = inclusive ? Math.max(0, inclusive.query.total - result.query.total) : 0;
            const nextPresentation: SearchPresentation = {
              title: "Recommendations shaped around your request",
              explanation: personalization === "local_library" ? "Public catalog results ranked with a private profile computed inside this page." : "Public catalog results ranked for the stated intent without reading personal taste data.",
              mode, highlights, ranking: nextRanking, excludeOwned,
            };
            const recommendationId = "store-rec-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
            const recommendation: PendingRecommendation = {
              id: recommendationId, search: query, priceBand: price, genre, tag, minPositiveRatio: minRatio, minReviewCount: minReviews,
              sort: sortKey, direction: sortDirection, presentation: nextPresentation, results: result.games, resultTotal: result.query.total,
            };
            storefrontRecommendations.set(recommendationId, recommendation);
            return {
              content: [{ type: "text", text: "Found " + result.games.length + " public game recommendations without changing the storefront." }],
              structuredContent: {
                schemaVersion: "steam-desk.storefront-recommendations/v1",
                ok: true,
                recommendationId,
                personalization,
                recipientContext,
                intent: { reference, includeTags, preferredTags, excludeTags },
                results: result.games.map(publicGame),
                excludedOwnedCount,
              },
            };
          } catch (error) {
            return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Storefront recommendations could not be created." }], structuredContent: { ok: false } };
          }
        },
      },
      {
        name: "curate_storefront_results",
        description: "Stage editorial curation for one recommendation set. The visible storefront must match the assistant’s stated recommendation. If the assistant names one decisive winner—for example, “Play X next,” “X is my pick,” or “X is the best choice”—include exactly that game in featured and place it first in orderedAppIds. Keep other games as unfeatured alternatives. Use multiple featured games only when the assistant explicitly presents a shortlist, several equal options, or category winners. Do not turn supporting alternatives into co-equal featured recommendations when a single winner was stated. Give every featured game a badge and a Why it fits reason that reflects its role. This tool does not retrieve new games or change the visible UI, and every app ID is validated against the original recommendation set.",
        inputSchema: CURATE_RECOMMENDATION_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, untrustedContentHint: false },
        execute: (input: Record<string, unknown>) => {
          const recommendationId = cleanText(input.recommendationId, "", 80);
          const recommendation = storefrontRecommendations.get(recommendationId);
          if (!recommendation) return {
            isError: true,
            content: [{ type: "text", text: "That recommendation is unavailable or stale. Call recommend_storefront again." }],
            structuredContent: { ok: false, code: "RECOMMENDATION_NOT_FOUND" },
          };
          try {
            const curation = normalizeCuration(input, recommendation);
            recommendation.curation = curation;
            return {
              content: [{ type: "text", text: "Curated “" + curation.headline + "” using only games from the original recommendation set." }],
              structuredContent: {
                schemaVersion: "steam-desk.storefront-curation/v1",
                ok: true,
                recommendationId,
                headline: curation.headline,
                featuredAppIds: curation.featured.map((item) => item.appId),
                orderedAppIds: curation.orderedAppIds,
              },
            };
          } catch (error) {
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
        description: "Apply one staged recommendation to the visible storefront session, preserving its editorial summary, featured badges, Why it fits reasons, and ordering. Featured games render before the algorithmic list. The tool waits for the UI render to commit before returning. This cannot purchase, install, access an account, or write to an external service.",
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
            structuredContent: { schemaVersion: "steam-desk.storefront-apply-receipt/v2", ok: true, recommendationId, persistence: "session until search is cleared", ...receipt },
          };
        },
      },
      {
        name: "save_storefront_facet",
        description: "Create a user-requested reusable numeric facet with non-overlapping formula bands. This changes only the local demo UI and saves a removable preference in this browser's local storage; it does not change an account, retailer, catalog, order, or external service.",
        inputSchema: FACET_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, untrustedContentHint: false },
        execute: (input: Record<string, unknown>) => {
          try {
            const facet = normalizeCustomFacet(input);
            const currentRuntime = storefrontRuntime;
            if (!currentRuntime) throw new Error("The storefront page is not currently available.");
            const next = [facet, ...currentRuntime.customFacets.current].slice(0, 8);
            currentRuntime.saveFacet(next);
            return { content: [{ type: "text", text: "Added the local “" + facet.label + "” facet with " + facet.bands.length + " formula bands." }], structuredContent: { schemaVersion: "steam-desk.storefront-facet-receipt/v1", ok: true, saved: true, storage: "local", facet } };
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
          return { content: [{ type: "text", text: "Cleared the adaptive search and restored the conventional storefront." }], structuredContent: { ok: true, layout: "grid", customFacetsPreserved: true, libraryPreserved: true } };
        },
      },
    ];
    const registration = Promise.all(tools.map((tool) => context.registerTool(tool, { signal: controller.signal }))).then(() => undefined);
    storefrontRegistrations.set(context, registration);
    void registration
      .then(() => statusChangeRef.current("connected"))
      .catch(() => statusChangeRef.current("preview"));
    return () => { if (storefrontRuntime === runtime) storefrontRuntime = null; };
  }, [applyRecommendation, clearSearch, removeFacet, saveFacet]);

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
        <section className="storefront-browser-hero" aria-labelledby="storefront-browser-title"><div className="storefront-browser-copy"><h2 id="storefront-browser-title">Tell your browser what you want to play next.</h2></div><div className="storefront-prompt-starters" aria-label="Prompt ideas">{STORE_PROMPTS.map((item) => <button type="button" key={item.prompt} onClick={() => copyStorePrompt(item.prompt)}><span>{item.label}</span><b>“{item.prompt}”</b><small aria-live="polite">{copiedStorePrompt === item.prompt ? "Copied ✓" : "Copy to ask ↗"}</small></button>)}</div></section>
        <div className="storefront-manual-search"><label><span aria-hidden="true">⌕</span><span className="sr-only">Search the store</span><input value={search} onChange={(event) => updateTextSearch(event.target.value)} placeholder="Search games, studios, genres, or tags" /></label><select aria-label="Sort games" value={sort} onChange={(event) => { setSort(event.target.value as SortKey); setDirection(event.target.value === "title" ? "asc" : "desc"); setPage(0); }}><option value="ownersMax">Most popular</option><option value="positiveRatio">Best reviewed</option><option value="reviewCount">Most reviewed</option><option value="ccu">Most active</option><option value="releaseYear">Newest</option><option value="priceCents">Price</option><option value="title">Title</option></select><button type="button" className="storefront-clear" onClick={clearSearch} disabled={!activeFilterCount && !presentation}>Clear</button></div>
      </form> : null}

      {presentation ? <section className={"result-briefing mode-" + presentation.mode} aria-labelledby="result-briefing-title">
        <div><span>Composed by your browser</span><h2 id="result-briefing-title">{presentation.title}</h2><p>{presentation.explanation}</p></div>
        <div className="briefing-recipe"><b>{presentation.mode}</b>{presentation.ranking.length ? <span>{presentation.ranking.map((factor) => Math.round(factor.weight * 100) + "% " + (factor.label || fieldLabel(factor.field))).join(" · ")}</span> : <span>{highlights.length ? highlights.map((field) => field === "publisher" ? "publisher" : fieldLabel(field as StorefrontRankingField)).join(" · ") : "Visual discovery"}</span>}{presentation.excludeOwned && ownedExclusions.length ? <span>{ownedExclusions.length} owned games excluded</span> : null}<button type="button" onClick={clearSearch}><span aria-hidden="true">×</span> Clear personalized search</button></div>
      </section> : null}

      <div className={"storefront-body" + (editorial ? " is-curated" : "")}>
        {!editorial ? <aside className="storefront-facets" aria-label="Store filters">
          <div className="facet-heading"><div><span>Refine</span><b>{activeFilterCount || "All"} filters</b></div>{activeFilterCount ? <button type="button" onClick={clearSearch}>Reset</button> : null}</div>
          <fieldset><legend>Price</legend><select value={priceBand} onChange={(event) => { setPriceBand(event.target.value as (typeof PRICE_BANDS)[number]); setPage(0); }}>{PRICE_BANDS.map((band) => <option key={band}>{band}</option>)}</select></fieldset>
          <fieldset><legend>Genre</legend><select value={genre} onChange={(event) => { setGenre(event.target.value); setPage(0); }}><option value="">All genres</option>{(catalog?.facets.genres ?? []).slice(0, 28).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}</select></fieldset>
          <details className="facet-add"><summary><span className="facet-add-copy"><small>Browser-powered</small><b>Add a facet</b></span><span className="facet-add-icon" aria-hidden="true">+</span></summary><section className="facet-prompt-menu" role="dialog" aria-modal="false" aria-labelledby="facet-prompt-title"><header><span>Browser shortcut</span><h2 id="facet-prompt-title">You can say</h2><p>Your browser will build the bands and save the facet here.</p></header><div>{FACET_PROMPTS.map((item) => <button type="button" key={item.prompt} onClick={() => copyFacetPrompt(item.prompt)}><span>{item.label}</span><b>“{item.prompt}”</b><small>{copiedFacetPrompt === item.prompt ? "Copied ✓" : "Copy prompt ↗"}</small></button>)}</div></section></details>
          <fieldset><legend>Popular tags</legend><div className="facet-chips">{(catalog?.facets.tags ?? []).slice(0, 9).map((item) => <button type="button" className={tag === item.label ? "active" : ""} key={item.label} onClick={() => { setTag((value) => value === item.label ? "" : item.label); setPage(0); }}>{item.label}</button>)}</div></fieldset>
          {customFacets.map((facet) => <fieldset className="custom-facet" key={facet.id}><legend><span>{facet.label}</span><button type="button" aria-label={"Remove " + facet.label + " facet"} onClick={() => removeFacet(facet.id)}>×</button></legend><div className="facet-options"><button type="button" className={!selectedCustomBands[facet.id] ? "active" : ""} onClick={() => { setSelectedCustomBands((selected) => { const copy = { ...selected }; delete copy[facet.id]; return copy; }); setPage(0); }}>Any</button>{facet.bands.map((band) => <button type="button" className={selectedCustomBands[facet.id] === band.id ? "active" : ""} key={band.id} onClick={() => { setSelectedCustomBands((selected) => ({ ...selected, [facet.id]: band.id })); setPage(0); }}>{band.label}</button>)}</div><small>{fieldLabel(facet.field)} · saved in this browser</small></fieldset>)}
        </aside> : null}

        <section className="storefront-results" aria-busy={loading} aria-live="polite">
          <div className="storefront-results-bar"><div><strong>{loading ? "Updating…" : total.toLocaleString() + " games"}</strong><span>{presentation ? activeMode + " view selected for this search" : "Conventional store results"}</span></div><div><span>{library.size} in library</span><b>{activeMode}</b></div></div>
          {loading ? <StorefrontResultsSkeleton mode={activeMode} /> : catalogError && !appliedRecommendation ? <div className="storefront-empty"><strong>Store catalog unavailable</strong><p>{catalogError}</p></div> : !games.length ? <div className="storefront-empty"><strong>No games match this search</strong><p>Clear a filter or try broader terms.</p><button type="button" onClick={clearSearch}>Clear search</button></div> : <>
            {featuredGames.length ? <section className={"store-featured" + (featuredGames.length === 1 ? " is-single" : "")} aria-labelledby="store-featured-title">
              <div className="store-featured-heading"><span>{featuredGames.length === 1 ? "Curated standout" : "Curated shortlist"}</span><h3 id="store-featured-title">{featuredGames.length === 1 ? "Our best match for you" : "Top picks for you"}</h3></div>
              <div className="store-featured-grid">{featuredGames.map(({ game, editorial: item }) => <FeaturedGameCard key={game.id} game={game} editorial={item} isBestMatch={featuredGames.length === 1} inLibrary={library.has(game.id)} adding={addingId === game.id} onAdd={addToLibrary} />)}</div>
            </section> : null}
            {algorithmicGames.length ? activeMode === "table" ? <GameTable games={algorithmicGames} library={library} addingId={addingId} onAdd={addToLibrary} /> : activeMode === "ranking" ? <div className="store-ranking">{algorithmicGames.map((game, index) => <RankingItem key={game.id} game={game} rank={featuredGames.length + visiblePage * PAGE_SIZE + index + 1} highlights={highlights} inLibrary={library.has(game.id)} adding={addingId === game.id} onAdd={addToLibrary} />)}</div> : activeMode === "list" ? <div className="store-list">{algorithmicGames.map((game) => <GameListItem key={game.id} game={game} highlights={highlights} inLibrary={library.has(game.id)} adding={addingId === game.id} onAdd={addToLibrary} />)}</div> : <div className="store-grid">{algorithmicGames.map((game) => <GameCard key={game.id} game={game} highlights={highlights} inLibrary={library.has(game.id)} adding={addingId === game.id} onAdd={addToLibrary} />)}</div> : null}
          </>}
          <footer className="store-pagination"><span>{loading ? "Updating results…" : "Showing " + resultStart.toLocaleString() + "–" + resultEnd.toLocaleString() + " of " + total.toLocaleString()}</span><div><button type="button" disabled={loading || visiblePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>←</button><span>Page {visiblePage + 1} / {totalPages}</span><button type="button" disabled={loading || visiblePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>→</button></div></footer>
        </section>
      </div>
    </section>
    <footer className="valve-attribution"><span>Independent demo. Not affiliated with or endorsed by Valve.</span><span>©2026 Valve Corporation. Steam and the Steam logo are trademarks and/or registered trademarks of Valve Corporation in the U.S. and/or other countries.</span><a href="https://partner.steamgames.com/doc/marketing/branding" target="_blank" rel="noreferrer">Steam brand guidelines ↗</a></footer>
  </main></>;
}
