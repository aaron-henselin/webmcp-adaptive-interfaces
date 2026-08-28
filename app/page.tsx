'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { GAMES, GENRES, Game, daysFromLaunch, formatDate, formatPrice } from './release-data';
import { PlotlyCanvas, PlotlyFigure, PLOTLY_TRACE_TYPES, normalizePlotlyFigure } from './plotly-visualization';

type SortKey = 'releaseDate' | 'title' | 'price' | 'wishlists';
type SortDirection = 'asc' | 'desc';
type ChartType = 'genre' | 'timeline' | 'price';
type ChartItem = { label: string; value: number };
type Visualization = { type: ChartType; title: string; subtitle: string; items: ChartItem[] };
type ReleaseField = 'id' | 'title' | 'releaseDate' | 'genre' | 'secondaryGenre' | 'price' | 'status' | 'studio' | 'wishlists';
type DerivedReleaseField = 'daysUntilRelease' | 'releaseWeek' | 'releaseMonth' | 'releaseWeekday';
type BindingField = ReleaseField | DerivedReleaseField;
type RelativeDatePreset = 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'next_7_days' | 'next_30_days' | 'next_90_days' | 'this_month' | 'next_month';
type RelativeDateRange = { preset: RelativeDatePreset; weekStartsOn: 'monday' | 'sunday' };
type ReleaseDataBinding = {
  source: 'release_calendar';
  query: string;
  genre: string;
  startDate: string;
  endDate: string;
  relativeDateRange: RelativeDateRange | null;
  limit: number;
  xField?: BindingField;
  yField?: BindingField;
  labelsField?: BindingField;
  valuesField?: BindingField;
  textField?: BindingField;
  groupByField?: BindingField;
  hoverFields: BindingField[];
};
type SavedReport = { id: string; savedAt: string; figure: PlotlyFigure; binding: ReleaseDataBinding | null };

const PAGE_SIZE = 12;
const MAX_SAVED_REPORTS = 8;
const SAVED_REPORTS_KEY = 'steam-desk:saved-reports:v1';
const RELEASE_FIELDS: ReleaseField[] = ['id', 'title', 'releaseDate', 'genre', 'secondaryGenre', 'price', 'status', 'studio', 'wishlists'];
const DERIVED_RELEASE_FIELDS: DerivedReleaseField[] = ['daysUntilRelease', 'releaseWeek', 'releaseMonth', 'releaseWeekday'];
const BINDING_FIELDS: BindingField[] = [...RELEASE_FIELDS, ...DERIVED_RELEASE_FIELDS];
const RELATIVE_DATE_PRESETS: RelativeDatePreset[] = ['today', 'tomorrow', 'this_week', 'next_week', 'next_7_days', 'next_30_days', 'next_90_days', 'this_month', 'next_month'];
const RELATIVE_DATE_RANGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description: 'A date window resolved again whenever the tool runs or a saved report is reopened. next_week means the next calendar week.',
  properties: {
    preset: { type: 'string', enum: RELATIVE_DATE_PRESETS },
    weekStartsOn: { type: 'string', enum: ['monday', 'sunday'], default: 'monday' },
  },
  required: ['preset'],
};

const coverMarks = ['◜', '◇', '◉', '⌁', '△', '✣', '⊙', '╱'];

function windowLimit(value: string) {
  if (value === '30') return 30;
  if (value === '90') return 90;
  if (value === '180') return 180;
  return Number.POSITIVE_INFINITY;
}

function sortGames(games: Game[], key: SortKey, direction: SortDirection) {
  return [...games].sort((a, b) => {
    let result = 0;
    if (key === 'price') result = (a.price ?? 0) - (b.price ?? 0);
    else if (key === 'wishlists') result = a.wishlists - b.wishlists;
    else result = a[key].localeCompare(b[key]);
    return direction === 'asc' ? result : -result;
  });
}

function filterGames(search: string, genre: string, days: string) {
  const query = search.trim().toLocaleLowerCase();
  const maxDays = windowLimit(days);
  return GAMES.filter((game) => {
    const matchesQuery = !query || `${game.title} ${game.studio} ${game.genre}`.toLocaleLowerCase().includes(query);
    const matchesGenre = genre === 'All genres' || game.genre === genre || game.secondaryGenre === genre;
    return matchesQuery && matchesGenre && daysFromLaunch(game.releaseDate) <= maxDays;
  });
}

