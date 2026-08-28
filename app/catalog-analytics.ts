export const CATALOG_FIELD_CATALOG = [
  { name: "id", type: "integer", description: "Steam application ID." },
  { name: "title", type: "string", description: "Game title." },
  { name: "developer", type: "string", description: "Comma-separated developer names." },
  { name: "publisher", type: "string", description: "Comma-separated publisher names." },
  { name: "owners", type: "string", description: "Estimated-owner range as published." },
  { name: "ownersMin", type: "integer", description: "Lower owner estimate.", unit: "owners" },
  { name: "ownersMax", type: "integer", description: "Upper owner estimate.", unit: "owners" },
  { name: "priceCents", type: "integer", description: "Listed price in US cents.", unit: "USD cents" },
  { name: "discountPercent", type: "number", description: "Current discount percentage.", unit: "percent" },
  { name: "positive", type: "integer", description: "Positive review count.", unit: "reviews" },
  { name: "negative", type: "integer", description: "Negative review count.", unit: "reviews" },
  { name: "reviewCount", type: "integer", description: "Positive plus negative reviews.", unit: "reviews" },
  { name: "positiveRatio", type: ["number", "null"], description: "Positive review share from 0 to 1.", unit: "ratio" },
  { name: "ccu", type: "integer", description: "Peak concurrent players in the source catalog.", unit: "players" },
  { name: "averageForever", type: "integer", description: "Average all-time playtime.", unit: "minutes" },
  { name: "average2Weeks", type: "integer", description: "Average two-week playtime.", unit: "minutes" },
  { name: "medianForever", type: "integer", description: "Median all-time playtime.", unit: "minutes" },
  { name: "median2Weeks", type: "integer", description: "Median two-week playtime.", unit: "minutes" },
  { name: "releaseDate", type: ["string", "null"], description: "ISO release date." },
  { name: "releaseYear", type: ["integer", "null"], description: "Release year." },
  { name: "requiredAge", type: "integer", description: "Minimum required age." },
  { name: "dlcCount", type: "integer", description: "DLC count." },
  { name: "metacriticScore", type: "integer", description: "Metacritic score, or zero when unavailable." },
  { name: "userScore", type: "integer", description: "Reported user score, or zero when unavailable." },
  { name: "achievements", type: "integer", description: "Achievement count." },
  { name: "recommendations", type: "integer", description: "Recommendation count." },
  { name: "windows", type: "boolean", description: "Whether Windows is supported." },
  { name: "mac", type: "boolean", description: "Whether macOS is supported." },
  { name: "linux", type: "boolean", description: "Whether Linux is supported." },
  { name: "ownerBand", type: "string", description: "Derived owner-range category." },
  { name: "priceBand", type: "string", description: "Derived price category." },
  { name: "reviewBand", type: "string", description: "Derived review-sentiment category." },
  { name: "activityBand", type: "string", description: "Derived player-activity category." },
  { name: "genre", type: "string", description: "Genre created by explode(genres)." },
  { name: "tag", type: "string", description: "Community tag created by explode(tags)." },
  { name: "tagWeight", type: "integer", description: "Vote weight for an exploded tag." },
  { name: "category", type: "string", description: "Store category created by explode(categories)." },
  { name: "language", type: "string", description: "Supported language created by explode(languages)." },
] as const;

export const OWNER_BANDS = ["100,000,000 .. 200,000,000", "50,000,000 .. 100,000,000", "20,000,000 .. 50,000,000", "10,000,000 .. 20,000,000", "5,000,000 .. 10,000,000", "2,000,000 .. 5,000,000", "1,000,000 .. 2,000,000", "500,000 .. 1,000,000", "200,000 .. 500,000", "100,000 .. 200,000", "50,000 .. 100,000", "20,000 .. 50,000", "0 .. 20,000", "0 .. 0"] as const;
export const PRICE_BANDS = ["Free", "Under $10", "$10–$29.99", "$30–$59.99", "$60+"] as const;

