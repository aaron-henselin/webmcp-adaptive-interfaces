"use client";

import { useEffect, useRef, useState } from "react";
import { CATALOG_ANALYTICS_BINDING_SCHEMA, CATALOG_FIELD_CATALOG, normalizeCatalogAnalyticsBinding, OWNER_BANDS, PRICE_BANDS, type CatalogAnalyticsBinding } from "./catalog-analytics";
import { executeCatalogReport, loadCatalogPage, type CatalogFilter, type CatalogFilterOperator, type CatalogFilterValue, type CatalogGame, type CatalogPage } from "./catalog-data";
import { bindCatalogRowsToFigure } from "./catalog-visualization";
import { createReportPresentationSchema, REPORT_MODE_CATALOG, REPORT_PRESENTATION_DESCRIPTION, reportPresentationShapeError } from "./report-presentation-schema";
import { webMcpStatusLabel, type WebMcpStatus } from "./demo-switcher";
import { formatCompact, formatOwnerRange, formatPercent, formatPlaytime, formatPrice } from "./steamspy-data";
import { normalizePlotlyFigure, PlotlyCanvas, PLOTLY_TRACE_TYPES, renderPlotlyFigureToPng, type PlotlyFigure } from "./plotly-visualization";
import { CatalogTableSkeleton } from "./loading-skeletons";

type SortKey = "ownersMax" | "title" | "priceCents" | "positiveRatio" | "reviewCount" | "ccu" | "releaseYear";
type SortDirection = "asc" | "desc";
type ValueFormat = "number" | "integer" | "compact" | "currencyCents" | "percent" | "minutes" | "year";
type MetricSpec = { valueField: string; label: string; format: ValueFormat; context: string };
type TableColumn = { field: string; label: string; format: ValueFormat };
type ReportPresentation =
  | { mode: "metric"; metric: MetricSpec }
  | { mode: "table"; table: { columns: TableColumn[] } }
  | { mode: "chart"; figure: PlotlyFigure }
  | { mode: "narrative"; narrative: { body: string } }
  | { mode: "mixed"; metric: MetricSpec; figure: PlotlyFigure };
type SavedReport = { id: string; savedAt: string; title: string; description: string; presentation: ReportPresentation; binding: CatalogAnalyticsBinding };
type OpenReport = { report: SavedReport; rows: Record<string, unknown>[]; figure?: PlotlyFigure };
type AppliedCatalogFilter = CatalogFilter & { id: string; label: string };
type CatalogSearchSnapshot = { query: string; ownerBand: string; priceBand: string; filters: AppliedCatalogFilter[]; sort: SortKey; direction: SortDirection };
type PendingCatalogSearch = { key: string; resolve: (catalog: CatalogPage) => void; reject: (error: Error) => void; timeout: number };

const PAGE_SIZE = 12;
const MAX_SAVED_REPORTS = 8;
const SAVED_REPORTS_KEY = "adaptive-interfaces:saved-reports:v5";
const LEGACY_SAVED_REPORTS_KEY = "steam-desk:saved-reports:v5";
const VALUE_FORMATS: ValueFormat[] = ["number", "integer", "compact", "currencyCents", "percent", "minutes", "year"];
const SORT_KEYS: SortKey[] = ["ownersMax", "title", "priceCents", "positiveRatio", "reviewCount", "ccu", "releaseYear"];
const CATALOG_FILTER_OPERATORS: CatalogFilterOperator[] = ["equal", "notEqual", "greaterThan", "greaterOrEqual", "lessThan", "lessOrEqual", "in", "contains"];
const CATALOG_FILTER_FIELDS = CATALOG_FIELD_CATALOG.map((field) => field.name).filter((field) => field !== "tagWeight");
const CATALOG_FILTER_FIELD_SET = new Set<string>(CATALOG_FILTER_FIELDS);
const FILTER_OPERATOR_LABELS: Record<CatalogFilterOperator, string> = {
  equal: "is", notEqual: "is not", greaterThan: ">", greaterOrEqual: "≥", lessThan: "<", lessOrEqual: "≤", in: "in", contains: "contains",
};
const coverMarks = ["◜", "◇", "◉", "⌁", "△", "✣", "⊙", "╱"];
const ownerBandLabels = new Map(OWNER_BANDS.map((band) => {
  const [ownersMin, ownersMax] = band.split("..").map((value) => Number(value.replaceAll(",", "").trim()));
  return [band, formatOwnerRange({ ownersMin, ownersMax })] as const;
}));

function GameCover({ game }: { game: Pick<CatalogGame, "id" | "title" | "headerImage"> }) {
  const accent = Math.abs(game.id) % coverMarks.length;
  const initials = game.title.split(" ").map((word) => word[0]).slice(0, 2).join("");

  return <span className={`cover cover-${accent}`} aria-hidden="true">
    <i>{coverMarks[accent]}</i>
    <b>{initials}</b>
    {game.headerImage ? <img src={game.headerImage} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} /> : null}
  </span>;
}

