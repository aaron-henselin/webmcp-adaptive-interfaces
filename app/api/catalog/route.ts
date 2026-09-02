import { NextResponse } from "next/server";
import { catalogDb } from "@/app/server/catalog-db";

export const runtime = "edge";

const PRICE_BAND_SQL = `CASE
  WHEN g.price_cents = 0 THEN 'Free'
  WHEN g.price_cents < 1000 THEN 'Under $10'
  WHEN g.price_cents < 3000 THEN '$10–$29.99'
  WHEN g.price_cents < 6000 THEN '$30–$59.99'
  ELSE '$60+'
END`;

const REVIEW_BAND_SQL = `CASE
  WHEN g.positive_ratio IS NULL THEN 'No reviews'
  WHEN g.positive_ratio >= 0.95 THEN '95%+ positive'
  WHEN g.positive_ratio >= 0.9 THEN '90–94% positive'
  WHEN g.positive_ratio >= 0.8 THEN '80–89% positive'
  WHEN g.positive_ratio >= 0.7 THEN '70–79% positive'
  ELSE 'Below 70%'
END`;

const SORT_FIELDS = {
  ownersMax: "g.owners_max",
  title: "g.name COLLATE NOCASE",
  priceCents: "g.price_cents",
  positiveRatio: "g.positive_ratio",
  reviewCount: "g.review_count",
  ccu: "g.peak_ccu",
  releaseYear: "g.release_year",
} as const;

const NUMERIC_FIELDS = {
  positiveRatio: "g.positive_ratio",
  reviewCount: "g.review_count",
  priceCents: "g.price_cents",
  ownersMax: "g.owners_max",
  ccu: "g.peak_ccu",
  averageForever: "g.average_forever",
  releaseYear: "g.release_year",
} as const;

const ACTIVITY_BAND_SQL = `CASE
  WHEN g.peak_ccu >= 100000 THEN '100K+ playing'
  WHEN g.peak_ccu >= 10000 THEN '10K–99K playing'
  WHEN g.peak_ccu >= 1000 THEN '1K–9.9K playing'
  WHEN g.peak_ccu >= 100 THEN '100–999 playing'
  WHEN g.peak_ccu > 0 THEN 'Under 100 playing'
  ELSE 'No players reported'
END`;

const GENERIC_FILTER_OPERATORS = new Set(["equal", "notEqual", "greaterThan", "greaterOrEqual", "lessThan", "lessOrEqual", "in", "contains"]);
const GENERIC_FILTER_FIELDS: Record<string, string> = {
  id: "g.app_id", title: "g.name", owners: "g.owners", ownersMin: "g.owners_min", ownersMax: "g.owners_max",
  priceCents: "g.price_cents", discountPercent: "g.discount_percent", positive: "g.positive", negative: "g.negative",
  reviewCount: "g.review_count", positiveRatio: "g.positive_ratio", ccu: "g.peak_ccu", averageForever: "g.average_forever",
  average2Weeks: "g.average_2weeks", medianForever: "g.median_forever", median2Weeks: "g.median_2weeks",
  releaseDate: "g.release_date", releaseYear: "g.release_year", requiredAge: "g.required_age", dlcCount: "g.dlc_count",
  metacriticScore: "g.metacritic_score", userScore: "g.user_score", achievements: "g.achievements",
  recommendations: "g.recommendations", windows: "g.windows", mac: "g.mac", linux: "g.linux",
  ownerBand: "g.owners", priceBand: PRICE_BAND_SQL, reviewBand: REVIEW_BAND_SQL, activityBand: ACTIVITY_BAND_SQL,
};
const RELATION_FILTER_FIELDS: Record<string, { from: string; value: string }> = {
  developer: { from: "game_developers gf_j JOIN developers gf_d ON gf_d.id = gf_j.developer_id", value: "gf_d.name" },
  publisher: { from: "game_publishers gf_j JOIN publishers gf_d ON gf_d.id = gf_j.publisher_id", value: "gf_d.name" },
  genre: { from: "game_genres gf_j JOIN genres gf_d ON gf_d.id = gf_j.genre_id", value: "gf_d.name" },
  tag: { from: "game_tags gf_j JOIN tags gf_d ON gf_d.id = gf_j.tag_id", value: "gf_d.name" },
  category: { from: "game_categories gf_j JOIN categories gf_d ON gf_d.id = gf_j.category_id", value: "gf_d.name" },
  language: { from: "game_languages gf_j JOIN languages gf_d ON gf_d.id = gf_j.language_id", value: "gf_d.name" },
};

