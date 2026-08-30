import type {
  AggregateMeasure,
  SortField,
  WindowMeasure,
} from "@/app/catalog-analytics";
import type {
  EngagementAnalyticsBinding,
  EngagementAnalyticsOperation,
  EngagementSourceFilters,
} from "@/app/engagement-analytics";

const SESSION_FIELDS = new Set([
  "sessionId", "userId", "productId", "productTitle", "sessionDate", "startedAt",
  "durationSeconds", "durationMinutes", "deviceType", "shop", "shopRegion",
  "supplier", "brand", "productCategory", "productClass", "firstName", "lastName",
  "email", "sex", "customerType", "city", "region", "customerStatus",
  "signedUp", "activated", "subscribed",
]);

function identifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function requireFields(available: Set<string>, fields: Array<string | undefined>) {
  for (const field of fields) if (field && !available.has(field)) throw new Error(`Unknown analytics field: ${field}.`);
}

function listFilter(column: string, items: string[], values: Array<string | number>) {
  if (!items.length) return "";
  values.push(...items);
  return `${column} IN (${items.map(() => "?").join(", ")})`;
}

function relationshipFilter(sql: string, items: string[], values: Array<string | number>) {
  if (!items.length) return "";
  values.push(...items);
  return `EXISTS (${sql} IN (${items.map(() => "?").join(", ")}))`;
}

function sessionSource(filters: EngagementSourceFilters, values: Array<string | number>) {
  const clauses = ["date(es.started_at) BETWEEN ? AND ?"];
  values.push(filters.dateFrom, filters.dateTo);
  const simple = [
    listFilter("sh.name", filters.shops, values),
    listFilter("eu.sex", filters.sexes, values),
    listFilter("eu.customer_type", filters.customerTypes, values),
    listFilter("es.device_type", filters.devices, values),
  ].filter(Boolean);
  clauses.push(...simple);

  const relationships = [
    relationshipFilter("SELECT p.name FROM game_publishers gp JOIN publishers p ON p.id = gp.publisher_id WHERE gp.app_id = es.app_id AND p.name", filters.suppliers, values),
    relationshipFilter("SELECT ge.name FROM game_genres gg JOIN genres ge ON ge.id = gg.genre_id WHERE gg.app_id = es.app_id AND lower(trim(ge.name)) <> 'sexual content' AND ge.name", filters.productCategories, values),
    relationshipFilter("SELECT d.name FROM game_developers gd JOIN developers d ON d.id = gd.developer_id WHERE gd.app_id = es.app_id AND d.name", filters.brands, values),
    relationshipFilter("SELECT c.name FROM game_categories gc JOIN categories c ON c.id = gc.category_id WHERE gc.app_id = es.app_id AND c.name", filters.productClasses, values),
  ].filter(Boolean);
  clauses.push(...relationships);

  return `SELECT
    es.id AS sessionId,
    es.user_id AS userId,
    es.app_id AS productId,
    g.name AS productTitle,
    date(es.started_at) AS sessionDate,
    es.started_at AS startedAt,
    es.duration_seconds AS durationSeconds,
    es.duration_seconds / 60.0 AS durationMinutes,
    es.device_type AS deviceType,
    sh.name AS shop,
    sh.region AS shopRegion,
    COALESCE((SELECT p.name FROM game_publishers gp JOIN publishers p ON p.id = gp.publisher_id WHERE gp.app_id = es.app_id ORDER BY p.name LIMIT 1), 'Unknown supplier') AS supplier,
    COALESCE((SELECT d.name FROM game_developers gd JOIN developers d ON d.id = gd.developer_id WHERE gd.app_id = es.app_id ORDER BY d.name LIMIT 1), 'Unknown brand') AS brand,
    COALESCE((SELECT ge.name FROM game_genres gg JOIN genres ge ON ge.id = gg.genre_id WHERE gg.app_id = es.app_id AND lower(trim(ge.name)) <> 'sexual content' ORDER BY ge.name LIMIT 1), 'Uncategorized') AS productCategory,
    COALESCE((SELECT c.name FROM game_categories gc JOIN categories c ON c.id = gc.category_id WHERE gc.app_id = es.app_id ORDER BY c.name LIMIT 1), 'Unclassified') AS productClass,
    eu.first_name AS firstName,
    eu.last_name AS lastName,
    eu.email,
    eu.sex,
    eu.customer_type AS customerType,
    eu.city,
    eu.region,
    eu.status AS customerStatus,
    es.signed_up AS signedUp,
    es.activated,
    es.subscribed
  FROM engagement_sessions es
  JOIN engagement_users eu ON eu.id = es.user_id
  JOIN engagement_shops sh ON sh.id = es.shop_id
  JOIN games g ON g.app_id = es.app_id
  WHERE ${clauses.join(" AND ")}`;
}

