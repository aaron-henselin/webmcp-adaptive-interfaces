import type {
  AggregateFunction,
  AggregateMeasure,
  CatalogAnalyticsOperation,
  FilterValue,
  SortField,
  WindowFunction,
  WindowMeasure,
} from "./catalog-analytics";

export const ENGAGEMENT_DATE_MIN = "2026-05-31";
export const ENGAGEMENT_DATE_MAX = "2026-08-28";
export const CUSTOMER_TYPES = ["New", "Returning", "Loyal"] as const;
export const CUSTOMER_SEXES = ["Female", "Male", "Non-binary", "Undisclosed"] as const;
export const DEVICE_TYPES = ["Desktop", "Mobile", "Tablet"] as const;

export type EngagementSourceFilters = {
  dateFrom: string;
  dateTo: string;
  shops: string[];
  suppliers: string[];
  productCategories: string[];
  brands: string[];
  productClasses: string[];
  sexes: string[];
  customerTypes: string[];
  devices: string[];
};

export type EngagementAnalyticsOperation = Exclude<CatalogAnalyticsOperation, { operation: "explode" }>;

export type EngagementAnalyticsBinding = {
  source: {
    name: "customer_engagement";
    view: "sessions" | "funnel";
    inheritPageFilters: boolean;
    filters: EngagementSourceFilters;
  };
  pipeline: EngagementAnalyticsOperation[];
  encoding: { x?: string; y?: string; labels?: string; values?: string; text?: string; series?: string; hover: string[] };
  resultLimit: number;
};

export const DEFAULT_ENGAGEMENT_FILTERS: EngagementSourceFilters = {
  dateFrom: "2026-06-01",
  dateTo: ENGAGEMENT_DATE_MAX,
  shops: [],
  suppliers: [],
  productCategories: [],
  brands: [],
  productClasses: [],
  sexes: [],
  customerTypes: [],
  devices: [],
};

export const ENGAGEMENT_FIELD_CATALOG = [
  { name: "sessionId", type: "integer", view: "sessions", description: "Session identifier." },
  { name: "userId", type: "integer", view: "sessions", description: "Customer identifier." },
  { name: "productId", type: "integer", view: "sessions", description: "Steam application ID for the product." },
  { name: "productTitle", type: "string", view: "sessions", description: "Product title from the Steam catalog." },
  { name: "sessionDate", type: "string", view: "sessions", description: "Session date in YYYY-MM-DD format." },
  { name: "startedAt", type: "string", view: "sessions", description: "Session start timestamp." },
  { name: "durationSeconds", type: "integer", view: "sessions", unit: "seconds", description: "Session duration in seconds." },
  { name: "durationMinutes", type: "number", view: "sessions", unit: "minutes", description: "Session duration in minutes." },
  { name: "deviceType", type: "string", view: "sessions", description: "Desktop, mobile, or tablet." },
  { name: "shop", type: "string", view: "sessions", description: "Shop associated with the session." },
  { name: "shopRegion", type: "string", view: "sessions", description: "Shop operating region." },
  { name: "supplier", type: "string", view: "sessions", description: "Primary publisher for the product." },
  { name: "brand", type: "string", view: "sessions", description: "Primary developer for the product." },
  { name: "productCategory", type: "string", view: "sessions", description: "Primary Steam genre for the product." },
  { name: "productClass", type: "string", view: "sessions", description: "Primary Steam category for the product." },
  { name: "firstName", type: "string", view: "sessions", description: "Customer first name." },
  { name: "lastName", type: "string", view: "sessions", description: "Customer last name." },
  { name: "email", type: "string", view: "sessions", description: "Customer email address." },
  { name: "sex", type: "string", view: "sessions", description: "Customer-reported sex." },
  { name: "customerType", type: "string", view: "sessions", description: "New, returning, or loyal customer." },
  { name: "city", type: "string", view: "sessions", description: "Customer city." },
  { name: "region", type: "string", view: "sessions", description: "Customer region." },
  { name: "customerStatus", type: "string", view: "sessions", description: "Current customer status." },
  { name: "signedUp", type: "integer", view: "sessions", unit: "sessions", description: "One when the session reached sign-up, otherwise zero." },
  { name: "activated", type: "integer", view: "sessions", unit: "sessions", description: "One when the session reached activation, otherwise zero." },
  { name: "subscribed", type: "integer", view: "sessions", unit: "sessions", description: "One when the session reached subscription, otherwise zero." },
  { name: "stage", type: "string", view: "funnel", description: "Ordered journey stage: Visitors, Sign-ups, Active, or Subscribed." },
  { name: "stageOrder", type: "integer", view: "funnel", description: "Numeric journey-stage order." },
] as const;

