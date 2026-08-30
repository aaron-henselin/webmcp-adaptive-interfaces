"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DemoSwitcher, { type WebMcpStatus, webMcpStatusLabel } from "./demo-switcher";
import { loadCatalogPage, type CatalogGame, type CatalogPage, type StorefrontNumericField, type StorefrontNumericFilter, type StorefrontRankingFactor } from "./catalog-data";
import "./storefront.css";

const PAGE_SIZE = 12;
const SEARCH_SESSION_KEY = "steam-desk.storefront-search/v1";
const CUSTOM_FACETS_KEY = "steam-desk.storefront-facets/v1";
const LIBRARY_KEY = "steam-desk.storefront-library/v1";
const PRICE_BANDS = ["All prices", "Free", "Under $10", "$10–$29.99", "$30–$59.99", "$60+"] as const;
const SORTS = ["ownersMax", "title", "priceCents", "positiveRatio", "reviewCount", "ccu", "releaseYear"] as const;
const LAYOUTS = ["grid", "list", "table", "ranking"] as const;
const NUMERIC_FIELDS: StorefrontNumericField[] = ["positiveRatio", "reviewCount", "priceCents", "ownersMax", "ccu", "averageForever", "releaseYear"];
const HIGHLIGHT_FIELDS = ["positiveRatio", "reviewCount", "ownersMax", "ccu", "releaseYear", "averageForever", "publisher"] as const;

type LayoutMode = typeof LAYOUTS[number];
type SortKey = typeof SORTS[number];
type HighlightField = typeof HIGHLIGHT_FIELDS[number];
type FacetBand = { id: string; label: string; min?: number; max?: number };
type CustomFacet = { id: string; label: string; field: StorefrontNumericField; bands: FacetBand[] };
type SearchPresentation = { title: string; explanation: string; mode: LayoutMode; highlights: HighlightField[]; ranking: StorefrontRankingFactor[]; excludeOwned: boolean };
type StorefrontPageProps = { webMcpStatus: WebMcpStatus; onWebMcpStatusChange: (status: WebMcpStatus) => void };

const SEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string", maxLength: 120, description: "Concise catalog search terms." },
    title: { type: "string", maxLength: 90, description: "Heading that states the interpreted shopping intent." },
    explanation: { type: "string", maxLength: 180, description: "Why this result layout and ordering fit the request." },
    genre: { type: "string", maxLength: 80 },
    tag: { type: "string", maxLength: 80 },
    priceBand: { type: "string", enum: PRICE_BANDS },
    minPositiveRatio: { type: "number", minimum: 0, maximum: 1 },
    minReviewCount: { type: "integer", minimum: 0, maximum: 10000000 },
    sort: { type: "string", enum: SORTS },
    direction: { type: "string", enum: ["asc", "desc"] },
    excludeOwned: { type: "boolean", default: true, description: "Exclude games already stored in this browser's local library. Keep true unless the user explicitly asks to browse owned games." },
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
              field: { type: "string", enum: NUMERIC_FIELDS },
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
  required: ["query", "title", "explanation", "presentation"],
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

function fieldLabel(field: StorefrontNumericField) {
  return {
    positiveRatio: "review quality", reviewCount: "review confidence", priceCents: "lower price",
    ownersMax: "player reach", ccu: "active players", averageForever: "long-term playtime", releaseYear: "recency",
  }[field];
}

function metricValue(game: CatalogGame, field: HighlightField) {
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
    <div className="store-rank-evidence">{visible.slice(0, 3).map((field) => <span key={field}><b>{metricValue(game, field)}</b><small>{field === "publisher" ? "publisher" : fieldLabel(field as StorefrontNumericField)}</small></span>)}</div>
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
    const field = String(factor.field ?? "") as StorefrontNumericField;
    const weight = typeof factor.weight === "number" ? Math.min(1, Math.max(0, factor.weight)) : 0;
    if (!NUMERIC_FIELDS.includes(field) || !weight) return [];
    return [{ field, weight, direction: factor.direction === "lower" ? "lower" : "higher", label: cleanText(factor.label, fieldLabel(field), 40) }];
  }).slice(0, 5);
}

