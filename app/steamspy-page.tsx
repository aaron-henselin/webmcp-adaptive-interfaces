"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ANALYTICS_BINDING_SCHEMA,
  type AnalyticsBinding,
  filterSteamSpyGames,
  normalizeAnalyticsBinding,
  regenerateAnalyticsFigure,
  renderAnalyticsReport,
  steamSpyAnalyticsRow,
} from "./steamspy-analytics";
import {
  activityBand,
  formatCompact,
  formatOwnerRange,
  formatPercent,
  formatPlaytime,
  formatPrice,
  formatSnapshotDate,
  GAMES,
  OWNER_BANDS,
  priceBand,
  PRICE_BANDS,
  reviewBand,
  REVIEW_BANDS,
  STEAMSPY_SNAPSHOT,
  type SteamSpyGame,
} from "./steamspy-data";
import { PlotlyCanvas, type PlotlyFigure, PLOTLY_TRACE_TYPES, normalizePlotlyFigure } from "./plotly-visualization";

type SortKey = "ownersMax" | "title" | "priceCents" | "positiveRatio" | "ccu";
type SortDirection = "asc" | "desc";
type ChartType = "owners" | "reviews" | "price";
type ChartItem = { label: string; value: number };
type Visualization = { type: ChartType; title: string; subtitle: string; items: ChartItem[] };
type SavedReport = { id: string; savedAt: string; figure: PlotlyFigure; binding: AnalyticsBinding };

const PAGE_SIZE = 12;
const MAX_SAVED_REPORTS = 8;
const MAX_RETURNED_REPORT_ROWS = 250;
const SAVED_REPORTS_KEY = "steam-desk:saved-reports:v3";
const PLOTLY_TRACE_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    type: { type: "string", enum: [...PLOTLY_TRACE_TYPES] },
    name: { type: "string" },
    x: { type: "array", maxItems: 2_000, items: {} },
    y: { type: "array", maxItems: 2_000, items: {} },
    labels: { type: "array", maxItems: 2_000, items: {} },
    values: { type: "array", maxItems: 2_000, items: {} },
    mode: { type: "string" },
    orientation: { type: "string", enum: ["h", "v"] },
    hole: { type: "number", minimum: 0, maximum: 0.9 },
    marker: { type: "object", additionalProperties: true },
    line: { type: "object", additionalProperties: true },
    text: { type: "array", maxItems: 2_000, items: {} },
    hovertemplate: { type: "string" },
  },
};
const REPORT_DATA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description: "The report dataset: static SteamSpy snapshot filters, ordered calculations, and maximum result size.",
  properties: {
    source: ANALYTICS_BINDING_SCHEMA.properties.source,
    pipeline: ANALYTICS_BINDING_SCHEMA.properties.pipeline,
    resultLimit: ANALYTICS_BINDING_SCHEMA.properties.resultLimit,
  },
  required: ["source", "pipeline", "resultLimit"],
};
const REPORT_VISUALIZATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description: "The corresponding Plotly presentation and the fields that bind report data to visual channels.",
  properties: {
    renderer: { type: "string", const: "plotly" },
    traces: { type: "array", minItems: 1, maxItems: 12, items: PLOTLY_TRACE_SCHEMA },
    layout: { type: "object", additionalProperties: true },
    encoding: ANALYTICS_BINDING_SCHEMA.properties.encoding,
  },
  required: ["renderer", "traces", "encoding"],
};

const coverMarks = ["◜", "◇", "◉", "⌁", "△", "✣", "⊙", "╱"];
const ownerBandLabels = new Map(
  OWNER_BANDS.map((band) => {
    const game = GAMES.find((item) => item.owners === band);
    return [band, game ? formatOwnerRange(game) : band] as const;
  }),
);

function sortGames(games: SteamSpyGame[], key: SortKey, direction: SortDirection) {
  return [...games].sort((left, right) => {
    let result: number;
    if (key === "title") result = left.title.localeCompare(right.title);
    else if (key === "positiveRatio") result = (left.positiveRatio ?? -1) - (right.positiveRatio ?? -1);
    else result = left[key] - right[key];
    return direction === "asc" ? result : -result;
  });
}