const MAX_RESULT_ROWS = 2_000;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;
const AGGREGATE_FUNCTIONS: AggregateFunction[] = ["count", "valid", "distinct", "sum", "mean", "median", "min", "max", "quantile", "stdev", "variance", "corr"];
const WINDOW_FUNCTIONS: WindowFunction[] = ["rowNumber", "rank", "denseRank", "percentRank", "mean", "sum", "median", "stdev", "lag", "lead"];
const FILTER_OPERATORS = ["equal", "notEqual", "greaterThan", "greaterOrEqual", "lessThan", "lessOrEqual", "in"] as const;
const analyticFieldSchema = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" };
const sortFieldSchema = { type: "object", additionalProperties: false, properties: { field: analyticFieldSchema, direction: { type: "string", enum: ["ascending", "descending"] } }, required: ["field", "direction"] };

const ENGAGEMENT_PIPELINE_SCHEMA = {
  type: "array",
  maxItems: 12,
  items: {
    oneOf: [
      { type: "object", additionalProperties: false, properties: { operation: { const: "groupBy" }, fields: { type: "array", minItems: 1, maxItems: 4, items: analyticFieldSchema } }, required: ["operation", "fields"] },
      { type: "object", additionalProperties: false, properties: { operation: { const: "aggregate" }, measures: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, properties: { function: { enum: AGGREGATE_FUNCTIONS }, field: analyticFieldSchema, field2: analyticFieldSchema, parameter: { type: "number", minimum: 0, maximum: 1 }, as: analyticFieldSchema }, required: ["function", "as"] } } }, required: ["operation", "measures"] },
      { type: "object", additionalProperties: false, properties: { operation: { const: "window" }, partitionBy: { type: "array", maxItems: 4, items: analyticFieldSchema }, sortBy: { type: "array", maxItems: 4, items: sortFieldSchema }, measures: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, properties: { function: { enum: WINDOW_FUNCTIONS }, field: analyticFieldSchema, offset: { type: "integer", minimum: 1, maximum: 100 }, frame: { enum: ["partition", "cumulative", "rolling"] }, rows: { type: "integer", minimum: 1, maximum: 100 }, as: analyticFieldSchema }, required: ["function", "as"] } } }, required: ["operation", "partitionBy", "sortBy", "measures"] },
      { type: "object", additionalProperties: false, properties: { operation: { const: "calculate" }, as: analyticFieldSchema, operator: { enum: ["add", "subtract", "multiply", "divide"] }, left: analyticFieldSchema, right: { type: "object", additionalProperties: false, properties: { field: analyticFieldSchema, value: { type: "number" } } } }, required: ["operation", "as", "operator", "left", "right"] },
      { type: "object", additionalProperties: false, properties: { operation: { const: "filter" }, field: analyticFieldSchema, operator: { enum: FILTER_OPERATORS }, value: {} }, required: ["operation", "field", "operator", "value"] },
      { type: "object", additionalProperties: false, properties: { operation: { const: "sort" }, fields: { type: "array", minItems: 1, maxItems: 4, items: sortFieldSchema } }, required: ["operation", "fields"] },
      { type: "object", additionalProperties: false, properties: { operation: { const: "limit" }, count: { type: "integer", minimum: 1, maximum: MAX_RESULT_ROWS } }, required: ["operation", "count"] },
    ],
  },
};

