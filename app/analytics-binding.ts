import type { PlotlyFigure, PlotlyTrace } from './plotly-visualization';
import { GAMES, GENRES, Game } from './release-data';

export type ReleaseField = 'id' | 'title' | 'releaseDate' | 'genre' | 'secondaryGenre' | 'price' | 'status' | 'studio' | 'wishlists';
export type DerivedReleaseField = 'daysUntilRelease' | 'releaseWeek' | 'releaseMonth' | 'releaseWeekday';
export type BindingField = ReleaseField | DerivedReleaseField;
export type RelativeDatePreset = 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'next_7_days' | 'next_30_days' | 'next_90_days' | 'this_month' | 'next_month';
export type RelativeDateRange = { preset: RelativeDatePreset; weekStartsOn: 'monday' | 'sunday' };

type SourceFilters = {
  query: string;
  genre: string;
  startDate: string;
  endDate: string;
  relativeDateRange: RelativeDateRange | null;
};
type SourceFilterInput = Omit<Partial<SourceFilters>, 'relativeDateRange'> & { relativeDateRange?: unknown };

type GroupByOperation = { operation: 'groupBy'; fields: string[] };
type AggregateFunction = 'count' | 'valid' | 'distinct' | 'sum' | 'mean' | 'median' | 'min' | 'max' | 'quantile' | 'stdev' | 'variance' | 'corr';
type AggregateMeasure = { function: AggregateFunction; field?: string; field2?: string; parameter?: number; as: string };
type AggregateOperation = { operation: 'aggregate'; measures: AggregateMeasure[] };
type WindowFunction = 'rowNumber' | 'rank' | 'denseRank' | 'percentRank' | 'mean' | 'sum' | 'median' | 'stdev' | 'lag' | 'lead';
type WindowMeasure = { function: WindowFunction; field?: string; offset?: number; frame: 'partition' | 'cumulative' | 'rolling'; rows: number; as: string };
type SortField = { field: string; direction: 'ascending' | 'descending' };
type WindowOperation = { operation: 'window'; partitionBy: string[]; sortBy: SortField[]; measures: WindowMeasure[] };
type CalculateOperation = {
  operation: 'calculate';
  as: string;
  operator: 'add' | 'subtract' | 'multiply' | 'divide';
  left: string;
  right: { field?: string; value?: number };
};
type FilterValue = string | number | boolean | null | Array<string | number | boolean | null>;
type FilterOperation = { operation: 'filter'; field: string; operator: 'equal' | 'notEqual' | 'greaterThan' | 'greaterOrEqual' | 'lessThan' | 'lessOrEqual' | 'in'; value: FilterValue };
type SortOperation = { operation: 'sort'; fields: SortField[] };
type LimitOperation = { operation: 'limit'; count: number };

export type AnalyticsOperation = GroupByOperation | AggregateOperation | WindowOperation | CalculateOperation | FilterOperation | SortOperation | LimitOperation;