const SAMPLE_PROMPTS = [
  { mode: "Metric", prompt: "Exclude free titles and show me the median price of paid games in this catalog." },
  { mode: "Table", prompt: "Show me the 10 games with the highest peak player count." },
  { mode: "Chart", prompt: "Show me how many games are in each genre." },
  { mode: "Mixed", prompt: "Show the mean review score for RPG-tagged games with a review-band chart." },
] as const;

const PLOTLY_TRACE_SCHEMA = { type: "object", additionalProperties: true, properties: { type: { type: "string", enum: [...PLOTLY_TRACE_TYPES] }, name: { type: "string" }, x: { type: "array", maxItems: 2_000, items: {} }, y: { type: "array", maxItems: 2_000, items: {} }, labels: { type: "array", maxItems: 2_000, items: {} }, values: { type: "array", maxItems: 2_000, items: {} }, mode: { type: "string" }, orientation: { type: "string", enum: ["h", "v"] }, hole: { type: "number", minimum: 0, maximum: 0.9 }, marker: { type: "object", additionalProperties: true }, line: { type: "object", additionalProperties: true }, text: { type: "array", maxItems: 2_000, items: {} }, hovertemplate: { type: "string" } } };
const REPORT_DATA_SCHEMA = { type: "object", additionalProperties: false, properties: { source: CATALOG_ANALYTICS_BINDING_SCHEMA.properties.source, pipeline: CATALOG_ANALYTICS_BINDING_SCHEMA.properties.pipeline, resultLimit: CATALOG_ANALYTICS_BINDING_SCHEMA.properties.resultLimit }, required: ["source", "pipeline", "resultLimit"] };
const REPORT_VISUALIZATION_SCHEMA = { type: "object", additionalProperties: false, properties: { renderer: { type: "string", const: "plotly" }, traces: { type: "array", minItems: 1, maxItems: 12, items: PLOTLY_TRACE_SCHEMA }, layout: { type: "object", additionalProperties: true }, encoding: CATALOG_ANALYTICS_BINDING_SCHEMA.properties.encoding }, required: ["renderer", "traces", "encoding"] };
const REPORT_METRIC_SCHEMA = { type: "object", additionalProperties: false, properties: { valueField: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" }, label: { type: "string", maxLength: 80 }, format: { type: "string", enum: VALUE_FORMATS, description: "Use year for calendar-year fields. releaseYear always renders as a year when this is omitted or set to a generic numeric format." }, context: { type: "string", maxLength: 180 } }, required: ["valueField", "label"] };
const REPORT_COLUMN_SCHEMA = { type: "object", additionalProperties: false, properties: { field: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" }, label: { type: "string", maxLength: 60 }, format: { type: "string", enum: VALUE_FORMATS, description: "Use year for calendar-year fields. releaseYear always renders as a year when this is omitted or set to a generic numeric format." } }, required: ["field", "label"] };
const REPORT_PRESENTATION_SCHEMA = createReportPresentationSchema({ metric: REPORT_METRIC_SCHEMA, tableColumn: REPORT_COLUMN_SCHEMA, visualization: REPORT_VISUALIZATION_SCHEMA });
const APPLY_CATALOG_SEARCH_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["replace", "append"], default: "replace", description: "Replace the visible criteria, or append filters to the current visible search." },
    query: { type: "string", maxLength: 120, description: "Optional full-text search across titles and indexed catalog metadata." },
    filters: {
      type: "array", maxItems: 12, description: "Any safe combination of scalar or dimension filters. Dimension fields are developer, publisher, genre, tag, category, and language.",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          label: { type: "string", maxLength: 60, description: "Optional concise facet label shown in the UI." },
          field: { type: "string", enum: CATALOG_FILTER_FIELDS },
          operator: { type: "string", enum: CATALOG_FILTER_OPERATORS },
          value: { description: "A string, finite number, boolean, null, or an array of scalar values for the in operator." },
        },
        required: ["field", "operator", "value"],
      },
    },
    sort: { type: "string", enum: SORT_KEYS },
    direction: { type: "string", enum: ["asc", "desc"] },
  },
  required: ["filters"],
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, fallback: string, limit: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : fallback;
const valueFormat = (value: unknown, field: string): ValueFormat => field === "releaseYear" ? "year" : VALUE_FORMATS.includes(value as ValueFormat) ? value as ValueFormat : "number";

function metric(value: unknown): MetricSpec | null {
  if (!isRecord(value) || typeof value.valueField !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value.valueField)) return null;
  return { valueField: value.valueField, label: text(value.label, value.valueField, 80), format: valueFormat(value.format, value.valueField), context: text(value.context, "", 180) };
}

function columns(value: unknown): TableColumn[] {
  return Array.isArray(value) ? value.flatMap((item): TableColumn[] => isRecord(item) && typeof item.field === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(item.field) ? [{ field: item.field, label: text(item.label, item.field, 60), format: valueFormat(item.format, item.field) }] : []).slice(0, 8) : [];
}

function catalogFilterValue(value: unknown): CatalogFilterValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
  if (!Array.isArray(value) || !value.length || value.length > 20) return undefined;
  const members = value.filter((item): item is string | number | boolean => typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item));
  return members.length === value.length ? members : undefined;
}