const RANK_NORMALIZERS: Record<keyof typeof NUMERIC_FIELDS, string> = {
  positiveRatio: "COALESCE(g.positive_ratio, 0)",
  reviewCount: "MIN(CAST(g.review_count AS REAL) / 100000.0, 1)",
  priceCents: "MIN(CAST(g.price_cents AS REAL) / 7000.0, 1)",
  ownersMax: "MIN(CAST(g.owners_max AS REAL) / 200000000.0, 1)",
  ccu: "MIN(CAST(g.peak_ccu AS REAL) / 500000.0, 1)",
  averageForever: "MIN(CAST(g.average_forever AS REAL) / 10000.0, 1)",
  releaseYear: "MAX(0, MIN((COALESCE(g.release_year, 1990) - 1990) / 40.0, 1))",
};

type SqlExpression = { sql: string; values: Array<string | number> };
type TagGroupFilter = { tags: string[]; match: "any" | "all" };

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function ftsQuery(value: string) {
  return (value.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
}

function parseArray(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizedTextArray(value: string | null, limit: number) {
  return parseArray(value)
    .map((item) => String(item).trim().replace(/\s+/g, " ").slice(0, 80))
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.toLocaleLowerCase() === item.toLocaleLowerCase()) === index)
    .slice(0, limit);
}

function tagGroupFilters(value: string | null): TagGroupFilter[] {
  return parseArray(value).flatMap((filter): TagGroupFilter[] => {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) return [];
    const item = filter as Record<string, unknown>;
    const rawTags = Array.isArray(item.tags) ? item.tags : [];
    const tags = rawTags
      .map((tag) => String(tag).trim().replace(/\s+/g, " ").slice(0, 80))
      .filter(Boolean)
      .filter((tag, index, values) => values.findIndex((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index)
      .slice(0, 12);
    return tags.length ? [{ tags, match: item.match === "all" ? "all" : "any" }] : [];
  }).slice(0, 8);
}

function filterPrimitive(value: unknown): string | number | boolean | null | undefined {
  return value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value) || typeof value === "boolean" ? value : undefined;
}

function genericScalarFilter(sqlField: string, operator: string, rawValue: unknown): SqlExpression {
  if (operator === "contains") {
    if (typeof rawValue !== "string" || !rawValue.trim()) throw new Error("contains filters require a non-empty string.");
    return { sql: `INSTR(LOWER(CAST(${sqlField} AS TEXT)), LOWER(?)) > 0`, values: [rawValue.trim().slice(0, 120)] };
  }
  if (operator === "in") {
    if (!Array.isArray(rawValue)) throw new Error("in filters require an array value.");
    const members = rawValue.map(filterPrimitive).filter((item): item is string | number | boolean => item !== undefined && item !== null).slice(0, 20);
    if (!members.length) throw new Error("in filters require at least one scalar value.");
    return { sql: `${sqlField} IN (${members.map(() => "?").join(", ")})`, values: members.map((item) => typeof item === "boolean" ? Number(item) : item) };
  }
  if (Array.isArray(rawValue)) throw new Error(`${operator} filters require one scalar value.`);
  const value = filterPrimitive(rawValue);
  if (value === undefined) throw new Error("Filter values must be strings, finite numbers, booleans, null, or scalar arrays.");
  if (value === null) {
    if (operator !== "equal" && operator !== "notEqual") throw new Error("Only equal and notEqual can compare with null.");
    return { sql: `${sqlField} IS ${operator === "notEqual" ? "NOT " : ""}NULL`, values: [] };
  }
  const operators: Record<string, string> = { equal: "=", notEqual: "!=", greaterThan: ">", greaterOrEqual: ">=", lessThan: "<", lessOrEqual: "<=" };
  const sqlOperator = operators[operator];
  if (!sqlOperator) throw new Error(`Unsupported filter operator: ${operator}.`);
  return { sql: `${sqlField} ${sqlOperator} ?`, values: [typeof value === "boolean" ? Number(value) : value] };
}