function mostCommon(values: string[], limit = 5) {
  const counts = new Map<string, number>();
  for (const value of values.map((item) => item.trim()).filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

export default function StorefrontPage({ webMcpStatus, onWebMcpStatusChange }: StorefrontPageProps) {
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
  const [customFacets, setCustomFacets] = useState<CustomFacet[]>([]);
  const [selectedCustomBands, setSelectedCustomBands] = useState<Record<string, string>>({});
  const [library, setLibrary] = useState<Set<number>>(new Set());
  const [addingId, setAddingId] = useState<number | null>(null);
  const customFacetsRef = useRef<CustomFacet[]>([]);
  const libraryRef = useRef<Set<number>>(new Set());
  const storageLoadedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  const numericFilters = useMemo<StorefrontNumericFilter[]>(() => customFacets.flatMap((facet) => {
    const selected = facet.bands.find((band) => band.id === selectedCustomBands[facet.id]);
    return selected ? [{ field: facet.field, min: selected.min, max: selected.max }] : [];
  }), [customFacets, selectedCustomBands]);
  const ranking = presentation?.ranking ?? [];
  const ownedExclusions = useMemo(() => presentation?.excludeOwned ? [...library].slice(0, 200) : [], [library, presentation?.excludeOwned]);
  const requestKey = JSON.stringify([search, priceBand, genre, tag, minPositiveRatio, minReviewCount, sort, direction, page, numericFilters, ranking, ownedExclusions]);

  useEffect(() => {
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

  const clearSearch = useCallback(() => {
    setSearch(""); setPriceBand("All prices"); setGenre(""); setTag(""); setMinPositiveRatio(undefined); setMinReviewCount(undefined);
    setSort("ownersMax"); setDirection("desc"); setPage(0); setPresentation(null); setSelectedCustomBands({});
    try { window.sessionStorage.removeItem(SEARCH_SESSION_KEY); } catch { /* State is reset in memory. */ }
  }, []);

  const catalogRecordCount = catalog?.meta.recordCount;
  const catalogSourceSha256 = catalog?.meta.sourceSha256;
  useEffect(() => {
    if (catalogRecordCount === undefined) return;
    const context = document.modelContext ?? navigator.modelContext;
    if (!context) { queueMicrotask(() => onWebMcpStatusChange("preview")); return; }
    const controller = new AbortController();
    const tools = [
      {
        name: "describe_storefront",
        description: "Describe the Steam storefront fields, filters, ranking formula fields, adaptive templates, saved custom facets, and local library behavior.",
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: () => ({
          content: [{ type: "text", text: "Described a " + catalogRecordCount.toLocaleString() + "-game storefront with agent-controlled result layouts." }],
          structuredContent: {
            schemaVersion: "steam-desk.storefront/v1",
            catalog: { recordCount: catalogRecordCount, genres: catalog?.facets.genres.slice(0, 30).map((item) => item.label) ?? [], tags: catalog?.facets.tags.slice(0, 40).map((item) => item.label) ?? [] },
            presentationModes: LAYOUTS, rankingFields: NUMERIC_FIELDS.map((field) => ({ field, meaning: fieldLabel(field) })), customFacets: customFacetsRef.current,
            library: { count: libraryRef.current.size, storage: "local" },
            guidance: [
              "Call get_storefront_library before recommendations, discovery, comparisons, or rankings to learn the user's tastes and know which app IDs are already owned.",
              "Adaptive searches exclude locally owned games by default unless the user explicitly asks to browse owned games.",
              "Use search_storefront for natural-language shopping and ranking requests.",
              "Choose ranking only when the request compares or prioritizes results; otherwise use grid, list, or table.",
              "Ranking factors are normalized and weighted. Use direction lower for price when affordability should improve the score.",
              "Use save_storefront_facet for reusable facets and provide non-overlapping numeric bands.",
              "Do not offer cart or checkout. The page only adds games to its local demo library.",
            ],
          },
        }),
      },
      {
        name: "get_storefront_library",
        description: "Get the games stored in this browser's local library plus a compact taste profile. Call before recommendations, discovery, comparison, or ranking so owned games can be excluded and results can reflect the user's genres, tags, developers, publishers, review preferences, and playtime signals.",
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async () => {
          try {
            const ids = [...libraryRef.current].slice(0, 2000);
            if (!ids.length) return {
              content: [{ type: "text", text: "The local storefront library is empty." }],
              structuredContent: {
                schemaVersion: "steam-desk.storefront-library/v1", storage: "local", count: 0, appIds: [], games: [],
                tasteProfile: { genres: [], tags: [], developers: [], publishers: [], averagePositiveRatio: null, averagePlaytimeHours: null, freeGames: 0 },
              },
            };
            const result = await loadCatalogPage({
              search: "", ownerBand: "All owner ranges", priceBand: "All prices", sort: "title", direction: "asc", page: 0, pageSize: 100,
              appIds: ids.slice(0, 100),
            }, controller.signal);
            const games = result.games;
            const averagePositiveRatio = games.length ? games.reduce((sum, game) => sum + (game.positiveRatio ?? 0), 0) / games.length : null;
            const averagePlaytimeHours = games.length ? games.reduce((sum, game) => sum + game.averageForever, 0) / games.length / 60 : null;
            const tasteProfile = {
              genres: mostCommon(games.flatMap((game) => game.genres)),
              tags: mostCommon(games.flatMap((game) => game.tags), 8),
              developers: mostCommon(games.flatMap((game) => game.developer.split(","))),
              publishers: mostCommon(games.flatMap((game) => game.publisher.split(","))),
              averagePositiveRatio: averagePositiveRatio === null ? null : Math.round(averagePositiveRatio * 1000) / 1000,
              averagePlaytimeHours: averagePlaytimeHours === null ? null : Math.round(averagePlaytimeHours * 10) / 10,
              freeGames: games.filter((game) => game.priceCents === 0).length,
            };
            const genreSummary = tasteProfile.genres.map((item) => item.label).join(", ") || "no strong genre signal yet";
            return {
              content: [{ type: "text", text: "Read " + ids.length + " locally owned games. Strongest genre signals: " + genreSummary + "." }],
              structuredContent: {
                schemaVersion: "steam-desk.storefront-library/v1", storage: "local", count: ids.length, appIds: ids,
                sampledGameCount: games.length,
                games: games.map((game) => ({
                  id: game.id, title: game.title, developer: game.developer, publisher: game.publisher, genres: game.genres, tags: game.tags,
                  positiveRatio: game.positiveRatio, reviewCount: game.reviewCount, ownersMax: game.ownersMax, ccu: game.ccu,
                  averageForever: game.averageForever, releaseYear: game.releaseYear,
                })),
                tasteProfile,
              },
            };
          } catch (error) {
            return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The local library could not be read." }] };
          }
        },
      },
      {
        name: "search_storefront",
        description: "Use for every natural-language request to find, browse, show, compare, recommend, or rank storefront games. Perform the search, exclude locally owned games by default, and choose the result template that fits the user's intent. Grid supports visual discovery, list supports compact comparison, table supports exact inspection, and ranking supports prioritized recommendations.",
        inputSchema: SEARCH_SCHEMA,
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input: Record<string, unknown>) => {
          try {
            const rawPresentation = isRecord(input.presentation) ? input.presentation : {};
            const mode = LAYOUTS.includes(rawPresentation.mode as LayoutMode) ? rawPresentation.mode as LayoutMode : "grid";
            const highlights = Array.isArray(rawPresentation.highlightFields) ? rawPresentation.highlightFields.filter((field): field is HighlightField => HIGHLIGHT_FIELDS.includes(field as HighlightField)).slice(0, 5) : [];
            let nextRanking = normalizeRanking(input.ranking);
            if (mode === "ranking" && !nextRanking.length) nextRanking = [
              { field: "positiveRatio", weight: .5, direction: "higher", label: "review quality" },
              { field: "reviewCount", weight: .2, direction: "higher", label: "review confidence" },
              { field: "ownersMax", weight: .2, direction: "higher", label: "player reach" },
              { field: "ccu", weight: .1, direction: "higher", label: "active players" },
            ];
            const nextPresentation: SearchPresentation = {
              title: cleanText(input.title, "Results shaped around your request", 90),
              explanation: cleanText(input.explanation, "The browser selected the fields and layout that make this search easiest to evaluate.", 180),
              mode, highlights, ranking: nextRanking, excludeOwned: input.excludeOwned !== false,
            };
            setSearch(cleanText(input.query, "", 120)); setGenre(cleanText(input.genre, "", 80)); setTag(cleanText(input.tag, "", 80));
            setPriceBand(PRICE_BANDS.includes(input.priceBand as (typeof PRICE_BANDS)[number]) ? input.priceBand as (typeof PRICE_BANDS)[number] : "All prices");
            setMinPositiveRatio(typeof input.minPositiveRatio === "number" ? Math.min(1, Math.max(0, input.minPositiveRatio)) : undefined);
            setMinReviewCount(typeof input.minReviewCount === "number" ? Math.max(0, Math.round(input.minReviewCount)) : undefined);
            setSort(SORTS.includes(input.sort as SortKey) ? input.sort as SortKey : nextRanking.length ? "positiveRatio" : "ownersMax");
            setDirection(input.direction === "asc" ? "asc" : "desc"); setPresentation(nextPresentation); setPage(0);
            return { content: [{ type: "text", text: "Applied “" + nextPresentation.title + "” in the " + mode + " storefront layout." }], structuredContent: { schemaVersion: "steam-desk.storefront-search-receipt/v1", ok: true, query: cleanText(input.query, "", 120), presentation: nextPresentation, excludedOwnedCount: nextPresentation.excludeOwned ? libraryRef.current.size : 0, persistence: "session until search is cleared" } };
          } catch (error) {
            return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The storefront search could not be applied." }], structuredContent: { ok: false } };
          }
        },
      },
      {
        name: "save_storefront_facet",
        description: "Create a reusable numeric storefront facet with non-overlapping formula bands. The facet is saved permanently in this browser.",
        inputSchema: FACET_SCHEMA,
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input: Record<string, unknown>) => {
          try {
            const facet = normalizeCustomFacet(input);
            const next = [facet, ...customFacetsRef.current].slice(0, 8);
            customFacetsRef.current = next; setCustomFacets(next);
            return { content: [{ type: "text", text: "Added the permanent “" + facet.label + "” facet with " + facet.bands.length + " formula bands." }], structuredContent: { schemaVersion: "steam-desk.storefront-facet-receipt/v1", ok: true, saved: true, storage: "local", facet } };
          } catch (error) {
            return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The custom facet could not be saved." }], structuredContent: { ok: false } };
          }
        },
      },
      {
        name: "remove_storefront_facet",
        description: "Remove a saved custom storefront facet from this browser.",
        inputSchema: { type: "object", additionalProperties: false, properties: { facetId: { type: "string", minLength: 1, maxLength: 80 } }, required: ["facetId"] },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input: Record<string, unknown>) => {
          const facetId = cleanText(input.facetId, "", 80);
          const existing = customFacetsRef.current.find((facet) => facet.id === facetId);
          if (!existing) return { isError: true, content: [{ type: "text", text: "Saved facet not found." }] };
          const next = customFacetsRef.current.filter((facet) => facet.id !== facetId);
          customFacetsRef.current = next; setCustomFacets(next);
          setSelectedCustomBands((selected) => { const copy = { ...selected }; delete copy[facetId]; return copy; });
          return { content: [{ type: "text", text: "Removed the “" + existing.label + "” facet." }], structuredContent: { ok: true, removed: facetId } };
        },
      },
      {
        name: "clear_storefront_search",
        description: "Clear the current search, filters, ranking formula, and adaptive template while preserving custom facets and library.",
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: () => {
          clearSearch();
          return { content: [{ type: "text", text: "Cleared the adaptive search and restored the conventional storefront." }], structuredContent: { ok: true, layout: "grid", customFacetsPreserved: true, libraryPreserved: true } };
        },
      },
    ];
    void Promise.all(tools.map((tool) => context.registerTool(tool, { signal: controller.signal })))
      .then(() => { if (!controller.signal.aborted) onWebMcpStatusChange("connected"); })
      .catch(() => { if (!controller.signal.aborted) onWebMcpStatusChange("preview"); });
    return () => controller.abort();
  }, [catalogRecordCount, catalogSourceSha256, clearSearch, onWebMcpStatusChange]);

  const addToLibrary = useCallback((id: number) => {
    if (library.has(id) || addingId !== null) return;
    setAddingId(id);
    const timer = window.setTimeout(() => { setLibrary((items) => { const next = new Set(items); next.add(id); libraryRef.current = next; return next; }); setAddingId(null); }, 760);
    timersRef.current.push(timer);
  }, [addingId, library]);

  const updateTextSearch = (value: string) => { setSearch(value); setPage(0); if (!value) setPresentation(null); };
  const loading = resolvedKey !== requestKey;
  const games = catalog?.games ?? [];
  const total = catalog?.query.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visiblePage = Math.min(page, totalPages - 1);
  const activeMode = presentation?.mode ?? "grid";
  const highlights = presentation?.highlights ?? [];
  const resultStart = total ? visiblePage * PAGE_SIZE + 1 : 0;
  const resultEnd = Math.min((visiblePage + 1) * PAGE_SIZE, total);
  const activeFilterCount = [search, priceBand !== "All prices", genre, tag, minPositiveRatio !== undefined, minReviewCount !== undefined, ...Object.values(selectedCustomBands)].filter(Boolean).length;

  return <><DemoSwitcher active="store" /><main className="storefront-shell">
    <section className="storefront" aria-labelledby="storefront-title">
      <header className="storefront-hero">
        <div className="storefront-hero-copy">
          <p className={"storefront-status webmcp-status-" + webMcpStatus}><span aria-hidden="true" /> {webMcpStatusLabel(webMcpStatus)}</p>
          <h1 id="storefront-title">Find your next game.</h1>
          <p>Browse the store normally—or tell your browser what matters and let the results reshape around the question.</p>
          <div className="storefront-prompt"><span>Try saying</span><b>“Rank real-time strategy games for someone who values active players and reviews.”</b></div>
        </div>
        <div className="storefront-hero-mark" aria-hidden="true"><span>03</span><strong>STORE</strong><i /></div>
      </header>

      <form className="storefront-search" role="search" onSubmit={(event) => event.preventDefault()}>
        <label><span aria-hidden="true">⌕</span><span className="sr-only">Search the store</span><input value={search} onChange={(event) => updateTextSearch(event.target.value)} placeholder="Search games, studios, genres, or tags" /></label>
        <select aria-label="Sort games" value={sort} onChange={(event) => { setSort(event.target.value as SortKey); setDirection(event.target.value === "title" ? "asc" : "desc"); setPage(0); }}>
          <option value="ownersMax">Most popular</option><option value="positiveRatio">Best reviewed</option><option value="reviewCount">Most reviewed</option><option value="ccu">Most active</option><option value="releaseYear">Newest</option><option value="priceCents">Price</option><option value="title">Title</option>
        </select>
        <button type="button" className="storefront-clear" onClick={clearSearch} disabled={!activeFilterCount && !presentation}>Clear</button>
      </form>

      {presentation ? <section className={"result-briefing mode-" + presentation.mode} aria-labelledby="result-briefing-title">
        <div><span>Composed by your browser</span><h2 id="result-briefing-title">{presentation.title}</h2><p>{presentation.explanation}</p></div>
        <div className="briefing-recipe"><b>{presentation.mode}</b>{presentation.ranking.length ? <span>{presentation.ranking.map((factor) => Math.round(factor.weight * 100) + "% " + (factor.label || fieldLabel(factor.field))).join(" · ")}</span> : <span>{highlights.length ? highlights.map((field) => field === "publisher" ? "publisher" : fieldLabel(field as StorefrontNumericField)).join(" · ") : "Visual discovery"}</span>}{presentation.excludeOwned && ownedExclusions.length ? <span>{ownedExclusions.length} owned games excluded</span> : null}</div>
      </section> : null}

      <div className="storefront-body">
        <aside className="storefront-facets" aria-label="Store filters">
          <div className="facet-heading"><div><span>Refine</span><b>{activeFilterCount || "All"} filters</b></div>{activeFilterCount ? <button type="button" onClick={clearSearch}>Reset</button> : null}</div>
          <fieldset><legend>Price</legend><select value={priceBand} onChange={(event) => { setPriceBand(event.target.value as (typeof PRICE_BANDS)[number]); setPage(0); }}>{PRICE_BANDS.map((band) => <option key={band}>{band}</option>)}</select></fieldset>
          <fieldset><legend>Reviews</legend><div className="facet-options">{[{ label: "Any rating", value: undefined }, { label: "70%+ positive", value: .7 }, { label: "80%+ positive", value: .8 }, { label: "90%+ positive", value: .9 }, { label: "95%+ positive", value: .95 }].map((item) => <button type="button" className={minPositiveRatio === item.value ? "active" : ""} key={item.label} onClick={() => { setMinPositiveRatio(item.value); setPage(0); }}>{item.label}</button>)}</div></fieldset>
          <fieldset><legend>Genre</legend><select value={genre} onChange={(event) => { setGenre(event.target.value); setPage(0); }}><option value="">All genres</option>{(catalog?.facets.genres ?? []).slice(0, 28).map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}</select></fieldset>
          <fieldset><legend>Popular tags</legend><div className="facet-chips">{(catalog?.facets.tags ?? []).slice(0, 9).map((item) => <button type="button" className={tag === item.label ? "active" : ""} key={item.label} onClick={() => { setTag((value) => value === item.label ? "" : item.label); setPage(0); }}>{item.label}</button>)}</div></fieldset>
          {customFacets.map((facet) => <fieldset className="custom-facet" key={facet.id}><legend><span>{facet.label}</span><button type="button" aria-label={"Remove " + facet.label + " facet"} onClick={() => { setCustomFacets((items) => items.filter((item) => item.id !== facet.id)); setSelectedCustomBands((selected) => { const copy = { ...selected }; delete copy[facet.id]; return copy; }); }}>×</button></legend><div className="facet-options"><button type="button" className={!selectedCustomBands[facet.id] ? "active" : ""} onClick={() => { setSelectedCustomBands((selected) => { const copy = { ...selected }; delete copy[facet.id]; return copy; }); setPage(0); }}>Any</button>{facet.bands.map((band) => <button type="button" className={selectedCustomBands[facet.id] === band.id ? "active" : ""} key={band.id} onClick={() => { setSelectedCustomBands((selected) => ({ ...selected, [facet.id]: band.id })); setPage(0); }}>{band.label}</button>)}</div><small>{fieldLabel(facet.field)} · saved in this browser</small></fieldset>)}
          {!customFacets.length ? <div className="facet-invitation"><span>Make it yours</span><p>Ask your browser to “add a facet for reviews” and define the bands you care about.</p></div> : null}
        </aside>

        <section className="storefront-results" aria-busy={loading} aria-live="polite">
          <div className="storefront-results-bar"><div><strong>{loading ? "Updating…" : total.toLocaleString() + " games"}</strong><span>{presentation ? activeMode + " view selected for this search" : "Conventional store results"}</span></div><div><span>{library.size} in library</span><b>{activeMode}</b></div></div>
          {catalogError ? <div className="storefront-empty"><strong>Store catalog unavailable</strong><p>{catalogError}</p></div> : !loading && !games.length ? <div className="storefront-empty"><strong>No games match this search</strong><p>Clear a filter or try broader terms.</p><button type="button" onClick={clearSearch}>Clear search</button></div> : activeMode === "table" ? <GameTable games={games} library={library} addingId={addingId} onAdd={addToLibrary} /> : activeMode === "ranking" ? <div className="store-ranking">{games.map((game, index) => <RankingItem key={game.id} game={game} rank={visiblePage * PAGE_SIZE + index + 1} highlights={highlights} inLibrary={library.has(game.id)} adding={addingId === game.id} onAdd={addToLibrary} />)}</div> : activeMode === "list" ? <div className="store-list">{games.map((game) => <GameListItem key={game.id} game={game} highlights={highlights} inLibrary={library.has(game.id)} adding={addingId === game.id} onAdd={addToLibrary} />)}</div> : <div className="store-grid">{games.map((game) => <GameCard key={game.id} game={game} highlights={highlights} inLibrary={library.has(game.id)} adding={addingId === game.id} onAdd={addToLibrary} />)}</div>}
          <footer className="store-pagination"><span>{loading ? "Updating results…" : "Showing " + resultStart.toLocaleString() + "–" + resultEnd.toLocaleString() + " of " + total.toLocaleString()}</span><div><button type="button" disabled={loading || visiblePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>←</button><span>Page {visiblePage + 1} / {totalPages}</span><button type="button" disabled={loading || visiblePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>→</button></div></footer>
        </section>
      </div>
    </section>
    <footer className="valve-attribution"><span>Independent demo. Not affiliated with or endorsed by Valve.</span><span>©2026 Valve Corporation. Steam and the Steam logo are trademarks and/or registered trademarks of Valve Corporation in the U.S. and/or other countries.</span><a href="https://partner.steamgames.com/doc/marketing/branding" target="_blank" rel="noreferrer">Steam brand guidelines ↗</a></footer>
  </main></>;
}