function catalogFilterLabel(field: string, operator: CatalogFilterOperator, value: CatalogFilterValue) {
  const rendered = Array.isArray(value) ? value.join(", ") : value === null ? "empty" : typeof value === "boolean" ? value ? "yes" : "no" : String(value);
  return `${field} ${FILTER_OPERATOR_LABELS[operator]} ${rendered}`.slice(0, 80);
}

function normalizeCatalogFilters(value: unknown): AppliedCatalogFilter[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const normalized = value.flatMap((item, index): AppliedCatalogFilter[] => {
    if (!isRecord(item) || typeof item.field !== "string" || !CATALOG_FILTER_FIELD_SET.has(item.field) || !CATALOG_FILTER_OPERATORS.includes(item.operator as CatalogFilterOperator)) return [];
    const operator = item.operator as CatalogFilterOperator;
    const filterValue = catalogFilterValue(item.value);
    if (filterValue === undefined || operator === "in" && !Array.isArray(filterValue) || operator !== "in" && Array.isArray(filterValue) || operator === "contains" && typeof filterValue !== "string" || filterValue === null && !["equal", "notEqual"].includes(operator)) return [];
    return [{
      id: `${item.field}-${operator}-${index}-${crypto.randomUUID()}`,
      label: text(item.label, catalogFilterLabel(item.field, operator, filterValue), 80),
      field: item.field, operator, value: filterValue,
    }];
  });
  return normalized.length === value.length ? normalized : null;
}

function createPresentation(input: Record<string, unknown>) {
  if (!isRecord(input.presentation)) throw new Error("A report presentation is required.");
  const supplied = input.presentation;
  const shapeError = reportPresentationShapeError(supplied);
  if (shapeError) throw new Error(shapeError);
  const mode = supplied.mode;
  const metricSpec = metric(supplied.metric);
  const tableColumns = isRecord(supplied.table) ? columns(supplied.table.columns) : [];
  const narrative = isRecord(supplied.narrative) ? text(supplied.narrative.body, "", 800) : "";
  let figure: PlotlyFigure | undefined;
  let encoding: Record<string, unknown> = { hover: [] };
  if (isRecord(supplied.visualization)) {
    figure = normalizePlotlyFigure({ data: Array.isArray(supplied.visualization.traces) ? supplied.visualization.traces : [], layout: isRecord(supplied.visualization.layout) ? supplied.visualization.layout : {} });
    encoding = isRecord(supplied.visualization.encoding) ? supplied.visualization.encoding : { hover: [] };
  }
  if (mode === "metric" && metricSpec) return { presentation: { mode, metric: metricSpec } as ReportPresentation, encoding: { hover: [] } };
  if (mode === "table" && tableColumns.length) return { presentation: { mode, table: { columns: tableColumns } } as ReportPresentation, encoding: { hover: [] } };
  if (mode === "narrative" && narrative) return { presentation: { mode, narrative: { body: narrative } } as ReportPresentation, encoding: { hover: [] } };
  if (mode === "chart" && figure) return { presentation: { mode, figure } as ReportPresentation, encoding };
  if (mode === "mixed" && metricSpec && figure) return { presentation: { mode, metric: metricSpec, figure } as ReportPresentation, encoding };
  throw new Error(`The ${String(mode)} report has an invalid presentation definition.`);
}

function formatValue(value: unknown, format: ValueFormat) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return String(value ?? "—");
  if (format === "currencyCents") return formatPrice(number);
  if (format === "percent") return formatPercent(number);
  if (format === "minutes") return formatPlaytime(number);
  if (format === "compact") return formatCompact(number);
  if (format === "year") return String(Math.round(number));
  return format === "integer" ? Math.round(number).toLocaleString() : number.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function ReportBody({ opened }: { opened: OpenReport }) {
  const presentation = opened.report.presentation;
  if (presentation.mode === "metric" || presentation.mode === "mixed") {
    const value = opened.rows[0]?.[presentation.metric.valueField];
    return <div className={`report-body report-body-${presentation.mode}`}><div className="metric-answer"><span>{presentation.metric.label}</span><strong>{formatValue(value, presentation.metric.format)}</strong><span>{presentation.metric.context || "Calculated from the catalog."}</span></div>{presentation.mode === "mixed" && opened.figure ? <PlotlyCanvas figure={opened.figure} /> : null}</div>;
  }
  if (presentation.mode === "table") return <div className="report-table-wrap"><table className="report-table"><thead><tr>{presentation.table.columns.map((column) => <th key={column.field}>{column.label}</th>)}</tr></thead><tbody>{opened.rows.map((row, index) => <tr key={index}>{presentation.table.columns.map((column) => <td key={column.field}>{formatValue(row[column.field], column.format)}</td>)}</tr>)}</tbody></table></div>;
  if (presentation.mode === "narrative") return <div className="narrative-report"><span aria-hidden="true">“</span><p>{presentation.narrative.body}</p></div>;
  return opened.figure ? <PlotlyCanvas figure={opened.figure} /> : null;
}