function genericRelationFilter(relation: { from: string; value: string }, operator: string, rawValue: unknown): SqlExpression {
  if (!["equal", "notEqual", "in", "contains"].includes(operator)) throw new Error("Dimension filters support equal, notEqual, in, and contains.");
  const positiveOperator = operator === "notEqual" ? "equal" : operator;
  const condition = genericScalarFilter(relation.value, positiveOperator, rawValue);
  return {
    sql: `${operator === "notEqual" ? "NOT " : ""}EXISTS (SELECT 1 FROM ${relation.from} WHERE gf_j.app_id = g.app_id AND ${condition.sql})`,
    values: condition.values,
  };
}

function compileGenericFilters(value: string | null): SqlExpression[] {
  return parseArray(value).slice(0, 12).map((rawFilter) => {
    if (!rawFilter || typeof rawFilter !== "object") throw new Error("Each catalog filter must be an object.");
    const filter = rawFilter as Record<string, unknown>;
    const field = String(filter.field ?? "");
    const operator = String(filter.operator ?? "");
    if (!GENERIC_FILTER_OPERATORS.has(operator)) throw new Error(`Unsupported filter operator: ${operator || "missing"}.`);
    const relation = RELATION_FILTER_FIELDS[field];
    const sqlField = GENERIC_FILTER_FIELDS[field];
    if (!relation && !sqlField) throw new Error(`Unsupported catalog filter field: ${field || "missing"}.`);
    return relation ? genericRelationFilter(relation, operator, filter.value) : genericScalarFilter(sqlField, operator, filter.value);
  });
}

function tagMatchCountExpression(tags: string[]): SqlExpression {
  if (!tags.length) return { sql: "0", values: [] };
  return {
    sql: `(SELECT COUNT(*) FROM game_tags intent_gt JOIN tags intent_t ON intent_t.id = intent_gt.tag_id WHERE intent_gt.app_id = g.app_id AND LOWER(intent_t.name) IN (${tags.map(() => "LOWER(?)").join(", ")}))`,
    values: tags,
  };
}

