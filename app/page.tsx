'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { GAMES, GENRES, Game, daysFromLaunch, formatDate, formatPrice } from './release-data';

type SortKey = 'releaseDate' | 'title' | 'price' | 'wishlists';
type SortDirection = 'asc' | 'desc';
type ChartType = 'genre' | 'timeline' | 'price';
type ChartItem = { label: string; value: number };
type Visualization = { type: ChartType; title: string; subtitle: string; items: ChartItem[] };

const PAGE_SIZE = 12;

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

function normalizeToolGames(input: Record<string, unknown>) {
  const search = typeof input.query === 'string' ? input.query : '';
  const genre = typeof input.genre === 'string' && GENRES.includes(input.genre as (typeof GENRES)[number]) ? input.genre : 'All genres';
  const startDate = typeof input.startDate === 'string' ? input.startDate : '';
  const endDate = typeof input.endDate === 'string' ? input.endDate : '';
  return GAMES.filter((game) => {
    const haystack = `${game.title} ${game.studio} ${game.genre}`.toLocaleLowerCase();
    return (!search || haystack.includes(search.toLocaleLowerCase()))
      && (genre === 'All genres' || game.genre === genre || game.secondaryGenre === genre)
      && (!startDate || game.releaseDate >= startDate)
      && (!endDate || game.releaseDate <= endDate);
  });
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
  const visualizationRef = useRef<HTMLElement>(null);

  const filtered = useMemo(() => sortGames(filterGames(search, genre, dateWindow), sortKey, sortDirection), [search, genre, dateWindow, sortKey, sortDirection]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => { setPage(0); }, [search, genre, dateWindow]);
  useEffect(() => { if (page >= totalPages) setPage(totalPages - 1); }, [page, totalPages]);

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

    const tools = [
      {
        name: 'read_release_calendar',
        description: 'Read synthetic Steam release-calendar rows. Filter by query, genre, or ISO date range and return structured game records.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: {
            query: { type: 'string', description: 'Title, studio, or genre text to match.' },
            genre: { type: 'string', enum: [...GENRES] },
            startDate: { type: 'string', description: 'Inclusive ISO date, YYYY-MM-DD.' },
            endDate: { type: 'string', description: 'Inclusive ISO date, YYYY-MM-DD.' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          },
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const matches = sortGames(normalizeToolGames(input), 'releaseDate', 'asc');
          const limit = Math.min(100, Math.max(1, typeof input.limit === 'number' ? Math.floor(input.limit) : 25));
          const rows = matches.slice(0, limit).map((game) => ({
            id: game.id, title: game.title, releaseDate: game.releaseDate, genre: game.genre,
            secondaryGenre: game.secondaryGenre, price: game.price, status: game.status,
            studio: game.studio, wishlists: game.wishlists,
          }));
          return {
            content: [{ type: 'text', text: `Found ${matches.length.toLocaleString()} synthetic releases; returning ${rows.length}.` }],
            structuredContent: { total: matches.length, returned: rows.length, synthetic: true, releases: rows },
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
        name: 'show_release_visualization',
        description: 'Push a visualization of matching synthetic Steam releases into the browser page.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['genre', 'timeline', 'price'], description: 'Chart grouping to render.' },
            query: { type: 'string' }, genre: { type: 'string', enum: [...GENRES] },
            startDate: { type: 'string' }, endDate: { type: 'string' },
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