export type AnalyticsBinding = {
  source: { name: 'release_calendar'; filters: SourceFilters };
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

export const RELEASE_FIELDS: ReleaseField[] = ['id', 'title', 'releaseDate', 'genre', 'secondaryGenre', 'price', 'status', 'studio', 'wishlists'];
export const DERIVED_RELEASE_FIELDS: DerivedReleaseField[] = ['daysUntilRelease', 'releaseWeek', 'releaseMonth', 'releaseWeekday'];
export const BINDING_FIELDS: BindingField[] = [...RELEASE_FIELDS, ...DERIVED_RELEASE_FIELDS];
export const RELATIVE_DATE_PRESETS: RelativeDatePreset[] = ['today', 'tomorrow', 'this_week', 'next_week', 'next_7_days', 'next_30_days', 'next_90_days', 'this_month', 'next_month'];

const MAX_PIPELINE_OPERATIONS = 12;
const MAX_MEASURES = 12;
const MAX_RESULT_ROWS = 2000;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const AGGREGATE_FUNCTIONS: AggregateFunction[] = ['count', 'valid', 'distinct', 'sum', 'mean', 'median', 'min', 'max', 'quantile', 'stdev', 'variance', 'corr'];
const WINDOW_FUNCTIONS: WindowFunction[] = ['rowNumber', 'rank', 'denseRank', 'percentRank', 'mean', 'sum', 'median', 'stdev', 'lag', 'lead'];
const CALCULATE_OPERATORS: CalculateOperation['operator'][] = ['add', 'subtract', 'multiply', 'divide'];
const FILTER_OPERATORS: FilterOperation['operator'][] = ['equal', 'notEqual', 'greaterThan', 'greaterOrEqual', 'lessThan', 'lessOrEqual', 'in'];

const analyticFieldSchema = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,63}$' };
const sortFieldSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    field: analyticFieldSchema,
    direction: { type: 'string', enum: ['ascending', 'descending'] },
  },
  required: ['field', 'direction'],
};

export const ANALYTICS_BINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', const: 'release_calendar' },
        filters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', maxLength: 120 },
            genre: { type: 'string', enum: ['All genres', ...GENRES] },
            startDate: { type: 'string', description: 'Inclusive ISO date, YYYY-MM-DD.' },
            endDate: { type: 'string', description: 'Inclusive ISO date, YYYY-MM-DD.' },
            relativeDateRange: {
              type: 'object',
              additionalProperties: false,
              properties: {
                preset: { type: 'string', enum: RELATIVE_DATE_PRESETS },
                weekStartsOn: { type: 'string', enum: ['monday', 'sunday'] },
              },
              required: ['preset', 'weekStartsOn'],
            },
          },
        },
      },
      required: ['name', 'filters'],
    },
    pipeline: {
      type: 'array',
      maxItems: MAX_PIPELINE_OPERATIONS,
      items: {
        oneOf: [
          {
            type: 'object', additionalProperties: false,
            properties: { operation: { type: 'string', const: 'groupBy' }, fields: { type: 'array', minItems: 1, maxItems: 4, items: analyticFieldSchema } },
            required: ['operation', 'fields'],
          },
          {
            type: 'object', additionalProperties: false,
            properties: {
              operation: { type: 'string', const: 'aggregate' },
              measures: {
                type: 'array', minItems: 1, maxItems: MAX_MEASURES,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    function: { type: 'string', enum: AGGREGATE_FUNCTIONS },
                    field: analyticFieldSchema,
                    field2: analyticFieldSchema,
                    parameter: { type: 'number', minimum: 0, maximum: 1 },
                    as: analyticFieldSchema,
                  },
                  required: ['function', 'as'],
                },
              },
            },
            required: ['operation', 'measures'],
          },
          {
            type: 'object', additionalProperties: false,
            properties: {
              operation: { type: 'string', const: 'window' },
              partitionBy: { type: 'array', maxItems: 4, items: analyticFieldSchema },
              sortBy: { type: 'array', maxItems: 4, items: sortFieldSchema },
              measures: {
                type: 'array', minItems: 1, maxItems: MAX_MEASURES,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    function: { type: 'string', enum: WINDOW_FUNCTIONS },
                    field: analyticFieldSchema,
                    offset: { type: 'integer', minimum: 1, maximum: 100 },
                    frame: { type: 'string', enum: ['partition', 'cumulative', 'rolling'] },
                    rows: { type: 'integer', minimum: 1, maximum: 100 },
                    as: analyticFieldSchema,
                  },
                  required: ['function', 'as'],
                },
              },
            },
            required: ['operation', 'partitionBy', 'sortBy', 'measures'],
          },
          {
            type: 'object', additionalProperties: false,
            properties: {
              operation: { type: 'string', const: 'calculate' }, as: analyticFieldSchema,
              operator: { type: 'string', enum: CALCULATE_OPERATORS }, left: analyticFieldSchema,
              right: {
                type: 'object', additionalProperties: false,
                properties: { field: analyticFieldSchema, value: { type: 'number' } },
              },
            },
            required: ['operation', 'as', 'operator', 'left', 'right'],
          },
          {
            type: 'object', additionalProperties: false,
            properties: {
              operation: { type: 'string', const: 'filter' }, field: analyticFieldSchema,
              operator: { type: 'string', enum: FILTER_OPERATORS },
              value: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }, { type: 'array', maxItems: 30, items: { type: ['string', 'number', 'boolean', 'null'] } }] },
            },
            required: ['operation', 'field', 'operator', 'value'],
          },
          {
            type: 'object', additionalProperties: false,
            properties: { operation: { type: 'string', const: 'sort' }, fields: { type: 'array', minItems: 1, maxItems: 4, items: sortFieldSchema } },
            required: ['operation', 'fields'],
          },
          {
            type: 'object', additionalProperties: false,
            properties: { operation: { type: 'string', const: 'limit' }, count: { type: 'integer', minimum: 1, maximum: MAX_RESULT_ROWS } },
            required: ['operation', 'count'],
          },
        ],
      },
    },
    encoding: {
      type: 'object', additionalProperties: false,
      properties: {
        x: analyticFieldSchema, y: analyticFieldSchema, labels: analyticFieldSchema, values: analyticFieldSchema,
        text: analyticFieldSchema, series: analyticFieldSchema,
        hover: { type: 'array', maxItems: 8, items: analyticFieldSchema },
      },
      required: ['hover'],
    },
    resultLimit: { type: 'integer', minimum: 1, maximum: MAX_RESULT_ROWS },
  },
  required: ['source', 'pipeline', 'encoding', 'resultLimit'],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fieldName(value: unknown) {
  return typeof value === 'string' && FIELD_NAME.test(value) ? value : undefined;
}

