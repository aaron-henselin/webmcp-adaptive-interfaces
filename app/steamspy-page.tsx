"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ANALYTICS_BINDING_SCHEMA,
  type AnalyticsBinding,
  filterSteamSpyGames,
  normalizeAnalyticsBinding,
  renderAnalyticsReport,
  runAnalyticsBinding,
  STEAMSPY_FIELD_CATALOG,
} from "./steamspy-analytics";
import {
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
type ReportMode = "metric" | "table" | "chart" | "narrative" | "mixed";
type ValueFormat = "number" | "integer" | "compact" | "currencyCents" | "percent" | "minutes";
type MetricSpec = { valueField: string; label: string; format: ValueFormat; context: string };
type TableColumn = { field: string; label: string; format: ValueFormat };
type ReportPresentation =
  | { mode: "metric"; metric: MetricSpec }
  | { mode: "table"; table: { columns: TableColumn[] } }
  | { mode: "chart"; figure: PlotlyFigure }
  | { mode: "narrative"; narrative: { body: string } }
  | { mode: "mixed"; metric: MetricSpec; figure: PlotlyFigure };
type SavedReport = { id: string; savedAt: string; title: string; description: string; presentation: ReportPresentation; binding: AnalyticsBinding };
type OpenReport = { report: SavedReport; rows: Record<string, unknown>[]; figure?: PlotlyFigure };

const PAGE_SIZE = 12;
const MAX_SAVED_REPORTS = 8;
const MAX_RETURNED_REPORT_ROWS = 250;
const SAVED_REPORTS_KEY = "steam-desk:saved-reports:v4";
const LEGACY_SAVED_REPORTS_KEY = "steam-desk:saved-reports:v3";
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
const REPORT_VALUE_FORMATS: ValueFormat[] = ["number", "integer", "compact", "currencyCents", "percent", "minutes"];
const REPORT_METRIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    valueField: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$", description: "The result field containing the headline value." },
    label: { type: "string", maxLength: 80 },
    format: { type: "string", enum: REPORT_VALUE_FORMATS, default: "number" },
    context: { type: "string", maxLength: 180, description: "Short scope or methodology note shown below the value." },
  },
  required: ["valueField", "label"],
};
const REPORT_COLUMN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    field: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" },
    label: { type: "string", maxLength: 60 },
    format: { type: "string", enum: REPORT_VALUE_FORMATS, default: "number" },
  },
  required: ["field", "label"],
};
const REPORT_PRESENTATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description: "How the report should be presented. Use metric for one answer, table for rows, chart for visual patterns, narrative for a concise written finding, or mixed for a headline metric supported by a chart.",
  properties: {
    mode: { type: "string", enum: ["metric", "table", "chart", "narrative", "mixed"] },
    metric: REPORT_METRIC_SCHEMA,
    table: { type: "object", additionalProperties: false, properties: { columns: { type: "array", minItems: 1, maxItems: 8, items: REPORT_COLUMN_SCHEMA } }, required: ["columns"] },
    narrative: { type: "object", additionalProperties: false, properties: { body: { type: "string", maxLength: 800 } }, required: ["body"] },
    visualization: REPORT_VISUALIZATION_SCHEMA,
  },
  required: ["mode"],
};

const SAMPLE_PROMPTS = [
  { mode: "Metric", prompt: "What is the median price of games in this snapshot? Save the answer as a report." },
  { mode: "Table", prompt: "Create a report listing the 10 games with the most current players." },
  { mode: "Chart", prompt: "Chart the number of games in each review sentiment band and save it as a report." },
  { mode: "Mixed", prompt: "Show the median review score for free games, with a chart of their review sentiment." },
] as const;
const REPORT_MODE_CATALOG = [
  { mode: "metric", useWhen: "The result is one headline value.", requires: ["metric"] },
  { mode: "table", useWhen: "The result is a small set of comparable rows.", requires: ["table"] },
  { mode: "chart", useWhen: "A pattern, distribution, or relationship is easier to understand visually.", requires: ["visualization"] },
  { mode: "narrative", useWhen: "The result is best expressed as a concise written finding.", requires: ["narrative"] },
  { mode: "mixed", useWhen: "A headline value benefits from a supporting chart.", requires: ["metric", "visualization"] },
] as const;

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

function savedAtLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved locally";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function bindingLabel(binding: AnalyticsBinding) {
  return `Analytics · ${binding.pipeline.length} ${binding.pipeline.length === 1 ? "step" : "steps"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reportText(value: unknown, fallback: string, limit: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : fallback;
}

function valueFormat(value: unknown): ValueFormat {
  return typeof value === "string" && REPORT_VALUE_FORMATS.includes(value as ValueFormat) ? value as ValueFormat : "number";
}

function normalizeMetricSpec(value: unknown): MetricSpec | null {
  if (!isRecord(value) || typeof value.valueField !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value.valueField)) return null;
  return {
    valueField: value.valueField,
    label: reportText(value.label, value.valueField, 80),
    format: valueFormat(value.format),
    context: reportText(value.context, "", 180),
  };
}

function normalizeTableColumns(value: unknown): TableColumn[] {
  if (!isRecord(value) || !Array.isArray(value.columns)) return [];
  return value.columns.flatMap((item): TableColumn[] => {
    if (!isRecord(item) || typeof item.field !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(item.field)) return [];
    return [{ field: item.field, label: reportText(item.label, item.field, 60), format: valueFormat(item.format) }];
  }).slice(0, 8);
}

function normalizeSavedReport(value: unknown): SavedReport | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const binding = normalizeAnalyticsBinding(value.binding);
  if (!binding) return null;
  const savedAt = typeof value.savedAt === "string" ? value.savedAt : new Date().toISOString();

  if (!isRecord(value.presentation) && isRecord(value.figure)) {
    const figure = normalizePlotlyFigure(value.figure);
    return { id: value.id, savedAt, title: figure.title, description: figure.description, binding, presentation: { mode: "chart", figure } };
  }
  if (!isRecord(value.presentation) || typeof value.presentation.mode !== "string") return null;
  const title = reportText(value.title, "Saved report", 100);
  const description = reportText(value.description, "", 220);
  const mode = value.presentation.mode as ReportMode;
  if (mode === "metric") {
    const metric = normalizeMetricSpec(value.presentation.metric);
    return metric ? { id: value.id, savedAt, title, description, binding, presentation: { mode, metric } } : null;
  }
  if (mode === "table") {
    const columns = normalizeTableColumns(value.presentation.table);
    return columns.length ? { id: value.id, savedAt, title, description, binding, presentation: { mode, table: { columns } } } : null;
  }
  if (mode === "narrative" && isRecord(value.presentation.narrative)) {
    const body = reportText(value.presentation.narrative.body, "", 800);
    return body ? { id: value.id, savedAt, title, description, binding, presentation: { mode, narrative: { body } } } : null;
  }
  if ((mode === "chart" || mode === "mixed") && isRecord(value.presentation.figure)) {
    const figure = normalizePlotlyFigure(value.presentation.figure);
    if (mode === "chart") return { id: value.id, savedAt, title, description, binding, presentation: { mode, figure } };
    const metric = normalizeMetricSpec(value.presentation.metric);
    return metric ? { id: value.id, savedAt, title, description, binding, presentation: { mode, metric, figure } } : null;
  }
  return null;
}

function createPresentation(input: Record<string, unknown>, title: string, description: string) {
  const supplied = isRecord(input.presentation) ? input.presentation : null;
  const legacyVisualization = isRecord(input.visualization) ? input.visualization : null;
  const mode = (supplied?.mode ?? (legacyVisualization ? "chart" : "")) as ReportMode;
  const visualization = supplied && isRecord(supplied.visualization) ? supplied.visualization : legacyVisualization;

  if (mode === "metric") {
    const metric = normalizeMetricSpec(supplied?.metric);
    if (!metric) throw new Error("A metric report requires a valid metric definition.");
    return { presentation: { mode, metric } as ReportPresentation, encoding: { hover: [] } };
  }
  if (mode === "table") {
    const columns = normalizeTableColumns(supplied?.table);
    if (!columns.length) throw new Error("A table report requires at least one column.");
    return { presentation: { mode, table: { columns } } as ReportPresentation, encoding: { hover: [] } };
  }
  if (mode === "narrative" && supplied && isRecord(supplied.narrative)) {
    const body = reportText(supplied.narrative.body, "", 800);
    if (!body) throw new Error("A narrative report requires a written finding.");
    return { presentation: { mode, narrative: { body } } as ReportPresentation, encoding: { hover: [] } };
  }
  if ((mode === "chart" || mode === "mixed") && visualization) {
    const figure = normalizePlotlyFigure({ title, description, data: visualization.traces, layout: visualization.layout });
    if (mode === "chart") return { presentation: { mode, figure } as ReportPresentation, encoding: visualization.encoding };
    const metric = normalizeMetricSpec(supplied?.metric);
    if (!metric) throw new Error("A mixed report requires a headline metric.");
    return { presentation: { mode, metric, figure } as ReportPresentation, encoding: visualization.encoding };
  }
  throw new Error("Choose a valid report presentation mode and provide its required definition.");
}

function formatReportValue(value: unknown, format: ValueFormat) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  if (format === "currencyCents") return formatPrice(value);
  if (format === "percent") return formatPercent(value);
  if (format === "minutes") return formatPlaytime(value);
  if (format === "compact") return formatCompact(value);
  return new Intl.NumberFormat("en", { maximumFractionDigits: format === "integer" ? 0 : 2 }).format(value);
}

function reportModeLabel(mode: ReportMode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
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

function MetricAnswer({ metric, rows }: { metric: MetricSpec; rows: Record<string, unknown>[] }) {
  const value = rows[0]?.[metric.valueField];
  return (
    <div className="metric-answer">
      <p>{metric.label}</p>
      <strong>{formatReportValue(value, metric.format)}</strong>
      <span>{metric.context || (rows.length ? "Calculated from the current snapshot." : "No matching data was found.")}</span>
    </div>
  );
}

function ReportBody({ opened }: { opened: OpenReport }) {
  const presentation = opened.report.presentation;
  return (
    <div className={`report-body report-body-${presentation.mode}`}>
      {(presentation.mode === "metric" || presentation.mode === "mixed") && <MetricAnswer metric={presentation.metric} rows={opened.rows} />}
      {presentation.mode === "table" && (
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr>{presentation.table.columns.map((column) => <th key={column.field}>{column.label}</th>)}</tr></thead>
            <tbody>
              {opened.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>{presentation.table.columns.map((column) => <td key={column.field}>{formatReportValue(row[column.field], column.format)}</td>)}</tr>
              ))}
              {opened.rows.length === 0 && <tr><td colSpan={presentation.table.columns.length}><div className="report-empty">No matching rows were found.</div></td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {presentation.mode === "narrative" && <div className="narrative-report"><span aria-hidden="true">“</span><p>{presentation.narrative.body}</p></div>}
      {(presentation.mode === "chart" || presentation.mode === "mixed") && opened.figure && <PlotlyCanvas figure={opened.figure} />}
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
  const [openReport, setOpenReport] = useState<OpenReport | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [savedReportsReady, setSavedReportsReady] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const visualizationRef = useRef<HTMLElement>(null);
  const reportRef = useRef<HTMLElement>(null);
  const copiedPromptTimerRef = useRef<number | null>(null);

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
        const stored = window.localStorage.getItem(SAVED_REPORTS_KEY) ?? window.localStorage.getItem(LEGACY_SAVED_REPORTS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const restored = parsed.flatMap((item): SavedReport[] => {
              try {
                const report = normalizeSavedReport(item);
                return report ? [report] : [];
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

  useEffect(() => () => {
    if (copiedPromptTimerRef.current !== null) window.clearTimeout(copiedPromptTimerRef.current);
  }, []);

  useEffect(() => {
    const context = document.modelContext ?? navigator.modelContext;
    if (!context) {
      const timer = window.setTimeout(() => setWebMcpStatus("preview"), 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    const createReport = async (input: Record<string, unknown>) => {
      const title = reportText(input.title, "SteamSpy report", 100);
      const description = reportText(input.description, "", 220);
      const reportData = isRecord(input.data) ? input.data : {};
      const created = createPresentation(input, title, description);
      const binding = normalizeAnalyticsBinding({ ...reportData, encoding: created.encoding });
      if (!binding) throw new Error("A report requires a valid data definition.");

      let rows: Record<string, unknown>[];
      let presentation = created.presentation;
      let figure: PlotlyFigure | undefined;
      if (presentation.mode === "chart" || presentation.mode === "mixed") {
        const rendered = await renderAnalyticsReport(presentation.figure, binding);
        rows = rendered.rows;
        figure = normalizePlotlyFigure(rendered.figure);
        presentation = presentation.mode === "chart"
          ? { mode: "chart", figure }
          : { mode: "mixed", metric: presentation.metric, figure };
      } else {
        rows = await runAnalyticsBinding(binding);
      }

      const availableFields = new Set(rows.flatMap((row) => Object.keys(row)));
      if ((presentation.mode === "metric" || presentation.mode === "mixed") && rows.length && !availableFields.has(presentation.metric.valueField)) {
        throw new Error(`The metric field “${presentation.metric.valueField}” is not present in the report result.`);
      }
      if (presentation.mode === "table" && rows.length) {
        const missing = presentation.table.columns.find((column) => !availableFields.has(column.field));
        if (missing) throw new Error(`The table field “${missing.field}” is not present in the report result.`);
      }

      const openInBrowser = input.openInBrowser !== false;
      const report: SavedReport = {
        id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `report-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        savedAt: new Date().toISOString(),
        title,
        description,
        presentation,
        binding,
      };
      setSavedReports((current) => [report, ...current].slice(0, MAX_SAVED_REPORTS));
      if (openInBrowser) {
        setOpenReport({ report, rows, figure });
        window.setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
      }
      return { report, rows, figure, openInBrowser };
    };

    const tools = [
      {
        name: "describe_steamspy_snapshot",
        description: "Describe the SteamSpy datasource and report contract without reading records or calculating summaries. Use this when you need field meanings, units, filters, analytics operations, or presentation modes before creating a report.",
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: () => ({
          content: [{ type: "text", text: `Described the SteamSpy report contract: ${STEAMSPY_FIELD_CATALOG.length} fields, five presentation modes, and no game records.` }],
          structuredContent: {
            schemaVersion: "steam-desk.datasource/v1",
            source: {
              name: "steamspy_snapshot",
              label: "SteamSpy static snapshot",
              description: "A locally cached datasource available only through the create_report analytics pipeline.",
            },
            fields: STEAMSPY_FIELD_CATALOG,
            reportDefinition: {
              data: REPORT_DATA_SCHEMA,
              presentation: REPORT_PRESENTATION_SCHEMA,
              valueFormats: REPORT_VALUE_FORMATS,
            },
            presentationModes: REPORT_MODE_CATALOG,
            guidance: [
              "Use aggregate operations for scalar answers such as medians, means, counts, minima, and maxima.",
              "Use currencyCents for price fields, percent for positiveRatio, and minutes for playtime fields.",
              "The describe tool returns schema and capabilities only; create_report executes the data definition.",
            ],
          },
        }),
      },
      {
        name: "create_report",
        description: "Create, execute, and save a Steam Desk report from the static SteamSpy snapshot. Choose metric for a direct answer, table for rows, chart for visual patterns, narrative for a written finding, or mixed for a metric with a supporting chart. Call describe_steamspy_snapshot first when field meanings or supported operations are unclear. Reopening any report reruns its data definition.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", maxLength: 100 },
            description: { type: "string", maxLength: 220 },
            data: REPORT_DATA_SCHEMA,
            presentation: REPORT_PRESENTATION_SCHEMA,
            openInBrowser: { type: "boolean", default: true },
          },
          required: ["title", "data", "presentation"],
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          const completed = await createReport(input);
          const report = completed.report;
          const returnedRows = completed.rows.slice(0, MAX_RETURNED_REPORT_ROWS);
          const columns = Array.from(new Set(completed.rows.flatMap((row) => Object.keys(row))));
          const presentation = report.presentation;
          const metric = presentation.mode === "metric" || presentation.mode === "mixed"
            ? {
                label: presentation.metric.label,
                valueField: presentation.metric.valueField,
                value: completed.rows[0]?.[presentation.metric.valueField] ?? null,
                formattedValue: formatReportValue(completed.rows[0]?.[presentation.metric.valueField], presentation.metric.format),
                format: presentation.metric.format,
                context: presentation.metric.context,
              }
            : undefined;
          const visualization = completed.figure
            ? { renderer: "plotly", figure: { data: completed.figure.data, layout: completed.figure.layout }, traceCount: completed.figure.traceCount, pointCount: completed.figure.pointCount }
            : undefined;
          return {
            content: [{ type: "text", text: `Created and saved ${reportModeLabel(presentation.mode).toLocaleLowerCase()} report “${report.title}”. The Steam Desk panel was ${completed.openInBrowser ? "opened" : "left closed"}.` }],
            structuredContent: {
              created: true,
              saved: true,
              report: {
                schemaVersion: "steam-desk.report/v3",
                id: report.id,
                title: report.title,
                description: report.description,
                createdAt: report.savedAt,
                presentation: {
                  mode: presentation.mode,
                  metric,
                  table: presentation.mode === "table" ? presentation.table : undefined,
                  narrative: presentation.mode === "narrative" ? presentation.narrative : undefined,
                  visualization,
                },
                data: { definition: report.binding, result: { rowCount: completed.rows.length, returnedRowCount: returnedRows.length, truncated: returnedRows.length < completed.rows.length, columns, rows: returnedRows } },
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
    let rows: Record<string, unknown>[];
    let figure: PlotlyFigure | undefined;
    if (report.presentation.mode === "chart" || report.presentation.mode === "mixed") {
      const rendered = await renderAnalyticsReport(report.presentation.figure, report.binding);
      rows = rendered.rows;
      figure = normalizePlotlyFigure(rendered.figure);
    } else {
      rows = await runAnalyticsBinding(report.binding);
    }
    setOpenReport({ report, rows, figure });
    window.setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  function deleteSavedReport(id: string) {
    setSavedReports((current) => current.filter((report) => report.id !== id));
    if (openReport?.report.id === id) setOpenReport(null);
  }

  async function copySamplePrompt(prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(prompt);
      if (copiedPromptTimerRef.current !== null) window.clearTimeout(copiedPromptTimerRef.current);
      copiedPromptTimerRef.current = window.setTimeout(() => setCopiedPrompt(null), 1_600);
    } catch {
      setCopiedPrompt(null);
    }
  }

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
            <p className="dek">A searchable market snapshot built from eleven locally cached SteamSpy pages.</p>
          </div>
          <div className="header-meta">
            <div className={`agent-state state-${webMcpStatus}`}><span />{webMcpStatus === "connected" ? "WebMCP connected" : webMcpStatus === "preview" ? "WebMCP preview" : "Checking WebMCP"}</div>
            <div className="catalog-status"><strong>{GAMES.length.toLocaleString()}</strong><span>games · {formatSnapshotDate(STEAMSPY_SNAPSHOT.snapshotDate)}</span></div>
          </div>
        </header>

        <section className="saved-reports" aria-labelledby="saved-reports-title">
          <header className="saved-reports-header"><div><p className="eyebrow"><span /> Local workspace</p><h2 id="saved-reports-title">Saved reports</h2></div><span className="saved-reports-count">{savedReports.length} / {MAX_SAVED_REPORTS}</span></header>
          {savedReports.length === 0 ? (
            <div className="saved-reports-empty"><span aria-hidden="true">⌁</span><div><strong>No saved reports yet</strong><small>Direct answers, tables, charts, and mixed reports will appear here.</small></div></div>
          ) : (
            <div className="saved-reports-list">
              {savedReports.map((report) => (
                <article className={`saved-report-card mode-${report.presentation.mode}${openReport?.report.id === report.id ? " active" : ""}`} key={report.id}>
                  <button type="button" className="saved-report-open" onClick={() => void openSavedReport(report)}><span className="saved-report-mark">{report.presentation.mode.slice(0, 4)}</span><span className="saved-report-copy"><strong>{report.title}</strong><small>{savedAtLabel(report.savedAt)} · {reportModeLabel(report.presentation.mode)} report</small><em>{bindingLabel(report.binding)}</em></span></button>
                  <button type="button" className="saved-report-delete" aria-label={`Delete ${report.title}`} onClick={() => deleteSavedReport(report.id)}>×</button>
                </article>
              ))}
            </div>
          )}
          <footer className="saved-reports-note"><span>Stored only in this browser</span><span>Open any report to rerun its snapshot query and rebuild its result</span></footer>
        </section>

        <section className="prompt-guide" aria-labelledby="prompt-guide-title">
          <header>
            <div><p className="eyebrow"><span /> Ask naturally</p><h2 id="prompt-guide-title">Helpful sample prompts</h2></div>
            <p>Start with the answer you need. Steam Desk will choose a fitting report mode.</p>
          </header>
          <div className="prompt-grid">
            {SAMPLE_PROMPTS.map((item) => (
              <button type="button" className="prompt-card" key={item.prompt} onClick={() => void copySamplePrompt(item.prompt)}>
                <span className="prompt-mode">{item.mode}</span>
                <span className="prompt-copy">“{item.prompt}”</span>
                <span className="prompt-action">{copiedPrompt === item.prompt ? "Copied" : "Copy prompt"} <span aria-hidden="true">{copiedPrompt === item.prompt ? "✓" : "↗"}</span></span>
              </button>
            ))}
          </div>
          <p className="sr-only" aria-live="polite">{copiedPrompt ? "Sample prompt copied." : ""}</p>
        </section>

        <div className="toolbar" aria-label="SteamSpy filters">
          <label className="search-field"><span className="sr-only">Search games</span><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search titles, developers, publishers" /></label>
          <label className="select-field"><span className="sr-only">Owner range</span><select value={ownerBand} onChange={(event) => { setOwnerBand(event.target.value); setPage(0); }}><option>All owner ranges</option>{OWNER_BANDS.map((item) => <option key={item} value={item}>{ownerBandLabels.get(item)}</option>)}</select></label>
          <label className="select-field"><span className="sr-only">Price band</span><select value={selectedPriceBand} onChange={(event) => { setSelectedPriceBand(event.target.value); setPage(0); }}><option>All prices</option>{PRICE_BANDS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <button type="button" className="view-button" onClick={() => renderChart("owners")}>Quick view <span>↗</span></button>
        </div>

        <div className="result-strip"><span><strong>{filtered.length.toLocaleString()}</strong> games match · 11 cached pages</span><button type="button" onClick={() => { setSearch(""); setOwnerBand("All owner ranges"); setSelectedPriceBand("All prices"); }}>Reset filters</button></div>

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

      {openReport && (
        <section className={`visualization-panel report-panel report-${openReport.report.presentation.mode}`} ref={reportRef} aria-live="polite">
          <header>
            <div><p className="eyebrow"><span /> WebMCP · {reportModeLabel(openReport.report.presentation.mode)} report</p><h2>{openReport.report.title}</h2><p>{openReport.report.description}</p></div>
            <div className="plot-meta" aria-label="Report details"><span>{reportModeLabel(openReport.report.presentation.mode)}</span><span>Analytics pipeline</span><span>{openReport.rows.length.toLocaleString()} {openReport.rows.length === 1 ? "row" : "rows"}</span>{openReport.figure && <span>{openReport.figure.pointCount.toLocaleString()} points</span>}</div>
          </header>
          <ReportBody opened={openReport} />
          <footer><span>Recreated from the saved snapshot definition</span><button type="button" onClick={() => setOpenReport(null)}>Close report</button></footer>
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