async function runReport(report: SavedReport): Promise<OpenReport> {
  const rows = await executeCatalogReport(report.binding);
  if (report.presentation.mode === "chart" || report.presentation.mode === "mixed") {
    const figure = normalizePlotlyFigure(bindCatalogRowsToFigure(report.presentation.figure, report.binding, rows));
    return { report, rows, figure };
  }
  return { report, rows };
}

function markdownReport(opened: OpenReport) {
  const presentation = opened.report.presentation;
  const lines = [`## ${opened.report.title}`, opened.report.description, ""];
  if (presentation.mode === "metric" || presentation.mode === "mixed") lines.push(`**${presentation.metric.label}:** ${formatValue(opened.rows[0]?.[presentation.metric.valueField], presentation.metric.format)}`);
  else if (presentation.mode === "narrative") lines.push(presentation.narrative.body);
  else {
    const reportColumns = presentation.mode === "table" ? presentation.table.columns : Object.keys(opened.rows[0] ?? {}).slice(0, 8).map((field) => ({ field, label: field, format: field === "releaseYear" ? "year" as ValueFormat : "number" as ValueFormat }));
    lines.push(`| ${reportColumns.map((column) => column.label).join(" | ")} |`, `| ${reportColumns.map(() => "---").join(" | ")} |`);
    for (const row of opened.rows.slice(0, 20)) lines.push(`| ${reportColumns.map((column) => String(formatValue(row[column.field], column.format)).replaceAll("|", "\\|")).join(" | ")} |`);
  }
  return lines.filter(Boolean).join("\n");
}