function source(binding: EngagementAnalyticsBinding, values: Array<string | number>) {
  const sessions = sessionSource(binding.source.filters, values);
  if (binding.source.view === "sessions") return sessions;
  return `SELECT base.*, stages.stage, stages.stageOrder
  FROM (${sessions}) base
  JOIN (
    SELECT 'Visitors' AS stage, 1 AS stageOrder
    UNION ALL SELECT 'Sign-ups', 2
    UNION ALL SELECT 'Active', 3
    UNION ALL SELECT 'Subscribed', 4
  ) stages
    ON stages.stageOrder = 1
    OR stages.stageOrder = 2 AND base.signedUp = 1
    OR stages.stageOrder = 3 AND base.activated = 1
    OR stages.stageOrder = 4 AND base.subscribed = 1`;
}

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

function windowExpression(measure: WindowMeasure, partition: string, ordering: string) {
  const base = measure.function === "rowNumber" ? "ROW_NUMBER()" : measure.function === "rank" ? "RANK()" : measure.function === "denseRank" ? "DENSE_RANK()" : measure.function === "percentRank" ? "PERCENT_RANK()" : measure.function === "lag" ? `LAG(${identifier(measure.field!)}, ${measure.offset})` : measure.function === "lead" ? `LEAD(${identifier(measure.field!)}, ${measure.offset})` : measure.function === "mean" ? `AVG(${identifier(measure.field!)})` : measure.function === "sum" ? `SUM(${identifier(measure.field!)})` : "";
  if (!base) throw new Error(`Window function ${measure.function} is not supported by the database compiler.`);
  const frame = measure.frame === "cumulative" ? "ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW" : measure.frame === "rolling" ? `ROWS BETWEEN ${measure.rows - 1} PRECEDING AND CURRENT ROW` : "ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING";
  return `${base} OVER (${partition}${partition && ordering ? " " : ""}${ordering}${ordering ? ` ${frame}` : ""})`;
}

function filter(operation: Extract<EngagementAnalyticsOperation, { operation: "filter" }>, values: Array<string | number>) {
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

export function compileEngagementReport(binding: EngagementAnalyticsBinding) {
  const values: Array<string | number> = [];
  const ctes: string[] = [`s0 AS (${source(binding, values)})`];
  let current = "s0";
  let available = new Set(SESSION_FIELDS);
  if (binding.source.view === "funnel") { available.add("stage"); available.add("stageOrder"); }
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
    if (operation.operation === "calculate") {
      requireFields(available, [operation.left, operation.right.field]);
      const right = operation.right.field ? identifier(operation.right.field) : String(operation.right.value);
      const symbol = { add: "+", subtract: "-", multiply: "*", divide: "/" }[operation.operator];
      const expression = operation.operator === "divide" ? `${identifier(operation.left)} / NULLIF(${right}, 0)` : `${identifier(operation.left)} ${symbol} ${right}`;
      next(`SELECT ${current}.*, ${expression} AS ${identifier(operation.as)} FROM ${current}`);
      available.add(operation.as);
    } else if (operation.operation === "filter") {
      requireFields(available, [operation.field]);
      next(`SELECT * FROM ${current} WHERE ${filter(operation, values)}`);
    } else if (operation.operation === "sort") {
      requireFields(available, operation.fields.map((item) => item.field));
      next(`SELECT * FROM ${current} ORDER BY ${order(operation.fields)}`);
    } else if (operation.operation === "limit") {
      next(`SELECT * FROM ${current} LIMIT ${operation.count}`);
    } else if (operation.operation === "window") {
      requireFields(available, [...operation.partitionBy, ...operation.sortBy.map((item) => item.field), ...operation.measures.map((item) => item.field)]);
      const partition = operation.partitionBy.length ? `PARTITION BY ${operation.partitionBy.map(identifier).join(", ")}` : "";
      const ordering = operation.sortBy.length ? `ORDER BY ${order(operation.sortBy)}` : "";
      const expressions = operation.measures.map((item) => `${windowExpression(item, partition, ordering)} AS ${identifier(item.as)}`);
      next(`SELECT ${current}.*, ${expressions.join(", ")} FROM ${current}`);
      for (const item of operation.measures) available.add(item.as);
    }
  }
  if (pendingGroups.length) throw new Error("A groupBy operation must be followed by aggregate.");
  requireFields(available, [binding.encoding.x, binding.encoding.y, binding.encoding.labels, binding.encoding.values, binding.encoding.text, binding.encoding.series, ...binding.encoding.hover]);
  return { sql: `WITH ${ctes.join(",\n")} SELECT * FROM ${current} LIMIT ${binding.resultLimit}`, values };
}