export const ENGAGEMENT_ANALYTICS_BINDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    source: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", const: "customer_engagement" },
        view: { type: "string", enum: ["sessions", "funnel"] },
        inheritPageFilters: { type: "boolean", default: true },
        filters: {
          type: "object",
          additionalProperties: false,
          properties: {
            dateFrom: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            dateTo: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            shops: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
            suppliers: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
            productCategories: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
            brands: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
            productClasses: { type: "array", maxItems: 10, items: { type: "string", maxLength: 80 } },
            sexes: { type: "array", maxItems: 4, items: { type: "string", enum: CUSTOMER_SEXES } },
            customerTypes: { type: "array", maxItems: 3, items: { type: "string", enum: CUSTOMER_TYPES } },
            devices: { type: "array", maxItems: 3, items: { type: "string", enum: DEVICE_TYPES } },
          },
          required: ["dateFrom", "dateTo", "shops", "suppliers", "productCategories", "brands", "productClasses", "sexes", "customerTypes", "devices"],
        },
      },
      required: ["name", "view", "filters"],
    },
    pipeline: ENGAGEMENT_PIPELINE_SCHEMA,
    encoding: { type: "object", additionalProperties: false, properties: { x: analyticFieldSchema, y: analyticFieldSchema, labels: analyticFieldSchema, values: analyticFieldSchema, text: analyticFieldSchema, series: analyticFieldSchema, hover: { type: "array", maxItems: 8, items: analyticFieldSchema } }, required: ["hover"] },
    resultLimit: { type: "integer", minimum: 1, maximum: MAX_RESULT_ROWS },
  },
  required: ["source", "pipeline", "encoding", "resultLimit"],
};

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const fieldName = (value: unknown) => typeof value === "string" && FIELD_NAME.test(value) ? value : undefined;
const fieldNames = (value: unknown, maximum: number) => Array.isArray(value) ? value.map(fieldName).filter((field): field is string => Boolean(field)).slice(0, maximum) : [];
const stringList = (value: unknown, maximum = 10) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 80)).slice(0, maximum) : [];
const dateValue = (value: unknown, fallback: string) => typeof value === "string" && DATE_VALUE.test(value) ? value : fallback;

function sorts(value: unknown): SortField[] {
  return Array.isArray(value) ? value.flatMap((item): SortField[] => isObject(item) && fieldName(item.field) ? [{ field: item.field as string, direction: item.direction === "descending" ? "descending" : "ascending" }] : []).slice(0, 4) : [];
}