function fieldNames(value: unknown, maximum: number) {
  if (!Array.isArray(value)) return [];
  return value.map(fieldName).filter((field): field is string => Boolean(field)).slice(0, maximum);
}

function normalizeRelativeDateRange(value: unknown): RelativeDateRange | null {
  if (!isObject(value) || typeof value.preset !== 'string' || !RELATIVE_DATE_PRESETS.includes(value.preset as RelativeDatePreset)) return null;
  return { preset: value.preset as RelativeDatePreset, weekStartsOn: value.weekStartsOn === 'sunday' ? 'sunday' : 'monday' };
}

function normalizeSortFields(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SortField[] => {
    if (!isObject(item)) return [];
    const field = fieldName(item.field);
    return field ? [{ field, direction: item.direction === 'descending' ? 'descending' : 'ascending' }] : [];
  }).slice(0, 4);
}

function normalizeAggregateMeasures(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AggregateMeasure[] => {
    if (!isObject(item) || typeof item.function !== 'string' || !AGGREGATE_FUNCTIONS.includes(item.function as AggregateFunction)) return [];
    const as = fieldName(item.as);
    const field = fieldName(item.field);
    const field2 = fieldName(item.field2);
    const fn = item.function as AggregateFunction;
    if (!as || (fn !== 'count' && !field) || (fn === 'corr' && !field2)) return [];
    return [{ function: fn, field, field2, parameter: fn === 'quantile' && typeof item.parameter === 'number' ? Math.min(1, Math.max(0, item.parameter)) : undefined, as }];
  }).slice(0, MAX_MEASURES);
}