export type CatalogSourceFilters = { query: string; ownerBand: string; priceBand: string; minPositiveRatio: number; minCcu: number; genres: string[]; tags: string[]; categories: string[] };
export type SortField = { field: string; direction: "ascending" | "descending" };
export type AggregateFunction = "count" | "valid" | "distinct" | "sum" | "mean" | "median" | "min" | "max" | "quantile" | "stdev" | "variance" | "corr";
export type AggregateMeasure = { function: AggregateFunction; field?: string; field2?: string; parameter?: number; as: string };
export type WindowFunction = "rowNumber" | "rank" | "denseRank" | "percentRank" | "mean" | "sum" | "median" | "stdev" | "lag" | "lead";
export type WindowMeasure = { function: WindowFunction; field?: string; offset: number; frame: "partition" | "cumulative" | "rolling"; rows: number; as: string };
export type FilterValue = string | number | boolean | null | Array<string | number | boolean | null>;
export type ExplodeField = "genres" | "tags" | "categories" | "developers" | "publishers" | "languages";

export type CatalogAnalyticsOperation =
  | { operation: "explode"; field: ExplodeField; as: string }
  | { operation: "groupBy"; fields: string[] }
  | { operation: "aggregate"; measures: AggregateMeasure[] }
  | { operation: "window"; partitionBy: string[]; sortBy: SortField[]; measures: WindowMeasure[] }
  | { operation: "calculate"; as: string; operator: "add" | "subtract" | "multiply" | "divide"; left: string; right: { field?: string; value?: number } }
  | { operation: "filter"; field: string; operator: "equal" | "notEqual" | "greaterThan" | "greaterOrEqual" | "lessThan" | "lessOrEqual" | "in"; value: FilterValue }
  | { operation: "sort"; fields: SortField[] }
  | { operation: "limit"; count: number };

export type CatalogAnalyticsBinding = {
  source: { name: "steam_catalog"; filters: CatalogSourceFilters };
  pipeline: CatalogAnalyticsOperation[];
  encoding: { x?: string; y?: string; labels?: string; values?: string; text?: string; series?: string; hover: string[] };
  resultLimit: number;
};

const MAX_RESULT_ROWS = 2_000;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const EXPLODE_FIELDS: ExplodeField[] = ["genres", "tags", "categories", "developers", "publishers", "languages"];
const AGGREGATE_FUNCTIONS: AggregateFunction[] = ["count", "valid", "distinct", "sum", "mean", "median", "min", "max", "quantile", "stdev", "variance", "corr"];
const WINDOW_FUNCTIONS: WindowFunction[] = ["rowNumber", "rank", "denseRank", "percentRank", "mean", "sum", "median", "stdev", "lag", "lead"];
const FILTER_OPERATORS = ["equal", "notEqual", "greaterThan", "greaterOrEqual", "lessThan", "lessOrEqual", "in"] as const;
const analyticFieldSchema = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" };
const sortFieldSchema = { type: "object", additionalProperties: false, properties: { field: analyticFieldSchema, direction: { type: "string", enum: ["ascending", "descending"] } }, required: ["field", "direction"] };

