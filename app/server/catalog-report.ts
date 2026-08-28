import type { AggregateMeasure, CatalogAnalyticsBinding, CatalogAnalyticsOperation, ExplodeField, SortField, WindowMeasure } from "@/app/catalog-analytics";

const BASE_FIELDS = new Set(["id", "title", "developer", "publisher", "owners", "ownersMin", "ownersMax", "priceCents", "discountPercent", "positive", "negative", "reviewCount", "positiveRatio", "ccu", "averageForever", "average2Weeks", "medianForever", "median2Weeks", "releaseDate", "releaseYear", "requiredAge", "dlcCount", "metacriticScore", "userScore", "achievements", "recommendations", "windows", "mac", "linux", "ownerBand", "priceBand", "reviewBand", "activityBand"]);

const PRICE_BAND = `CASE WHEN g.price_cents = 0 THEN 'Free' WHEN g.price_cents < 1000 THEN 'Under $10' WHEN g.price_cents < 3000 THEN '$10–$29.99' WHEN g.price_cents < 6000 THEN '$30–$59.99' ELSE '$60+' END`;
const REVIEW_BAND = `CASE WHEN g.positive_ratio IS NULL THEN 'No reviews' WHEN g.positive_ratio >= 0.95 THEN '95%+ positive' WHEN g.positive_ratio >= 0.9 THEN '90–94% positive' WHEN g.positive_ratio >= 0.8 THEN '80–89% positive' WHEN g.positive_ratio >= 0.7 THEN '70–79% positive' ELSE 'Below 70%' END`;
const ACTIVITY_BAND = `CASE WHEN g.peak_ccu >= 100000 THEN '100K+ playing' WHEN g.peak_ccu >= 10000 THEN '10K–99K playing' WHEN g.peak_ccu >= 1000 THEN '1K–9.9K playing' WHEN g.peak_ccu >= 100 THEN '100–999 playing' WHEN g.peak_ccu > 0 THEN 'Under 100 playing' ELSE 'No players reported' END`;

function identifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function requireFields(available: Set<string>, fields: Array<string | undefined>) {
  for (const field of fields) if (field && !available.has(field)) throw new Error(`Unknown analytics field: ${field}.`);
}