function makeVisualization(type: ChartType, games: Game[]): Visualization {
  if (type === 'timeline') {
    const items = Array.from({ length: 12 }, (_, week) => ({
      label: week === 0 ? 'Now' : `W${week + 1}`,
      value: games.filter((game) => {
        const day = daysFromLaunch(game.releaseDate) - 1;
        return day >= week * 7 && day < (week + 1) * 7;
      }).length,
    }));
    return { type, title: 'Release cadence', subtitle: `${games.length.toLocaleString()} releases across the next 12 weeks`, items };
  }

  if (type === 'price') {
    const bands = [
      { label: 'Free', test: (game: Game) => game.price === null },
      { label: '< $20', test: (game: Game) => game.price !== null && game.price < 20 },
      { label: '$20–39', test: (game: Game) => game.price !== null && game.price >= 20 && game.price < 40 },
      { label: '$40–59', test: (game: Game) => game.price !== null && game.price >= 40 && game.price < 60 },
      { label: '$60+', test: (game: Game) => game.price !== null && game.price >= 60 },
    ];
    return { type, title: 'Price bands', subtitle: `Launch pricing for ${games.length.toLocaleString()} matching games`, items: bands.map((band) => ({ label: band.label, value: games.filter(band.test).length })) };
  }

  const items = GENRES.map((label) => ({ label, value: games.filter((game) => game.genre === label).length }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  return { type, title: 'Genre mix', subtitle: `Top genres across ${games.length.toLocaleString()} matching games`, items };
}

function statusLabel(game: Game) {
  if (game.status === 'Early access') return 'Early access';
  if (game.status === 'Announced') return 'Date TBA';
  const days = daysFromLaunch(game.releaseDate);
  if (days === 1) return 'Tomorrow';
  if (days < 8) return `In ${days} days`;
  return `In ${Math.ceil(days / 7)} weeks`;
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

function normalizeRelativeDateRange(value: unknown): RelativeDateRange | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.preset !== 'string' || !RELATIVE_DATE_PRESETS.includes(input.preset as RelativeDatePreset)) return null;
  return {
    preset: input.preset as RelativeDatePreset,
    weekStartsOn: input.weekStartsOn === 'sunday' ? 'sunday' : 'monday',
  };
}

function resolveDateRange(input: Record<string, unknown>, now = new Date()) {
  const relative = normalizeRelativeDateRange(input.relativeDateRange);
  if (!relative) {
    return {
      startDate: typeof input.startDate === 'string' ? input.startDate : '',
      endDate: typeof input.endDate === 'string' ? input.endDate : '',
      relativeDateRange: null,
    };
  }

  const today = calendarDate(now);
  const dayOfWeek = today.getUTCDay();
  const weekOffset = relative.weekStartsOn === 'monday' ? (dayOfWeek + 6) % 7 : dayOfWeek;
  const thisWeekStart = addCalendarDays(today, -weekOffset);
  let start = today;
  let end = today;

  if (relative.preset === 'tomorrow') start = end = addCalendarDays(today, 1);
  else if (relative.preset === 'this_week') {
    start = thisWeekStart;
    end = addCalendarDays(thisWeekStart, 6);
  } else if (relative.preset === 'next_week') {
    start = addCalendarDays(thisWeekStart, 7);
    end = addCalendarDays(start, 6);
  } else if (relative.preset === 'next_7_days') end = addCalendarDays(today, 6);
  else if (relative.preset === 'next_30_days') end = addCalendarDays(today, 29);
  else if (relative.preset === 'next_90_days') end = addCalendarDays(today, 89);
  else if (relative.preset === 'this_month') {
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  } else if (relative.preset === 'next_month') {
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0));
  }

  return { startDate: isoCalendarDate(start), endDate: isoCalendarDate(end), relativeDateRange: relative };
}