function normalizeWindowMeasures(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): WindowMeasure[] => {
    if (!isObject(item) || typeof item.function !== 'string' || !WINDOW_FUNCTIONS.includes(item.function as WindowFunction)) return [];
    const fn = item.function as WindowFunction;
    const as = fieldName(item.as);
    const field = fieldName(item.field);
    if (!as || (!['rowNumber', 'rank', 'denseRank', 'percentRank'].includes(fn) && !field)) return [];
    return [{
      function: fn,
      field,
      offset: typeof item.offset === 'number' ? Math.min(100, Math.max(1, Math.floor(item.offset))) : 1,
      frame: item.frame === 'cumulative' || item.frame === 'rolling' ? item.frame : 'partition',
      rows: typeof item.rows === 'number' ? Math.min(100, Math.max(1, Math.floor(item.rows))) : 4,
      as,
    }];
  }).slice(0, MAX_MEASURES);
}

function normalizeFilterValue(value: unknown): FilterValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item) => item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean').slice(0, 30);
  return items;
}

function normalizeOperation(value: unknown): AnalyticsOperation | null {
  if (!isObject(value) || typeof value.operation !== 'string') return null;
  if (value.operation === 'groupBy') {
    const fields = fieldNames(value.fields, 4);
    return fields.length ? { operation: 'groupBy', fields } : null;
  }
  if (value.operation === 'aggregate') {
    const measures = normalizeAggregateMeasures(value.measures);
    return measures.length ? { operation: 'aggregate', measures } : null;
  }
  if (value.operation === 'window') {
    const measures = normalizeWindowMeasures(value.measures);
    return measures.length ? { operation: 'window', partitionBy: fieldNames(value.partitionBy, 4), sortBy: normalizeSortFields(value.sortBy), measures } : null;
  }
  if (value.operation === 'calculate') {
    const as = fieldName(value.as);
    const left = fieldName(value.left);
    if (!as || !left || typeof value.operator !== 'string' || !CALCULATE_OPERATORS.includes(value.operator as CalculateOperation['operator']) || !isObject(value.right)) return null;
    const rightField = fieldName(value.right.field);
    const rightValue = typeof value.right.value === 'number' && Number.isFinite(value.right.value) ? value.right.value : undefined;
    if (!rightField && rightValue === undefined) return null;
    return { operation: 'calculate', as, operator: value.operator as CalculateOperation['operator'], left, right: rightField ? { field: rightField } : { value: rightValue } };
  }
  if (value.operation === 'filter') {
    const field = fieldName(value.field);
    const filterValue = normalizeFilterValue(value.value);
    if (!field || filterValue === undefined || typeof value.operator !== 'string' || !FILTER_OPERATORS.includes(value.operator as FilterOperation['operator'])) return null;
    return { operation: 'filter', field, operator: value.operator as FilterOperation['operator'], value: filterValue };
  }
  if (value.operation === 'sort') {
    const fields = normalizeSortFields(value.fields);
    return fields.length ? { operation: 'sort', fields } : null;
  }
  if (value.operation === 'limit' && typeof value.count === 'number') return { operation: 'limit', count: Math.min(MAX_RESULT_ROWS, Math.max(1, Math.floor(value.count))) };
  return null;
}

export function normalizeAnalyticsBinding(value: unknown): AnalyticsBinding | null {
  if (!isObject(value) || !isObject(value.source) || value.source.name !== 'release_calendar' || !isObject(value.source.filters) || !isObject(value.encoding) || !Array.isArray(value.pipeline)) return null;
  const filters = value.source.filters;
  const pipeline = value.pipeline.map(normalizeOperation).filter((operation): operation is AnalyticsOperation => Boolean(operation)).slice(0, MAX_PIPELINE_OPERATIONS);
  if (pipeline.length !== value.pipeline.length) return null;
  const encodingFields = ['x', 'y', 'labels', 'values', 'text', 'series'] as const;
  const encoding: AnalyticsBinding['encoding'] = { hover: fieldNames(value.encoding.hover, 8) };
  for (const key of encodingFields) {
    const field = fieldName(value.encoding[key]);
    if (field) encoding[key] = field;
  }
  if (!encoding.x && !encoding.labels) return null;
  if (!encoding.y && !encoding.values) return null;
  return {
    source: {
      name: 'release_calendar',
      filters: {
        query: typeof filters.query === 'string' ? filters.query.slice(0, 120) : '',
        genre: typeof filters.genre === 'string' && (filters.genre === 'All genres' || GENRES.includes(filters.genre as (typeof GENRES)[number])) ? filters.genre : 'All genres',
        startDate: typeof filters.startDate === 'string' ? filters.startDate : '',
        endDate: typeof filters.endDate === 'string' ? filters.endDate : '',
        relativeDateRange: normalizeRelativeDateRange(filters.relativeDateRange),
      },
    },
    pipeline,
    encoding,
    resultLimit: typeof value.resultLimit === 'number' ? Math.min(MAX_RESULT_ROWS, Math.max(1, Math.floor(value.resultLimit))) : MAX_RESULT_ROWS,
  };
}