export const CATALOG_ANALYTICS_BINDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    source: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", const: "steam_catalog" },
        filters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", maxLength: 120 }, ownerBand: { type: "string", enum: ["All owner ranges", ...OWNER_BANDS] }, priceBand: { type: "string", enum: ["All prices", ...PRICE_BANDS] }, minPositiveRatio: { type: "number", minimum: 0, maximum: 1 }, minCcu: { type: "integer", minimum: 0 },
            genres: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 80 } }, tags: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 80 } }, categories: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 80 } },
          },
          required: ["query", "ownerBand", "priceBand", "minPositiveRatio", "minCcu", "genres", "tags", "categories"],
        },
      },
      required: ["name", "filters"],
    },
    pipeline: { type: "array", maxItems: 12, items: { oneOf: [
      { type: "object", additionalProperties: false, properties: { operation: { const: "explode" }, field: { enum: EXPLODE_FIELDS }, as: analyticFieldSchema }, required: ["operation", "field", "as"] },
      { type: "object", additionalProperties: false, properties: { operation: { const: "groupBy" }, fields: { type: "array", minItems: 1, maxItems: 4, items: analyticFieldSchema } }, required: ["operation", "fields"] },
      { type: "object", additionalProperties: false, properties: { operation: { const: "aggregate" }, measures: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, properties: { function: { enum: AGGREGATE_FUNCTIONS }, field: analyticFieldSchema, field2: analyticFieldSchema, parameter: { type: "number", minimum: 0, maximum: 1 }, as: analyticFieldSchema }, required: ["function", "as"] } } }, required: ["operation", "measures"] },
      { type: "object", additionalProperties: false, properties: { operation: { const: "window" }, partitionBy: { type: "array", maxItems: 4, items: analyticFieldSchema }, sortBy: { type: "array", maxItems: 4, items: sortFieldSchema }, measures: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, properties: { function: { enum: WINDOW_FUNCTIONS }, field: analyticFieldSchema, offset: { type: "integer", minimum: 1, maximum: 100 }, frame: { enum: ["partition", "cumulative", "rolling"] }, rows: { type: "integer", minimum: 1, maximum: 100 }, as: analyticFieldSchema }, required: ["function", "as"] } } }, required: ["operation", "partitionBy", "sortBy", "measures"] },
      { type: "object", additionalProperties: false, properties: { operation: { const: "calculate" }, as: analyticFieldSchema, operator: { enum: ["add", "subtract", "multiply", "divide"] }, left: analyticFieldSchema, right: { type: "object", additionalProperties: false, properties: { field: analyticFieldSchema, value: { type: "number" } } } }, required: ["operation", "as", "operator", "left", "right"] },
      { type: "object", additionalProperties: false, properties: { operation: { const: "filter" }, field: analyticFieldSchema, operator: { enum: FILTER_OPERATORS }, value: {} }, required: ["operation", "field", "operator", "value"] },
      { type: "object", additionalProperties: false, properties: { operation: { const: "sort" }, fields: { type: "array", minItems: 1, maxItems: 4, items: sortFieldSchema } }, required: ["operation", "fields"] },
      { type: "object", additionalProperties: false, properties: { operation: { const: "limit" }, count: { type: "integer", minimum: 1, maximum: MAX_RESULT_ROWS } }, required: ["operation", "count"] },
    ] } },
    encoding: { type: "object", additionalProperties: false, properties: { x: analyticFieldSchema, y: analyticFieldSchema, labels: analyticFieldSchema, values: analyticFieldSchema, text: analyticFieldSchema, series: analyticFieldSchema, hover: { type: "array", maxItems: 8, items: analyticFieldSchema } }, required: ["hover"] },
    resultLimit: { type: "integer", minimum: 1, maximum: MAX_RESULT_ROWS },
  },
  required: ["source", "pipeline", "encoding", "resultLimit"],
};

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const fieldName = (value: unknown) => typeof value === "string" && FIELD_NAME.test(value) ? value : undefined;
const fieldNames = (value: unknown, maximum: number) => Array.isArray(value) ? value.map(fieldName).filter((field): field is string => Boolean(field)).slice(0, maximum) : [];
const stringList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 80)).slice(0, 10) : [];

function sorts(value: unknown): SortField[] {
  return Array.isArray(value) ? value.flatMap((item): SortField[] => isObject(item) && fieldName(item.field) ? [{ field: item.field as string, direction: item.direction === "descending" ? "descending" : "ascending" }] : []).slice(0, 4) : [];
}

