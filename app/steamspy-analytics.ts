import type { PlotlyFigure, PlotlyTrace } from "./plotly-visualization";
import {
  activityBand,
  GAMES,
  OWNER_BANDS,
  priceBand,
  PRICE_BANDS,
  reviewBand,
  REVIEW_BANDS,
  type SteamSpyGame,
} from "./steamspy-data";

export const STEAMSPY_FIELD_CATALOG = [
  { name: "id", type: "integer", description: "Steam application ID." },
  { name: "title", type: "string", description: "Game title." },
  { name: "developer", type: "string", description: "Developer name." },
  { name: "publisher", type: "string", description: "Publisher name." },
  { name: "owners", type: "string", description: "SteamSpy estimated-owner range as published." },
  { name: "ownersMin", type: "integer", description: "Lower bound of the estimated-owner range.", unit: "owners" },
  { name: "ownersMax", type: "integer", description: "Upper bound of the estimated-owner range.", unit: "owners" },
  { name: "priceCents", type: "integer", description: "Current listed price in US cents.", unit: "USD cents" },
  { name: "initialPriceCents", type: "integer", description: "Original listed price in US cents.", unit: "USD cents" },
  { name: "discountPercent", type: "number", description: "Current discount percentage.", unit: "percent" },
  { name: "positive", type: "integer", description: "Positive review count.", unit: "reviews" },
  { name: "negative", type: "integer", description: "Negative review count.", unit: "reviews" },
  { name: "reviewCount", type: "integer", description: "Total positive and negative reviews.", unit: "reviews" },
  { name: "positiveRatio", type: ["number", "null"], description: "Share of reviews that are positive, from 0 to 1.", unit: "ratio" },
  { name: "ccu", type: "integer", description: "Concurrent players reported by SteamSpy.", unit: "players" },
  { name: "averageForever", type: "number", description: "Average all-time playtime.", unit: "minutes" },
  { name: "average2Weeks", type: "number", description: "Average playtime over the last two weeks.", unit: "minutes" },
  { name: "medianForever", type: "number", description: "Median all-time playtime.", unit: "minutes" },
  { name: "median2Weeks", type: "number", description: "Median playtime over the last two weeks.", unit: "minutes" },
  { name: "ownerBand", type: "string", description: "Derived owner-range category; equivalent to owners." },
  { name: "priceBand", type: "string", description: "Derived current-price category." },
  { name: "reviewBand", type: "string", description: "Derived positive-review sentiment category." },
  { name: "activityBand", type: "string", description: "Derived concurrent-player activity category." },
] as const;

export const BINDING_FIELDS = STEAMSPY_FIELD_CATALOG.map((field) => field.name);

type SourceFilters = {
  query: string;
  ownerBand: string;
  priceBand: string;
  minPositiveRatio: number;
  minCcu: number;
};

type SortField = { field: string; direction: "ascending" | "descending" };
type AggregateFunction = "count" | "valid" | "distinct" | "sum" | "mean" | "median" | "min" | "max" | "quantile" | "stdev" | "variance" | "corr";
type AggregateMeasure = { function: AggregateFunction; field?: string; field2?: string; parameter?: number; as: string };
type WindowFunction = "rowNumber" | "rank" | "denseRank" | "percentRank" | "mean" | "sum" | "median" | "stdev" | "lag" | "lead";
type WindowMeasure = { function: WindowFunction; field?: string; offset: number; frame: "partition" | "cumulative" | "rolling"; rows: number; as: string };
type FilterValue = string | number | boolean | null | Array<string | number | boolean | null>;

export type AnalyticsOperation =
  | { operation: "groupBy"; fields: string[] }
  | { operation: "aggregate"; measures: AggregateMeasure[] }
  | { operation: "window"; partitionBy: string[]; sortBy: SortField[]; measures: WindowMeasure[] }
  | { operation: "calculate"; as: string; operator: "add" | "subtract" | "multiply" | "divide"; left: string; right: { field?: string; value?: number } }
  | { operation: "filter"; field: string; operator: "equal" | "notEqual" | "greaterThan" | "greaterOrEqual" | "lessThan" | "lessOrEqual" | "in"; value: FilterValue }
  | { operation: "sort"; fields: SortField[] }
  | { operation: "limit"; count: number };