function normalizeToolGames(input: Record<string, unknown>, now = new Date()) {
  const search = typeof input.query === 'string' ? input.query : '';
  const genre = typeof input.genre === 'string' && GENRES.includes(input.genre as (typeof GENRES)[number]) ? input.genre : 'All genres';
  const { startDate, endDate } = resolveDateRange(input, now);
  return GAMES.filter((game) => {
    const haystack = `${game.title} ${game.studio} ${game.genre}`.toLocaleLowerCase();
    return (!search || haystack.includes(search.toLocaleLowerCase()))
      && (genre === 'All genres' || game.genre === genre || game.secondaryGenre === genre)
      && (!startDate || game.releaseDate >= startDate)
      && (!endDate || game.releaseDate <= endDate);
  });
}

function bindingField(value: unknown): BindingField | undefined {
  return typeof value === 'string' && BINDING_FIELDS.includes(value as BindingField) ? value as BindingField : undefined;
}

function normalizeReleaseBinding(value: unknown): ReleaseDataBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.source !== 'release_calendar') return null;
  const hoverFields = Array.isArray(input.hoverFields)
    ? input.hoverFields.map(bindingField).filter((field): field is BindingField => Boolean(field)).slice(0, 8)
    : [];
  const requestedLimit = typeof input.limit === 'number' ? Math.floor(input.limit) : 2000;
  return {
    source: 'release_calendar',
    query: typeof input.query === 'string' ? input.query.slice(0, 120) : '',
    genre: typeof input.genre === 'string' ? input.genre : 'All genres',
    startDate: typeof input.startDate === 'string' ? input.startDate : '',
    endDate: typeof input.endDate === 'string' ? input.endDate : '',
    relativeDateRange: normalizeRelativeDateRange(input.relativeDateRange),
    limit: Math.min(2000, Math.max(1, requestedLimit)),
    xField: bindingField(input.xField),
    yField: bindingField(input.yField),
    labelsField: bindingField(input.labelsField),
    valuesField: bindingField(input.valuesField),
    textField: bindingField(input.textField),
    groupByField: bindingField(input.groupByField),
    hoverFields,
  };
}

function bindingValue(game: Game, field: BindingField, now: Date, weekStartsOn: 'monday' | 'sunday') {
  if (RELEASE_FIELDS.includes(field as ReleaseField)) return game[field as ReleaseField];
  if (field === 'releaseMonth') return game.releaseDate.slice(0, 7);

  const release = new Date(game.releaseDate + 'T00:00:00Z');
  if (field === 'daysUntilRelease') return Math.round((release.getTime() - calendarDate(now).getTime()) / 86_400_000);
  if (field === 'releaseWeekday') return new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(release);

  const dayOfWeek = release.getUTCDay();
  const weekOffset = weekStartsOn === 'monday' ? (dayOfWeek + 6) % 7 : dayOfWeek;
  return isoCalendarDate(addCalendarDays(release, -weekOffset));
}

function regenerateSavedFigure(report: SavedReport) {
  if (!report.binding) return normalizePlotlyFigure(report.figure as unknown as Record<string, unknown>);

  const binding = report.binding;
  const now = new Date();
  const games = sortGames(normalizeToolGames(binding as unknown as Record<string, unknown>, now), 'releaseDate', 'asc').slice(0, binding.limit);
  const weekStartsOn = binding.relativeDateRange?.weekStartsOn ?? 'monday';
  const grouped = new Map<string, Game[]>();
  for (const game of games) {
    const key = binding.groupByField ? String(bindingValue(game, binding.groupByField, now, weekStartsOn) ?? 'Unspecified') : '';
    const existing = grouped.get(key);
    if (existing) existing.push(game);
    else grouped.set(key, [game]);
  }

  const groups = (grouped.size ? Array.from(grouped.entries()) : [['', []] as [string, Game[]]]).slice(0, 12);
  const data = groups.map(([name, rows], index) => {
    const namedTemplate = report.figure.data.find((trace) => typeof trace.name === 'string' && trace.name === name);
    const template = namedTemplate ?? report.figure.data[index % report.figure.data.length] ?? { type: 'scatter' };
    const trace: Record<string, unknown> = { ...template };
    delete trace.x;
    delete trace.y;
    delete trace.labels;
    delete trace.values;
    delete trace.text;
    delete trace.customdata;
    if (binding.groupByField) trace.name = name;
    if (binding.xField) trace.x = rows.map((game) => bindingValue(game, binding.xField!, now, weekStartsOn));
    if (binding.yField) trace.y = rows.map((game) => bindingValue(game, binding.yField!, now, weekStartsOn));
    if (binding.labelsField) trace.labels = rows.map((game) => bindingValue(game, binding.labelsField!, now, weekStartsOn));
    if (binding.valuesField) trace.values = rows.map((game) => bindingValue(game, binding.valuesField!, now, weekStartsOn));
    if (binding.textField) trace.text = rows.map((game) => String(bindingValue(game, binding.textField!, now, weekStartsOn) ?? ''));
    if (binding.hoverFields.length) trace.customdata = rows.map((game) => binding.hoverFields.map((field) => bindingValue(game, field, now, weekStartsOn)));
    return trace;
  });

  return normalizePlotlyFigure({
    title: report.figure.title,
    description: report.figure.description,
    data: data.length ? data : report.figure.data,
    layout: report.figure.layout,
  });
}

function savedAtLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Saved locally';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function bindingLabel(binding: ReleaseDataBinding | null) {
  if (!binding) return 'Snapshot · Plotly spec';
  const preset = binding.relativeDateRange?.preset;
  return preset ? 'Live · ' + preset.replaceAll('_', ' ') : 'Live · release calendar';
}

function BarChart({ visualization }: { visualization: Visualization }) {
  const max = Math.max(...visualization.items.map((item) => item.value), 1);
  return (
    <div className={`chart chart-${visualization.type}`} role="img" aria-label={`${visualization.title}. ${visualization.items.map((item) => `${item.label}: ${item.value}`).join(', ')}`}>
      {visualization.items.map((item) => (
        <div className="bar-column" key={item.label}>
          <span className="bar-value">{item.value.toLocaleString()}</span>
          <div className="bar-rail"><span style={{ height: `${Math.max(5, (item.value / max) * 100)}%` }} /></div>
          <span className="bar-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('All genres');
  const [dateWindow, setDateWindow] = useState('90');
  const [sortKey, setSortKey] = useState<SortKey>('releaseDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(0);
  const [webMcpStatus, setWebMcpStatus] = useState<'checking' | 'connected' | 'preview'>('checking');
  const [visualization, setVisualization] = useState<Visualization | null>(null);
  const [customVisualization, setCustomVisualization] = useState<PlotlyFigure | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [savedReportsReady, setSavedReportsReady] = useState(false);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const visualizationRef = useRef<HTMLElement>(null);
  const customVisualizationRef = useRef<HTMLElement>(null);

  const filtered = useMemo(() => sortGames(filterGames(search, genre, dateWindow), sortKey, sortDirection), [search, genre, dateWindow, sortKey, sortDirection]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => { setPage(0); }, [search, genre, dateWindow]);
  useEffect(() => { if (page >= totalPages) setPage(totalPages - 1); }, [page, totalPages]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SAVED_REPORTS_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return;
      const restored = parsed.flatMap((item): SavedReport[] => {
        try {
          if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.figure) return [];
          return [{
            id: item.id,
            savedAt: typeof item.savedAt === 'string' ? item.savedAt : new Date().toISOString(),
            figure: normalizePlotlyFigure(item.figure as Record<string, unknown>),
            binding: normalizeReleaseBinding(item.binding),
          }];
        } catch {
          return [];
        }
      }).slice(0, MAX_SAVED_REPORTS);
      setSavedReports(restored);
    } catch {
      // Ignore malformed or unavailable browser storage and start with an empty shelf.
    } finally {
      setSavedReportsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!savedReportsReady) return;
    try {
      window.localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(savedReports));
    } catch {
      // A report remains usable for this session if the browser refuses persistence.
    }
  }, [savedReports, savedReportsReady]);

  useEffect(() => {
    const context = document.modelContext ?? navigator.modelContext;
    if (!context) {
      setWebMcpStatus('preview');
      return;
    }

    const controller = new AbortController();
    const showChart = (type: ChartType, games: Game[]) => {
      const next = makeVisualization(type, games);
      setVisualization(next);
      window.setTimeout(() => visualizationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
      return next;
    };
    const showCustomFigure = (input: Record<string, unknown>) => {
      const next = normalizePlotlyFigure(input);
      const report: SavedReport = {
        id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'report-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        savedAt: new Date().toISOString(),
        figure: next,
        binding: normalizeReleaseBinding(input.binding),
      };
      setSavedReports((current) => [report, ...current].slice(0, MAX_SAVED_REPORTS));
      setActiveReportId(report.id);
      setCustomVisualization(next);
      window.setTimeout(() => customVisualizationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
      return report;
    };

    const tools = [
      {
        name: 'read_release_calendar',
        description: 'Read synthetic Steam release-calendar rows. Filter by query, genre, absolute ISO dates, or a dynamic relative window such as next_week.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: {
            query: { type: 'string', description: 'Title, studio, or genre text to match.' },
            genre: { type: 'string', enum: [...GENRES] },
            startDate: { type: 'string', description: 'Inclusive ISO date, YYYY-MM-DD.' },
            endDate: { type: 'string', description: 'Inclusive ISO date, YYYY-MM-DD.' },
            relativeDateRange: RELATIVE_DATE_RANGE_SCHEMA,
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          },
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const now = new Date();
          const resolvedDateRange = resolveDateRange(input, now);
          const matches = sortGames(normalizeToolGames(input, now), 'releaseDate', 'asc');
          const limit = Math.min(100, Math.max(1, typeof input.limit === 'number' ? Math.floor(input.limit) : 25));
          const rows = matches.slice(0, limit).map((game) => ({
            id: game.id, title: game.title, releaseDate: game.releaseDate, genre: game.genre,
            secondaryGenre: game.secondaryGenre, price: game.price, status: game.status,
            studio: game.studio, wishlists: game.wishlists,
            daysUntilRelease: bindingValue(game, 'daysUntilRelease', now, resolvedDateRange.relativeDateRange?.weekStartsOn ?? 'monday'),
            releaseWeek: bindingValue(game, 'releaseWeek', now, resolvedDateRange.relativeDateRange?.weekStartsOn ?? 'monday'),
            releaseMonth: bindingValue(game, 'releaseMonth', now, resolvedDateRange.relativeDateRange?.weekStartsOn ?? 'monday'),
            releaseWeekday: bindingValue(game, 'releaseWeekday', now, resolvedDateRange.relativeDateRange?.weekStartsOn ?? 'monday'),
          }));
          return {
            content: [{ type: 'text', text: `Found ${matches.length.toLocaleString()} synthetic releases; returning ${rows.length}.` }],
            structuredContent: { total: matches.length, returned: rows.length, synthetic: true, resolvedDateRange, releases: rows },
          };
        },
      },
      {
        name: 'summarize_release_calendar',
        description: 'Summarize synthetic Steam releases by genre, price band, or upcoming week.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: {
            groupBy: { type: 'string', enum: ['genre', 'timeline', 'price'], default: 'genre' },
            query: { type: 'string' }, genre: { type: 'string', enum: [...GENRES] },
            startDate: { type: 'string' }, endDate: { type: 'string' },
            relativeDateRange: RELATIVE_DATE_RANGE_SCHEMA,
          },
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const type = input.groupBy === 'timeline' || input.groupBy === 'price' ? input.groupBy : 'genre';
          const chart = makeVisualization(type, normalizeToolGames(input));
          return { content: [{ type: 'text', text: `${chart.title}: ${chart.items.map((item) => `${item.label} ${item.value}`).join(', ')}.` }], structuredContent: chart };
        },
      },
      {
        name: 'render_plotly_visualization',
        description: 'Render and save a bespoke Plotly figure in Steam Desk. Include a release_calendar binding so reopening the saved report regenerates its traces from the current source rows. Call read_release_calendar first, then send complete Plotly-compatible data traces, layout, and field mapping.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', maxLength: 100, description: 'Visible title for the visualization.' },
            description: { type: 'string', maxLength: 220, description: 'Short explanation of the question the figure answers.' },
            data: {
              type: 'array', minItems: 1, maxItems: 12,
              description: 'Plotly data traces. Up to 12 traces and 2,000 total points.',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  type: { type: 'string', enum: [...PLOTLY_TRACE_TYPES] },
                  name: { type: 'string' },
                  x: { type: 'array', maxItems: 2000, items: {} },
                  y: { type: 'array', maxItems: 2000, items: {} },
                  labels: { type: 'array', maxItems: 2000, items: {} },
                  values: { type: 'array', maxItems: 2000, items: {} },
                  mode: { type: 'string' },
                  orientation: { type: 'string', enum: ['h', 'v'] },
                  hole: { type: 'number', minimum: 0, maximum: 0.9 },
                  marker: { type: 'object', additionalProperties: true },
                  line: { type: 'object', additionalProperties: true },
                  text: { type: 'array', maxItems: 2000, items: {} },
                  hovertemplate: { type: 'string' },
                },
              },
            },
            layout: {
              type: 'object',
              additionalProperties: true,
              description: 'Plotly layout options such as axes, legend, annotations, shapes, barmode, hovermode, and margins.',
            },
            binding: {
              type: 'object',
              additionalProperties: false,
              description: 'Live binding used to regenerate the saved report from Steam Desk release rows.',
              properties: {
                source: { type: 'string', const: 'release_calendar' },
                query: { type: 'string', maxLength: 120 },
                genre: { type: 'string', enum: ['All genres', ...GENRES] },
                startDate: { type: 'string', description: 'Inclusive ISO date, YYYY-MM-DD.' },
                endDate: { type: 'string', description: 'Inclusive ISO date, YYYY-MM-DD.' },
                relativeDateRange: RELATIVE_DATE_RANGE_SCHEMA,
                limit: { type: 'integer', minimum: 1, maximum: 2000, default: 2000 },
                xField: { type: 'string', enum: BINDING_FIELDS },
                yField: { type: 'string', enum: BINDING_FIELDS },
                labelsField: { type: 'string', enum: BINDING_FIELDS },
                valuesField: { type: 'string', enum: BINDING_FIELDS },
                textField: { type: 'string', enum: BINDING_FIELDS },
                groupByField: { type: 'string', enum: BINDING_FIELDS },
                hoverFields: { type: 'array', maxItems: 8, items: { type: 'string', enum: BINDING_FIELDS } },
              },
              required: ['source'],
            },
          },
          required: ['title', 'data', 'binding'],
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const report = showCustomFigure(input);
          const figure = report.figure;
          return {
            content: [{ type: 'text', text: `Rendered bespoke Plotly visualization “${figure.title}” with ${figure.traceCount} trace${figure.traceCount === 1 ? '' : 's'} and ${figure.pointCount.toLocaleString()} points.` }],
            structuredContent: { displayed: true, saved: true, reportId: report.id, renderer: 'plotly', binding: report.binding, title: figure.title, traceCount: figure.traceCount, pointCount: figure.pointCount },
          };
        },
      },
      {
        name: 'show_release_visualization',
        description: 'Show one of three quick preset summaries. Prefer render_plotly_visualization when the user asks for a bespoke chart.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['genre', 'timeline', 'price'], description: 'Chart grouping to render.' },
            query: { type: 'string' }, genre: { type: 'string', enum: [...GENRES] },
            startDate: { type: 'string' }, endDate: { type: 'string' },
            relativeDateRange: RELATIVE_DATE_RANGE_SCHEMA,
          }, required: ['type'],
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const type: ChartType = input.type === 'timeline' || input.type === 'price' ? input.type : 'genre';
          const chart = showChart(type, normalizeToolGames(input));
          return { content: [{ type: 'text', text: `Displayed “${chart.title}” in the page for ${normalizeToolGames(input).length.toLocaleString()} matching releases.` }], structuredContent: { displayed: true, ...chart } };
        },
      },
    ];

    Promise.all(tools.map((tool) => context.registerTool(tool, { signal: controller.signal })))
      .then(() => setWebMcpStatus('connected'))
      .catch(() => setWebMcpStatus('preview'));
    return () => controller.abort();
  }, []);

  function changeSort(next: SortKey) {
    if (next === sortKey) setSortDirection((value) => value === 'asc' ? 'desc' : 'asc');
    else { setSortKey(next); setSortDirection('asc'); }
  }

  function renderChart(type: ChartType = 'genre') {
    setVisualization(makeVisualization(type, filtered));
    window.setTimeout(() => visualizationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }

  function openSavedReport(report: SavedReport) {
    const regenerated = regenerateSavedFigure(report);
    setCustomVisualization(regenerated);
    setActiveReportId(report.id);
    window.setTimeout(() => customVisualizationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }

  function deleteSavedReport(id: string) {
    setSavedReports((current) => current.filter((report) => report.id !== id));
    if (activeReportId === id) setActiveReportId(null);
  }

  const activeSavedReport = savedReports.find((report) => report.id === activeReportId) ?? null;
  const start = filtered.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, filtered.length);

  return (
    <main className="site-shell">
      <section className="release-desk" aria-labelledby="page-title">
        <header className="desk-header">
          <div>
            <p className="eyebrow"><span /> Steam release calendar</p>
            <h1 id="page-title">Steam Desk</h1>
            <p className="dek">A synthetic calendar for testing what launches next.</p>
          </div>
          <div className="header-meta">
            <div className={`agent-state state-${webMcpStatus}`}><span />{webMcpStatus === 'connected' ? 'WebMCP connected' : webMcpStatus === 'preview' ? 'WebMCP preview' : 'Checking WebMCP'}</div>
            <div className="catalog-status"><strong>{GAMES.length.toLocaleString()}</strong><span>generated releases</span></div>
          </div>
        </header>

        <div className="toolbar" aria-label="Release filters">
          <label className="search-field"><span className="sr-only">Search games</span><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles, studios, genres" /></label>
          <label className="select-field"><span className="sr-only">Date range</span><select value={dateWindow} onChange={(event) => setDateWindow(event.target.value)}><option value="30">Next 30 days</option><option value="90">Next 90 days</option><option value="180">Next 6 months</option><option value="all">All dates</option></select></label>
          <label className="select-field"><span className="sr-only">Genre</span><select value={genre} onChange={(event) => setGenre(event.target.value)}><option>All genres</option>{GENRES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <button type="button" className="view-button" onClick={() => renderChart('genre')}>Visualize <span>↗</span></button>
        </div>

        <div className="result-strip"><span><strong>{filtered.length.toLocaleString()}</strong> releases match</span><button type="button" onClick={() => { setSearch(''); setGenre('All genres'); setDateWindow('90'); }}>Reset filters</button></div>

        <div className="table-wrap">
          <table>
            <thead><tr>
              <th><button type="button" onClick={() => changeSort('title')}>Game <span>{sortKey === 'title' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>
              <th><button type="button" onClick={() => changeSort('releaseDate')}>Release <span>{sortKey === 'releaseDate' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>
              <th>Genre</th>
              <th><button type="button" onClick={() => changeSort('price')}>Price <span>{sortKey === 'price' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>
              <th><button type="button" onClick={() => changeSort('wishlists')}>Wishlists <span>{sortKey === 'wishlists' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>
              <th>Status</th>
            </tr></thead>
            <tbody>
              {visible.map((game) => (
                <tr key={game.id}>
                  <td><div className="game-cell"><span className={`cover cover-${game.accent}`} aria-hidden="true"><i>{coverMarks[game.accent]}</i><b>{game.title.split(' ').map((word) => word[0]).slice(0, 2).join('')}</b></span><span><strong>{game.title}</strong><small>{game.studio}</small></span></div></td>
                  <td className="date-cell"><span className="track-dot" />{formatDate(game.releaseDate)}</td>
                  <td><span className="genre-pill">{game.genre}</span></td>
                  <td className="price-cell">{formatPrice(game.price)}</td>
                  <td className="wishlist-cell">{game.wishlists.toLocaleString()}</td>
                  <td><span className={`status ${daysFromLaunch(game.releaseDate) < 8 ? 'soon' : ''}`}>{statusLabel(game)}</span></td>
                </tr>
              ))}
              {visible.length === 0 && <tr><td colSpan={6}><div className="empty-state"><strong>No releases found</strong><span>Try a broader search or reset the filters.</span></div></td></tr>}
            </tbody>
          </table>
        </div>

        <footer className="desk-footer"><span>Showing {start.toLocaleString()}–{end.toLocaleString()} of {filtered.length.toLocaleString()}</span><div><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)} aria-label="Previous page">←</button><span>Page {page + 1} / {totalPages}</span><button type="button" disabled={page >= totalPages - 1} onClick={() => setPage((value) => value + 1)} aria-label="Next page">→</button></div></footer>
      </section>

      <section className="saved-reports" aria-labelledby="saved-reports-title">
        <header className="saved-reports-header">
          <div>
            <p className="eyebrow"><span /> Local workspace</p>
            <h2 id="saved-reports-title">Saved reports</h2>
          </div>
          <span className="saved-reports-count">{savedReports.length} / {MAX_SAVED_REPORTS}</span>
        </header>
        {savedReports.length === 0 ? (
          <div className="saved-reports-empty">
            <span aria-hidden="true">⌁</span>
            <div><strong>No saved reports yet</strong><small>WebMCP Plotly visualizations will appear here with their data bindings.</small></div>
          </div>
        ) : (
          <div className="saved-reports-list">
            {savedReports.map((report) => (
              <article className={'saved-report-card' + (activeReportId === report.id ? ' active' : '')} key={report.id}>
                <button type="button" className="saved-report-open" onClick={() => openSavedReport(report)}>
                  <span className="saved-report-mark">{String(report.figure.data[0]?.type ?? 'plot').slice(0, 4)}</span>
                  <span className="saved-report-copy">
                    <strong>{report.figure.title}</strong>
                    <small>{savedAtLabel(report.savedAt)} · {report.figure.pointCount.toLocaleString()} points</small>
                    <em>{bindingLabel(report.binding)}</em>
                  </span>
                </button>
                <button type="button" className="saved-report-delete" aria-label={'Delete ' + report.figure.title} onClick={() => deleteSavedReport(report.id)}>×</button>
              </article>
            ))}
          </div>
        )}
        <footer className="saved-reports-note"><span>Stored only in this browser</span><span>Open a report to rebuild its traces from the saved binding</span></footer>
      </section>

      {customVisualization && (
        <section className="visualization-panel plotly-panel" ref={customVisualizationRef} aria-live="polite">
          <header>
            <div>
              <p className="eyebrow"><span /> WebMCP · Bespoke figure</p>
              <h2>{customVisualization.title}</h2>
              <p>{customVisualization.description}</p>
            </div>
            <div className="plot-meta" aria-label="Visualization details">
              <span>Plotly 4</span>
              {activeSavedReport?.binding && <span>Live data binding</span>}
              <span>{customVisualization.traceCount} {customVisualization.traceCount === 1 ? 'trace' : 'traces'}</span>
              <span>{customVisualization.pointCount.toLocaleString()} points</span>
            </div>
          </header>
          <PlotlyCanvas figure={customVisualization} />
          <footer>
            <span>{activeSavedReport?.binding ? 'Regenerated from the saved release_calendar binding' : 'Saved as a complete Plotly specification through WebMCP'}</span>
            <button type="button" onClick={() => { setCustomVisualization(null); setActiveReportId(null); }}>Close visualization</button>
          </footer>
        </section>
      )}
      {visualization && (
        <section className="visualization-panel" ref={visualizationRef} aria-live="polite">
          <header><div><p className="eyebrow"><span /> Browser visualization</p><h2>{visualization.title}</h2><p>{visualization.subtitle}</p></div><div className="chart-tabs" aria-label="Visualization type"><button className={visualization.type === 'genre' ? 'active' : ''} onClick={() => renderChart('genre')}>Genre</button><button className={visualization.type === 'timeline' ? 'active' : ''} onClick={() => renderChart('timeline')}>Timeline</button><button className={visualization.type === 'price' ? 'active' : ''} onClick={() => renderChart('price')}>Price</button></div></header>
          <BarChart visualization={visualization} />
          <footer><span>Generated from the same records exposed to WebMCP</span><button type="button" onClick={() => setVisualization(null)}>Close visualization</button></footer>
        </section>
      )}
    </main>
  );
}