function calendarDate(value = new Date()) {
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
}

function addCalendarDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 86_400_000);
}

function isoCalendarDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function resolveDateRange(filters: SourceFilterInput, now = new Date()) {
  const relative = normalizeRelativeDateRange(filters.relativeDateRange);
  if (!relative) return { startDate: typeof filters.startDate === 'string' ? filters.startDate : '', endDate: typeof filters.endDate === 'string' ? filters.endDate : '', relativeDateRange: null };
  const today = calendarDate(now);
  const dayOfWeek = today.getUTCDay();
  const weekOffset = relative.weekStartsOn === 'monday' ? (dayOfWeek + 6) % 7 : dayOfWeek;
  const thisWeekStart = addCalendarDays(today, -weekOffset);
  let start = today;
  let end = today;
  if (relative.preset === 'tomorrow') start = end = addCalendarDays(today, 1);
  else if (relative.preset === 'this_week') { start = thisWeekStart; end = addCalendarDays(thisWeekStart, 6); }
  else if (relative.preset === 'next_week') { start = addCalendarDays(thisWeekStart, 7); end = addCalendarDays(start, 6); }
  else if (relative.preset === 'next_7_days') end = addCalendarDays(today, 6);
  else if (relative.preset === 'next_30_days') end = addCalendarDays(today, 29);
  else if (relative.preset === 'next_90_days') end = addCalendarDays(today, 89);
  else if (relative.preset === 'this_month') { start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)); }
  else if (relative.preset === 'next_month') { start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)); end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0)); }
  return { startDate: isoCalendarDate(start), endDate: isoCalendarDate(end), relativeDateRange: relative };
}

export function filterReleaseGames(filters: SourceFilterInput, now = new Date()) {
  const query = typeof filters.query === 'string' ? filters.query.trim().toLocaleLowerCase() : '';
  const genre = typeof filters.genre === 'string' ? filters.genre : 'All genres';
  const { startDate, endDate } = resolveDateRange(filters, now);
  return GAMES.filter((game) => {
    const haystack = `${game.title} ${game.studio} ${game.genre}`.toLocaleLowerCase();
    return (!query || haystack.includes(query))
      && (genre === 'All genres' || game.genre === genre || game.secondaryGenre === genre)
      && (!startDate || game.releaseDate >= startDate)
      && (!endDate || game.releaseDate <= endDate);
  });
}

function weekStart(date: string, weekStartsOn: 'monday' | 'sunday') {
  const value = new Date(`${date}T00:00:00Z`);
  const offset = weekStartsOn === 'monday' ? (value.getUTCDay() + 6) % 7 : value.getUTCDay();
  return isoCalendarDate(addCalendarDays(value, -offset));
}

export function releaseAnalyticsRow(game: Game, now = new Date(), weekStartsOn: 'monday' | 'sunday' = 'monday') {
  const today = calendarDate(now).getTime();
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
  return {
    ...game,
    daysUntilRelease: Math.ceil((new Date(`${game.releaseDate}T00:00:00Z`).getTime() - today) / 86_400_000),
    releaseWeek: weekStart(game.releaseDate, weekStartsOn),
    releaseMonth: game.releaseDate.slice(0, 7),
    releaseWeekday: weekday.format(new Date(`${game.releaseDate}T00:00:00Z`)),
  };
}