export default function CatalogPage({ webMcpStatus, onWebMcpStatusChange }: { webMcpStatus: WebMcpStatus; onWebMcpStatusChange: (status: WebMcpStatus) => void }) {
  const [catalog, setCatalog] = useState<CatalogPage | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [resolvedCatalogKey, setResolvedCatalogKey] = useState("");
  const [search, setSearch] = useState("");
  const [ownerBand, setOwnerBand] = useState("All owner ranges");
  const [priceBand, setPriceBand] = useState("All prices");
  const [catalogFilters, setCatalogFilters] = useState<AppliedCatalogFilter[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("ownersMax");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(0);
  const [openReport, setOpenReport] = useState<OpenReport | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [showPromptGuide, setShowPromptGuide] = useState(false);
  const savedReportsRef = useRef<SavedReport[]>([]);
  const reportsLoadedRef = useRef(false);
  const catalogRef = useRef<CatalogPage | null>(null);
  const resolvedCatalogKeyRef = useRef("");
  const catalogSearchStateRef = useRef<CatalogSearchSnapshot>({ query: "", ownerBand: "All owner ranges", priceBand: "All prices", filters: [], sort: "ownersMax", direction: "desc" });
  const pendingCatalogSearchRef = useRef<PendingCatalogSearch | null>(null);
  const reportRef = useRef<HTMLElement>(null);
  const suggestionMenuRef = useRef<HTMLDivElement>(null);
  const catalogRequestKey = JSON.stringify([search, ownerBand, priceBand, sortKey, sortDirection, page, catalogFilters]);
  catalogRef.current = catalog;
  resolvedCatalogKeyRef.current = resolvedCatalogKey;
  catalogSearchStateRef.current = { query: search, ownerBand, priceBand, filters: catalogFilters, sort: sortKey, direction: sortDirection };
  const catalogLoading = resolvedCatalogKey !== catalogRequestKey;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      loadCatalogPage({ search, ownerBand, priceBand, filters: catalogFilters, sort: sortKey, direction: sortDirection, page, pageSize: PAGE_SIZE }, controller.signal)
        .then((value) => {
          if (controller.signal.aborted) return;
          setCatalog(value); setCatalogError(""); setResolvedCatalogKey(catalogRequestKey);
          const pending = pendingCatalogSearchRef.current;
          if (pending?.key === catalogRequestKey) { window.clearTimeout(pending.timeout); pendingCatalogSearchRef.current = null; pending.resolve(value); }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const failure = error instanceof Error ? error : new Error("Catalog unavailable.");
          setCatalogError(failure.message); setResolvedCatalogKey(catalogRequestKey);
          const pending = pendingCatalogSearchRef.current;
          if (pending?.key === catalogRequestKey) { window.clearTimeout(pending.timeout); pendingCatalogSearchRef.current = null; pending.reject(failure); }
        });
    }, search ? 180 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  // The serialized filters are the request identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogRequestKey]);

  useEffect(() => {
    let reports: SavedReport[] = [];
    try {
      const stored = window.localStorage.getItem(SAVED_REPORTS_KEY) ?? window.localStorage.getItem(LEGACY_SAVED_REPORTS_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      if (Array.isArray(parsed)) {
        reports = parsed.flatMap((item): SavedReport[] => {
          if (!isRecord(item) || !isRecord(item.binding) || !isRecord(item.presentation)) return [];
          const binding = normalizeCatalogAnalyticsBinding(item.binding);
          return binding && typeof item.id === "string" ? [{ ...item, binding } as SavedReport] : [];
        }).slice(0, MAX_SAVED_REPORTS);
      }
    } catch { /* Ignore unavailable or malformed device storage. */ }
    savedReportsRef.current = reports;
    queueMicrotask(() => { reportsLoadedRef.current = true; setSavedReports(reports); });
  }, []);

  useEffect(() => { savedReportsRef.current = savedReports; if (!reportsLoadedRef.current) return; try { window.localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(savedReports)); window.localStorage.removeItem(LEGACY_SAVED_REPORTS_KEY); } catch { /* Session-only fallback. */ } }, [savedReports]);

  useEffect(() => {
    if (!showPromptGuide) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !suggestionMenuRef.current?.contains(event.target)) setShowPromptGuide(false);
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowPromptGuide(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnKeyDown);
    };
  }, [showPromptGuide]);

  const catalogRecordCount = catalog?.meta.recordCount;
  const catalogSourceSha256 = catalog?.meta.sourceSha256;
  useEffect(() => {
    if (catalogRecordCount === undefined) return;
    const context = document.modelContext ?? navigator.modelContext;
    if (!context) { queueMicrotask(() => onWebMcpStatusChange("preview")); return; }
    const controller = new AbortController();

    const createReport = async (input: Record<string, unknown>) => {
      const title = text(input.title, "Steam catalog report", 100);
      const description = text(input.description, "", 220);
      const created = createPresentation(input);
      const data = isRecord(input.data) ? input.data : {};
      const binding = normalizeCatalogAnalyticsBinding({ ...data, encoding: created.encoding });
      if (!binding) throw new Error("Invalid catalog report definition.");
      const rows = await executeCatalogReport(binding, controller.signal);
      let presentation = created.presentation;
      let figure: PlotlyFigure | undefined;
      if (presentation.mode === "chart" || presentation.mode === "mixed") {
        figure = normalizePlotlyFigure(bindCatalogRowsToFigure(presentation.figure, binding, rows));
        presentation = presentation.mode === "chart" ? { mode: "chart", figure } : { mode: "mixed", metric: presentation.metric, figure };
      }
      const available = new Set(rows.flatMap(Object.keys));
      if ((presentation.mode === "metric" || presentation.mode === "mixed") && rows.length && !available.has(presentation.metric.valueField)) throw new Error(`Result field ${presentation.metric.valueField} is unavailable.`);
      if (presentation.mode === "table") { const missing = presentation.table.columns.find((column) => rows.length && !available.has(column.field)); if (missing) throw new Error(`Result field ${missing.field} is unavailable.`); }
      const report: SavedReport = { id: crypto.randomUUID(), savedAt: new Date().toISOString(), title, description, presentation, binding };
      const next = [report, ...savedReportsRef.current].slice(0, MAX_SAVED_REPORTS); savedReportsRef.current = next; setSavedReports(next);
      const opened = { report, rows, figure }; if (input.openInBrowser !== false) { setOpenReport(opened); window.setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80); }
      return opened;
    };

    const applyCatalogSearch = async (input: Record<string, unknown>) => {
      const incoming = normalizeCatalogFilters(input.filters);
      if (!incoming) throw new Error("Invalid catalog filters. Use only described fields, operators, and scalar values.");
      const current = catalogSearchStateRef.current;
      const append = input.mode === "append";
      const combined = append ? [...current.filters, ...incoming] : incoming;
      const seen = new Set<string>();
      const nextFilters = combined.filter((filter) => {
        const signature = JSON.stringify([filter.field, filter.operator, filter.value]);
        if (seen.has(signature)) return false;
        seen.add(signature);
        return true;
      }).slice(-12);
      const nextSearch = typeof input.query === "string" ? input.query.trim().slice(0, 120) : append ? current.query : "";
      const nextOwnerBand = append ? current.ownerBand : "All owner ranges";
      const nextPriceBand = append ? current.priceBand : "All prices";
      const nextSort = SORT_KEYS.includes(input.sort as SortKey) ? input.sort as SortKey : append ? current.sort : "ownersMax";
      const nextDirection = input.direction === "asc" || input.direction === "desc" ? input.direction : append ? current.direction : nextSort === "title" ? "asc" : "desc";
      const nextKey = JSON.stringify([nextSearch, nextOwnerBand, nextPriceBand, nextSort, nextDirection, 0, nextFilters]);
      const alreadyRendered = resolvedCatalogKeyRef.current === nextKey ? catalogRef.current : null;

      const previous = pendingCatalogSearchRef.current;
      if (previous) { window.clearTimeout(previous.timeout); previous.reject(new Error("The visible catalog search was replaced by a newer request.")); pendingCatalogSearchRef.current = null; }

      let rendered: Promise<CatalogPage>;
      if (alreadyRendered) rendered = Promise.resolve(alreadyRendered);
      else rendered = new Promise<CatalogPage>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          if (pendingCatalogSearchRef.current?.key === nextKey) pendingCatalogSearchRef.current = null;
          reject(new Error("The catalog search timed out before the visible results finished updating."));
        }, 30_000);
        pendingCatalogSearchRef.current = { key: nextKey, resolve, reject, timeout };
      });

      setSearch(nextSearch); setOwnerBand(nextOwnerBand); setPriceBand(nextPriceBand); setCatalogFilters(nextFilters);
      setSortKey(nextSort); setSortDirection(nextDirection); setPage(0); setOpenReport(null);
      const result = await rendered;
      return {
        content: [{ type: "text", text: `Applied ${nextFilters.length} facet filter${nextFilters.length === 1 ? "" : "s"} to the visible catalog; ${result.query.total.toLocaleString()} games match.` }],
        structuredContent: {
          schemaVersion: "adaptive-interfaces.catalog-search/v1", ok: true, applied: true, persistence: "current browser session",
          query: nextSearch, filters: nextFilters.map(({ label, field, operator, value }) => ({ label, field, operator, value })),
          sort: nextSort, direction: nextDirection, total: result.query.total,
        },
      };
    };

    const tools = [
      { name: "describe_steam_catalog", description: "Describe the database-backed Steam catalog fields, filters, analytics operations, and presentation contract. Use before creating a report when field meanings or genre/tag expansion are unclear.", inputSchema: { type: "object", additionalProperties: false, properties: {} }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => ({ content: [{ type: "text", text: `Described ${CATALOG_FIELD_CATALOG.length} reportable catalog fields.` }], structuredContent: { schemaVersion: "adaptive-interfaces.datasource/v2", source: { name: "steam_catalog", label: "Steam catalog database", recordCount: catalogRecordCount }, fields: CATALOG_FIELD_CATALOG, visibleSearch: catalogSearchStateRef.current, searchDefinition: APPLY_CATALOG_SEARCH_SCHEMA, reportDefinition: { data: REPORT_DATA_SCHEMA, presentation: REPORT_PRESENTATION_SCHEMA, valueFormats: VALUE_FORMATS }, presentationModes: REPORT_MODE_CATALOG, guidance: ["Route every data-derived request through create_report, even when it is phrased as a natural question and never mentions reports or saving.", "Use explode with genres, tags, categories, developers, publishers, or languages before grouping by an individual value.", "For tags, explode also provides tagWeight.", "Report results are capped at 2,000 rows and execute in the database.", REPORT_PRESENTATION_DESCRIPTION] } }) },
      {
        name: "apply_catalog_search",
        description: "Apply arbitrary, allowlisted facet filters to the visible catalog table. Filters may target any described scalar field or the developer, publisher, genre, tag, category, and language dimensions; combine up to 12 filters with AND semantics. Use in for one-of values and contains for case-insensitive text matching. Replace is the default; append preserves existing visible criteria. This changes only the current browser session, opens the raw-data view, resets pagination, and waits for the results to render.",
        inputSchema: APPLY_CATALOG_SEARCH_SCHEMA,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, untrustedContentHint: false },
        execute: async (input: Record<string, unknown>) => {
          try { return await applyCatalogSearch(input); }
          catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "The catalog search could not be applied." }], structuredContent: { ok: false } }; }
        },
      },
      { name: "create_report", description: "Use for every request that asks for an answer, calculation, analysis, ranking, comparison, summary, table, chart, or narrative from Steam catalog data, even when the user does not say report or save. This is the reporting interface for all data-derived answers. Save exactly one presentation: metric, table, chart, narrative, or mixed. Mixed means one headline metric plus one supporting chart and never includes a table; create separate reports when both a chart and table are needed. Returns only a compact receipt.", inputSchema: { type: "object", additionalProperties: false, properties: { title: { type: "string", maxLength: 100 }, description: { type: "string", maxLength: 220 }, data: REPORT_DATA_SCHEMA, presentation: REPORT_PRESENTATION_SCHEMA, openInBrowser: { type: "boolean", default: true } }, required: ["title", "data", "presentation"] }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input: Record<string, unknown>) => { try { const opened = await createReport(input); return { content: [{ type: "text", text: `Created and saved “${opened.report.title}”.` }], structuredContent: { schemaVersion: "adaptive-interfaces.report-receipt/v3", ok: true, created: true, saved: true, browser: { opened: input.openInBrowser !== false }, report: { id: opened.report.id, title: opened.report.title, mode: opened.report.presentation.mode, rowCount: opened.rows.length } } }; } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Report creation failed." }], structuredContent: { ok: false, retryable: false } }; } } },
      { name: "render_report", description: "Render an existing saved report as bounded Markdown or, for chart reports, a PNG.", inputSchema: { type: "object", additionalProperties: false, properties: { reportId: { type: "string", minLength: 1, maxLength: 128 }, renderMode: { type: "string", enum: ["auto", "markdown", "image"], default: "auto" } }, required: ["reportId"] }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: async (input: Record<string, unknown>) => { try { const report = savedReportsRef.current.find((item) => item.id === input.reportId); if (!report) throw new Error("Saved report not found."); const opened = await runReport(report); const imageMode = input.renderMode === "image" || input.renderMode !== "markdown" && Boolean(opened.figure); if (imageMode) { if (!opened.figure) throw new Error("Image rendering is available only for chart reports."); return { content: [{ type: "text", text: `Rendered “${report.title}” as a PNG.` }, { type: "image", data: await renderPlotlyFigureToPng(opened.figure), mimeType: "image/png" }], structuredContent: { ok: true, rendered: true, report: { id: report.id, title: report.title } } }; } return { content: [{ type: "text", text: markdownReport(opened) }], structuredContent: { ok: true, rendered: true, report: { id: report.id, title: report.title } } }; } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Report rendering failed." }] }; } } },
    ];
    Promise.all(tools.map((tool) => context.registerTool(tool, { signal: controller.signal })))
      .then(() => { if (!controller.signal.aborted) onWebMcpStatusChange("connected"); })
      .catch(() => { if (!controller.signal.aborted) onWebMcpStatusChange("preview"); });
    return () => controller.abort();
  }, [catalogRecordCount, catalogSourceSha256, onWebMcpStatusChange]);

  const games = catalog?.games ?? [];
  const total = catalog?.query.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visiblePage = Math.min(page, totalPages - 1);
  const start = total ? visiblePage * PAGE_SIZE + 1 : 0;
  const end = Math.min((visiblePage + 1) * PAGE_SIZE, total);
  const activeCatalogTab = openReport?.report.id ?? "raw-data";
  const sortIndicator = (key: SortKey) => sortKey === key ? sortDirection === "asc" ? "↑" : "↓" : "↕";
  const changeSort = (next: SortKey) => { if (next === sortKey) setSortDirection((value) => value === "asc" ? "desc" : "asc"); else { setSortKey(next); setSortDirection(next === "title" ? "asc" : "desc"); } setPage(0); };
  return <main className="site-shell">
    <section className="adaptive-interface" aria-labelledby="page-title">
      <header className="desk-header catalog-header"><div className="desk-header-copy"><p className={`desk-kicker webmcp-status-${webMcpStatus}`}><span aria-hidden="true" /> {webMcpStatusLabel(webMcpStatus)}</p><h1 id="page-title">Data Table</h1><p className="dek">See how a familiar data table component can be personalized right within your browser. Try exploring the Steam ecosystem your way.</p></div><div className="header-meta"><img className="steam-press-mark" src="/steam-logo-official.jpg" alt="Steam®" width="300" height="300" /><div className="catalog-status"><strong>{catalog ? catalog.meta.recordCount.toLocaleString() : "—"}<span>games</span></strong></div></div></header>
      <div className="catalog-viewbar" ref={suggestionMenuRef}>
        <nav className="catalog-tabs" role="tablist" aria-label="Catalog views">
          <button id="catalog-tab-raw-data" type="button" role="tab" aria-selected={activeCatalogTab === "raw-data"} aria-controls="catalog-panel-raw-data" className={activeCatalogTab === "raw-data" ? "active" : ""} onClick={() => setOpenReport(null)}>
            <span className="catalog-tab-mark" aria-hidden="true">⌗</span>
            <span><strong>Raw data</strong><small>{catalog ? `${catalog.meta.recordCount.toLocaleString()} games` : "Catalog"}</small></span>
          </button>
          {savedReports.map((report) => <div className={`catalog-report-tab mode-${report.presentation.mode} ${activeCatalogTab === report.id ? "active" : ""}`} role="presentation" key={report.id}>
            <button id={`catalog-tab-${report.id}`} type="button" role="tab" aria-selected={activeCatalogTab === report.id} aria-controls={`catalog-panel-${report.id}`} onClick={() => void runReport(report).then((opened) => { setOpenReport(opened); window.setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80); })}>
              <span className="catalog-tab-mark" aria-hidden="true">{report.presentation.mode.slice(0, 1)}</span>
              <span><strong>{report.title}</strong><small>{report.presentation.mode} report</small></span>
            </button>
            <button type="button" className="catalog-tab-delete" aria-label={`Delete ${report.title}`} onClick={() => { setSavedReports((items) => items.filter((item) => item.id !== report.id)); if (activeCatalogTab === report.id) setOpenReport(null); }}>×</button>
          </div>)}
          {!savedReports.length ? <span className="catalog-tabs-empty">Your personal reports will appear here</span> : null}
        </nav>
        <button type="button" className={`suggest-report${showPromptGuide ? " open" : ""}`} aria-label={showPromptGuide ? "Close report suggestions" : "Add a report"} aria-expanded={showPromptGuide} aria-controls="prompt-guide" onClick={() => setShowPromptGuide((value) => !value)}>
          Add a report <span aria-hidden="true">+</span>
        </button>
        {showPromptGuide ? <section id="prompt-guide" className="prompt-guide catalog-suggestion-menu" role="dialog" aria-modal="false" aria-labelledby="prompt-guide-title"><header><div><h2 id="prompt-guide-title">You can ask..</h2></div><p>New reports become tabs.</p></header><div className="prompt-grid">{SAMPLE_PROMPTS.map((item) => <button type="button" className="prompt-card" key={item.prompt} onClick={() => void navigator.clipboard.writeText(item.prompt).then(() => { setCopiedPrompt(item.prompt); window.setTimeout(() => setCopiedPrompt(null), 1600); })}><span className="prompt-mode">{item.mode}</span><span className="prompt-copy">“{item.prompt}”</span><span className="prompt-action">{copiedPrompt === item.prompt ? "Copied ✓" : "Copy prompt ↗"}</span></button>)}</div></section> : null}
      </div>
      {openReport ? <section id={`catalog-panel-${openReport.report.id}`} className={`catalog-report-view report-${openReport.report.presentation.mode}`} role="tabpanel" aria-labelledby={`catalog-tab-${openReport.report.id}`} ref={reportRef}>
        <header><div><h2>{openReport.report.title}</h2><p>{openReport.report.description || "Updated from its saved catalog settings."}</p></div><div className="plot-meta"><span>{openReport.report.presentation.mode}</span><span>{openReport.rows.length.toLocaleString()} rows</span></div></header>
        <ReportBody opened={openReport} />
        <footer><span>Updated from the catalog when this tab opens</span><button type="button" onClick={() => setOpenReport(null)}>Back to raw data</button></footer>
      </section> : <section id="catalog-panel-raw-data" className="catalog-raw-view" role="tabpanel" aria-labelledby="catalog-tab-raw-data" aria-busy={catalogLoading}>
        <div className="toolbar" aria-label="Catalog filters"><label className="search-field"><span className="sr-only">Search games</span><span aria-hidden="true">⌕</span><input disabled={!catalog} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search titles, developers, genres, tags" /></label><label className="select-field"><span className="sr-only">Owner range</span><select disabled={!catalog} value={ownerBand} onChange={(event) => { setOwnerBand(event.target.value); setPage(0); }}><option>All owner ranges</option>{OWNER_BANDS.map((item) => <option key={item} value={item}>{ownerBandLabels.get(item)}</option>)}</select></label><label className="select-field"><span className="sr-only">Price band</span><select disabled={!catalog} value={priceBand} onChange={(event) => { setPriceBand(event.target.value); setPage(0); }}><option>All prices</option>{PRICE_BANDS.map((item) => <option key={item}>{item}</option>)}</select></label></div>
        <div className="result-strip"><div className="catalog-result-context"><span aria-live="polite">{catalogLoading ? "Updating results..." : catalog ? <><strong>{total.toLocaleString()}</strong> games match</> : catalogError}</span>{catalogFilters.length ? <div className="catalog-filter-chips" aria-label="Applied facet filters">{catalogFilters.map((filter) => <button type="button" className="catalog-filter-chip" key={filter.id} aria-label={`Remove ${filter.label} filter`} onClick={() => { setCatalogFilters((items) => items.filter((item) => item.id !== filter.id)); setPage(0); }}>{filter.label}<span aria-hidden="true">×</span></button>)}</div> : null}</div><button type="button" disabled={!catalog} onClick={() => { setSearch(""); setOwnerBand("All owner ranges"); setPriceBand("All prices"); setCatalogFilters([]); setPage(0); }}>Reset filters</button></div>
        <div className="table-wrap"><table><thead><tr><th><button type="button" onClick={() => changeSort("title")}>Game <span>{sortIndicator("title")}</span></button></th><th><button type="button" onClick={() => changeSort("ownersMax")}>Owners <span>{sortIndicator("ownersMax")}</span></button></th><th><button type="button" onClick={() => changeSort("priceCents")}>Price <span>{sortIndicator("priceCents")}</span></button></th><th><button type="button" onClick={() => changeSort("positiveRatio")}>Reviews <span>{sortIndicator("positiveRatio")}</span></button></th><th><button type="button" onClick={() => changeSort("ccu")}>Players <span>{sortIndicator("ccu")}</span></button></th><th>Avg. playtime</th></tr></thead><tbody>{catalogLoading ? <CatalogTableSkeleton /> : games.map((game) => <tr key={game.id}><td><div className="game-cell"><GameCover game={game} /><span><strong>{game.title}</strong><small>{game.developer}{game.genres.length ? ` · ${game.genres.slice(0, 2).join(", ")}` : ""}</small></span></div></td><td><span className="genre-pill owner-range" title={game.owners}>{formatOwnerRange(game)}</span></td><td className="price-cell">{formatPrice(game.priceCents)}</td><td className="wishlist-cell">{formatPercent(game.positiveRatio)}</td><td className="wishlist-cell">{formatCompact(game.ccu)}</td><td><span className="status">{formatPlaytime(game.averageForever)}</span></td></tr>)}{!catalogLoading && !games.length && <tr><td colSpan={6}><div className="empty-state"><strong>{catalogError ? "Catalog unavailable" : "No games found"}</strong><span>{catalogError || "Try broader filters."}</span></div></td></tr>}</tbody></table></div>
        <footer className="desk-footer"><span>{catalogLoading ? "Updating catalog results..." : <>Showing {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}</>}</span><div><button type="button" disabled={catalogLoading || visiblePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>←</button><span>Page {visiblePage + 1} / {totalPages}</span><button type="button" disabled={catalogLoading || visiblePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>→</button></div></footer>
      </section>}
    </section>
    <footer className="valve-attribution"><span>Independent demo. Not affiliated with or endorsed by Valve.</span><span>©2026 Valve Corporation. Steam and the Steam logo are trademarks and/or registered trademarks of Valve Corporation in the U.S. and/or other countries.</span><a href="https://partner.steamgames.com/doc/marketing/branding" target="_blank" rel="noreferrer">Steam brand guidelines ↗</a></footer>
  </main>;
}