export type AnalyticsBinding = {
  source: { name: "steamspy_snapshot"; filters: SourceFilters };
  pipeline: AnalyticsOperation[];
  encoding: {
    x?: string;
    y?: string;
    labels?: string;
    values?: string;
    text?: string;
    series?: string;
    hover: string[];
  };
  resultLimit: number;
};

const MAX_PIPELINE_OPERATIONS = 12;
const MAX_MEASURES = 12;
const MAX_RESULT_ROWS = 2_000;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const AGGREGATE_FUNCTIONS: AggregateFunction[] = ["count", "valid", "distinct", "sum", "mean", "median", "min", "max", "quantile", "stdev", "variance", "corr"];
const WINDOW_FUNCTIONS: WindowFunction[] = ["rowNumber", "rank", "denseRank", "percentRank", "mean", "sum", "median", "stdev", "lag", "lead"];
const FILTER_OPERATORS = ["equal", "notEqual", "greaterThan", "greaterOrEqual", "lessThan", "lessOrEqual", "in"] as const;
const analyticFieldSchema = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" };
const sortFieldSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    field: analyticFieldSchema,
    direction: { type: "string", enum: ["ascending", "descending"] },
  },
  required: ["field", "direction"],
};

export const ANALYTICS_BINDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    source: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", const: "steamspy_snapshot" },
        filters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", maxLength: 120 },
            ownerBand: { type: "string", enum: ["All owner ranges", ...OWNER_BANDS] },
            priceBand: { type: "string", enum: ["All prices", ...PRICE_BANDS] },
            minPositiveRatio: { type: "number", minimum: 0, maximum: 1 },
            minCcu: { type: "integer", minimum: 0 },
          },
        },
      },
      required: ["name", "filters"],
    },
    pipeline: {
      type: "array",
      maxItems: MAX_PIPELINE_OPERATIONS,
      items: {
        oneOf: [
          { type: "object", additionalProperties: false, properties: { operation: { const: "groupBy" }, fields: { type: "array", minItems: 1, maxItems: 4, items: analyticFieldSchema } }, required: ["operation", "fields"] },
          { type: "object", additionalProperties: false, properties: { operation: { const: "aggregate" }, measures: { type: "array", minItems: 1, maxItems: MAX_MEASURES, items: { type: "object", additionalProperties: false, properties: { function: { enum: AGGREGATE_FUNCTIONS }, field: analyticFieldSchema, field2: analyticFieldSchema, parameter: { type: "number", minimum: 0, maximum: 1 }, as: analyticFieldSchema }, required: ["function", "as"] } } }, required: ["operation", "measures"] },
          { type: "object", additionalProperties: false, properties: { operation: { const: "window" }, partitionBy: { type: "array", maxItems: 4, items: analyticFieldSchema }, sortBy: { type: "array", maxItems: 4, items: sortFieldSchema }, measures: { type: "array", minItems: 1, maxItems: MAX_MEASURES, items: { type: "object", additionalProperties: false, properties: { function: { enum: WINDOW_FUNCTIONS }, field: analyticFieldSchema, offset: { type: "integer", minimum: 1, maximum: 100 }, frame: { enum: ["partition", "cumulative", "rolling"] }, rows: { type: "integer", minimum: 1, maximum: 100 }, as: analyticFieldSchema }, required: ["function", "as"] } } }, required: ["operation", "partitionBy", "sortBy", "measures"] },
          { type: "object", additionalProperties: false, properties: { operation: { const: "calculate" }, as: analyticFieldSchema, operator: { enum: ["add", "subtract", "multiply", "divide"] }, left: analyticFieldSchema, right: { type: "object", additionalProperties: false, properties: { field: analyticFieldSchema, value: { type: "number" } } } }, required: ["operation", "as", "operator", "left", "right"] },
          { type: "object", additionalProperties: false, properties: { operation: { const: "filter" }, field: analyticFieldSchema, operator: { enum: FILTER_OPERATORS }, value: {} }, required: ["operation", "field", "operator", "value"] },
          { type: "object", additionalProperties: false, properties: { operation: { const: "sort" }, fields: { type: "array", minItems: 1, maxItems: 4, items: sortFieldSchema } }, required: ["operation", "fields"] },
          { type: "object", additionalProperties: false, properties: { operation: { const: "limit" }, count: { type: "integer", minimum: 1, maximum: MAX_RESULT_ROWS } }, required: ["operation", "count"] },
        ],
      },
    },
    encoding: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: analyticFieldSchema,
        y: analyticFieldSchema,
        labels: analyticFieldSchema,
        values: analyticFieldSchema,
        text: analyticFieldSchema,
        series: analyticFieldSchema,
        hover: { type: "array", maxItems: 8, items: analyticFieldSchema },
      },
      required: ["hover"],
    },
    resultLimit: { type: "integer", minimum: 1, maximum: MAX_RESULT_ROWS },
  },
  required: ["source", "pipeline", "encoding", "resultLimit"],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fieldName(value: unknown) {
  return typeof value === "string" && FIELD_NAME.test(value) ? value : undefined;
}