function intentExpressions(params: URLSearchParams) {
  const reference = (params.get("reference") ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const includeTags = normalizedTextArray(params.get("includeTags"), 12);
  const preferredTags = normalizedTextArray(params.get("preferredTags"), 12);
  const excludeTags = normalizedTextArray(params.get("excludeTags"), 12);
  const coverageTags = [...includeTags, ...preferredTags].filter((tag, index, tags) => tags.findIndex((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index);
  const includeCount = tagMatchCountExpression(includeTags);
  const preferredCount = tagMatchCountExpression(preferredTags);
  const coverageCount = tagMatchCountExpression(coverageTags);
  const referenceTerm = reference ? "CASE WHEN INSTR(LOWER(g.name), LOWER(?)) > 0 THEN 1.0 ELSE 0.0 END" : "0.0";
  const intentDenominator = includeTags.length * 2 + preferredTags.length + (reference ? 1 : 0);
  return {
    reference,
    includeTags,
    preferredTags,
    excludeTags,
    tagCoverage: {
      sql: coverageTags.length ? `(CAST(${coverageCount.sql} AS REAL) / ${coverageTags.length})` : "0.0",
      values: coverageCount.values,
    } satisfies SqlExpression,
    intentFit: {
      sql: intentDenominator ? `((2.0 * ${includeCount.sql}) + ${preferredCount.sql} + ${referenceTerm}) / ${intentDenominator}` : "0.0",
      values: [...includeCount.values, ...preferredCount.values, ...(reference ? [reference] : [])],
    } satisfies SqlExpression,
  };
}

function rankingExpression(value: string | null, intent: ReturnType<typeof intentExpressions>): SqlExpression | null {
  const factors = parseArray(value).slice(0, 5);
  const terms: string[] = [];
  const values: Array<string | number> = [];
  let totalWeight = 0;
  for (const factor of factors) {
    if (!factor || typeof factor !== "object") continue;
    const item = factor as Record<string, unknown>;
    const field = String(item.field ?? "");
    const weight = boundedNumber(item.weight, 0, 0, 1);
    if (!weight) continue;
    const intentExpression = field === "intentFit" ? intent.intentFit : field === "tagCoverage" ? intent.tagCoverage : null;
    const normalized = intentExpression?.sql ?? RANK_NORMALIZERS[field as keyof typeof NUMERIC_FIELDS];
    if (!normalized) continue;
    const term = item.direction === "lower" ? `(1 - (${normalized}))` : `(${normalized})`;
    terms.push(`(${weight.toFixed(4)} * ${term})`);
    if (intentExpression) values.push(...intentExpression.values);
    totalWeight += weight;
  }
  if (!terms.length || totalWeight <= 0) return null;
  return { sql: `(${terms.join(" + ")}) / ${totalWeight.toFixed(4)}`, values };
}

function filters(params: URLSearchParams, intent: ReturnType<typeof intentExpressions>, selectedTagGroups: TagGroupFilter[]) {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  const search = ftsQuery((params.get("search") ?? "").slice(0, 120));
  const ownerBand = (params.get("ownerBand") ?? "All owner ranges").slice(0, 40);
  const priceBand = (params.get("priceBand") ?? "All prices").slice(0, 30);
  const genre = (params.get("genre") ?? "").slice(0, 80);
  const tag = (params.get("tag") ?? "").slice(0, 80);
  const requiredTags = normalizedTextArray(params.get("requiredTags"), 8);
  const minPositiveRatio = boundedNumber(params.get("minPositiveRatio"), -1, -1, 1);
  const minReviewCount = boundedInteger(params.get("minReviewCount"), -1, -1, 10_000_000);
  const appIds = parseArray(params.get("appIds"))
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .slice(0, 200);
  const excludeAppIds = parseArray(params.get("excludeAppIds"))
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .slice(0, 200);

  if (intent.includeTags.length) {
    clauses.push(`EXISTS (SELECT 1 FROM game_tags include_gt JOIN tags include_t ON include_t.id = include_gt.tag_id WHERE include_gt.app_id = g.app_id AND LOWER(include_t.name) IN (${intent.includeTags.map(() => "LOWER(?)").join(", ")}))`);
    values.push(...intent.includeTags);
  }
  if (intent.excludeTags.length) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM game_tags exclude_gt JOIN tags exclude_t ON exclude_t.id = exclude_gt.tag_id WHERE exclude_gt.app_id = g.app_id AND LOWER(exclude_t.name) IN (${intent.excludeTags.map(() => "LOWER(?)").join(", ")}))`);
    values.push(...intent.excludeTags);
  }

  if (appIds.length) {
    clauses.push(`g.app_id IN (${appIds.map(() => "?").join(", ")})`);
    values.push(...appIds);
  }
  if (excludeAppIds.length) {
    clauses.push(`g.app_id NOT IN (${excludeAppIds.map(() => "?").join(", ")})`);
    values.push(...excludeAppIds);
  }
  if (search) {
    clauses.push("g.app_id IN (SELECT CAST(app_id AS INTEGER) FROM game_search WHERE game_search MATCH ?)");
    values.push(search);
  }
  if (ownerBand !== "All owner ranges") {
    clauses.push("g.owners = ?");
    values.push(ownerBand);
  }
  if (priceBand !== "All prices") {
    clauses.push(`${PRICE_BAND_SQL} = ?`);
    values.push(priceBand);
  }
  if (genre) {
    clauses.push("EXISTS (SELECT 1 FROM game_genres gg JOIN genres ge ON ge.id = gg.genre_id WHERE gg.app_id = g.app_id AND ge.name = ? AND lower(trim(ge.name)) <> 'sexual content')");
    values.push(genre);
  }
  if (tag) {
    clauses.push("EXISTS (SELECT 1 FROM game_tags gt JOIN tags t ON t.id = gt.tag_id WHERE gt.app_id = g.app_id AND t.name = ?)");
    values.push(tag);
  }
  for (const requiredTag of requiredTags) {
    clauses.push("EXISTS (SELECT 1 FROM game_tags required_gt JOIN tags required_t ON required_t.id = required_gt.tag_id WHERE required_gt.app_id = g.app_id AND LOWER(required_t.name) = LOWER(?))");
    values.push(requiredTag);
  }
  for (const group of selectedTagGroups) {
    if (group.match === "any") {
      clauses.push(`g.app_id IN (SELECT group_gt.app_id FROM game_tags group_gt JOIN tags group_t ON group_t.id = group_gt.tag_id WHERE LOWER(group_t.name) IN (${group.tags.map(() => "LOWER(?)").join(", ")}))`);
      values.push(...group.tags);
      continue;
    }
    clauses.push(`g.app_id IN (SELECT group_gt.app_id FROM game_tags group_gt JOIN tags group_t ON group_t.id = group_gt.tag_id WHERE LOWER(group_t.name) IN (${group.tags.map(() => "LOWER(?)").join(", ")}) GROUP BY group_gt.app_id HAVING COUNT(DISTINCT LOWER(group_t.name)) = ?)`);
    values.push(...group.tags, group.tags.length);
  }
  if (minPositiveRatio >= 0) {
    clauses.push("g.positive_ratio >= ?");
    values.push(minPositiveRatio);
  }
  if (minReviewCount >= 0) {
    clauses.push("g.review_count >= ?");
    values.push(minReviewCount);
  }

  const numericFilters = parseArray(params.get("numericFilters")).slice(0, 8);
  for (const filter of numericFilters) {
    if (!filter || typeof filter !== "object") continue;
    const item = filter as Record<string, unknown>;
    const field = String(item.field ?? "") as keyof typeof NUMERIC_FIELDS;
    if (!(field in NUMERIC_FIELDS)) continue;
    const sqlField = NUMERIC_FIELDS[field];
    if (item.min !== undefined && item.min !== null) {
      clauses.push(`${sqlField} >= ?`);
      values.push(boundedNumber(item.min, 0, -1_000_000_000, 1_000_000_000));
    }
    if (item.max !== undefined && item.max !== null) {
      clauses.push(`${sqlField} < ?`);
      values.push(boundedNumber(item.max, 0, -1_000_000_000, 1_000_000_000));
    }
  }

  for (const filter of compileGenericFilters(params.get("filters"))) {
    clauses.push(filter.sql);
    values.push(...filter.values);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

function parseDbJsonArray(value: unknown) {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = boundedInteger(url.searchParams.get("page"), 0, 0, 100_000);
    const pageSize = boundedInteger(url.searchParams.get("pageSize"), 12, 1, 100);
    const sort = url.searchParams.get("sort") as keyof typeof SORT_FIELDS;
    const intent = intentExpressions(url.searchParams);
    const ranking = rankingExpression(url.searchParams.get("ranking"), intent);
    const sortSql = ranking ? "rankScore" : SORT_FIELDS[sort] ?? SORT_FIELDS.ownersMax;
    const direction = ranking ? "DESC" : url.searchParams.get("direction") === "asc" ? "ASC" : "DESC";
    const selectedTagGroups = tagGroupFilters(url.searchParams.get("tagGroupFilters"));
    const where = filters(url.searchParams, intent, selectedTagGroups);
    const selectedGroupTags = selectedTagGroups.flatMap((group) => group.tags)
      .filter((tag, index, tags) => tags.findIndex((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index);
    const matchedTagsSql = selectedGroupTags.length
      ? `COALESCE((SELECT json_group_array(name) FROM (SELECT t.name FROM game_tags matched_gt JOIN tags t ON t.id = matched_gt.tag_id WHERE matched_gt.app_id = g.app_id AND LOWER(t.name) IN (${selectedGroupTags.map(() => "LOWER(?)").join(", ")}) ORDER BY matched_gt.weight DESC, t.name)), '[]')`
      : "'[]'";
    const database = catalogDb();
    const pageSql = `SELECT
      g.app_id AS id,
      g.name AS title,
      g.header_image AS headerImage,
      COALESCE((SELECT group_concat(name, ', ') FROM (SELECT d.name FROM game_developers gd JOIN developers d ON d.id = gd.developer_id WHERE gd.app_id = g.app_id ORDER BY d.name)), 'Unknown developer') AS developer,
      COALESCE((SELECT group_concat(name, ', ') FROM (SELECT p.name FROM game_publishers gp JOIN publishers p ON p.id = gp.publisher_id WHERE gp.app_id = g.app_id ORDER BY p.name)), 'Unknown publisher') AS publisher,
      g.owners,
      g.owners_min AS ownersMin,
      g.owners_max AS ownersMax,
      g.price_cents AS priceCents,
      g.price_cents AS initialPriceCents,
      g.discount_percent AS discountPercent,
      g.positive,
      g.negative,
      g.review_count AS reviewCount,
      g.positive_ratio AS positiveRatio,
      g.peak_ccu AS ccu,
      g.average_forever AS averageForever,
      g.average_2weeks AS average2Weeks,
      g.median_forever AS medianForever,
      g.median_2weeks AS median2Weeks,
      g.release_date AS releaseDate,
      g.release_year AS releaseYear,
      ${ranking?.sql ?? "NULL"} AS rankScore,
      ${intent.intentFit.sql} AS intentFit,
      ${intent.tagCoverage.sql} AS tagCoverage,
      COALESCE((SELECT json_group_array(name) FROM (SELECT ge.name FROM game_genres gg JOIN genres ge ON ge.id = gg.genre_id WHERE gg.app_id = g.app_id AND lower(trim(ge.name)) <> 'sexual content' ORDER BY ge.name)), '[]') AS genres,
      COALESCE((SELECT json_group_array(name) FROM (SELECT t.name FROM game_tags gt JOIN tags t ON t.id = gt.tag_id WHERE gt.app_id = g.app_id ORDER BY gt.weight DESC, t.name LIMIT 12)), '[]') AS tags,
      ${matchedTagsSql} AS matchedTags
    FROM games g
    ${where.sql}
    ORDER BY ${sortSql} ${direction}, g.app_id ASC
    LIMIT ? OFFSET ?`;

    const statements = [
      database.prepare(`SELECT COUNT(*) AS total FROM games g ${where.sql}`).bind(...where.values),
      database.prepare(pageSql).bind(...(ranking?.values ?? []), ...intent.intentFit.values, ...intent.tagCoverage.values, ...selectedGroupTags, ...where.values, pageSize, page * pageSize),
      database.prepare("SELECT schema_version AS schemaVersion, source_filename AS sourceFilename, source_sha256 AS sourceSha256, imported_at AS importedAt, record_count AS recordCount FROM catalog_imports ORDER BY id DESC LIMIT 1"),
      database.prepare(`SELECT g.owners AS label, COUNT(*) AS value FROM games g ${where.sql} GROUP BY g.owners ORDER BY MAX(g.owners_max) DESC`).bind(...where.values),
      database.prepare(`SELECT ${REVIEW_BAND_SQL} AS label, COUNT(*) AS value FROM games g ${where.sql} GROUP BY label ORDER BY MIN(CASE label WHEN '95%+ positive' THEN 1 WHEN '90–94% positive' THEN 2 WHEN '80–89% positive' THEN 3 WHEN '70–79% positive' THEN 4 WHEN 'Below 70%' THEN 5 ELSE 6 END)`).bind(...where.values),
      database.prepare(`SELECT ${PRICE_BAND_SQL} AS label, COUNT(*) AS value FROM games g ${where.sql} GROUP BY label ORDER BY MIN(g.price_cents)`).bind(...where.values),
      database.prepare("SELECT ge.name AS label, COUNT(*) AS value FROM game_genres gg JOIN genres ge ON ge.id = gg.genre_id WHERE lower(trim(ge.name)) <> 'sexual content' GROUP BY ge.id ORDER BY value DESC, ge.name LIMIT 40"),
      database.prepare("SELECT t.name AS label, COUNT(*) AS value FROM game_tags gt JOIN tags t ON t.id = gt.tag_id GROUP BY t.id ORDER BY value DESC, t.name LIMIT 60"),
    ];
    const [countResult, gamesResult, importResult, ownersResult, reviewsResult, priceResult, genresResult, tagsResult] = await database.batch(statements);
    const total = Number((countResult.results[0] as { total?: number } | undefined)?.total ?? 0);
    const imported = importResult.results[0] as Record<string, unknown> | undefined;
    const games = (gamesResult.results as Array<Record<string, unknown>>).map((game) => ({ ...game, genres: parseDbJsonArray(game.genres), tags: parseDbJsonArray(game.tags), matchedTags: parseDbJsonArray(game.matchedTags) }));
    return NextResponse.json({
      schemaVersion: "adaptive-interfaces.catalog-page/v1",
      meta: {
        recordCount: Number(imported?.recordCount ?? total),
        importedAt: String(imported?.importedAt ?? ""),
        sourceFilename: String(imported?.sourceFilename ?? "games.json"),
        sourceSha256: String(imported?.sourceSha256 ?? ""),
      },
      query: { total, page, pageSize, ranked: Boolean(ranking) },
      games,
      distributions: { owners: ownersResult.results, reviews: reviewsResult.results, price: priceResult.results },
      facets: { genres: genresResult.results, tags: tagsResult.results },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Catalog query failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
