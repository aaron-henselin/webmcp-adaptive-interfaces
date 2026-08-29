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
  loadSteamSpySnapshot,
  OWNER_BANDS,
  PRICE_BANDS,
  type SteamSpyGame,
  type SteamSpySnapshot,
} from "./steamspy-data";
import { PlotlyCanvas, type PlotlyFigure, PLOTLY_TRACE_TYPES, normalizePlotlyFigure, renderPlotlyFigureToPng } from "./plotly-visualization";
import { createReportPresentationSchema, REPORT_MODE_CATALOG, reportPresentationShapeError } from "./report-presentation-schema";

type SortKey = "ownersMax" | "title" | "priceCents" | "positiveRatio" | "ccu";
type SortDirection = "asc" | "desc";
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
type ReportToolStage = "validation" | "execution" | "lookup" | "render";
type ReportToolErrorCode =
  | "INVALID_PRESENTATION"
  | "INVALID_DATA_DEFINITION"
  | "INVALID_RESULT_FIELD"
  | "INVALID_REPORT_ID"
  | "REPORT_NOT_FOUND"
  | "UNSUPPORTED_RENDER_MODE"
  | "REPORT_EXECUTION_FAILED"
  | "REPORT_RENDER_FAILED";

class ReportToolError extends Error {
  constructor(
    readonly code: ReportToolErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly stage: ReportToolStage,
  ) {
    super(message);
    this.name = "ReportToolError";
  }
}

const PAGE_SIZE = 12;
const MAX_SAVED_REPORTS = 8;
const MAX_CHAT_REPORT_ROWS = 20;
const MAX_CHAT_REPORT_COLUMNS = 8;
const EMPTY_GAMES: SteamSpyGame[] = [];
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
const REPORT_PRESENTATION_SCHEMA = createReportPresentationSchema({ metric: REPORT_METRIC_SCHEMA, tableColumn: REPORT_COLUMN_SCHEMA, visualization: REPORT_VISUALIZATION_SCHEMA });