function fieldNames(value: unknown, maximum: number) {
  return Array.isArray(value)
    ? value.map(fieldName).filter((field): field is string => Boolean(field)).slice(0, maximum)
    : [];
}

function normalizeSortFields(value: unknown): SortField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SortField[] => {
    if (!isObject(item)) return [];
    const field = fieldName(item.field);
    return field ? [{ field, direction: item.direction === "descending" ? "descending" : "ascending" }] : [];
  }).slice(0, 4);
}

function normalizeAggregateMeasures(value: unknown): AggregateMeasure[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AggregateMeasure[] => {
    if (!isObject(item) || typeof item.function !== "string" || !AGGREGATE_FUNCTIONS.includes(item.function as AggregateFunction)) return [];
    const fn = item.function as AggregateFunction;
    const as = fieldName(item.as);
    const field = fieldName(item.field);
    const field2 = fieldName(item.field2);
    if (!as || (fn !== "count" && !field) || (fn === "corr" && !field2)) return [];
    return [{ function: fn, as, field, field2, parameter: fn === "quantile" && typeof item.parameter === "number" ? Math.min(1, Math.max(0, item.parameter)) : undefined }];
  }).slice(0, MAX_MEASURES);
}

function normalizeWindowMeasures(value: unknown): WindowMeasure[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): WindowMeasure[] => {
    if (!isObject(item) || typeof item.function !== "string" || !WINDOW_FUNCTIONS.includes(item.function as WindowFunction)) return [];
    const fn = item.function as WindowFunction;
    const as = fieldName(item.as);
    const field = fieldName(item.field);
    if (!as || (!["rowNumber", "rank", "denseRank", "percentRank"].includes(fn) && !field)) return [];
    return [{ function: fn, as, field, offset: typeof item.offset === "number" ? Math.min(100, Math.max(1, Math.floor(item.offset))) : 1, frame: item.frame === "cumulative" || item.frame === "rolling" ? item.frame : "partition", rows: typeof item.rows === "number" ? Math.min(100, Math.max(1, Math.floor(item.rows))) : 4 }];
  }).slice(0, MAX_MEASURES);
}

function normalizeFilterValue(value: unknown): FilterValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (!Array.isArray(value)) return undefined;
  return value.filter((item) => item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean").slice(0, 30) as FilterValue;
}

function normalizeOperation(value: unknown): AnalyticsOperation | null {
  if (!isObject(value) || typeof value.operation !== "string") return null;
  if (value.operation === "groupBy") {
    const fields = fieldNames(value.fields, 4);
    return fields.length ? { operation: "groupBy", fields } : null;
  }
  if (value.operation === "aggregate") {
    const measures = normalizeAggregateMeasures(value.measures);
    return measures.length ? { operation: "aggregate", measures } : null;
  }
  if (value.operation === "window") {
    const measures = normalizeWindowMeasures(value.measures);
    return measures.length ? { operation: "window", partitionBy: fieldNames(value.partitionBy, 4), sortBy: normalizeSortFields(value.sortBy), measures } : null;
  }
  if (value.operation === "calculate" && isObject(value.right)) {
    const as = fieldName(value.as);
    const left = fieldName(value.left);
    const operator = value.operator;
    const rightField = fieldName(value.right.field);
    const rightValue = typeof value.right.value === "number" && Number.isFinite(value.right.value) ? value.right.value : undefined;
    if (as && left && ["add", "subtract", "multiply", "divide"].includes(String(operator)) && (rightField || rightValue !== undefined)) {
      return { operation: "calculate", as, left, operator: operator as "add" | "subtract" | "multiply" | "divide", right: rightField ? { field: rightField } : { value: rightValue } };
    }
  }
  if (value.operation === "filter") {
    const field = fieldName(value.field);
    const filterValue = normalizeFilterValue(value.value);
    const operator = value.operator as (typeof FILTER_OPERATORS)[number];
    if (field && filterValue !== undefined && FILTER_OPERATORS.includes(operator)) return { operation: "filter", field, operator, value: filterValue };
  }
  if (value.operation === "sort") {
    const fields = normalizeSortFields(value.fields);
    return fields.length ? { operation: "sort", fields } : null;
  }
  if (value.operation === "limit" && typeof value.count === "number") return { operation: "limit", count: Math.min(MAX_RESULT_ROWS, Math.max(1, Math.floor(value.count))) };
  return null;
}