function analyticsRows(games: Game[], now = new Date(), weekStartsOn: 'monday' | 'sunday' = 'monday') {
  return games.map((game) => releaseAnalyticsRow(game, now, weekStartsOn));
}

function ensureColumns(table: { columnNames(): string[] }, fields: string[]) {
  const available = new Set(table.columnNames());
  for (const field of fields) if (!available.has(field)) throw new Error(`Unknown analytics field: ${field}.`);
}

function aggregateExpression(aq: typeof import('arquero'), measure: AggregateMeasure) {
  if (measure.function === 'count') return aq.op.count();
  const field = measure.field!;
  if (measure.function === 'valid') return aq.op.valid(field);
  if (measure.function === 'distinct') return aq.op.distinct(field);
  if (measure.function === 'sum') return aq.op.sum(field);
  if (measure.function === 'mean') return aq.op.mean(field);
  if (measure.function === 'median') return aq.op.median(field);
  if (measure.function === 'min') return aq.op.min(field);
  if (measure.function === 'max') return aq.op.max(field);
  if (measure.function === 'quantile') return aq.op.quantile(field, measure.parameter ?? 0.5);
  if (measure.function === 'stdev') return aq.op.stdev(field);
  if (measure.function === 'variance') return aq.op.variance(field);
  return aq.op.corr(field, measure.field2!);
}

function windowExpression(aq: typeof import('arquero'), measure: WindowMeasure) {
  if (measure.function === 'rowNumber') return aq.op.row_number();
  if (measure.function === 'rank') return aq.op.rank();
  if (measure.function === 'denseRank') return aq.op.dense_rank();
  if (measure.function === 'percentRank') return aq.op.percent_rank();
  if (measure.function === 'lag') return aq.op.lag(measure.field!, measure.offset);
  if (measure.function === 'lead') return aq.op.lead(measure.field!, measure.offset);
  const aggregate = measure.function === 'sum' ? aq.op.sum(measure.field!)
    : measure.function === 'median' ? aq.op.median(measure.field!)
      : measure.function === 'stdev' ? aq.op.stdev(measure.field!)
        : aq.op.mean(measure.field!);
  const frame: [number, number] = measure.frame === 'partition' ? [-Infinity, Infinity]
    : measure.frame === 'cumulative' ? [-Infinity, 0]
      : [-(measure.rows - 1), 0];
  return aq.rolling(aggregate as unknown as object, frame);
}

function compare(left: unknown, operator: FilterOperation['operator'], right: FilterValue) {
  if (operator === 'in') return Array.isArray(right) && right.includes(left as never);
  if (operator === 'equal') return left === right;
  if (operator === 'notEqual') return left !== right;
  if (typeof left !== 'number' || typeof right !== 'number') return false;
  if (operator === 'greaterThan') return left > right;
  if (operator === 'greaterOrEqual') return left >= right;
  if (operator === 'lessThan') return left < right;
  return left <= right;
}

let arqueroPromise: Promise<typeof import('arquero')> | null = null;

async function loadArquero() {
  arqueroPromise ??= import('arquero');
  return arqueroPromise;
}