function operation(value: unknown): EngagementAnalyticsOperation | null {
  if (!isObject(value) || typeof value.operation !== "string" || value.operation === "explode") return null;
  if (value.operation === "groupBy") { const fields = fieldNames(value.fields, 4); return fields.length ? { operation: "groupBy", fields } : null; }
  if (value.operation === "aggregate" && Array.isArray(value.measures)) {
    const measures = value.measures.flatMap((item): AggregateMeasure[] => {
      if (!isObject(item) || !AGGREGATE_FUNCTIONS.includes(item.function as AggregateFunction) || !fieldName(item.as)) return [];
      const fn = item.function as AggregateFunction;
      const field = fieldName(item.field);
      const field2 = fieldName(item.field2);
      if (fn !== "count" && !field || fn === "corr" && !field2) return [];
      return [{ function: fn, as: item.as as string, field, field2, parameter: fn === "quantile" && typeof item.parameter === "number" ? Math.min(1, Math.max(0, item.parameter)) : undefined }];
    }).slice(0, 12);
    return measures.length === value.measures.length && measures.length ? { operation: "aggregate", measures } : null;
  }
  if (value.operation === "window" && Array.isArray(value.measures)) {
    const measures = value.measures.flatMap((item): WindowMeasure[] => {
      if (!isObject(item) || !WINDOW_FUNCTIONS.includes(item.function as WindowFunction) || !fieldName(item.as)) return [];
      const fn = item.function as WindowFunction;
      const field = fieldName(item.field);
      if (!["rowNumber", "rank", "denseRank", "percentRank"].includes(fn) && !field) return [];
      return [{ function: fn, as: item.as as string, field, offset: typeof item.offset === "number" ? Math.min(100, Math.max(1, Math.floor(item.offset))) : 1, frame: item.frame === "cumulative" || item.frame === "rolling" ? item.frame : "partition", rows: typeof item.rows === "number" ? Math.min(100, Math.max(1, Math.floor(item.rows))) : 4 }];
    }).slice(0, 12);
    return measures.length === value.measures.length && measures.length ? { operation: "window", partitionBy: fieldNames(value.partitionBy, 4), sortBy: sorts(value.sortBy), measures } : null;
  }
  if (value.operation === "calculate" && isObject(value.right) && fieldName(value.as) && fieldName(value.left) && ["add", "subtract", "multiply", "divide"].includes(String(value.operator))) {
    const rightField = fieldName(value.right.field);
    const rightValue = typeof value.right.value === "number" && Number.isFinite(value.right.value) ? value.right.value : undefined;
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

export function normalizeEngagementFilters(value: unknown): EngagementSourceFilters {
  const filters = isObject(value) ? value : {};
  const dateFrom = dateValue(filters.dateFrom, DEFAULT_ENGAGEMENT_FILTERS.dateFrom);
  const dateTo = dateValue(filters.dateTo, DEFAULT_ENGAGEMENT_FILTERS.dateTo);
  return {
    dateFrom: dateFrom <= dateTo ? dateFrom : dateTo,
    dateTo: dateFrom <= dateTo ? dateTo : dateFrom,
    shops: stringList(filters.shops),
    suppliers: stringList(filters.suppliers),
    productCategories: stringList(filters.productCategories),
    brands: stringList(filters.brands),
    productClasses: stringList(filters.productClasses),
    sexes: stringList(filters.sexes, 4),
    customerTypes: stringList(filters.customerTypes, 3),
    devices: stringList(filters.devices, 3),
  };
}

export function normalizeEngagementAnalyticsBinding(value: unknown): EngagementAnalyticsBinding | null {
  if (!isObject(value) || !isObject(value.source) || value.source.name !== "customer_engagement" || !isObject(value.source.filters) || !Array.isArray(value.pipeline) || !isObject(value.encoding)) return null;
  const pipeline = value.pipeline.map(operation);
  if (pipeline.some((item) => !item)) return null;
  const encoding: EngagementAnalyticsBinding["encoding"] = { hover: fieldNames(value.encoding.hover, 8) };
  for (const key of ["x", "y", "labels", "values", "text", "series"] as const) {
    const field = fieldName(value.encoding[key]);
    if (field) encoding[key] = field;
  }
  return {
    source: {
      name: "customer_engagement",
      view: value.source.view === "funnel" ? "funnel" : "sessions",
      inheritPageFilters: value.source.inheritPageFilters !== false,
      filters: normalizeEngagementFilters(value.source.filters),
    },
    pipeline: pipeline as EngagementAnalyticsOperation[],
    encoding,
    resultLimit: typeof value.resultLimit === "number" ? Math.min(MAX_RESULT_ROWS, Math.max(1, Math.floor(value.resultLimit))) : MAX_RESULT_ROWS,
  };
}

export function withPageEngagementFilters(binding: EngagementAnalyticsBinding, pageFilters: EngagementSourceFilters) {
  if (!binding.source.inheritPageFilters) return binding;
  return { ...binding, source: { ...binding.source, filters: pageFilters } };
}
