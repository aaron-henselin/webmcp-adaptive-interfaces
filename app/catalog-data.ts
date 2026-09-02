export type StorefrontNumericField = "positiveRatio" | "reviewCount" | "priceCents" | "ownersMax" | "ccu" | "averageForever" | "releaseYear";
export type StorefrontIntentField = "intentFit" | "tagCoverage";
export type StorefrontRankingField = StorefrontNumericField | StorefrontIntentField;
export type StorefrontRankingFactor = { field: StorefrontRankingField; weight: number; direction: "higher" | "lower"; label?: string };
export type StorefrontNumericFilter = { field: StorefrontNumericField; min?: number; max?: number };
export type CatalogFilterOperator = "equal" | "notEqual" | "greaterThan" | "greaterOrEqual" | "lessThan" | "lessOrEqual" | "in" | "contains";
export type CatalogFilterValue = string | number | boolean | null | Array<string | number | boolean>;
export type CatalogFilter = { field: string; operator: CatalogFilterOperator; value: CatalogFilterValue };

export type CatalogGame = {
  id: number;
  title: string;
  headerImage: string | null;
  developer: string;
  publisher: string;
  owners: string;
  ownersMin: number;
  ownersMax: number;
  priceCents: number;
  initialPriceCents: number;
  discountPercent: number;
  positive: number;
  negative: number;
  reviewCount: number;
  positiveRatio: number | null;
  ccu: number;
  averageForever: number;
  average2Weeks: number;
  medianForever: number;
  median2Weeks: number;
  releaseDate: string | null;
  releaseYear: number | null;
  rankScore?: number | null;
  intentFit?: number | null;
  tagCoverage?: number | null;
  genres: string[];
  tags: string[];
};

export type CatalogPage = {
  schemaVersion: "adaptive-interfaces.catalog-page/v1";
  meta: {
    recordCount: number;
    importedAt: string;
    sourceFilename: string;
    sourceSha256: string;
  };
  query: { total: number; page: number; pageSize: number; ranked?: boolean };
  games: CatalogGame[];
  distributions: Record<"owners" | "reviews" | "price", Array<{ label: string; value: number }>>;
  facets: { genres: Array<{ label: string; value: number }>; tags: Array<{ label: string; value: number }> };
};

export type CatalogPageOptions = {
  search: string;
  ownerBand: string;
  priceBand: string;
  sort: "ownersMax" | "title" | "priceCents" | "positiveRatio" | "reviewCount" | "ccu" | "releaseYear";
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
  genre?: string;
  tag?: string;
  requiredTags?: string[];
  filters?: CatalogFilter[];
  minPositiveRatio?: number;
  minReviewCount?: number;
  numericFilters?: StorefrontNumericFilter[];
  ranking?: StorefrontRankingFactor[];
  reference?: string;
  includeTags?: string[];
  preferredTags?: string[];
  excludeTags?: string[];
  appIds?: number[];
  excludeAppIds?: number[];
};

export type GameCompany = {
  id: number;
  name: string;
  roles: Array<"developer" | "publisher">;
  gameCount: number;
  similarity?: number;
};

export type CompanyResolution = {
  status: "matched" | "corrected" | "ambiguous" | "not_found";
  confidence: number;
  company?: GameCompany;
  correctedFrom?: string;
  alternatives: GameCompany[];
};

export type CompanySearchResult = {
  schemaVersion: "adaptive-interfaces.company-search/v2";
  query: string;
  candidates: GameCompany[];
  resolution: CompanyResolution;
};

export async function resolveGameCompany(query: string, signal?: AbortSignal): Promise<CompanySearchResult> {
  const params = new URLSearchParams({ query, limit: "8" });
  const response = await fetch("/api/catalog/companies?" + params, { signal, cache: "no-store" });
  const value = await response.json() as CompanySearchResult | { error?: string };
  if (!response.ok || !("candidates" in value) || !Array.isArray(value.candidates) || !("resolution" in value)) throw new Error("error" in value && value.error ? value.error : "Company search failed with status " + response.status + ".");
  return value;
}

export async function searchGameCompanies(query: string, signal?: AbortSignal) {
  return (await resolveGameCompany(query, signal)).candidates;
}

export async function loadCatalogPage(options: CatalogPageOptions, signal?: AbortSignal) {
  const params = new URLSearchParams({
    search: options.search,
    ownerBand: options.ownerBand,
    priceBand: options.priceBand,
    sort: options.sort,
    direction: options.direction,
    page: String(options.page),
    pageSize: String(options.pageSize),
  });
  if (options.genre) params.set("genre", options.genre);
  if (options.tag) params.set("tag", options.tag);
  if (options.requiredTags?.length) params.set("requiredTags", JSON.stringify(options.requiredTags));
  if (options.filters?.length) params.set("filters", JSON.stringify(options.filters));
  if (options.minPositiveRatio !== undefined) params.set("minPositiveRatio", String(options.minPositiveRatio));
  if (options.minReviewCount !== undefined) params.set("minReviewCount", String(options.minReviewCount));
  if (options.numericFilters?.length) params.set("numericFilters", JSON.stringify(options.numericFilters));
  if (options.ranking?.length) params.set("ranking", JSON.stringify(options.ranking));
  if (options.reference) params.set("reference", options.reference);
  if (options.includeTags?.length) params.set("includeTags", JSON.stringify(options.includeTags));
  if (options.preferredTags?.length) params.set("preferredTags", JSON.stringify(options.preferredTags));
  if (options.excludeTags?.length) params.set("excludeTags", JSON.stringify(options.excludeTags));
  if (options.appIds?.length) params.set("appIds", JSON.stringify(options.appIds));
  if (options.excludeAppIds?.length) params.set("excludeAppIds", JSON.stringify(options.excludeAppIds));
  const response = await fetch(`/api/catalog?${params}`, { signal, cache: "no-store" });
  const value = await response.json() as CatalogPage | { error?: string };
  if (!response.ok) throw new Error("error" in value && value.error ? value.error : `Catalog request failed with status ${response.status}.`);
  return value as CatalogPage;
}

export async function executeCatalogReport(binding: unknown, signal?: AbortSignal) {
  const response = await fetch("/api/catalog/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(binding),
    signal,
  });
  const value = await response.json() as { rows?: Record<string, unknown>[]; error?: string };
  if (!response.ok || !Array.isArray(value.rows)) throw new Error(value.error || `Report request failed with status ${response.status}.`);
  return value.rows;
}