export function normalizeAnalyticsBinding(value: unknown): AnalyticsBinding | null {
  if (!isObject(value) || !isObject(value.source) || value.source.name !== "steamspy_snapshot" || !isObject(value.source.filters) || !isObject(value.encoding) || !Array.isArray(value.pipeline)) return null;
  const filters = value.source.filters;
  const pipeline = value.pipeline.map(normalizeOperation).filter((operation): operation is AnalyticsOperation => Boolean(operation)).slice(0, MAX_PIPELINE_OPERATIONS);
  if (pipeline.length !== value.pipeline.length) return null;
  const encoding: AnalyticsBinding["encoding"] = { hover: fieldNames(value.encoding.hover, 8) };
  for (const key of ["x", "y", "labels", "values", "text", "series"] as const) {
    const field = fieldName(value.encoding[key]);
    if (field) encoding[key] = field;
  }
  return {
    source: {
      name: "steamspy_snapshot",
      filters: {
        query: typeof filters.query === "string" ? filters.query.slice(0, 120) : "",
        ownerBand: typeof filters.ownerBand === "string" && (filters.ownerBand === "All owner ranges" || OWNER_BANDS.includes(filters.ownerBand)) ? filters.ownerBand : "All owner ranges",
        priceBand: typeof filters.priceBand === "string" && (filters.priceBand === "All prices" || PRICE_BANDS.includes(filters.priceBand as (typeof PRICE_BANDS)[number])) ? filters.priceBand : "All prices",
        minPositiveRatio: typeof filters.minPositiveRatio === "number" ? Math.min(1, Math.max(0, filters.minPositiveRatio)) : 0,
        minCcu: typeof filters.minCcu === "number" ? Math.max(0, Math.floor(filters.minCcu)) : 0,
      },
    },
    pipeline,
    encoding,
    resultLimit: typeof value.resultLimit === "number" ? Math.min(MAX_RESULT_ROWS, Math.max(1, Math.floor(value.resultLimit))) : MAX_RESULT_ROWS,
  };
}

export function filterSteamSpyGames(filters: Partial<SourceFilters>) {
  const query = typeof filters.query === "string" ? filters.query.trim().toLocaleLowerCase() : "";
  const owner = typeof filters.ownerBand === "string" ? filters.ownerBand : "All owner ranges";
  const price = typeof filters.priceBand === "string" ? filters.priceBand : "All prices";
  const minPositiveRatio = typeof filters.minPositiveRatio === "number" ? filters.minPositiveRatio : 0;
  const minCcu = typeof filters.minCcu === "number" ? filters.minCcu : 0;
  return GAMES.filter((game) => {
    const haystack = `${game.title} ${game.developer} ${game.publisher}`.toLocaleLowerCase();
    return (!query || haystack.includes(query))
      && (owner === "All owner ranges" || game.owners === owner)
      && (price === "All prices" || priceBand(game) === price)
      && (game.positiveRatio ?? 0) >= minPositiveRatio
      && game.ccu >= minCcu;
  });
}

export function steamSpyAnalyticsRow(game: SteamSpyGame) {
  return {
    ...game,
    ownerBand: game.owners,
    priceBand: priceBand(game),
    reviewBand: reviewBand(game),
    activityBand: activityBand(game),
  };
}