function filterGames(search: string, ownerBand: string, selectedPriceBand: string) {
  return filterSteamSpyGames({ query: search, ownerBand, priceBand: selectedPriceBand });
}

function makeVisualization(type: ChartType, games: SteamSpyGame[]): Visualization {
  if (type === "price") {
    return {
      type,
      title: "Price bands",
      subtitle: `Current listed prices for ${games.length.toLocaleString()} matching games`,
      items: PRICE_BANDS.map((label) => ({ label, value: games.filter((game) => priceBand(game) === label).length })),
    };
  }
  if (type === "reviews") {
    return {
      type,
      title: "Review sentiment",
      subtitle: `SteamSpy review ratios for ${games.length.toLocaleString()} matching games`,
      items: REVIEW_BANDS.map((label) => ({ label: label.replace(" positive", ""), value: games.filter((game) => reviewBand(game) === label).length })),
    };
  }
  return {
    type,
    title: "Estimated ownership",
    subtitle: `SteamSpy owner ranges for ${games.length.toLocaleString()} matching games`,
    items: OWNER_BANDS.map((band) => ({ label: ownerBandLabels.get(band) ?? band, value: games.filter((game) => game.owners === band).length })).filter((item) => item.value > 0),
  };
}

function makeSummary(groupBy: string, games: SteamSpyGame[]) {
  const values = groupBy === "priceBand" ? PRICE_BANDS
    : groupBy === "reviewBand" ? REVIEW_BANDS
      : groupBy === "activityBand" ? ["100K+ playing", "10K–99K playing", "1K–9.9K playing", "100–999 playing", "Under 100 playing", "No players reported"]
        : OWNER_BANDS;
  return values.map((value) => ({
    label: groupBy === "ownerBand" ? ownerBandLabels.get(value) ?? value : value,
    value: games.filter((game) => {
      if (groupBy === "priceBand") return priceBand(game) === value;
      if (groupBy === "reviewBand") return reviewBand(game) === value;
      if (groupBy === "activityBand") return activityBand(game) === value;
      return game.owners === value;
    }).length,
  })).filter((item) => item.value > 0);
}

function normalizeToolGames(input: Record<string, unknown>) {
  return filterSteamSpyGames({
    query: typeof input.query === "string" ? input.query : "",
    ownerBand: typeof input.ownerBand === "string" ? input.ownerBand : "All owner ranges",
    priceBand: typeof input.priceBand === "string" ? input.priceBand : "All prices",
    minPositiveRatio: typeof input.minPositiveRatio === "number" ? input.minPositiveRatio : 0,
    minCcu: typeof input.minCcu === "number" ? input.minCcu : 0,
  });
}

function savedAtLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved locally";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function bindingLabel(binding: AnalyticsBinding) {
  return `Analytics · ${binding.pipeline.length} ${binding.pipeline.length === 1 ? "step" : "steps"}`;
}