function ftsQuery(value: string) {
  return (value.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
}

function source(binding: CatalogAnalyticsBinding, values: Array<string | number>) {
  const filters = binding.source.filters;
  const clauses: string[] = [];
  const search = ftsQuery(filters.query);
  if (search) { clauses.push("g.app_id IN (SELECT CAST(app_id AS INTEGER) FROM game_search WHERE game_search MATCH ?)"); values.push(search); }
  if (filters.ownerBand !== "All owner ranges") { clauses.push("g.owners = ?"); values.push(filters.ownerBand); }
  if (filters.priceBand !== "All prices") { clauses.push(`${PRICE_BAND} = ?`); values.push(filters.priceBand); }
  if (filters.minPositiveRatio > 0) { clauses.push("COALESCE(g.positive_ratio, 0) >= ?"); values.push(filters.minPositiveRatio); }
  if (filters.minCcu > 0) { clauses.push("g.peak_ccu >= ?"); values.push(filters.minCcu); }
  for (const genre of filters.genres) { clauses.push("g.app_id IN (SELECT fg.app_id FROM game_genres fg JOIN genres fge ON fge.id = fg.genre_id WHERE fge.name = ?)"); values.push(genre); }
  for (const tag of filters.tags) { clauses.push("g.app_id IN (SELECT ft.app_id FROM game_tags ft JOIN tags fta ON fta.id = ft.tag_id WHERE fta.name = ?)"); values.push(tag); }
  for (const category of filters.categories) { clauses.push("g.app_id IN (SELECT fc.app_id FROM game_categories fc JOIN categories fca ON fca.id = fc.category_id WHERE fca.name = ?)"); values.push(category); }
  return `SELECT
    g.app_id AS id, g.name AS title,
    COALESCE((SELECT group_concat(name, ', ') FROM (SELECT d.name FROM game_developers gd JOIN developers d ON d.id = gd.developer_id WHERE gd.app_id = g.app_id ORDER BY d.name)), 'Unknown developer') AS developer,
    COALESCE((SELECT group_concat(name, ', ') FROM (SELECT p.name FROM game_publishers gp JOIN publishers p ON p.id = gp.publisher_id WHERE gp.app_id = g.app_id ORDER BY p.name)), 'Unknown publisher') AS publisher,
    g.owners, g.owners_min AS ownersMin, g.owners_max AS ownersMax, g.price_cents AS priceCents, g.discount_percent AS discountPercent,
    g.positive, g.negative, g.review_count AS reviewCount, g.positive_ratio AS positiveRatio, g.peak_ccu AS ccu,
    g.average_forever AS averageForever, g.average_2weeks AS average2Weeks, g.median_forever AS medianForever, g.median_2weeks AS median2Weeks,
    g.release_date AS releaseDate, g.release_year AS releaseYear, g.required_age AS requiredAge, g.dlc_count AS dlcCount,
    g.metacritic_score AS metacriticScore, g.user_score AS userScore, g.achievements, g.recommendations,
    g.windows, g.mac, g.linux, g.owners AS ownerBand, ${PRICE_BAND} AS priceBand, ${REVIEW_BAND} AS reviewBand, ${ACTIVITY_BAND} AS activityBand
  FROM games g${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}`;
}

const EXPLODES: Record<ExplodeField, { join: (sourceName: string) => string; value: string; additions?: string[] }> = {
  genres: { join: (s) => `JOIN game_genres xj ON xj.app_id = ${s}.id JOIN genres xd ON xd.id = xj.genre_id`, value: "xd.name" },
  tags: { join: (s) => `JOIN game_tags xj ON xj.app_id = ${s}.id JOIN tags xd ON xd.id = xj.tag_id`, value: "xd.name", additions: ["xj.weight AS tagWeight"] },
  categories: { join: (s) => `JOIN game_categories xj ON xj.app_id = ${s}.id JOIN categories xd ON xd.id = xj.category_id`, value: "xd.name" },
  developers: { join: (s) => `JOIN game_developers xj ON xj.app_id = ${s}.id JOIN developers xd ON xd.id = xj.developer_id`, value: "xd.name" },
  publishers: { join: (s) => `JOIN game_publishers xj ON xj.app_id = ${s}.id JOIN publishers xd ON xd.id = xj.publisher_id`, value: "xd.name" },
  languages: { join: (s) => `JOIN game_languages xj ON xj.app_id = ${s}.id JOIN languages xd ON xd.id = xj.language_id`, value: "xd.name" },
};

function aggregate(measure: AggregateMeasure, sourceName: string) {
  if (measure.function === "count") return "COUNT(*)";
  const field = identifier(measure.field!);
  if (measure.function === "valid") return `COUNT(${field})`;
  if (measure.function === "distinct") return `COUNT(DISTINCT ${field})`;
  if (measure.function === "sum") return `SUM(${field})`;
  if (measure.function === "mean") return `AVG(${field})`;
  if (measure.function === "min") return `MIN(${field})`;
  if (measure.function === "max") return `MAX(${field})`;
  if (measure.function === "variance") return `(SUM(${field} * ${field}) - SUM(${field}) * SUM(${field}) / NULLIF(COUNT(${field}), 0)) / NULLIF(COUNT(${field}) - 1, 0)`;
  if (measure.function === "stdev") return `sqrt((SUM(${field} * ${field}) - SUM(${field}) * SUM(${field}) / NULLIF(COUNT(${field}), 0)) / NULLIF(COUNT(${field}) - 1, 0))`;
  if (measure.function === "corr") {
    const field2 = identifier(measure.field2!);
    return `(COUNT(${field}) * SUM(${field} * ${field2}) - SUM(${field}) * SUM(${field2})) / NULLIF(sqrt((COUNT(${field}) * SUM(${field} * ${field}) - SUM(${field}) * SUM(${field})) * (COUNT(${field2}) * SUM(${field2} * ${field2}) - SUM(${field2}) * SUM(${field2}))), 0)`;
  }
  if (measure.function === "median") return `(SELECT AVG(value) FROM (SELECT ${field} AS value FROM ${sourceName} WHERE ${field} IS NOT NULL ORDER BY ${field} LIMIT (2 - (SELECT COUNT(${field}) FROM ${sourceName} WHERE ${field} IS NOT NULL) % 2) OFFSET ((SELECT COUNT(${field}) FROM ${sourceName} WHERE ${field} IS NOT NULL) - 1) / 2))`;
  const parameter = measure.parameter ?? 0.5;
  return `(SELECT ${field} FROM ${sourceName} WHERE ${field} IS NOT NULL ORDER BY ${field} LIMIT 1 OFFSET CAST(((SELECT COUNT(${field}) FROM ${sourceName} WHERE ${field} IS NOT NULL) - 1) * ${parameter} AS INTEGER))`;
}

function windowExpression(measure: WindowMeasure, partition: string, order: string) {
  const base = measure.function === "rowNumber" ? "ROW_NUMBER()" : measure.function === "rank" ? "RANK()" : measure.function === "denseRank" ? "DENSE_RANK()" : measure.function === "percentRank" ? "PERCENT_RANK()" : measure.function === "lag" ? `LAG(${identifier(measure.field!)}, ${measure.offset})` : measure.function === "lead" ? `LEAD(${identifier(measure.field!)}, ${measure.offset})` : measure.function === "mean" ? `AVG(${identifier(measure.field!)})` : measure.function === "sum" ? `SUM(${identifier(measure.field!)})` : "";
  if (!base) throw new Error(`Window function ${measure.function} is not supported by the database compiler.`);
  const frame = measure.frame === "cumulative" ? "ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW" : measure.frame === "rolling" ? `ROWS BETWEEN ${measure.rows - 1} PRECEDING AND CURRENT ROW` : "ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING";
  return `${base} OVER (${partition}${partition && order ? " " : ""}${order}${order ? ` ${frame}` : ""})`;
}

function filter(operation: Extract<CatalogAnalyticsOperation, { operation: "filter" }>, values: Array<string | number>) {
  const field = identifier(operation.field);
  if (operation.operator === "in") {
    if (!Array.isArray(operation.value) || !operation.value.length) return "0 = 1";
    const members = operation.value.slice(0, 30);
    values.push(...members.map((value) => value === null ? "" : typeof value === "boolean" ? Number(value) : value as string | number));
    return `${field} IN (${members.map(() => "?").join(", ")})`;
  }
  const operators = { equal: "=", notEqual: "!=", greaterThan: ">", greaterOrEqual: ">=", lessThan: "<", lessOrEqual: "<=" } as const;
  if (operation.value === null) return `${field} IS ${operation.operator === "notEqual" ? "NOT " : ""}NULL`;
  values.push(typeof operation.value === "boolean" ? Number(operation.value) : operation.value as string | number);
  return `${field} ${operators[operation.operator]} ?`;
}

function order(fields: SortField[]) {
  return fields.map((item) => `${identifier(item.field)} ${item.direction === "descending" ? "DESC" : "ASC"}`).join(", ");
}

export function compileCatalogReport(binding: CatalogAnalyticsBinding) {
  const values: Array<string | number> = [];
  const ctes: string[] = [`s0 AS (${source(binding, values)})`];
  let current = "s0";
  let available = new Set(BASE_FIELDS);
  let pendingGroups: string[] = [];
  let step = 0;
  const next = (sql: string) => { step += 1; current = `s${step}`; ctes.push(`${current} AS (${sql})`); };

  for (const operation of binding.pipeline) {
    if (operation.operation === "groupBy") { requireFields(available, operation.fields); pendingGroups = operation.fields; continue; }
    if (operation.operation === "aggregate") {
      requireFields(available, [...pendingGroups, ...operation.measures.flatMap((item) => [item.field, item.field2])]);
      if (pendingGroups.length && operation.measures.some((item) => item.function === "median" || item.function === "quantile")) throw new Error("Grouped median and quantile are not supported; filter to one group or use mean.");
      const groups = pendingGroups.map(identifier);
      const measures = operation.measures.map((item) => `${aggregate(item, current)} AS ${identifier(item.as)}`);
      next(`SELECT ${[...groups, ...measures].join(", ")} FROM ${current}${groups.length ? ` GROUP BY ${groups.join(", ")}` : ""}`);
      available = new Set([...pendingGroups, ...operation.measures.map((item) => item.as)]);
      pendingGroups = [];
      continue;
    }
    if (pendingGroups.length) throw new Error("A groupBy operation must be followed immediately by aggregate.");
    if (operation.operation === "explode") {
      const exploded = EXPLODES[operation.field];
      next(`SELECT ${current}.*, ${exploded.value} AS ${identifier(operation.as)}${exploded.additions?.length ? `, ${exploded.additions.join(", ")}` : ""} FROM ${current} ${exploded.join(current)}`);
      available.add(operation.as); if (operation.field === "tags") available.add("tagWeight");
    } else if (operation.operation === "calculate") {
      requireFields(available, [operation.left, operation.right.field]);
      const right = operation.right.field ? identifier(operation.right.field) : String(operation.right.value);
      const symbol = { add: "+", subtract: "-", multiply: "*", divide: "/" }[operation.operator];
      const expression = operation.operator === "divide" ? `${identifier(operation.left)} / NULLIF(${right}, 0)` : `${identifier(operation.left)} ${symbol} ${right}`;
      next(`SELECT ${current}.*, ${expression} AS ${identifier(operation.as)} FROM ${current}`); available.add(operation.as);
    } else if (operation.operation === "filter") {
      requireFields(available, [operation.field]); next(`SELECT * FROM ${current} WHERE ${filter(operation, values)}`);
    } else if (operation.operation === "sort") {
      requireFields(available, operation.fields.map((item) => item.field)); next(`SELECT * FROM ${current} ORDER BY ${order(operation.fields)}`);
    } else if (operation.operation === "limit") {
      next(`SELECT * FROM ${current} LIMIT ${operation.count}`);
    } else if (operation.operation === "window") {
      requireFields(available, [...operation.partitionBy, ...operation.sortBy.map((item) => item.field), ...operation.measures.map((item) => item.field)]);
      const partition = operation.partitionBy.length ? `PARTITION BY ${operation.partitionBy.map(identifier).join(", ")}` : "";
      const ordering = operation.sortBy.length ? `ORDER BY ${order(operation.sortBy)}` : "";
      const expressions = operation.measures.map((item) => `${windowExpression(item, partition, ordering)} AS ${identifier(item.as)}`);
      next(`SELECT ${current}.*, ${expressions.join(", ")} FROM ${current}`); for (const item of operation.measures) available.add(item.as);
    }
  }
  if (pendingGroups.length) throw new Error("A groupBy operation must be followed by aggregate.");
  requireFields(available, [binding.encoding.x, binding.encoding.y, binding.encoding.labels, binding.encoding.values, binding.encoding.text, binding.encoding.series, ...binding.encoding.hover]);
  return { sql: `WITH ${ctes.join(",\n")} SELECT * FROM ${current} LIMIT ${binding.resultLimit}`, values };
}