function operation(value: unknown): CatalogAnalyticsOperation | null {
  if (!isObject(value) || typeof value.operation !== "string") return null;
  if (value.operation === "explode" && EXPLODE_FIELDS.includes(value.field as ExplodeField) && fieldName(value.as)) return { operation: "explode", field: value.field as ExplodeField, as: value.as as string };
  if (value.operation === "groupBy") { const fields = fieldNames(value.fields, 4); return fields.length ? { operation: "groupBy", fields } : null; }
  if (value.operation === "aggregate" && Array.isArray(value.measures)) {
    const measures = value.measures.flatMap((item): AggregateMeasure[] => {
      if (!isObject(item) || !AGGREGATE_FUNCTIONS.includes(item.function as AggregateFunction) || !fieldName(item.as)) return [];
      const fn = item.function as AggregateFunction; const field = fieldName(item.field); const field2 = fieldName(item.field2);
      if (fn !== "count" && !field || fn === "corr" && !field2) return [];
      return [{ function: fn, as: item.as as string, field, field2, parameter: fn === "quantile" && typeof item.parameter === "number" ? Math.min(1, Math.max(0, item.parameter)) : undefined }];
    }).slice(0, 12);
    return measures.length === value.measures.length && measures.length ? { operation: "aggregate", measures } : null;
  }
  if (value.operation === "window" && Array.isArray(value.measures)) {
    const measures = value.measures.flatMap((item): WindowMeasure[] => {
      if (!isObject(item) || !WINDOW_FUNCTIONS.includes(item.function as WindowFunction) || !fieldName(item.as)) return [];
      const fn = item.function as WindowFunction; const field = fieldName(item.field);
      if (!["rowNumber", "rank", "denseRank", "percentRank"].includes(fn) && !field) return [];
      return [{ function: fn, as: item.as as string, field, offset: typeof item.offset === "number" ? Math.min(100, Math.max(1, Math.floor(item.offset))) : 1, frame: item.frame === "cumulative" || item.frame === "rolling" ? item.frame : "partition", rows: typeof item.rows === "number" ? Math.min(100, Math.max(1, Math.floor(item.rows))) : 4 }];
    }).slice(0, 12);
    return measures.length === value.measures.length && measures.length ? { operation: "window", partitionBy: fieldNames(value.partitionBy, 4), sortBy: sorts(value.sortBy), measures } : null;
  }
  if (value.operation === "calculate" && isObject(value.right) && fieldName(value.as) && fieldName(value.left) && ["add", "subtract", "multiply", "divide"].includes(String(value.operator))) {
    const rightField = fieldName(value.right.field); const rightValue = typeof value.right.value === "number" && Number.isFinite(value.right.value) ? value.right.value : undefined;
    if (rightField || rightValue !== undefined) return { operation: "calculate", as: value.as as string, operator: value.operator as "add" | "subtract" | "multiply" | "divide", left: value.left as string, right: rightField ? { field: rightField } : { value: rightValue } };
  }
  if (value.operation === "filter" && fieldName(value.field) && FILTER_OPERATORS.includes(value.operator as typeof FILTER_OPERATORS[number])) {
    const filterValue = value.value;
    if (filterValue === null || ["string", "number", "boolean"].includes(typeof filterValue) || Array.isArray(filterValue)) return { operation: "filter", field: value.field as string, operator: value.operator as typeof FILTER_OPERATORS[number], value: filterValue as FilterValue };
  }
  if (value.operation === "sort") { const fields = sorts(value.fields); return fields.length ? { operation: "sort", fields } : null; }
  if (value.operation === "limit" && typeof value.count === "number") return { operation: "limit", count: Math.min(MAX_RESULT_ROWS, Math.max(1, Math.floor(value.count))) };
  return null;
}

export function normalizeCatalogAnalyticsBinding(value: unknown): CatalogAnalyticsBinding | null {
  if (!isObject(value) || !isObject(value.source) || value.source.name !== "steam_catalog" || !isObject(value.source.filters) || !Array.isArray(value.pipeline) || !isObject(value.encoding)) return null;
  const pipeline = value.pipeline.map(operation);
  if (pipeline.some((item) => !item)) return null;
  const filters = value.source.filters;
  const encoding: CatalogAnalyticsBinding["encoding"] = { hover: fieldNames(value.encoding.hover, 8) };
  for (const key of ["x", "y", "labels", "values", "text", "series"] as const) { const field = fieldName(value.encoding[key]); if (field) encoding[key] = field; }
  return {
    source: { name: "steam_catalog", filters: { query: typeof filters.query === "string" ? filters.query.slice(0, 120) : "", ownerBand: typeof filters.ownerBand === "string" ? filters.ownerBand : "All owner ranges", priceBand: typeof filters.priceBand === "string" ? filters.priceBand : "All prices", minPositiveRatio: typeof filters.minPositiveRatio === "number" ? Math.min(1, Math.max(0, filters.minPositiveRatio)) : 0, minCcu: typeof filters.minCcu === "number" ? Math.max(0, Math.floor(filters.minCcu)) : 0, genres: stringList(filters.genres), tags: stringList(filters.tags), categories: stringList(filters.categories) } },
    pipeline: pipeline as CatalogAnalyticsOperation[], encoding, resultLimit: typeof value.resultLimit === "number" ? Math.min(MAX_RESULT_ROWS, Math.max(1, Math.floor(value.resultLimit))) : MAX_RESULT_ROWS,
  };
}