const SAMPLE_PROMPTS = [
  { mode: "Metric", prompt: "What is the median price of games in this snapshot? Save the answer as a report." },
  { mode: "Table", prompt: "Create a report listing the 10 games with the most current players." },
  { mode: "Chart", prompt: "Chart the number of games in each review sentiment band and save it as a report." },
  { mode: "Mixed", prompt: "Show the median review score for free games, with a chart of their review sentiment." },
] as const;
const coverMarks = ["◜", "◇", "◉", "⌁", "△", "✣", "⊙", "╱"];
const ownerBandLabels = new Map(
  OWNER_BANDS.map((band) => {
    const [ownersMin, ownersMax] = band.split("..").map((value) => Number(value.replaceAll(",", "").trim()));
    return [band, formatOwnerRange({ ownersMin, ownersMax })] as const;
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

function filterGames(games: SteamSpyGame[], search: string, ownerBand: string, selectedPriceBand: string) {
  return filterSteamSpyGames(games, { query: search, ownerBand, priceBand: selectedPriceBand });
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

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "The report could not be executed.";
}

function invalidPresentation(message: string): never {
  throw new ReportToolError("INVALID_PRESENTATION", message, false, "validation");
}

function reportToolFailure(error: unknown) {
  const failure = error instanceof ReportToolError
    ? error
    : new ReportToolError("REPORT_EXECUTION_FAILED", errorMessage(error), true, "execution");
  return {
    content: [{ type: "text", text: `Report creation failed (${failure.code}): ${failure.message}${failure.retryable ? " Retrying may succeed." : " Correct the report definition before retrying."}` }],
    structuredContent: {
      schemaVersion: "steam-desk.report-receipt/v2",
      ok: false,
      created: false,
      saved: false,
      browser: { opened: false },
      error: {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
        stage: failure.stage,
      },
    },
  };
}

function renderToolFailure(error: unknown) {
  const failure = error instanceof ReportToolError
    ? error
    : new ReportToolError("REPORT_RENDER_FAILED", errorMessage(error), true, "render");
  return {
    content: [{ type: "text", text: `Report rendering failed (${failure.code}): ${failure.message}${failure.retryable ? " Retrying may succeed." : " Change the request before retrying."}` }],
    structuredContent: {
      schemaVersion: "steam-desk.report-render/v2",
      ok: false,
      rendered: false,
      error: {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
        stage: failure.stage,
      },
    },
  };
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
  if (supplied) {
    const effectivePresentation = visualization && !isRecord(supplied.visualization) ? { ...supplied, visualization } : supplied;
    const shapeError = reportPresentationShapeError(effectivePresentation);
    if (shapeError) invalidPresentation(shapeError);
  }

  if (mode === "metric") {
    const metric = normalizeMetricSpec(supplied?.metric);
    if (!metric) invalidPresentation("A metric report requires a valid metric definition.");
    return { presentation: { mode, metric } as ReportPresentation, encoding: { hover: [] } };
  }
  if (mode === "table") {
    const columns = normalizeTableColumns(supplied?.table);
    if (!columns.length) invalidPresentation("A table report requires at least one column.");
    return { presentation: { mode, table: { columns } } as ReportPresentation, encoding: { hover: [] } };
  }
  if (mode === "narrative" && supplied && isRecord(supplied.narrative)) {
    const body = reportText(supplied.narrative.body, "", 800);
    if (!body) invalidPresentation("A narrative report requires a written finding.");
    return { presentation: { mode, narrative: { body } } as ReportPresentation, encoding: { hover: [] } };
  }
  if ((mode === "chart" || mode === "mixed") && visualization) {
    const figure = normalizePlotlyFigure({ title, description, data: visualization.traces, layout: visualization.layout });
    if (mode === "chart") return { presentation: { mode, figure } as ReportPresentation, encoding: visualization.encoding };
    const metric = normalizeMetricSpec(supplied?.metric);
    if (!metric) invalidPresentation("A mixed report requires a headline metric.");
    return { presentation: { mode, metric, figure } as ReportPresentation, encoding: visualization.encoding };
  }
  return invalidPresentation("Choose a valid report presentation mode and provide its required definition.");
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

function escapeMarkdown(value: unknown) {
  return String(value ?? "—")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, " ")
    .replace(/([\`*_\[\]<>|])/g, "\\$1");
}

function inferredValueFormat(field: string): ValueFormat {
  if (field === "priceCents" || field === "initialPriceCents") return "currencyCents";
  if (field === "positiveRatio") return "percent";
  if (["averageForever", "average2Weeks", "medianForever", "median2Weeks"].includes(field)) return "minutes";
  return "number";
}

function chatReportColumns(report: SavedReport, rows: Record<string, unknown>[]): TableColumn[] {
  if (report.presentation.mode === "table") return report.presentation.table.columns.slice(0, MAX_CHAT_REPORT_COLUMNS);
  const encoding = report.binding.encoding;
  const fields = [encoding.labels, encoding.x, encoding.values, encoding.y, encoding.series, encoding.text, ...encoding.hover]
    .filter((field): field is string => Boolean(field));
  const uniqueFields = Array.from(new Set(fields.length ? fields : Object.keys(rows[0] ?? {}))).slice(0, MAX_CHAT_REPORT_COLUMNS);
  return uniqueFields.map((field) => ({ field, label: field, format: inferredValueFormat(field) }));
}

function markdownTable(columns: TableColumn[], rows: Record<string, unknown>[]) {
  if (!columns.length || !rows.length) return "_No matching rows were found._";
  const header = `| ${columns.map((column) => escapeMarkdown(column.label)).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.slice(0, MAX_CHAT_REPORT_ROWS).map((row) => (
    `| ${columns.map((column) => escapeMarkdown(formatReportValue(row[column.field], column.format))).join(" | ")} |`
  ));
  const remainder = rows.length - Math.min(rows.length, MAX_CHAT_REPORT_ROWS);
  return [header, divider, ...body, ...(remainder > 0 ? [`_${remainder.toLocaleString()} additional rows are available in Steam Desk._`] : [])].join("\n");
}

async function runSavedReport(report: SavedReport, games: SteamSpyGame[]): Promise<OpenReport> {
  if (report.presentation.mode === "chart" || report.presentation.mode === "mixed") {
    const rendered = await renderAnalyticsReport(report.presentation.figure, report.binding, games);
    return { report, rows: rendered.rows, figure: normalizePlotlyFigure(rendered.figure) };
  }
  return { report, rows: await runAnalyticsBinding(report.binding, games) };
}

function renderReportForChat(opened: OpenReport) {
  const { report, rows, figure } = opened;
  const presentation = report.presentation;
  const sections = [
    `## ${escapeMarkdown(report.title)}`,
    report.description ? escapeMarkdown(report.description) : "",
    `_${reportModeLabel(presentation.mode)} report · ${rows.length.toLocaleString()} ${rows.length === 1 ? "row" : "rows"}_`,
  ].filter(Boolean);

  if (presentation.mode === "metric" || presentation.mode === "mixed") {
    const value = formatReportValue(rows[0]?.[presentation.metric.valueField], presentation.metric.format);
    sections.push(`**${escapeMarkdown(presentation.metric.label)}:** ${escapeMarkdown(value)}`);
    if (presentation.metric.context) sections.push(escapeMarkdown(presentation.metric.context));
  }
  if (presentation.mode === "narrative") sections.push(escapeMarkdown(presentation.narrative.body));
  if (presentation.mode === "chart" || presentation.mode === "mixed") {
    const traceCount = figure?.traceCount ?? 0;
    const pointCount = figure?.pointCount ?? 0;
    sections.push(`**Supporting chart:** ${traceCount.toLocaleString()} series · ${pointCount.toLocaleString()} ${pointCount === 1 ? "point" : "points"}`);
  }
  if (presentation.mode === "table" || presentation.mode === "chart" || presentation.mode === "mixed") {
    sections.push(markdownTable(chatReportColumns(report, rows), rows));
  }
  return sections.join("\n\n");
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
  const [snapshot, setSnapshot] = useState<SteamSpySnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState("");
  const [search, setSearch] = useState("");
  const [ownerBand, setOwnerBand] = useState("All owner ranges");
  const [selectedPriceBand, setSelectedPriceBand] = useState("All prices");
  const [sortKey, setSortKey] = useState<SortKey>("ownersMax");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(0);
  const [webMcpStatus, setWebMcpStatus] = useState<"checking" | "connected" | "preview">("checking");
  const [openReport, setOpenReport] = useState<OpenReport | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [savedReportsReady, setSavedReportsReady] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const savedReportsRef = useRef<SavedReport[]>([]);
  const reportRef = useRef<HTMLElement>(null);
  const copiedPromptTimerRef = useRef<number | null>(null);
  const games = snapshot?.games ?? EMPTY_GAMES;

  const filtered = useMemo(
    () => sortGames(filterGames(games, search, ownerBand, selectedPriceBand), sortKey, sortDirection),
    [games, search, ownerBand, selectedPriceBand, sortKey, sortDirection],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visiblePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(visiblePage * PAGE_SIZE, visiblePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    let active = true;
    loadSteamSpySnapshot()
      .then((loaded) => {
        if (active) setSnapshot(loaded);
      })
      .catch((error: unknown) => {
        if (active) {
          setSnapshotError(errorMessage(error));
          setWebMcpStatus("preview");
        }
      });
    return () => {
      active = false;
    };
  }, []);

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
            savedReportsRef.current = restored;
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
    savedReportsRef.current = savedReports;
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
    if (!snapshot) return;
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
      if (!binding) throw new ReportToolError("INVALID_DATA_DEFINITION", "A report requires a valid data definition.", false, "validation");

      let rows: Record<string, unknown>[];
      let presentation = created.presentation;
      let figure: PlotlyFigure | undefined;
      try {
        if (presentation.mode === "chart" || presentation.mode === "mixed") {
          const rendered = await renderAnalyticsReport(presentation.figure, binding, games);
          rows = rendered.rows;
          figure = normalizePlotlyFigure(rendered.figure);
          presentation = presentation.mode === "chart"
            ? { mode: "chart", figure }
            : { mode: "mixed", metric: presentation.metric, figure };
        } else {
          rows = await runAnalyticsBinding(binding, games);
        }
      } catch (error) {
        throw new ReportToolError("INVALID_DATA_DEFINITION", errorMessage(error), false, "execution");
      }

      const availableFields = new Set(rows.flatMap((row) => Object.keys(row)));
      if ((presentation.mode === "metric" || presentation.mode === "mixed") && rows.length && !availableFields.has(presentation.metric.valueField)) {
        throw new ReportToolError("INVALID_RESULT_FIELD", `The metric field “${presentation.metric.valueField}” is not present in the report result.`, false, "validation");
      }
      if (presentation.mode === "table" && rows.length) {
        const missing = presentation.table.columns.find((column) => !availableFields.has(column.field));
        if (missing) throw new ReportToolError("INVALID_RESULT_FIELD", `The table field “${missing.field}” is not present in the report result.`, false, "validation");
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
      const nextReports = [report, ...savedReportsRef.current].slice(0, MAX_SAVED_REPORTS);
      savedReportsRef.current = nextReports;
      setSavedReports(nextReports);
      if (openInBrowser) {
        setOpenReport({ report, rows, figure });
        window.setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
      }
      return { report, rows, figure, openInBrowser };
    };

    const tools = [
      {
        name: "describe_steamspy_snapshot",
        description: "Use only when field meanings, units, supported calculations, filters, or presentation bindings are unclear. Returns schemaVersion, source, fields, reportDefinition, presentationModes, and guidance; it does not read records, calculate summaries, or create reports.",
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
              "The describe tool returns schema and capabilities only; create_report executes the data definition and returns a receipt.",
              "Use render_report only when the saved result should be presented as bounded Markdown or a static PNG.",
            ],
          },
        }),
      },
      {
        name: "create_report",
        description: "Use for any request to analyze, rank, summarize, chart, or create a table from the SteamSpy snapshot. Choose exactly one presentation mode. Mixed means one headline metric plus one supporting chart and never includes a table; create separate reports when both a chart and table are needed. Executes and saves the complete report, optionally opens it in Steam Desk, and returns only a compact receipt with ok, created, saved, browser.opened, report.id, report.title, report.mode, and report.rowCount. Validation errors are not retryable; REPORT_EXECUTION_FAILED is retryable. Prefer this tool over manipulating filters, sorting, pagination, or Saved Reports through the page UI.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", maxLength: 100 },
            description: { type: "string", maxLength: 220 },
            data: REPORT_DATA_SCHEMA,
            presentation: REPORT_PRESENTATION_SCHEMA,
            openInBrowser: { type: "boolean", default: true, description: "Whether to open and scroll to the completed report in Steam Desk. The report is saved either way." },
          },
          required: ["title", "data", "presentation"],
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          try {
            const completed = await createReport(input);
            const report = completed.report;
            return {
              content: [{ type: "text", text: `Created and saved ${reportModeLabel(report.presentation.mode).toLocaleLowerCase()} report “${report.title}” with ID ${report.id}. The Steam Desk panel was ${completed.openInBrowser ? "opened" : "left closed"}.` }],
              structuredContent: {
                schemaVersion: "steam-desk.report-receipt/v2",
                ok: true,
                created: true,
                saved: true,
                browser: { opened: completed.openInBrowser },
                report: {
                  id: report.id,
                  title: report.title,
                  mode: report.presentation.mode,
                  rowCount: completed.rows.length,
                },
              },
            };
          } catch (error) {
            return reportToolFailure(error);
          }
        },
      },
      {
        name: "render_report",
        description: "Use when the user asks to show, render, or embed an existing saved report. renderMode auto returns a PNG for chart or mixed reports and bounded Markdown otherwise; markdown returns at most 20 rows and 8 columns, while image is available only for chart or mixed reports. Returns chat-ready content plus receipt metadata and never returns raw result rows or the presentation payload. INVALID_REPORT_ID, REPORT_NOT_FOUND, and UNSUPPORTED_RENDER_MODE are not retryable; execution or rendering failures are retryable.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            reportId: { type: "string", minLength: 1, maxLength: 128, description: "The saved report ID returned by create_report." },
            renderMode: { type: "string", enum: ["auto", "markdown", "image"], default: "auto", description: "Use auto to select a PNG for chart or mixed reports and bounded Markdown for other report modes." },
          },
          required: ["reportId"],
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          try {
            const reportId = typeof input.reportId === "string" ? input.reportId.trim() : "";
            if (!reportId) throw new ReportToolError("INVALID_REPORT_ID", "A report ID is required.", false, "validation");
            const report = savedReportsRef.current.find((item) => item.id === reportId);
            if (!report) throw new ReportToolError("REPORT_NOT_FOUND", `No saved report was found with ID “${reportId}”.`, false, "lookup");

            if (input.renderMode !== undefined && !["auto", "markdown", "image"].includes(String(input.renderMode))) {
              throw new ReportToolError("UNSUPPORTED_RENDER_MODE", "renderMode must be auto, markdown, or image.", false, "validation");
            }
            const requestedMode = input.renderMode === "markdown" || input.renderMode === "image" ? input.renderMode : "auto";
            let opened: OpenReport;
            try {
              opened = await runSavedReport(report, games);
            } catch (error) {
              throw new ReportToolError("REPORT_EXECUTION_FAILED", errorMessage(error), true, "execution");
            }
            const resolvedMode = requestedMode === "auto"
              ? report.presentation.mode === "chart" || report.presentation.mode === "mixed" ? "image" : "markdown"
              : requestedMode;

            let content: Array<Record<string, unknown>>;
            let mimeType: "text/markdown" | "image/png";
            if (resolvedMode === "image") {
              if (!opened.figure) {
                throw new ReportToolError("UNSUPPORTED_RENDER_MODE", "Image rendering is available only for chart or mixed reports. Use markdown for this report.", false, "render");
              }
              let png: string;
              try {
                png = await renderPlotlyFigureToPng(opened.figure);
              } catch (error) {
                throw new ReportToolError("REPORT_RENDER_FAILED", errorMessage(error), true, "render");
              }
              mimeType = "image/png";
              content = [
                { type: "text", text: `Rendered “${report.title}” as a PNG. Report ID: ${report.id}.` },
                { type: "image", data: png, mimeType },
              ];
            } else {
              mimeType = "text/markdown";
              content = [{ type: "text", text: renderReportForChat(opened) }];
            }

            return {
              content,
              structuredContent: {
                schemaVersion: "steam-desk.report-render/v2",
                ok: true,
                rendered: true,
                report: { id: report.id, title: report.title, mode: report.presentation.mode },
                render: { requestedMode, resolvedMode, mimeType },
                rowCount: opened.rows.length,
                truncated: resolvedMode === "markdown" && opened.rows.length > MAX_CHAT_REPORT_ROWS,
              },
            };
          } catch (error) {
            return renderToolFailure(error);
          }
        },
      },
    ];

    Promise.all(tools.map((tool) => context.registerTool(tool, { signal: controller.signal })))
      .then(() => setWebMcpStatus("connected"))
      .catch(() => setWebMcpStatus("preview"));
    return () => controller.abort();
  }, [games, snapshot]);

  function changeSort(next: SortKey) {
    if (next === sortKey) setSortDirection((value) => value === "asc" ? "desc" : "asc");
    else {
      setSortKey(next);
      setSortDirection(next === "title" ? "asc" : "desc");
    }
  }

  async function openSavedReport(report: SavedReport) {
    setOpenReport(await runSavedReport(report, games));
    window.setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  function deleteSavedReport(id: string) {
    const nextReports = savedReportsRef.current.filter((report) => report.id !== id);
    savedReportsRef.current = nextReports;
    setSavedReports(nextReports);
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
            <p className="dek">A searchable market snapshot built from 21 locally cached SteamSpy pages.</p>
          </div>
          <div className="header-meta">
            <div className={`agent-state state-${webMcpStatus}`}><span />{webMcpStatus === "connected" ? "WebMCP connected" : webMcpStatus === "preview" ? "WebMCP preview" : "Checking WebMCP"}</div>
            <div className="catalog-status">
              <strong>{snapshot ? games.length.toLocaleString() : "—"}</strong>
              <span>{snapshot ? `games · ${formatSnapshotDate(snapshot.snapshotDate)}` : snapshotError ? "snapshot unavailable" : "loading snapshot"}</span>
            </div>
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
          <label className="search-field"><span className="sr-only">Search games</span><span aria-hidden="true">⌕</span><input disabled={!snapshot} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search titles, developers, publishers" /></label>
          <label className="select-field"><span className="sr-only">Owner range</span><select disabled={!snapshot} value={ownerBand} onChange={(event) => { setOwnerBand(event.target.value); setPage(0); }}><option>All owner ranges</option>{OWNER_BANDS.map((item) => <option key={item} value={item}>{ownerBandLabels.get(item)}</option>)}</select></label>
          <label className="select-field"><span className="sr-only">Price band</span><select disabled={!snapshot} value={selectedPriceBand} onChange={(event) => { setSelectedPriceBand(event.target.value); setPage(0); }}><option>All prices</option>{PRICE_BANDS.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>

        <div className="result-strip"><span>{snapshot ? <><strong>{filtered.length.toLocaleString()}</strong> games match · {snapshot.pageCount.toLocaleString()} cached pages</> : snapshotError || "Loading cached snapshot…"}</span><button type="button" disabled={!snapshot} onClick={() => { setSearch(""); setOwnerBand("All owner ranges"); setSelectedPriceBand("All prices"); }}>Reset filters</button></div>

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
              {visible.length === 0 && <tr><td colSpan={6}><div className="empty-state"><strong>{snapshot ? "No games found" : snapshotError ? "Snapshot unavailable" : "Loading games"}</strong><span>{snapshot ? "Try a broader search or reset the filters." : snapshotError || "Fetching the cached SteamSpy dataset…"}</span></div></td></tr>}
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
    </main>
  );
}