function ensureColumns(table: { columnNames(): string[] }, fields: string[]) {
  const available = new Set(table.columnNames());
  for (const field of fields) if (!available.has(field)) throw new Error(`Unknown analytics field: ${field}.`);
}

function aggregateExpression(aq: typeof import("arquero"), measure: AggregateMeasure) {
  if (measure.function === "count") return aq.op.count();
  const field = measure.field!;
  if (measure.function === "valid") return aq.op.valid(field);
  if (measure.function === "distinct") return aq.op.distinct(field);
  if (measure.function === "sum") return aq.op.sum(field);
  if (measure.function === "mean") return aq.op.mean(field);
  if (measure.function === "median") return aq.op.median(field);
  if (measure.function === "min") return aq.op.min(field);
  if (measure.function === "max") return aq.op.max(field);
  if (measure.function === "quantile") return aq.op.quantile(field, measure.parameter ?? 0.5);
  if (measure.function === "stdev") return aq.op.stdev(field);
  if (measure.function === "variance") return aq.op.variance(field);
  return aq.op.corr(field, measure.field2!);
}

function windowExpression(aq: typeof import("arquero"), measure: WindowMeasure) {
  if (measure.function === "rowNumber") return aq.op.row_number();
  if (measure.function === "rank") return aq.op.rank();
  if (measure.function === "denseRank") return aq.op.dense_rank();
  if (measure.function === "percentRank") return aq.op.percent_rank();
  if (measure.function === "lag") return aq.op.lag(measure.field!, measure.offset);
  if (measure.function === "lead") return aq.op.lead(measure.field!, measure.offset);
  const aggregate = measure.function === "sum" ? aq.op.sum(measure.field!) : measure.function === "median" ? aq.op.median(measure.field!) : measure.function === "stdev" ? aq.op.stdev(measure.field!) : aq.op.mean(measure.field!);
  const frame: [number, number] = measure.frame === "partition" ? [-Infinity, Infinity] : measure.frame === "cumulative" ? [-Infinity, 0] : [-(measure.rows - 1), 0];
  return aq.rolling(aggregate as unknown as object, frame);
}

function compare(left: unknown, operator: Extract<AnalyticsOperation, { operation: "filter" }>["operator"], right: FilterValue) {
  if (operator === "in") return Array.isArray(right) && right.includes(left as never);
  if (operator === "equal") return left === right;
  if (operator === "notEqual") return left !== right;
  if (typeof left !== "number" || typeof right !== "number") return false;
  if (operator === "greaterThan") return left > right;
  if (operator === "greaterOrEqual") return left >= right;
  if (operator === "lessThan") return left < right;
  return left <= right;
}

let arqueroPromise: Promise<typeof import("arquero")> | null = null;
async function loadArquero() {
  arqueroPromise ??= import("arquero");
  return arqueroPromise;
}

