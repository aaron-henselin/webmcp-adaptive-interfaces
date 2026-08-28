"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATALOG_ANALYTICS_BINDING_SCHEMA, CATALOG_FIELD_CATALOG, normalizeCatalogAnalyticsBinding, OWNER_BANDS, PRICE_BANDS } from "./catalog-analytics";
import { executeCatalogReport, loadCatalogPage, type CatalogPage } from "./catalog-data";
import { bindCatalogRowsToFigure } from "./catalog-visualization";
import { formatCompact, formatOwnerRange, formatPercent, formatPlaytime, formatPrice, formatSnapshotDate } from "./steamspy-data";
import { normalizePlotlyFigure, PlotlyCanvas, PLOTLY_TRACE_TYPES, renderPlotlyFigureToPng, type PlotlyFigure } from "./plotly-visualization";
import { PAGE_COMPOSITION_GUIDE } from "./page-composition-guide";
import "./workspace.css";
import {
  HTML_BINDINGS, MAX_HTML_LENGTH, SPANS, VALUE_FORMATS, addReport, applyOperations, findBlock, loadWorkspace, normalizePresentation,
  renderHtmlWidget, reportBlocks, saveWorkspace, validateBindings, workspaceOutline,
  type BlockSpan, type HtmlBlock, type LeafBlock, type ReportBlock, type TabsBlock,
  type ValueFormat, type Workspace, type WorkspaceBlock, type WorkspaceOperation,
} from "./workspace-model";

type SortKey = "ownersMax" | "title" | "priceCents" | "positiveRatio" | "ccu";
type SortDirection = "asc" | "desc";
type ChartType = "owners" | "reviews" | "price";
type Visualization = { type: ChartType; title: string; subtitle: string; items: Array<{ label: string; value: number }> };
type ReportResult = { rows: Record<string, unknown>[]; figure?: PlotlyFigure };

const PAGE_SIZE = 12;
const PAGE_TITLE = "Steam Desk";
const coverMarks = ["◜", "◇", "◉", "⌁", "△", "✣", "⊙", "╱"];
const ownerBandLabels = new Map(OWNER_BANDS.map((band) => {
  const [ownersMin, ownersMax] = band.split("..").map((value) => Number(value.replaceAll(",", "").trim()));
  return [band, formatOwnerRange({ ownersMin, ownersMax })] as const;
}));

const SAMPLE_PROMPTS = [
  { mode: "Briefing", prompt: "Build me a welcoming daily briefing that highlights what matters in the catalog and gives me a clear next step." },
  { mode: "Insight", prompt: "Show me the median price of games and explain what I should investigate next." },
  { mode: "Overview", prompt: "Create an at-a-glance view of ownership and genre performance for today's review." },
  { mode: "Organize", prompt: "Organize an executive overview and a deeper genre analysis so the page is easy to scan." },
] as const;

