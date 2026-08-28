'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { GAMES, GENRES, Game, daysFromLaunch, formatDate, formatPrice } from './release-data';
import { PlotlyCanvas, PlotlyFigure, PLOTLY_TRACE_TYPES, normalizePlotlyFigure } from './plotly-visualization';
import {
  ANALYTICS_BINDING_SCHEMA,
  AnalyticsBinding,
  RELATIVE_DATE_PRESETS,
  filterReleaseGames,
  normalizeAnalyticsBinding,
  regenerateAnalyticsFigure,
  releaseAnalyticsRow,
  resolveDateRange,
} from './analytics-binding';

type SortKey = 'releaseDate' | 'title' | 'price' | 'wishlists';
type SortDirection = 'asc' | 'desc';
type ChartType = 'genre' | 'timeline' | 'price';
type ChartItem = { label: string; value: number };
type Visualization = { type: ChartType; title: string; subtitle: string; items: ChartItem[] };
type SavedReport = { id: string; savedAt: string; figure: PlotlyFigure; binding: AnalyticsBinding };

const PAGE_SIZE = 12;
const MAX_SAVED_REPORTS = 8;
const SAVED_REPORTS_KEY = 'steam-desk:saved-reports:v2';
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
const PLOTLY_TRACE_SCHEMA = {
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
};
const REPORT_DATA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description: 'The report dataset: source filters, ordered calculations, and the maximum result size.',
  properties: {
    source: ANALYTICS_BINDING_SCHEMA.properties.source,
    pipeline: ANALYTICS_BINDING_SCHEMA.properties.pipeline,
    resultLimit: ANALYTICS_BINDING_SCHEMA.properties.resultLimit,
  },
  required: ['source', 'pipeline', 'resultLimit'],
};
const REPORT_VISUALIZATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description: 'The corresponding Plotly presentation and the fields that bind the report data to visual channels.',
  properties: {
    renderer: { type: 'string', const: 'plotly' },
    traces: { type: 'array', minItems: 1, maxItems: 12, items: PLOTLY_TRACE_SCHEMA },
    layout: {
      type: 'object',
      additionalProperties: true,
      description: 'Plotly layout options such as axes, legend, annotations, shapes, barmode, hovermode, and margins.',
    },
    encoding: ANALYTICS_BINDING_SCHEMA.properties.encoding,
  },
  required: ['renderer', 'traces', 'encoding'],
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

function normalizeToolGames(input: Record<string, unknown>, now = new Date()) {
  return filterReleaseGames({
    query: typeof input.query === 'string' ? input.query : '',
    genre: typeof input.genre === 'string' ? input.genre : 'All genres',
    startDate: typeof input.startDate === 'string' ? input.startDate : '',
    endDate: typeof input.endDate === 'string' ? input.endDate : '',
    relativeDateRange: input.relativeDateRange,
  }, now);
}

function savedAtLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Saved locally';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function bindingLabel(binding: AnalyticsBinding) {
  const preset = binding.source.filters.relativeDateRange?.preset;
  return preset ? `Analytics · ${preset.replaceAll('_', ' ')}` : `Analytics · ${binding.pipeline.length} steps`;
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
          const binding = normalizeAnalyticsBinding(item.binding);
          if (!binding) return [];
          return [{
            id: item.id,
            savedAt: typeof item.savedAt === 'string' ? item.savedAt : new Date().toISOString(),
            figure: normalizePlotlyFigure(item.figure as Record<string, unknown>),
            binding,
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
    const createReport = async (input: Record<string, unknown>) => {
      const reportData = input.data && typeof input.data === 'object' && !Array.isArray(input.data) ? input.data as Record<string, unknown> : {};
      const reportVisualization = input.visualization && typeof input.visualization === 'object' && !Array.isArray(input.visualization)
        ? input.visualization as Record<string, unknown>
        : {};
      const binding = normalizeAnalyticsBinding({ ...reportData, encoding: reportVisualization.encoding });
      if (!binding) throw new Error('A report requires valid data and visualization bindings.');
      const template = normalizePlotlyFigure({
        title: input.title,
        description: input.description,
        data: reportVisualization.traces,
        layout: reportVisualization.layout,
      });
      const next = normalizePlotlyFigure(await regenerateAnalyticsFigure(template, binding));
      const report: SavedReport = {
        id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'report-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        savedAt: new Date().toISOString(),
        figure: next,
        binding,
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
          const rows = matches.slice(0, limit).map((game) => releaseAnalyticsRow(game, now, resolvedDateRange.relativeDateRange?.weekStartsOn ?? 'monday'));
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
        name: 'create_report',
        description: 'Create and save a Steam Desk report. Every report must include two explicit parts: data defines the release source, filters, and calculations; visualization defines the corresponding Plotly presentation and field encodings. Reopening the report reruns its data definition before rendering.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', maxLength: 100, description: 'The report title.' },
            description: { type: 'string', maxLength: 220, description: 'The decision or question this report addresses.' },
            data: REPORT_DATA_SCHEMA,
            visualization: REPORT_VISUALIZATION_SCHEMA,
          },
          required: ['title', 'data', 'visualization'],
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const report = await createReport(input);
          const figure = report.figure;
          return {
            content: [{ type: 'text', text: `Created and saved report “${figure.title}” from its data definition and Plotly visualization.` }],
            structuredContent: { created: true, saved: true, reportId: report.id, data: report.binding, visualization: { renderer: 'plotly', title: figure.title, traceCount: figure.traceCount, pointCount: figure.pointCount } },
          };
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

  async function openSavedReport(report: SavedReport) {
    const regenerated = normalizePlotlyFigure(await regenerateAnalyticsFigure(report.figure, report.binding));
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
          <button type="button" className="view-button" onClick={() => renderChart('genre')}>Quick view <span>↗</span></button>
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
            <div><strong>No saved reports yet</strong><small>Created reports will appear here with their data and corresponding visualization.</small></div>
          </div>
        ) : (
          <div className="saved-reports-list">
            {savedReports.map((report) => (
              <article className={'saved-report-card' + (activeReportId === report.id ? ' active' : '')} key={report.id}>
                <button type="button" className="saved-report-open" onClick={() => void openSavedReport(report)}>
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
        <footer className="saved-reports-note"><span>Stored only in this browser</span><span>Open a report to rerun its data and rebuild its visualization</span></footer>
      </section>

      {customVisualization && (
        <section className="visualization-panel plotly-panel" ref={customVisualizationRef} aria-live="polite">
          <header>
            <div>
              <p className="eyebrow"><span /> WebMCP · Report</p>
              <h2>{customVisualization.title}</h2>
              <p>{customVisualization.description}</p>
            </div>
            <div className="plot-meta" aria-label="Report details">
              <span>Plotly 4</span>
              {activeSavedReport && <span>Analytics pipeline</span>}
              <span>{customVisualization.traceCount} {customVisualization.traceCount === 1 ? 'trace' : 'traces'}</span>
              <span>{customVisualization.pointCount.toLocaleString()} points</span>
            </div>
          </header>
          <PlotlyCanvas figure={customVisualization} />
          <footer>
            <span>{activeSavedReport ? 'Recreated from the report data and visualization definition' : 'Created from paired data and visualization definitions through WebMCP'}</span>
            <button type="button" onClick={() => { setCustomVisualization(null); setActiveReportId(null); }}>Close report</button>
          </footer>
        </section>
      )}
      {visualization && (
        <section className="visualization-panel" ref={visualizationRef} aria-live="polite">
          <header><div><p className="eyebrow"><span /> Browser quick view</p><h2>{visualization.title}</h2><p>{visualization.subtitle}</p></div><div className="chart-tabs" aria-label="Quick view type"><button className={visualization.type === 'genre' ? 'active' : ''} onClick={() => renderChart('genre')}>Genre</button><button className={visualization.type === 'timeline' ? 'active' : ''} onClick={() => renderChart('timeline')}>Timeline</button><button className={visualization.type === 'price' ? 'active' : ''} onClick={() => renderChart('price')}>Price</button></div></header>
          <BarChart visualization={visualization} />
          <footer><span>A temporary view of the current table filters</span><button type="button" onClick={() => setVisualization(null)}>Close quick view</button></footer>
        </section>
      )}
    </main>
  );
}