export async function runAnalyticsBinding(binding: AnalyticsBinding) {
  const aq = await loadArquero();
  let table = aq.from(filterSteamSpyGames(binding.source.filters).map(steamSpyAnalyticsRow));
  let pendingGroups: string[] = [];
  for (const operation of binding.pipeline) {
    if (operation.operation === "groupBy") {
      ensureColumns(table, operation.fields);
      pendingGroups = operation.fields;
      continue;
    }
    if (operation.operation === "aggregate") {
      const inputFields = operation.measures.flatMap((measure) => [measure.field, measure.field2].filter((field): field is string => Boolean(field)));
      ensureColumns(table, [...pendingGroups, ...inputFields]);
      const expressions = Object.fromEntries(operation.measures.map((measure) => [measure.as, aggregateExpression(aq, measure)]));
      table = (pendingGroups.length ? table.groupby(...pendingGroups) : table.ungroup()).rollup(expressions).ungroup();
      pendingGroups = [];
      continue;
    }
    if (pendingGroups.length) throw new Error("A groupBy operation must be followed immediately by aggregate.");
    if (operation.operation === "window") {
      ensureColumns(table, [...operation.partitionBy, ...operation.sortBy.map((item) => item.field), ...operation.measures.flatMap((measure) => measure.field ? [measure.field] : [])]);
      const sort = operation.sortBy.map((item) => item.direction === "descending" ? aq.desc(item.field) : item.field);
      let windowTable = operation.partitionBy.length ? table.groupby(...operation.partitionBy) : table.ungroup();
      if (sort.length) windowTable = windowTable.orderby(...sort);
      table = windowTable.derive(Object.fromEntries(operation.measures.map((measure) => [measure.as, windowExpression(aq, measure)]))).ungroup();
    } else if (operation.operation === "calculate") {
      ensureColumns(table, [operation.left, ...(operation.right.field ? [operation.right.field] : [])]);
      table = table.derive({ [operation.as]: aq.escape((row: Record<string, unknown>) => {
        const left = Number(row[operation.left]);
        const right = operation.right.field ? Number(row[operation.right.field]) : operation.right.value!;
        if (operation.operator === "add") return left + right;
        if (operation.operator === "subtract") return left - right;
        if (operation.operator === "multiply") return left * right;
        return right === 0 ? null : left / right;
      }) });
    } else if (operation.operation === "filter") {
      ensureColumns(table, [operation.field]);
      table = table.filter(aq.escape((row: Record<string, unknown>) => compare(row[operation.field], operation.operator, operation.value)));
    } else if (operation.operation === "sort") {
      ensureColumns(table, operation.fields.map((item) => item.field));
      table = table.orderby(...operation.fields.map((item) => item.direction === "descending" ? aq.desc(item.field) : item.field));
    } else if (operation.operation === "limit") {
      table = table.slice(0, operation.count);
    }
  }
  if (pendingGroups.length) throw new Error("A groupBy operation must be followed by aggregate.");
  ensureColumns(table, [binding.encoding.x, binding.encoding.y, binding.encoding.labels, binding.encoding.values, binding.encoding.text, binding.encoding.series, ...binding.encoding.hover].filter((field): field is string => Boolean(field)));
  return table.objects({ limit: binding.resultLimit }) as Record<string, unknown>[];
}

function clearTraceData(trace: PlotlyTrace) {
  const next: PlotlyTrace = { ...trace };
  delete next.x;
  delete next.y;
  delete next.labels;
  delete next.values;
  delete next.text;
  delete next.customdata;
  return next;
}

function bindRowsToAnalyticsFigure(figure: PlotlyFigure, binding: AnalyticsBinding, rows: Record<string, unknown>[]) {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = binding.encoding.series ? String(row[binding.encoding.series] ?? "Unspecified") : "";
    const group = grouped.get(key);
    if (group) group.push(row);
    else grouped.set(key, [row]);
  }
  if (!grouped.size) grouped.set("", []);
  const data = Array.from(grouped.entries()).slice(0, 12).map(([name, groupRows], index) => {
    const namedTemplate = figure.data.find((trace) => typeof trace.name === "string" && trace.name === name);
    const trace = clearTraceData(namedTemplate ?? figure.data[index % figure.data.length] ?? { type: "scatter" });
    if (binding.encoding.series) trace.name = name;
    if (binding.encoding.x) trace.x = groupRows.map((row) => row[binding.encoding.x!]);
    if (binding.encoding.y) trace.y = groupRows.map((row) => row[binding.encoding.y!]);
    if (binding.encoding.labels) trace.labels = groupRows.map((row) => row[binding.encoding.labels!]);
    if (binding.encoding.values) trace.values = groupRows.map((row) => row[binding.encoding.values!]);
    if (binding.encoding.text) trace.text = groupRows.map((row) => String(row[binding.encoding.text!] ?? ""));
    if (binding.encoding.hover.length) trace.customdata = groupRows.map((row) => binding.encoding.hover.map((field) => row[field]));
    return trace;
  });
  return { title: figure.title, description: figure.description, data, layout: figure.layout };
}

export async function renderAnalyticsReport(figure: PlotlyFigure, binding: AnalyticsBinding) {
  const rows = await runAnalyticsBinding(binding);
  return { rows, figure: bindRowsToAnalyticsFigure(figure, binding, rows) };
}

export async function regenerateAnalyticsFigure(figure: PlotlyFigure, binding: AnalyticsBinding) {
  return (await renderAnalyticsReport(figure, binding)).figure;
}

export const ANALYTICS_GROUP_VALUES = {
  ownerBand: OWNER_BANDS,
  priceBand: PRICE_BANDS,
  reviewBand: REVIEW_BANDS,
};