function BarChart({ visualization }: { visualization: Visualization }) {
  const max = Math.max(...visualization.items.map((item) => item.value), 1);
  return (
    <div className={`chart chart-${visualization.type}`} role="img" aria-label={`${visualization.title}. ${visualization.items.map((item) => `${item.label}: ${item.value}`).join(", ")}`}>
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

export default function SteamSpyPage() {
  const [search, setSearch] = useState("");
  const [ownerBand, setOwnerBand] = useState("All owner ranges");
  const [selectedPriceBand, setSelectedPriceBand] = useState("All prices");
  const [sortKey, setSortKey] = useState<SortKey>("ownersMax");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(0);
  const [webMcpStatus, setWebMcpStatus] = useState<"checking" | "connected" | "preview">("checking");
  const [visualization, setVisualization] = useState<Visualization | null>(null);
  const [customVisualization, setCustomVisualization] = useState<PlotlyFigure | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [savedReportsReady, setSavedReportsReady] = useState(false);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const visualizationRef = useRef<HTMLElement>(null);
  const customVisualizationRef = useRef<HTMLElement>(null);

  const filtered = useMemo(
    () => sortGames(filterGames(search, ownerBand, selectedPriceBand), sortKey, sortDirection),
    [search, ownerBand, selectedPriceBand, sortKey, sortDirection],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visiblePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(visiblePage * PAGE_SIZE, visiblePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(SAVED_REPORTS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const restored = parsed.flatMap((item): SavedReport[] => {
              try {
                if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.figure) return [];
                const binding = normalizeAnalyticsBinding(item.binding);
                if (!binding) return [];
                return [{ id: item.id, savedAt: typeof item.savedAt === "string" ? item.savedAt : new Date().toISOString(), figure: normalizePlotlyFigure(item.figure as Record<string, unknown>), binding }];
              } catch {
                return [];
              }
            }).slice(0, MAX_SAVED_REPORTS);
            setSavedReports(restored);
          }
        }
      } catch {
        // Ignore malformed or unavailable browser storage and start with an empty shelf.
      } finally {
        setSavedReportsReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!savedReportsReady) return;
    try {
      window.localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(savedReports));
    } catch {
      // Reports remain usable for the current session if persistence is unavailable.
    }
  }, [savedReports, savedReportsReady]);

  useEffect(() => {
    const context = document.modelContext ?? navigator.modelContext;
    if (!context) {
      const timer = window.setTimeout(() => setWebMcpStatus("preview"), 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    const createReport = async (input: Record<string, unknown>) => {
      const reportData = input.data && typeof input.data === "object" && !Array.isArray(input.data) ? input.data as Record<string, unknown> : {};
      const reportVisualization = input.visualization && typeof input.visualization === "object" && !Array.isArray(input.visualization) ? input.visualization as Record<string, unknown> : {};
      const binding = normalizeAnalyticsBinding({ ...reportData, encoding: reportVisualization.encoding });
      if (!binding) throw new Error("A report requires valid data and visualization bindings.");
      const template = normalizePlotlyFigure({ title: input.title, description: input.description, data: reportVisualization.traces, layout: reportVisualization.layout });
      const rendered = await renderAnalyticsReport(template, binding);
      const next = normalizePlotlyFigure(rendered.figure);
      const openInBrowser = input.openInBrowser !== false;
      const report: SavedReport = {
        id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `report-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        savedAt: new Date().toISOString(),
        figure: next,
        binding,
      };
      setSavedReports((current) => [report, ...current].slice(0, MAX_SAVED_REPORTS));
      if (openInBrowser) {
        setActiveReportId(report.id);
        setCustomVisualization(next);
        window.setTimeout(() => customVisualizationRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
      }
      return { report, rows: rendered.rows, openInBrowser };
    };

    const sourceFilterProperties = {
      query: { type: "string", description: "Game title, developer, or publisher text to match." },
      ownerBand: { type: "string", enum: [...OWNER_BANDS], description: "Exact SteamSpy estimated-owner range." },
      priceBand: { type: "string", enum: [...PRICE_BANDS] },
      minPositiveRatio: { type: "number", minimum: 0, maximum: 1, description: "Minimum positive-review ratio, from 0 to 1." },
      minCcu: { type: "integer", minimum: 0, description: "Minimum reported concurrent players." },
    };
    const tools = [
      {
        name: "read_steamspy_snapshot",
        description: "Read games from Steam Desk’s local three-page SteamSpy snapshot. Filter by title/developer/publisher, owner range, price, review ratio, or concurrent players.",
        inputSchema: { type: "object", additionalProperties: false, properties: { ...sourceFilterProperties, limit: { type: "integer", minimum: 1, maximum: 100, default: 25 } } },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const matches = sortGames(normalizeToolGames(input), "ownersMax", "desc");
          const limit = Math.min(100, Math.max(1, typeof input.limit === "number" ? Math.floor(input.limit) : 25));
          const rows = matches.slice(0, limit).map(steamSpyAnalyticsRow);
          return {
            content: [{ type: "text", text: `Found ${matches.length.toLocaleString()} games in the static SteamSpy snapshot; returning ${rows.length}.` }],
            structuredContent: {
              source: STEAMSPY_SNAPSHOT.source,
              snapshotDate: STEAMSPY_SNAPSHOT.snapshotDate,
              sourcePages: STEAMSPY_SNAPSHOT.pageCount,
              total: matches.length,
              returned: rows.length,
              games: rows,
            },
          };
        },
      },
      {
        name: "summarize_steamspy_snapshot",
        description: "Summarize the local SteamSpy snapshot by owner range, price band, review sentiment, or current activity.",
        inputSchema: { type: "object", additionalProperties: false, properties: { groupBy: { type: "string", enum: ["ownerBand", "priceBand", "reviewBand", "activityBand"], default: "ownerBand" }, ...sourceFilterProperties } },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const groupBy = ["priceBand", "reviewBand", "activityBand"].includes(String(input.groupBy)) ? String(input.groupBy) : "ownerBand";
          const games = normalizeToolGames(input);
          const items = makeSummary(groupBy, games);
          const title = `SteamSpy snapshot by ${groupBy.replace("Band", " band")}`;
          return { content: [{ type: "text", text: `${title}: ${items.map((item) => `${item.label} ${item.value}`).join(", ")}.` }], structuredContent: { title, groupBy, total: games.length, items } };
        },
      },
      {
        name: "create_report",
        description: "Create and save a Steam Desk report from the static SteamSpy snapshot. Data defines snapshot filters and calculations; visualization contains a normalized Plotly figure. Reopening a saved report reruns its data definition.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", maxLength: 100 },
            description: { type: "string", maxLength: 220 },
            data: REPORT_DATA_SCHEMA,
            visualization: REPORT_VISUALIZATION_SCHEMA,
            openInBrowser: { type: "boolean", default: true },
          },
          required: ["title", "data", "visualization"],
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const completed = await createReport(input);
          const report = completed.report;
          const figure = report.figure;
          const returnedRows = completed.rows.slice(0, MAX_RETURNED_REPORT_ROWS);
          const columns = Array.from(new Set(completed.rows.flatMap((row) => Object.keys(row))));
          return {
            content: [{ type: "text", text: `Created and saved report “${figure.title}”. The Steam Desk panel was ${completed.openInBrowser ? "opened" : "left closed"}.` }],
            structuredContent: {
              created: true,
              saved: true,
              report: {
                schemaVersion: "steam-desk.report/v2",
                id: report.id,
                title: figure.title,
                description: figure.description,
                createdAt: report.savedAt,
                data: { definition: report.binding, result: { rowCount: completed.rows.length, returnedRowCount: returnedRows.length, truncated: returnedRows.length < completed.rows.length, columns, rows: returnedRows } },
                visualization: { renderer: "plotly", figure: { data: figure.data, layout: figure.layout }, traceCount: figure.traceCount, pointCount: figure.pointCount },
              },
              browser: { saved: true, opened: completed.openInBrowser },
            },
          };
        },
      },
    ];

    Promise.all(tools.map((tool) => context.registerTool(tool, { signal: controller.signal })))
      .then(() => setWebMcpStatus("connected"))
      .catch(() => setWebMcpStatus("preview"));
    return () => controller.abort();
  }, []);

  function changeSort(next: SortKey) {
    if (next === sortKey) setSortDirection((value) => value === "asc" ? "desc" : "asc");
    else {
      setSortKey(next);
      setSortDirection(next === "title" ? "asc" : "desc");
    }
  }

  function renderChart(type: ChartType = "owners") {
    setVisualization(makeVisualization(type, filtered));
    window.setTimeout(() => visualizationRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  async function openSavedReport(report: SavedReport) {
    const regenerated = normalizePlotlyFigure(await regenerateAnalyticsFigure(report.figure, report.binding));
    setCustomVisualization(regenerated);
    setActiveReportId(report.id);
    window.setTimeout(() => customVisualizationRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  function deleteSavedReport(id: string) {
    setSavedReports((current) => current.filter((report) => report.id !== id));
    if (activeReportId === id) setActiveReportId(null);
  }

  const activeSavedReport = savedReports.find((report) => report.id === activeReportId) ?? null;
  const start = filtered.length === 0 ? 0 : visiblePage * PAGE_SIZE + 1;
  const end = Math.min((visiblePage + 1) * PAGE_SIZE, filtered.length);
  const sortIndicator = (key: SortKey) => sortKey === key ? (sortDirection === "asc" ? "↑" : "↓") : "↕";

  return (
    <main className="site-shell">
      <section className="release-desk" aria-labelledby="page-title">
        <header className="desk-header">
          <div>
            <p className="eyebrow"><span /> SteamSpy static snapshot</p>
            <h1 id="page-title">Steam Desk</h1>
            <p className="dek">A searchable market snapshot built from three locally cached SteamSpy pages.</p>
          </div>
          <div className="header-meta">
            <div className={`agent-state state-${webMcpStatus}`}><span />{webMcpStatus === "connected" ? "WebMCP connected" : webMcpStatus === "preview" ? "WebMCP preview" : "Checking WebMCP"}</div>
            <div className="catalog-status"><strong>{GAMES.length.toLocaleString()}</strong><span>games · {formatSnapshotDate(STEAMSPY_SNAPSHOT.snapshotDate)}</span></div>
          </div>
        </header>

        <section className="saved-reports" aria-labelledby="saved-reports-title">
          <header className="saved-reports-header"><div><p className="eyebrow"><span /> Local workspace</p><h2 id="saved-reports-title">Saved reports</h2></div><span className="saved-reports-count">{savedReports.length} / {MAX_SAVED_REPORTS}</span></header>
          {savedReports.length === 0 ? (
            <div className="saved-reports-empty"><span aria-hidden="true">⌁</span><div><strong>No saved reports yet</strong><small>Reports built from the static snapshot will appear here with their data and visualization.</small></div></div>
          ) : (
            <div className="saved-reports-list">
              {savedReports.map((report) => (
                <article className={`saved-report-card${activeReportId === report.id ? " active" : ""}`} key={report.id}>
                  <button type="button" className="saved-report-open" onClick={() => void openSavedReport(report)}><span className="saved-report-mark">{String(report.figure.data[0]?.type ?? "plot").slice(0, 4)}</span><span className="saved-report-copy"><strong>{report.figure.title}</strong><small>{savedAtLabel(report.savedAt)} · {report.figure.pointCount.toLocaleString()} points</small><em>{bindingLabel(report.binding)}</em></span></button>
                  <button type="button" className="saved-report-delete" aria-label={`Delete ${report.figure.title}`} onClick={() => deleteSavedReport(report.id)}>×</button>
                </article>
              ))}
            </div>
          )}
          <footer className="saved-reports-note"><span>Stored only in this browser</span><span>Open a report to rerun its snapshot query and rebuild its visualization</span></footer>
        </section>

        <div className="toolbar" aria-label="SteamSpy filters">
          <label className="search-field"><span className="sr-only">Search games</span><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search titles, developers, publishers" /></label>
          <label className="select-field"><span className="sr-only">Owner range</span><select value={ownerBand} onChange={(event) => { setOwnerBand(event.target.value); setPage(0); }}><option>All owner ranges</option>{OWNER_BANDS.map((item) => <option key={item} value={item}>{ownerBandLabels.get(item)}</option>)}</select></label>
          <label className="select-field"><span className="sr-only">Price band</span><select value={selectedPriceBand} onChange={(event) => { setSelectedPriceBand(event.target.value); setPage(0); }}><option>All prices</option>{PRICE_BANDS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <button type="button" className="view-button" onClick={() => renderChart("owners")}>Quick view <span>↗</span></button>
        </div>

        <div className="result-strip"><span><strong>{filtered.length.toLocaleString()}</strong> games match · 3 cached pages</span><button type="button" onClick={() => { setSearch(""); setOwnerBand("All owner ranges"); setSelectedPriceBand("All prices"); }}>Reset filters</button></div>

        <div className="table-wrap">
          <table>
            <thead><tr>
              <th><button type="button" onClick={() => changeSort("title")}>Game <span>{sortIndicator("title")}</span></button></th>
              <th><button type="button" onClick={() => changeSort("ownersMax")}>Owners <span>{sortIndicator("ownersMax")}</span></button></th>
              <th><button type="button" onClick={() => changeSort("priceCents")}>Price <span>{sortIndicator("priceCents")}</span></button></th>
              <th><button type="button" onClick={() => changeSort("positiveRatio")}>Reviews <span>{sortIndicator("positiveRatio")}</span></button></th>
              <th><button type="button" onClick={() => changeSort("ccu")}>Players <span>{sortIndicator("ccu")}</span></button></th>
              <th>Avg. playtime</th>
            </tr></thead>
            <tbody>
              {visible.map((game) => {
                const accent = Math.abs(game.id) % coverMarks.length;
                return (
                  <tr key={game.id}>
                    <td><div className="game-cell"><span className={`cover cover-${accent}`} aria-hidden="true"><i>{coverMarks[accent]}</i><b>{game.title.split(" ").map((word) => word[0]).slice(0, 2).join("")}</b></span><span><strong>{game.title}</strong><small>{game.developer}</small></span></div></td>
                    <td><span className="genre-pill" title={game.owners}>{formatOwnerRange(game)}</span></td>
                    <td className="price-cell">{formatPrice(game.priceCents)}</td>
                    <td className="wishlist-cell" title={`${game.positive.toLocaleString()} positive · ${game.negative.toLocaleString()} negative`}>{formatPercent(game.positiveRatio)}</td>
                    <td className="wishlist-cell">{formatCompact(game.ccu)}</td>
                    <td><span className="status">{formatPlaytime(game.averageForever)}</span></td>
                  </tr>
                );
              })}
              {visible.length === 0 && <tr><td colSpan={6}><div className="empty-state"><strong>No games found</strong><span>Try a broader search or reset the filters.</span></div></td></tr>}
            </tbody>
          </table>
        </div>

        <footer className="desk-footer"><span>Showing {start.toLocaleString()}–{end.toLocaleString()} of {filtered.length.toLocaleString()}</span><div><button type="button" disabled={visiblePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} aria-label="Previous page">←</button><span>Page {visiblePage + 1} / {totalPages}</span><button type="button" disabled={visiblePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))} aria-label="Next page">→</button></div></footer>
      </section>

      {customVisualization && (
        <section className="visualization-panel plotly-panel" ref={customVisualizationRef} aria-live="polite">
          <header><div><p className="eyebrow"><span /> WebMCP · Report</p><h2>{customVisualization.title}</h2><p>{customVisualization.description}</p></div><div className="plot-meta" aria-label="Report details"><span>Plotly 4</span>{activeSavedReport && <span>Analytics pipeline</span>}<span>{customVisualization.traceCount} {customVisualization.traceCount === 1 ? "trace" : "traces"}</span><span>{customVisualization.pointCount.toLocaleString()} points</span></div></header>
          <PlotlyCanvas figure={customVisualization} />
          <footer><span>{activeSavedReport ? "Recreated from the saved snapshot definition" : "Created from paired data and visualization definitions through WebMCP"}</span><button type="button" onClick={() => { setCustomVisualization(null); setActiveReportId(null); }}>Close report</button></footer>
        </section>
      )}
      {visualization && (
        <section className="visualization-panel" ref={visualizationRef} aria-live="polite">
          <header><div><p className="eyebrow"><span /> Browser quick view</p><h2>{visualization.title}</h2><p>{visualization.subtitle}</p></div><div className="chart-tabs" aria-label="Quick view type"><button className={visualization.type === "owners" ? "active" : ""} onClick={() => renderChart("owners")}>Owners</button><button className={visualization.type === "reviews" ? "active" : ""} onClick={() => renderChart("reviews")}>Reviews</button><button className={visualization.type === "price" ? "active" : ""} onClick={() => renderChart("price")}>Price</button></div></header>
          <BarChart visualization={visualization} />
          <footer><span>A temporary view of the current table filters</span><button type="button" onClick={() => setVisualization(null)}>Close quick view</button></footer>
        </section>
      )}
    </main>
  );
}