export async function runAnalyticsBinding(binding: AnalyticsBinding, now = new Date()) {
  const aq = await loadArquero();
  const weekStartsOn = binding.source.filters.relativeDateRange?.weekStartsOn ?? 'monday';
  let table = aq.from(analyticsRows(filterReleaseGames(binding.source.filters, now), now, weekStartsOn));
  let pendingGroups: string[] = [];

  for (const operation of binding.pipeline) {
    if (operation.operation === 'groupBy') {
      ensureColumns(table, operation.fields);
      pendingGroups = operation.fields;
      continue;
    }
    if (operation.operation === 'aggregate') {
      const inputFields = operation.measures.flatMap((measure) => [measure.field, measure.field2].filter((field): field is string => Boolean(field)));
      ensureColumns(table, [...pendingGroups, ...inputFields]);
      const expressions = Object.fromEntries(operation.measures.map((measure) => [measure.as, aggregateExpression(aq, measure)]));
      table = (pendingGroups.length ? table.groupby(...pendingGroups) : table.ungroup()).rollup(expressions).ungroup();
      pendingGroups = [];
      continue;
    }
    if (pendingGroups.length) throw new Error('A groupBy operation must be followed immediately by aggregate.');
    if (operation.operation === 'window') {
      const fields = [...operation.partitionBy, ...operation.sortBy.map((item) => item.field), ...operation.measures.flatMap((measure) => measure.field ? [measure.field] : [])];
      ensureColumns(table, fields);
      const sort = operation.sortBy.map((item) => item.direction === 'descending' ? aq.desc(item.field) : item.field);
      let windowTable = operation.partitionBy.length ? table.groupby(...operation.partitionBy) : table.ungroup();
      if (sort.length) windowTable = windowTable.orderby(...sort);
      const expressions = Object.fromEntries(operation.measures.map((measure) => [measure.as, windowExpression(aq, measure)]));
      table = windowTable.derive(expressions).ungroup();
    } else if (operation.operation === 'calculate') {
      ensureColumns(table, [operation.left, ...(operation.right.field ? [operation.right.field] : [])]);
      const calculation = aq.escape((row: Record<string, unknown>) => {
        const left = Number(row[operation.left]);
        const right = operation.right.field ? Number(row[operation.right.field]) : operation.right.value!;
        if (operation.operator === 'add') return left + right;
        if (operation.operator === 'subtract') return left - right;
        if (operation.operator === 'multiply') return left * right;
        return right === 0 ? null : left / right;
      });
      table = table.derive({ [operation.as]: calculation });
    } else if (operation.operation === 'filter') {
      ensureColumns(table, [operation.field]);
      table = table.filter(aq.escape((row: Record<string, unknown>) => compare(row[operation.field], operation.operator, operation.value)));
    } else if (operation.operation === 'sort') {
      ensureColumns(table, operation.fields.map((item) => item.field));
      table = table.orderby(...operation.fields.map((item) => item.direction === 'descending' ? aq.desc(item.field) : item.field));
    } else if (operation.operation === 'limit') {
      table = table.slice(0, operation.count);
    }
  }
  if (pendingGroups.length) throw new Error('A groupBy operation must be followed by aggregate.');
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
    const key = binding.encoding.series ? String(row[binding.encoding.series] ?? 'Unspecified') : '';
    const group = grouped.get(key);
    if (group) group.push(row);
    else grouped.set(key, [row]);
  }
  if (!grouped.size) grouped.set('', []);
  const data = Array.from(grouped.entries()).slice(0, 12).map(([name, groupRows], index) => {
    const namedTemplate = figure.data.find((trace) => typeof trace.name === 'string' && trace.name === name);
    const trace = clearTraceData(namedTemplate ?? figure.data[index % figure.data.length] ?? { type: 'scatter' });
    if (binding.encoding.series) trace.name = name;
    if (binding.encoding.x) trace.x = groupRows.map((row) => row[binding.encoding.x!]);
    if (binding.encoding.y) trace.y = groupRows.map((row) => row[binding.encoding.y!]);
    if (binding.encoding.labels) trace.labels = groupRows.map((row) => row[binding.encoding.labels!]);
    if (binding.encoding.values) trace.values = groupRows.map((row) => row[binding.encoding.values!]);
    if (binding.encoding.text) trace.text = groupRows.map((row) => String(row[binding.encoding.text!] ?? ''));
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