const PLOTLY_TRACE_SCHEMA = { type: "object", additionalProperties: true, properties: { type: { type: "string", enum: [...PLOTLY_TRACE_TYPES] }, name: { type: "string" }, x: { type: "array", maxItems: 2_000, items: {} }, y: { type: "array", maxItems: 2_000, items: {} }, labels: { type: "array", maxItems: 2_000, items: {} }, values: { type: "array", maxItems: 2_000, items: {} }, mode: { type: "string" }, orientation: { type: "string", enum: ["h", "v"] }, hole: { type: "number", minimum: 0, maximum: 0.9 }, marker: { type: "object", additionalProperties: true }, line: { type: "object", additionalProperties: true }, text: { type: "array", maxItems: 2_000, items: {} }, hovertemplate: { type: "string" } } };
const REPORT_DATA_SCHEMA = { type: "object", additionalProperties: false, properties: { source: CATALOG_ANALYTICS_BINDING_SCHEMA.properties.source, pipeline: CATALOG_ANALYTICS_BINDING_SCHEMA.properties.pipeline, resultLimit: CATALOG_ANALYTICS_BINDING_SCHEMA.properties.resultLimit }, required: ["source", "pipeline", "resultLimit"] };
const REPORT_VISUALIZATION_SCHEMA = { type: "object", additionalProperties: false, properties: { renderer: { type: "string", const: "plotly" }, traces: { type: "array", minItems: 1, maxItems: 12, items: PLOTLY_TRACE_SCHEMA }, layout: { type: "object", additionalProperties: true }, encoding: CATALOG_ANALYTICS_BINDING_SCHEMA.properties.encoding }, required: ["renderer", "traces", "encoding"] };
const REPORT_METRIC_SCHEMA = { type: "object", additionalProperties: false, properties: { valueField: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" }, label: { type: "string", maxLength: 80 }, format: { type: "string", enum: VALUE_FORMATS }, context: { type: "string", maxLength: 180 } }, required: ["valueField", "label"] };
const REPORT_COLUMN_SCHEMA = { type: "object", additionalProperties: false, properties: { field: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" }, label: { type: "string", maxLength: 60 }, format: { type: "string", enum: VALUE_FORMATS } }, required: ["field", "label"] };
const REPORT_PRESENTATION_SCHEMA = { type: "object", additionalProperties: false, properties: { mode: { type: "string", enum: ["metric", "table", "chart", "narrative", "mixed"] }, metric: REPORT_METRIC_SCHEMA, table: { type: "object", additionalProperties: false, properties: { columns: { type: "array", minItems: 1, maxItems: 8, items: REPORT_COLUMN_SCHEMA } }, required: ["columns"] }, narrative: { type: "object", additionalProperties: false, properties: { body: { type: "string", maxLength: 800 } }, required: ["body"] }, visualization: REPORT_VISUALIZATION_SCHEMA }, required: ["mode"] };

const COMPOSE_PAGE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    operations: {
      type: "array", maxItems: 16, items: {
        type: "object", additionalProperties: true,
        properties: {
          op: { type: "string", enum: ["inspect", "setAudience", "select", "addHtml", "addTabs", "move", "setSpan", "configure", "remove", "undo", "reset"] },
          target: { type: "string", maxLength: 128 }, firstName: { type: "string", maxLength: 60, description: "User-confirmed first name for local personalization." }, jobRole: { type: "string", maxLength: 100, description: "User-confirmed job role; required before page creation." }, title: { type: "string", maxLength: 100 }, markup: { type: "string", maxLength: MAX_HTML_LENGTH },
          span: { type: "string", enum: SPANS, description: "Infer from content: full for primary/dense content, half for paired peers, third for compact KPIs or actions." }, after: { type: "string", maxLength: 128 }, before: { type: "string", maxLength: 128 },
          labels: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", maxLength: 60 } },
          tabLabels: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", maxLength: 60 } },
          intoTab: { type: "object", additionalProperties: false, properties: { tabsId: { type: "string", maxLength: 128 }, tabId: { type: "string", maxLength: 128 } }, required: ["tabsId", "tabId"] },
          toRootEnd: { type: "boolean" },
        }, required: ["op"],
      },
    },
    openInBrowser: { type: "boolean", default: true },
  }, required: ["operations"],
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, fallback: string, limit: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : fallback;
const validSpan = (value: unknown): BlockSpan | undefined => SPANS.includes(value as BlockSpan) ? value as BlockSpan : undefined;

function createPresentation(input: Record<string, unknown>) {
  if (!isRecord(input.presentation)) throw new Error("A report presentation is required.");
  const supplied = input.presentation;
  let figure: PlotlyFigure | undefined;
  let encoding: Record<string, unknown> = { hover: [] };
  if (isRecord(supplied.visualization)) {
    figure = normalizePlotlyFigure({ data: Array.isArray(supplied.visualization.traces) ? supplied.visualization.traces : [], layout: isRecord(supplied.visualization.layout) ? supplied.visualization.layout : {} });
    encoding = isRecord(supplied.visualization.encoding) ? supplied.visualization.encoding : { hover: [] };
  }
  const normalized = normalizePresentation({ ...supplied, figure });
  if (!normalized) throw new Error("The selected report mode is missing required presentation fields.");
  return { presentation: normalized, encoding };
}

function formatValue(value: unknown, format: ValueFormat) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return String(value ?? "—");
  if (format === "currencyCents") return formatPrice(number);
  if (format === "percent") return formatPercent(number);
  if (format === "minutes") return formatPlaytime(number);
  if (format === "compact") return formatCompact(number);
  return format === "integer" ? Math.round(number).toLocaleString() : number.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

async function runReport(report: ReportBlock): Promise<ReportResult> {
  const rows = await executeCatalogReport(report.binding);
  if (report.presentation.mode === "chart" || report.presentation.mode === "mixed") {
    return { rows, figure: normalizePlotlyFigure(bindCatalogRowsToFigure(report.presentation.figure, report.binding, rows)) };
  }
  return { rows };
}

function markdownReport(report: ReportBlock, result: ReportResult) {
  const lines = [`## ${report.title}`, report.description, ""];
  const presentation = report.presentation;
  if (presentation.mode === "metric" || presentation.mode === "mixed") lines.push(`**${presentation.metric.label}:** ${formatValue(result.rows[0]?.[presentation.metric.valueField], presentation.metric.format)}`);
  else if (presentation.mode === "narrative") lines.push(presentation.narrative.body);
  else {
    const columns = presentation.mode === "table" ? presentation.table.columns : Object.keys(result.rows[0] ?? {}).slice(0, 8).map((field) => ({ field, label: field, format: "number" as ValueFormat }));
    lines.push(`| ${columns.map((column) => column.label).join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`);
    for (const row of result.rows.slice(0, 20)) lines.push(`| ${columns.map((column) => String(formatValue(row[column.field], column.format)).replaceAll("|", "\\|")).join(" | ")} |`);
  }
  return lines.filter(Boolean).join("\n");
}

function ReportContent({ report, result }: { report: ReportBlock; result: ReportResult }) {
  const presentation = report.presentation;
  if (presentation.mode === "metric" || presentation.mode === "mixed") {
    const value = result.rows[0]?.[presentation.metric.valueField];
    return <div className={`report-body report-body-${presentation.mode}`}><div className="metric-answer"><span>{presentation.metric.label}</span><strong>{formatValue(value, presentation.metric.format)}</strong><span>{presentation.metric.context || "Calculated by the catalog database."}</span></div>{presentation.mode === "mixed" && result.figure ? <PlotlyCanvas figure={result.figure} /> : null}</div>;
  }
  if (presentation.mode === "table") return <div className="report-table-wrap"><table className="report-table"><thead><tr>{presentation.table.columns.map((column) => <th key={column.field}>{column.label}</th>)}</tr></thead><tbody>{result.rows.map((row, index) => <tr key={index}>{presentation.table.columns.map((column) => <td key={column.field}>{formatValue(row[column.field], column.format)}</td>)}</tr>)}</tbody></table></div>;
  if (presentation.mode === "narrative") return <div className="narrative-report"><span aria-hidden="true">“</span><p>{presentation.narrative.body}</p></div>;
  return result.figure ? <PlotlyCanvas figure={result.figure} /> : null;
}

function BlockControls({ block, selected, onSelect, onMove, onSpan, onRemove, onDragStart }: { block: WorkspaceBlock; selected: boolean; onSelect: () => void; onMove: (direction: -1 | 1) => void; onSpan: () => void; onRemove: () => void; onDragStart: (event: React.DragEvent) => void }) {
  return <div className="workspace-block-controls" onClick={(event) => event.stopPropagation()}><button type="button" className="block-grip" draggable onDragStart={onDragStart} onClick={onSelect} aria-label={`Select and drag ${block.title}`}>⠿</button><span>{block.type}</span><button type="button" onClick={() => onMove(-1)} aria-label={`Move ${block.title} earlier`}>↑</button><button type="button" onClick={() => onMove(1)} aria-label={`Move ${block.title} later`}>↓</button><button type="button" onClick={onSpan} aria-label={`Change width of ${block.title}`}>{block.span}</button><button type="button" onClick={onRemove} aria-label={`Remove ${block.title}`}>×</button><i aria-hidden="true" className={selected ? "selected-mark" : ""} /></div>;
}

function ReportWidget({ block }: { block: ReportBlock }) {
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState("");
  const definitionKey = JSON.stringify([block.binding, block.presentation]);
  useEffect(() => {
    const controller = new AbortController();
    executeCatalogReport(block.binding, controller.signal).then((rows) => {
      if (block.presentation.mode === "chart" || block.presentation.mode === "mixed") setResult({ rows, figure: normalizePlotlyFigure(bindCatalogRowsToFigure(block.presentation.figure, block.binding, rows)) });
      else setResult({ rows });
      setError("");
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Report unavailable."); });
    return () => controller.abort();
  // The serialized definition is the report's semantic identity; layout clones keep it unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionKey]);
  return <><header className="workspace-report-header"><div><p className="eyebrow"><span /> Database report</p><h3>{block.title}</h3>{block.description ? <p>{block.description}</p> : null}</div><span>{block.presentation.mode}</span></header>{error ? <div className="block-status error">{error}</div> : result ? <ReportContent report={block} result={result} /> : <div className="block-status">Running report…</div>}</>;
}

function HtmlWidget({ block, recordCount, firstName, jobRole }: { block: HtmlBlock; recordCount: number; firstName: string; jobRole: string }) {
  const safeMarkup = useMemo(() => renderHtmlWidget(block.markup, { pageTitle: PAGE_TITLE, recordCount, userFirstName: firstName, userJobRole: jobRole }), [block.markup, firstName, jobRole, recordCount]);
  return <div className="html-widget"><span className="html-widget-label">{block.title}</span><div dangerouslySetInnerHTML={{ __html: safeMarkup }} /></div>;
}

function BarChart({ visualization }: { visualization: Visualization }) {
  const maximum = Math.max(1, ...visualization.items.map((item) => item.value));
  return <div className="chart">{visualization.items.map((item) => <div className="bar-group" key={item.label}><span>{formatCompact(item.value)}</span><div className="bar-column" style={{ height: `${Math.max(3, item.value / maximum * 100)}%` }} /><small>{item.label}</small></div>)}</div>;
}

function normalizeOperations(value: unknown): WorkspaceOperation[] {
  if (!Array.isArray(value)) throw new Error("operations must be an array.");
  return value.slice(0, 16).map((item): WorkspaceOperation => {
    if (!isRecord(item) || typeof item.op !== "string") throw new Error("Each page operation requires an op.");
    const target = typeof item.target === "string" ? item.target.slice(0, 128) : "selected";
    if (item.op === "inspect" || item.op === "undo" || item.op === "reset") return { op: item.op };
    if (item.op === "setAudience") { const firstName = text(item.firstName, "", 60); const jobRole = text(item.jobRole, "", 100); if (!firstName || !jobRole) throw new Error("setAudience requires the user-confirmed first name and job role."); return { op: "setAudience", firstName, jobRole }; }
    if (item.op === "select" || item.op === "remove") return { op: item.op, target };
    if (item.op === "setSpan") { const span = validSpan(item.span); if (!span) throw new Error("setSpan requires full, half, or third."); return { op: "setSpan", target, span }; }
    if (item.op === "addHtml") { if (typeof item.markup !== "string") throw new Error("addHtml requires markup."); validateBindings(item.markup); return { op: "addHtml", title: typeof item.title === "string" ? item.title : undefined, markup: item.markup, span: validSpan(item.span), after: typeof item.after === "string" ? item.after : undefined }; }
    if (item.op === "addTabs") { if (!Array.isArray(item.labels)) throw new Error("addTabs requires labels."); return { op: "addTabs", title: typeof item.title === "string" ? item.title : undefined, labels: item.labels.filter((label): label is string => typeof label === "string"), span: validSpan(item.span), after: typeof item.after === "string" ? item.after : undefined }; }
    if (item.op === "configure") { if (typeof item.markup === "string") validateBindings(item.markup); return { op: "configure", target, title: typeof item.title === "string" ? item.title : undefined, markup: typeof item.markup === "string" ? item.markup : undefined, tabLabels: Array.isArray(item.tabLabels) ? item.tabLabels.filter((label): label is string => typeof label === "string") : undefined }; }
    if (item.op === "move") return { op: "move", target, before: typeof item.before === "string" ? item.before : undefined, after: typeof item.after === "string" ? item.after : undefined, intoTab: isRecord(item.intoTab) && typeof item.intoTab.tabsId === "string" && typeof item.intoTab.tabId === "string" ? { tabsId: item.intoTab.tabsId, tabId: item.intoTab.tabId } : undefined, toRootEnd: item.toRootEnd === true };
    throw new Error(`Unsupported page operation: ${item.op}.`);
  });
}

export default function WorkspacePage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [catalog, setCatalog] = useState<CatalogPage | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [search, setSearch] = useState("");
  const [ownerBand, setOwnerBand] = useState("All owner ranges");
  const [priceBand, setPriceBand] = useState("All prices");
  const [sortKey, setSortKey] = useState<SortKey>("ownersMax");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(0);
  const [webMcpStatus, setWebMcpStatus] = useState<"checking" | "connected" | "preview">("checking");
  const [visualization, setVisualization] = useState<Visualization | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [activeTabs, setActiveTabs] = useState<Record<string, string>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const workspaceRef = useRef<Workspace | null>(null);
  const undoRef = useRef<Workspace | null>(null);
  const workspaceSectionRef = useRef<HTMLElement>(null);
  const visualizationRef = useRef<HTMLElement>(null);

  const commitWorkspace = useCallback((next: Workspace, remember = true) => {
    if (remember && workspaceRef.current) { undoRef.current = structuredClone(workspaceRef.current); setCanUndo(true); }
    workspaceRef.current = next; setWorkspace(next); saveWorkspace(next);
  }, []);

  const undoWorkspace = useCallback(() => {
    if (!undoRef.current || !workspaceRef.current) return false;
    const previous = undoRef.current; undoRef.current = null; setCanUndo(false); commitWorkspace(previous, false); return true;
  }, [commitWorkspace]);

  useEffect(() => { const loaded = loadWorkspace(); workspaceRef.current = loaded; queueMicrotask(() => setWorkspace(loaded)); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      loadCatalogPage({ search, ownerBand, priceBand, sort: sortKey, direction: sortDirection, page, pageSize: PAGE_SIZE }, controller.signal)
        .then((value) => { setCatalog(value); setCatalogError(""); })
        .catch((error: unknown) => { if (!controller.signal.aborted) setCatalogError(error instanceof Error ? error.message : "Catalog unavailable."); });
    }, search ? 180 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, ownerBand, priceBand, sortKey, sortDirection, page]);

  const recordCount = catalog?.meta.recordCount;
  const sourceSha256 = catalog?.meta.sourceSha256;
  useEffect(() => {
    if (recordCount === undefined || !workspaceRef.current) return;
    const context = document.modelContext ?? navigator.modelContext;
    if (!context) { queueMicrotask(() => setWebMcpStatus("preview")); return; }
    const controller = new AbortController();

    const createReport = async (input: Record<string, unknown>) => {
      const current = workspaceRef.current;
      if (!current) throw new Error("The page workspace is unavailable.");
      if (!current.audience.firstName || !current.audience.jobRole) throw new Error("Before creating a page, ask the user for their first name and job role, then save both with compose_page setAudience.");
      const created = createPresentation(input);
      const data = isRecord(input.data) ? input.data : {};
      const binding = normalizeCatalogAnalyticsBinding({ ...data, encoding: created.encoding });
      if (!binding) throw new Error("Invalid catalog report definition.");
      const report: ReportBlock = { id: crypto.randomUUID(), type: "report", span: validSpan(input.span) ?? "full", title: text(input.title, "Steam catalog report", 100), description: text(input.description, "", 220), createdAt: new Date().toISOString(), presentation: created.presentation, binding };
      const result = await runReport(report);
      const available = new Set(result.rows.flatMap(Object.keys));
      if ((report.presentation.mode === "metric" || report.presentation.mode === "mixed") && result.rows.length && !available.has(report.presentation.metric.valueField)) throw new Error(`Result field ${report.presentation.metric.valueField} is unavailable.`);
      if (report.presentation.mode === "table") { const missing = report.presentation.table.columns.find((column) => result.rows.length && !available.has(column.field)); if (missing) throw new Error(`Result field ${missing.field} is unavailable.`); }
      commitWorkspace(addReport(current, report));
      if (input.openInBrowser !== false) window.setTimeout(() => workspaceSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      return { report, result };
    };

    const tools = [
      { name: "describe_steam_catalog", description: "Describe the catalog, current page, audience status, and composition guide. Before page creation, inspect workspace.audience. If firstName or jobRole is missing, ask the user for both and save them with compose_page setAudience; never infer their role.", inputSchema: { type: "object", additionalProperties: false, properties: {} }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => { const current = workspaceRef.current!; return { content: [{ type: "text", text: `Described ${CATALOG_FIELD_CATALOG.length} reportable fields and ${workspaceOutline(current).length} page blocks.` }], structuredContent: { schemaVersion: "steam-desk.workspace/v1", source: { name: "steam_catalog", recordCount }, fields: CATALOG_FIELD_CATALOG, workspace: { storage: "local", audience: current.audience, selectedBlockId: current.selectedBlockId, blocks: workspaceOutline(current) }, htmlBindings: HTML_BINDINGS, compositionGuide: PAGE_COMPOSITION_GUIDE, spans: SPANS, composeOperations: ["inspect", "setAudience", "select", "addHtml", "addTabs", "move", "setSpan", "configure", "remove", "undo", "reset"], reportDefinition: { data: REPORT_DATA_SCHEMA, presentation: REPORT_PRESENTATION_SCHEMA } } }; } },
      { name: "create_report", description: "Create a database-backed report and place it inline. Requires a user-confirmed first name and job role already stored through compose_page setAudience. Tailor priorities to the role and infer span from the composition guide.", inputSchema: { type: "object", additionalProperties: false, properties: { title: { type: "string", maxLength: 100 }, description: { type: "string", maxLength: 220 }, span: { type: "string", enum: SPANS, description: "Choose from the composition guide: full for primary/dense content, half for paired peers, third for compact KPIs." }, data: REPORT_DATA_SCHEMA, presentation: REPORT_PRESENTATION_SCHEMA, openInBrowser: { type: "boolean", default: true } }, required: ["title", "data", "presentation"] }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input: Record<string, unknown>) => { try { const created = await createReport(input); return { content: [{ type: "text", text: `Created “${created.report.title}” and placed it on the page.` }], structuredContent: { schemaVersion: "steam-desk.report-receipt/v4", ok: true, report: { id: created.report.id, title: created.report.title, mode: created.report.presentation.mode, span: created.report.span, rowCount: created.result.rows.length }, workspace: { storage: "local", selectedBlockId: created.report.id } } }; } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Report creation failed." }] }; } } },
      { name: "compose_page", description: "Inspect or compose the local page. Before creating blocks, identify the user's first name and job role. If either is missing, stop and ask; never guess. Save both with setAudience, then tailor priorities, vocabulary, and the CTA to the role while inferring layout from pageCompositionGuide.", inputSchema: COMPOSE_PAGE_SCHEMA, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input: Record<string, unknown>) => { try { const operations = normalizeOperations(input.operations); const current = workspaceRef.current; if (!current) throw new Error("The page workspace is unavailable."); let audience = current.audience; for (const operation of operations) { if (operation.op === "setAudience") audience = { firstName: operation.firstName, jobRole: operation.jobRole }; if ((operation.op === "addHtml" || operation.op === "addTabs") && (!audience.firstName || !audience.jobRole)) throw new Error("Before creating page blocks, ask the user for their first name and job role, then run setAudience first."); } if (operations.some((operation) => operation.op === "undo")) { if (operations.length !== 1) throw new Error("undo must be the only page operation."); const changed = undoWorkspace(); const restored = workspaceRef.current!; return { content: [{ type: "text", text: changed ? "Undid the last page change." : "There is no page change to undo." }], structuredContent: { ok: true, changed, compositionGuide: PAGE_COMPOSITION_GUIDE, workspace: { storage: "local", audience: restored.audience, selectedBlockId: restored.selectedBlockId, blocks: workspaceOutline(restored) } } }; } const applied = applyOperations(current, operations); if (applied.changes.length) commitWorkspace(applied.workspace, !operations.every((operation) => operation.op === "select")); if (input.openInBrowser !== false && applied.changes.length) window.setTimeout(() => workspaceSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); return { content: [{ type: "text", text: applied.changes.length ? applied.changes.join(" ") : `The page contains ${workspaceOutline(applied.workspace).length} top-level blocks.` }], structuredContent: { schemaVersion: "steam-desk.compose-receipt/v1", ok: true, changed: Boolean(applied.changes.length), changes: applied.changes, compositionGuide: PAGE_COMPOSITION_GUIDE, workspace: { storage: "local", audience: applied.workspace.audience, selectedBlockId: applied.workspace.selectedBlockId, blocks: workspaceOutline(applied.workspace) } } }; } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Page composition failed." }], structuredContent: { ok: false } }; } } },
      { name: "render_report", description: "Render an inline report from the local page as bounded Markdown or a PNG.", inputSchema: { type: "object", additionalProperties: false, properties: { reportId: { type: "string", minLength: 1, maxLength: 128 }, renderMode: { type: "string", enum: ["auto", "markdown", "image"], default: "auto" } }, required: ["reportId"] }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: async (input: Record<string, unknown>) => { try { const current = workspaceRef.current; const report = current ? reportBlocks(current).find((item) => item.id === input.reportId) : null; if (!report) throw new Error("Report not found on this page."); const result = await runReport(report); const imageMode = input.renderMode === "image" || input.renderMode !== "markdown" && Boolean(result.figure); if (imageMode) { if (!result.figure) throw new Error("Image rendering is available only for chart reports."); return { content: [{ type: "text", text: `Rendered “${report.title}” as a PNG.` }, { type: "image", data: await renderPlotlyFigureToPng(result.figure), mimeType: "image/png" }], structuredContent: { ok: true, report: { id: report.id, title: report.title } } }; } return { content: [{ type: "text", text: markdownReport(report, result) }], structuredContent: { ok: true, report: { id: report.id, title: report.title } } }; } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Report rendering failed." }] }; } } },
    ];
    Promise.all(tools.map((tool) => context.registerTool(tool, { signal: controller.signal }))).then(() => setWebMcpStatus("connected")).catch(() => setWebMcpStatus("preview"));
    return () => controller.abort();
  }, [commitWorkspace, recordCount, sourceSha256, undoWorkspace]);

  const applyUiOperations = useCallback((operations: WorkspaceOperation[]) => {
    const current = workspaceRef.current; if (!current) return;
    try { const applied = applyOperations(current, operations); if (applied.changes.length) commitWorkspace(applied.workspace, !operations.every((operation) => operation.op === "select")); }
    catch { /* Invalid manual moves leave the current layout unchanged. */ }
  }, [commitWorkspace]);

  const removeBlock = (id: string) => applyUiOperations([{ op: "remove", target: id }]);
  const cycleSpan = (id: string, current: BlockSpan) => applyUiOperations([{ op: "setSpan", target: id, span: SPANS[(SPANS.indexOf(current) + 1) % SPANS.length] }]);
  const selectBlock = (id: string) => applyUiOperations([{ op: "select", target: id }]);
  const moveInContainer = (blocks: WorkspaceBlock[] | LeafBlock[], id: string, direction: -1 | 1) => { const index = blocks.findIndex((block) => block.id === id); const target = blocks[index + direction]; if (!target) return; applyUiOperations([{ op: "move", target: id, ...(direction < 0 ? { before: target.id } : { after: target.id }) }]); };
  const startDrag = (id: string, event: React.DragEvent) => { setDraggedId(id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); };
  const dropBefore = (target: string, event: React.DragEvent) => { event.preventDefault(); event.stopPropagation(); const id = draggedId ?? event.dataTransfer.getData("text/plain"); setDraggedId(null); if (id && id !== target) applyUiOperations([{ op: "move", target: id, before: target }]); };
  const dropIntoTab = (tabsId: string, tabId: string, event: React.DragEvent) => { event.preventDefault(); event.stopPropagation(); const id = draggedId ?? event.dataTransfer.getData("text/plain"); setDraggedId(null); if (id) applyUiOperations([{ op: "move", target: id, intoTab: { tabsId, tabId } }]); };

  const renderLeaf = (block: LeafBlock, siblings: WorkspaceBlock[]) => <article key={block.id} className={`workspace-block span-${block.span} ${workspace?.selectedBlockId === block.id ? "is-selected" : ""}`} onClick={(event) => { event.stopPropagation(); selectBlock(block.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropBefore(block.id, event)}><BlockControls block={block} selected={workspace?.selectedBlockId === block.id} onSelect={() => selectBlock(block.id)} onMove={(direction) => moveInContainer(siblings, block.id, direction)} onSpan={() => cycleSpan(block.id, block.span)} onRemove={() => removeBlock(block.id)} onDragStart={(event) => startDrag(block.id, event)} />{block.type === "report" ? <ReportWidget block={block} /> : <HtmlWidget block={block} recordCount={recordCount ?? 0} firstName={workspace?.audience.firstName ?? ""} jobRole={workspace?.audience.jobRole ?? ""} />}</article>;

  const renderTabs = (block: TabsBlock) => {
    const activeId = activeTabs[block.id] ?? block.tabs[0]?.id;
    const active = block.tabs.find((tab) => tab.id === activeId) ?? block.tabs[0];
    return <article key={block.id} className={`workspace-block workspace-tabs span-${block.span} ${workspace?.selectedBlockId === block.id ? "is-selected" : ""}`} onClick={(event) => { event.stopPropagation(); selectBlock(block.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropBefore(block.id, event)}><BlockControls block={block} selected={workspace?.selectedBlockId === block.id} onSelect={() => selectBlock(block.id)} onMove={(direction) => moveInContainer(workspace?.blocks ?? [], block.id, direction)} onSpan={() => cycleSpan(block.id, block.span)} onRemove={() => removeBlock(block.id)} onDragStart={(event) => startDrag(block.id, event)} /><header className="tabs-header"><div><p className="eyebrow"><span /> Page tabs</p><h3>{block.title}</h3></div><div role="tablist" aria-label={block.title}>{block.tabs.map((tab) => <button type="button" role="tab" aria-selected={tab.id === active?.id} className={tab.id === active?.id ? "active" : ""} key={tab.id} onClick={(event) => { event.stopPropagation(); setActiveTabs((value) => ({ ...value, [block.id]: tab.id })); }}>{tab.label}</button>)}</div></header>{active ? <div className="tab-canvas" role="tabpanel" onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropIntoTab(block.id, active.id, event)}>{active.blocks.length ? active.blocks.map((item) => renderLeaf(item, active.blocks)) : <div className="tab-drop-zone">Drop a report or HTML widget into {active.label}</div>}</div> : null}</article>;
  };

  const games = catalog?.games ?? [];
  const total = catalog?.query.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visiblePage = Math.min(page, totalPages - 1);
  const start = total ? visiblePage * PAGE_SIZE + 1 : 0;
  const end = Math.min((visiblePage + 1) * PAGE_SIZE, total);
  const sortIndicator = (key: SortKey) => sortKey === key ? sortDirection === "asc" ? "↑" : "↓" : "↕";
  const changeSort = (next: SortKey) => { if (next === sortKey) setSortDirection((value) => value === "asc" ? "desc" : "asc"); else { setSortKey(next); setSortDirection(next === "title" ? "asc" : "desc"); } setPage(0); };
  const renderChart = (type: ChartType) => { if (!catalog) return; const titles = { owners: "Estimated ownership", reviews: "Review sentiment", price: "Price bands" } as const; setVisualization({ type, title: titles[type], subtitle: `Database summary for ${catalog.query.total.toLocaleString()} matching games`, items: catalog.distributions[type] }); window.setTimeout(() => visualizationRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80); };

  return <main className="site-shell"><section className="release-desk" aria-labelledby="page-title"><header className="desk-header"><div><p className="eyebrow"><span /> WebMCP page workspace</p><h1 id="page-title">Steam Desk</h1><p className="dek">Describe the outcome. WebMCP chooses the reports, hierarchy, and layout.</p></div><div className="header-meta"><div className={`agent-state state-${webMcpStatus}`}><span />{webMcpStatus === "connected" ? "WebMCP connected" : webMcpStatus === "preview" ? "WebMCP preview" : "Checking WebMCP"}</div><div className="catalog-status"><strong>{catalog ? catalog.meta.recordCount.toLocaleString() : "—"}</strong><span>{catalog ? `games · imported ${formatSnapshotDate(catalog.meta.importedAt.slice(0, 10))}` : catalogError || "loading database"}</span></div></div></header>
    <section className="page-workspace" ref={workspaceSectionRef} aria-labelledby="workspace-title"><header className="page-workspace-header"><div><p className="eyebrow"><span /> Local page</p><h2 id="workspace-title">Report canvas</h2><p>Describe what the page should help you do. WebMCP will first confirm your name and job role, then choose the composition.</p></div><div className="workspace-actions"><span>{workspace?.blocks.length ?? 0} blocks</span><button type="button" disabled={!canUndo} onClick={undoWorkspace}>Undo</button><button type="button" disabled={!workspace?.blocks.length} onClick={() => applyUiOperations([{ op: "reset" }])}>Clear page</button></div></header>{workspace ? workspace.blocks.length ? <div className="page-canvas" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { if (event.currentTarget !== event.target) return; const id = draggedId ?? event.dataTransfer.getData("text/plain"); setDraggedId(null); if (id) applyUiOperations([{ op: "move", target: id, toRootEnd: true }]); }}>{workspace.blocks.map((block) => block.type === "tabs" ? renderTabs(block) : renderLeaf(block, workspace.blocks))}</div> : <div className="workspace-empty"><span aria-hidden="true">⌁</span><div><strong>Your page is ready for its first block</strong><p>Try: “Build me a personalized daily briefing,” or “Create an at-a-glance market overview.”</p></div></div> : <div className="workspace-empty"><div><strong>Loading your local page…</strong></div></div>}<footer className="page-workspace-footer"><span>Stored in this browser</span><span>{workspace?.audience.jobRole ? workspace.audience.firstName + " · " + workspace.audience.jobRole : "Audience not set"}</span><span>Catalog results run against D1</span><span>Selected: {workspace ? findBlock(workspace, workspace.selectedBlockId)?.title ?? "none" : "none"}</span></footer></section>
    <section className="prompt-guide" aria-labelledby="prompt-guide-title"><header><div><p className="eyebrow"><span /> Compose naturally</p><h2 id="prompt-guide-title">Helpful sample prompts</h2></div><p>Describe the outcome—not the grid. WebMCP confirms your audience context, then chooses widths, hierarchy, personalization, and the next action.</p></header><div className="prompt-grid">{SAMPLE_PROMPTS.map((item) => <button type="button" className="prompt-card" key={item.prompt} onClick={() => void navigator.clipboard.writeText(item.prompt).then(() => { setCopiedPrompt(item.prompt); window.setTimeout(() => setCopiedPrompt(null), 1600); })}><span className="prompt-mode">{item.mode}</span><span className="prompt-copy">“{item.prompt}”</span><span className="prompt-action">{copiedPrompt === item.prompt ? "Copied ✓" : "Copy prompt ↗"}</span></button>)}</div></section>
    <div id="catalog-browser" className="toolbar" aria-label="Catalog filters"><label className="search-field"><span className="sr-only">Search games</span><span aria-hidden="true">⌕</span><input disabled={!catalog} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search titles, developers, genres, tags" /></label><label className="select-field"><span className="sr-only">Owner range</span><select disabled={!catalog} value={ownerBand} onChange={(event) => { setOwnerBand(event.target.value); setPage(0); }}><option>All owner ranges</option>{OWNER_BANDS.map((item) => <option key={item} value={item}>{ownerBandLabels.get(item)}</option>)}</select></label><label className="select-field"><span className="sr-only">Price band</span><select disabled={!catalog} value={priceBand} onChange={(event) => { setPriceBand(event.target.value); setPage(0); }}><option>All prices</option>{PRICE_BANDS.map((item) => <option key={item}>{item}</option>)}</select></label><button type="button" className="view-button" disabled={!catalog} onClick={() => renderChart("owners")}>Quick view <span>↗</span></button></div><div className="result-strip"><span>{catalog ? <><strong>{total.toLocaleString()}</strong> games match · queried from D1</> : catalogError || "Loading catalog database…"}</span><button type="button" disabled={!catalog} onClick={() => { setSearch(""); setOwnerBand("All owner ranges"); setPriceBand("All prices"); setPage(0); }}>Reset filters</button></div>
    <div className="table-wrap"><table><thead><tr><th><button type="button" onClick={() => changeSort("title")}>Game <span>{sortIndicator("title")}</span></button></th><th><button type="button" onClick={() => changeSort("ownersMax")}>Owners <span>{sortIndicator("ownersMax")}</span></button></th><th><button type="button" onClick={() => changeSort("priceCents")}>Price <span>{sortIndicator("priceCents")}</span></button></th><th><button type="button" onClick={() => changeSort("positiveRatio")}>Reviews <span>{sortIndicator("positiveRatio")}</span></button></th><th><button type="button" onClick={() => changeSort("ccu")}>Players <span>{sortIndicator("ccu")}</span></button></th><th>Avg. playtime</th></tr></thead><tbody>{games.map((game) => { const accent = Math.abs(game.id) % coverMarks.length; return <tr key={game.id}><td><div className="game-cell"><span className={`cover cover-${accent}`} aria-hidden="true"><i>{coverMarks[accent]}</i><b>{game.title.split(" ").map((word) => word[0]).slice(0, 2).join("")}</b></span><span><strong>{game.title}</strong><small>{game.developer}{game.genres.length ? ` · ${game.genres.slice(0, 2).join(", ")}` : ""}</small></span></div></td><td><span className="genre-pill" title={game.owners}>{formatOwnerRange(game)}</span></td><td className="price-cell">{formatPrice(game.priceCents)}</td><td className="wishlist-cell">{formatPercent(game.positiveRatio)}</td><td className="wishlist-cell">{formatCompact(game.ccu)}</td><td><span className="status">{formatPlaytime(game.averageForever)}</span></td></tr>; })}{!games.length && <tr><td colSpan={6}><div className="empty-state"><strong>{catalogError ? "Catalog unavailable" : "No games found"}</strong><span>{catalogError || "Try broader filters."}</span></div></td></tr>}</tbody></table></div><footer className="desk-footer"><span>Showing {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}</span><div><button type="button" disabled={visiblePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>←</button><span>Page {visiblePage + 1} / {totalPages}</span><button type="button" disabled={visiblePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>→</button></div></footer></section>
    {visualization ? <section className="visualization-panel" ref={visualizationRef}><header><div><p className="eyebrow"><span /> Database quick view</p><h2>{visualization.title}</h2><p>{visualization.subtitle}</p></div><div className="chart-tabs"><button className={visualization.type === "owners" ? "active" : ""} onClick={() => renderChart("owners")}>Owners</button><button className={visualization.type === "reviews" ? "active" : ""} onClick={() => renderChart("reviews")}>Reviews</button><button className={visualization.type === "price" ? "active" : ""} onClick={() => renderChart("price")}>Price</button></div></header><BarChart visualization={visualization} /><footer><span>Aggregated by D1 for the current filters</span><button type="button" onClick={() => setVisualization(null)}>Close quick view</button></footer></section> : null}</main>;
}
