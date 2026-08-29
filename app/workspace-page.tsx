"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CATALOG_ANALYTICS_BINDING_SCHEMA, CATALOG_FIELD_CATALOG, OWNER_BANDS, PRICE_BANDS } from "./catalog-analytics";
import { executeCatalogReport, loadCatalogPage, resolveGameCompany, type CatalogPage, type GameCompany } from "./catalog-data";
import { bindCatalogRowsToFigure } from "./catalog-visualization";
import {
  DEFAULT_ENGAGEMENT_FILTERS,
  ENGAGEMENT_ANALYTICS_BINDING_SCHEMA,
  ENGAGEMENT_FIELD_CATALOG,
  withPageEngagementFilters,
  type EngagementSourceFilters,
} from "./engagement-analytics";
import { executeEngagementReport } from "./engagement-data";
import EngagementResourcePanel from "./engagement-resource-panel";
import { formatCompact, formatOwnerRange, formatPercent, formatPlaytime, formatPrice } from "./steamspy-data";
import { normalizePlotlyFigure, PlotlyCanvas, PLOTLY_TRACE_TYPES, renderPlotlyFigureToPng, type PlotlyFigure } from "./plotly-visualization";
import { PAGE_COMPOSITION_GUIDE } from "./page-composition-guide";
import { createReportPresentationSchema, REPORT_MODE_CATALOG, REPORT_PRESENTATION_DESCRIPTION, reportPresentationShapeError } from "./report-presentation-schema";
import type { WebMcpStatus } from "./demo-switcher";
import AudienceOnboarding from "./audience-onboarding";
import { CatalogTableSkeleton, ReportSkeleton } from "./loading-skeletons";
import "./workspace.css";
import {
  HTML_BINDINGS, MAX_HTML_LENGTH, SPANS, VALUE_FORMATS, addReport, applyOperations, findBlock, loadWorkspace, normalizeBuilderAnalyticsBinding, normalizePresentation,
  renderHtmlWidget, reportBlocks, saveWorkspace, validateBindings, workspaceOutline,
  type BlockSpan, type BuilderAnalyticsBinding, type HtmlBlock, type LeafBlock, type ReportBlock, type TabsBlock,
  type ValueFormat, type Workspace, type WorkspaceBlock, type WorkspaceOperation,
} from "./workspace-model";

type SortKey = "ownersMax" | "title" | "priceCents" | "positiveRatio" | "ccu";
type SortDirection = "asc" | "desc";
type ReportResult = { rows: Record<string, unknown>[]; figure?: PlotlyFigure };

const PAGE_SIZE = 12;
const PAGE_TITLE = "Steam Desk";
const coverMarks = ["◜", "◇", "◉", "⌁", "△", "✣", "⊙", "╱"];
const ownerBandLabels = new Map(OWNER_BANDS.map((band) => {
  const [ownersMin, ownersMax] = band.split("..").map((value) => Number(value.replaceAll(",", "").trim()));
  return [band, formatOwnerRange({ ownersMin, ownersMax })] as const;
}));

const SAMPLE_PROMPTS = [
  { mode: "Briefing", prompt: "Give me a welcoming daily briefing with customer activity and one clear next step for my company." },
  { mode: "Engagement", prompt: "Show me four key metrics, an active-user trend, a conversion funnel, and device distribution using the page filters." },
  { mode: "Catalog", prompt: "Show me the median price of games and explain what I should investigate next." },
  { mode: "Organize", prompt: "Organize a company-aware executive overview with customer activity first and deeper product analysis in tabs." },
] as const;

const PLOTLY_TRACE_SCHEMA = { type: "object", additionalProperties: true, properties: { type: { type: "string", enum: [...PLOTLY_TRACE_TYPES] }, name: { type: "string" }, x: { type: "array", maxItems: 2_000, items: {} }, y: { type: "array", maxItems: 2_000, items: {} }, labels: { type: "array", maxItems: 2_000, items: {} }, values: { type: "array", maxItems: 2_000, items: {} }, mode: { type: "string" }, orientation: { type: "string", enum: ["h", "v"] }, hole: { type: "number", minimum: 0, maximum: 0.9 }, marker: { type: "object", additionalProperties: true }, line: { type: "object", additionalProperties: true }, text: { type: "array", maxItems: 2_000, items: {} }, hovertemplate: { type: "string" } } };
const CATALOG_REPORT_DATA_SCHEMA = { type: "object", additionalProperties: false, properties: { source: CATALOG_ANALYTICS_BINDING_SCHEMA.properties.source, pipeline: CATALOG_ANALYTICS_BINDING_SCHEMA.properties.pipeline, resultLimit: CATALOG_ANALYTICS_BINDING_SCHEMA.properties.resultLimit }, required: ["source", "pipeline", "resultLimit"] };
const ENGAGEMENT_REPORT_DATA_SCHEMA = { type: "object", additionalProperties: false, properties: { source: ENGAGEMENT_ANALYTICS_BINDING_SCHEMA.properties.source, pipeline: ENGAGEMENT_ANALYTICS_BINDING_SCHEMA.properties.pipeline, resultLimit: ENGAGEMENT_ANALYTICS_BINDING_SCHEMA.properties.resultLimit }, required: ["source", "pipeline", "resultLimit"] };
const REPORT_DATA_SCHEMA = { oneOf: [CATALOG_REPORT_DATA_SCHEMA, ENGAGEMENT_REPORT_DATA_SCHEMA] };
const REPORT_VISUALIZATION_SCHEMA = { type: "object", additionalProperties: false, properties: { renderer: { type: "string", const: "plotly" }, traces: { type: "array", minItems: 1, maxItems: 12, items: PLOTLY_TRACE_SCHEMA }, layout: { type: "object", additionalProperties: true }, encoding: CATALOG_ANALYTICS_BINDING_SCHEMA.properties.encoding }, required: ["renderer", "traces", "encoding"] };
const REPORT_METRIC_SCHEMA = { type: "object", additionalProperties: false, properties: { valueField: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" }, label: { type: "string", maxLength: 80 }, format: { type: "string", enum: VALUE_FORMATS }, context: { type: "string", maxLength: 180 } }, required: ["valueField", "label"] };
const REPORT_COLUMN_SCHEMA = { type: "object", additionalProperties: false, properties: { field: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$" }, label: { type: "string", maxLength: 60 }, format: { type: "string", enum: VALUE_FORMATS } }, required: ["field", "label"] };
const REPORT_PRESENTATION_SCHEMA = createReportPresentationSchema({ metric: REPORT_METRIC_SCHEMA, tableColumn: REPORT_COLUMN_SCHEMA, visualization: REPORT_VISUALIZATION_SCHEMA });

const COMPOSE_PAGE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    operations: {
      type: "array", maxItems: 16, items: {
        type: "object", additionalProperties: true,
        properties: {
          op: { type: "string", enum: ["inspect", "select", "addHtml", "addTabs", "move", "setSpan", "configure", "remove", "undo", "reset"] },
          target: { type: "string", maxLength: 128 }, title: { type: "string", maxLength: 100 }, markup: { type: "string", maxLength: MAX_HTML_LENGTH },
          span: { type: "string", enum: SPANS, description: "Infer from content: full for primary/dense content, half for paired peers, third for three-up summaries, quarter for four compact KPIs." }, after: { type: "string", maxLength: 128 }, before: { type: "string", maxLength: 128 },
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

const ONBOARD_AUDIENCE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    operation: { type: "string", enum: ["start", "submit"] },
    firstName: { type: "string", maxLength: 60 },
    company: { type: "string", maxLength: 120 },
    jobRole: { type: "string", maxLength: 100 },
    companyId: { type: "integer", minimum: 1, description: "Use only after the user resolves an ambiguous company shortlist." },
  }, required: ["operation"],
};

const PAGE_PROPOSAL_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    summary: { type: "string", maxLength: 400, description: "The page purpose the user approved." },
    sections: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", maxLength: 120 }, description: "The approved page sections in reading order." },
    primaryAction: { type: "string", maxLength: 180, description: "The approved primary next action." },
    userConfirmed: { type: "boolean", description: "True only after the user approves or revises the proposal in conversation." },
  }, required: ["summary", "sections", "primaryAction", "userConfirmed"],
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, fallback: string, limit: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : fallback;
const validSpan = (value: unknown): BlockSpan | undefined => SPANS.includes(value as BlockSpan) ? value as BlockSpan : undefined;

function createPresentation(input: Record<string, unknown>) {
  if (!isRecord(input.presentation)) throw new Error("A report presentation is required.");
  const supplied = input.presentation;
  const shapeError = reportPresentationShapeError(supplied);
  if (shapeError) throw new Error(shapeError);
  let figure: PlotlyFigure | undefined;
  let encoding: Record<string, unknown> = { hover: [] };
  if (isRecord(supplied.visualization)) {
    figure = normalizePlotlyFigure({ data: Array.isArray(supplied.visualization.traces) ? supplied.visualization.traces : [], layout: isRecord(supplied.visualization.layout) ? supplied.visualization.layout : {} });
    encoding = isRecord(supplied.visualization.encoding) ? supplied.visualization.encoding : { hover: [] };
  }
  const normalized = normalizePresentation({ ...supplied, figure });
  if (!normalized) throw new Error(`The ${String(supplied.mode)} report has an invalid presentation definition.`);
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

async function executeBuilderReport(binding: BuilderAnalyticsBinding, pageFilters: EngagementSourceFilters, signal?: AbortSignal) {
  return binding.source.name === "customer_engagement"
    ? executeEngagementReport(withPageEngagementFilters(binding, pageFilters), signal)
    : executeCatalogReport(binding, signal);
}

async function runReport(report: ReportBlock, pageFilters: EngagementSourceFilters, signal?: AbortSignal): Promise<ReportResult> {
  const rows = await executeBuilderReport(report.binding, pageFilters, signal);
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
    return <div className={`report-body report-body-${presentation.mode}`}><div className="metric-answer"><span>{presentation.metric.label}</span><strong>{formatValue(value, presentation.metric.format)}</strong><span>{presentation.metric.context || "Calculated from the catalog."}</span></div>{presentation.mode === "mixed" && result.figure ? <PlotlyCanvas figure={result.figure} /> : null}</div>;
  }
  if (presentation.mode === "table") return <div className="report-table-wrap"><table className="report-table"><thead><tr>{presentation.table.columns.map((column) => <th key={column.field}>{column.label}</th>)}</tr></thead><tbody>{result.rows.map((row, index) => <tr key={index}>{presentation.table.columns.map((column) => <td key={column.field}>{formatValue(row[column.field], column.format)}</td>)}</tr>)}</tbody></table></div>;
  if (presentation.mode === "narrative") return <div className="narrative-report"><span aria-hidden="true">“</span><p>{presentation.narrative.body}</p></div>;
  return result.figure ? <PlotlyCanvas figure={result.figure} /> : null;
}

function BlockControls({ block, selected, onSelect, onMove, onSpan, onRemove, onDragStart }: { block: WorkspaceBlock; selected: boolean; onSelect: () => void; onMove: (direction: -1 | 1) => void; onSpan: () => void; onRemove: () => void; onDragStart: (event: React.DragEvent) => void }) {
  return <div className="workspace-block-controls" onClick={(event) => event.stopPropagation()}><button type="button" className="block-grip" draggable onDragStart={onDragStart} onClick={onSelect} aria-label={`Select and drag ${block.title}`}>⠿</button><span>{block.type}</span><button type="button" onClick={() => onMove(-1)} aria-label={`Move ${block.title} earlier`}>↑</button><button type="button" onClick={() => onMove(1)} aria-label={`Move ${block.title} later`}>↓</button><button type="button" onClick={onSpan} aria-label={`Change width of ${block.title}`}>{block.span}</button><button type="button" onClick={onRemove} aria-label={`Remove ${block.title}`}>×</button><i aria-hidden="true" className={selected ? "selected-mark" : ""} /></div>;
}

function ReportWidget({ block, pageFilters }: { block: ReportBlock; pageFilters: EngagementSourceFilters }) {
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState("");
  const definitionKey = JSON.stringify([block.binding, block.presentation, block.binding.source.name === "customer_engagement" && block.binding.source.inheritPageFilters ? pageFilters : null]);
  const [resolvedDefinitionKey, setResolvedDefinitionKey] = useState("");
  const loading = resolvedDefinitionKey !== definitionKey;
  useEffect(() => {
    const controller = new AbortController();
    executeBuilderReport(block.binding, pageFilters, controller.signal).then((rows) => {
      if (block.presentation.mode === "chart" || block.presentation.mode === "mixed") setResult({ rows, figure: normalizePlotlyFigure(bindCatalogRowsToFigure(block.presentation.figure, block.binding, rows)) });
      else setResult({ rows });
      setError("");
      setResolvedDefinitionKey(definitionKey);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Report unavailable."); setResolvedDefinitionKey(definitionKey); } });
    return () => controller.abort();
  // The serialized definition and inherited page filters are the report's semantic identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionKey]);
  return <><header className="workspace-report-header"><div><h3>{block.title}</h3>{block.description ? <p>{block.description}</p> : null}</div></header>{loading ? <ReportSkeleton /> : error ? <div className="block-status error">{error}</div> : result ? <ReportContent report={block} result={result} /> : null}</>;
}

function HtmlWidget({ block, recordCount, firstName, jobRole, company }: { block: HtmlBlock; recordCount: number; firstName: string; jobRole: string; company: string }) {
  const safeMarkup = useMemo(() => renderHtmlWidget(block.markup, { pageTitle: PAGE_TITLE, recordCount, userFirstName: firstName, userJobRole: jobRole, userCompany: company }), [block.markup, company, firstName, jobRole, recordCount]);
  return <div className="html-widget"><span className="html-widget-label">{block.title}</span><div dangerouslySetInnerHTML={{ __html: safeMarkup }} /></div>;
}

function TabsNavigation({ blockId, title, tabs, activeId, onSelect }: { blockId: string; title: string; tabs: TabsBlock["tabs"]; activeId?: string; onSelect: (tabId: string) => void }) {
  const navigationRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [visibleIds, setVisibleIds] = useState(() => tabs.map((tab) => tab.id));
  const [menuOpen, setMenuOpen] = useState(false);
  const tabSignature = tabs.map((tab) => `${tab.id}:${tab.label}`).join("|");
  const visibleIdSet = new Set(visibleIds);
  const visibleTabs = tabs.filter((tab) => visibleIdSet.has(tab.id));
  const hiddenTabs = tabs.filter((tab) => !visibleIdSet.has(tab.id));
  const menuId = `tabs-more-${blockId}`;

  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    const measure = measureRef.current;
    if (!navigation || !measure) return;
    const updateVisibleTabs = () => {
      const measuredTabs = Array.from(measure.querySelectorAll<HTMLElement>("[data-measure-tab]"));
      const measuredMore = measure.querySelector<HTMLElement>("[data-measure-more]");
      if (!measuredMore) return;
      const allIds = measuredTabs.map((tab) => tab.dataset.measureTab ?? "").filter(Boolean);
      const widths = measuredTabs.map((tab) => tab.getBoundingClientRect().width);
      const gap = 4;
      const railPadding = 8;
      const available = navigation.clientWidth;
      const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * gap + railPadding;
      let nextIds = allIds;
      if (total > available) {
        const budget = Math.max(0, available - measuredMore.getBoundingClientRect().width - gap - railPadding);
        nextIds = [];
        let used = 0;
        for (let index = 0; index < widths.length; index += 1) {
          const nextWidth = widths[index] + (nextIds.length ? gap : 0);
          if (nextIds.length && used + nextWidth > budget) break;
          nextIds.push(allIds[index]);
          used += nextWidth;
        }
        if (activeId && allIds.includes(activeId) && !nextIds.includes(activeId)) {
          nextIds[Math.max(0, nextIds.length - 1)] = activeId;
          nextIds = [...new Set(nextIds)].sort((left, right) => allIds.indexOf(left) - allIds.indexOf(right));
        }
      }
      setVisibleIds((current) => current.length === nextIds.length && current.every((id, index) => id === nextIds[index]) ? current : nextIds);
    };
    updateVisibleTabs();
    const observer = new ResizeObserver(updateVisibleTabs);
    observer.observe(navigation);
    return () => observer.disconnect();
  }, [activeId, tabSignature]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!navigationRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [menuOpen]);

  const selectTab = (tabId: string, moveFocus = false) => {
    onSelect(tabId);
    setMenuOpen(false);
    if (moveFocus) window.requestAnimationFrame(() => {
      const buttons = navigationRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']");
      Array.from(buttons ?? []).find((button) => button.dataset.tabId === tabId)?.focus();
    });
  };
  const moveToTab = (event: React.KeyboardEvent<HTMLButtonElement>, tabId: string) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === tabId);
    const nextIndex = event.key === "ArrowRight" ? (currentIndex + 1) % tabs.length
      : event.key === "ArrowLeft" ? (currentIndex - 1 + tabs.length) % tabs.length
      : event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
      : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    selectTab(tabs[nextIndex].id, true);
  };

  return <div className={`tabs-navigation ${hiddenTabs.length ? "has-overflow" : ""}`} ref={navigationRef} onClick={(event) => event.stopPropagation()}>
    <div role="tablist" aria-label={title}>
      {visibleTabs.map((tab) => <button
        id={`tab-${blockId}-${tab.id}`}
        type="button"
        role="tab"
        className="tabs-tab"
        aria-selected={tab.id === activeId}
        aria-controls={`tab-panel-${blockId}-${tab.id}`}
        tabIndex={tab.id === activeId ? 0 : -1}
        data-tab-id={tab.id}
        key={tab.id}
        onClick={() => selectTab(tab.id)}
        onKeyDown={(event) => moveToTab(event, tab.id)}
      >{tab.label}</button>)}
    </div>
    {hiddenTabs.length ? <>
      <button
        type="button"
        className="tabs-more-button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        aria-label={`Show ${hiddenTabs.length} more ${hiddenTabs.length === 1 ? "tab" : "tabs"}`}
        ref={moreButtonRef}
        onClick={() => setMenuOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setMenuOpen(false); return; }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setMenuOpen(true);
            window.requestAnimationFrame(() => navigationRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus());
          }
        }}
      >More <span>{hiddenTabs.length}</span><b aria-hidden="true">v</b></button>
      {menuOpen ? <div
        className="tabs-more-menu"
        id={menuId}
        role="menu"
        aria-label="More tabs"
        onKeyDown={(event) => {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']"));
          const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
          const nextIndex = event.key === "ArrowDown" ? (currentIndex + 1) % items.length
            : event.key === "ArrowUp" ? (currentIndex - 1 + items.length) % items.length
            : event.key === "Home" ? 0
            : event.key === "End" ? items.length - 1
            : -1;
          if (event.key === "Escape") { event.preventDefault(); setMenuOpen(false); moreButtonRef.current?.focus(); }
          else if (nextIndex >= 0) { event.preventDefault(); items[nextIndex]?.focus(); }
        }}
      >{hiddenTabs.map((tab) => <button type="button" role="menuitem" key={tab.id} onClick={() => selectTab(tab.id, true)}><span>{tab.label}</span><b aria-hidden="true">&gt;</b></button>)}</div> : null}
    </> : null}
    <div className="tabs-measure" aria-hidden="true" ref={measureRef}>
      {tabs.map((tab) => <span className="tabs-tab" data-measure-tab={tab.id} key={tab.id}>{tab.label}</span>)}
      <span className="tabs-more-button" data-measure-more>More <span>{tabs.length}</span><b>v</b></span>
    </div>
  </div>;
}

function normalizeOperations(value: unknown): WorkspaceOperation[] {
  if (!Array.isArray(value)) throw new Error("operations must be an array.");
  return value.slice(0, 16).map((item): WorkspaceOperation => {
    if (!isRecord(item) || typeof item.op !== "string") throw new Error("Each page operation requires an op.");
    const target = typeof item.target === "string" ? item.target.slice(0, 128) : "selected";
    if (item.op === "inspect" || item.op === "undo" || item.op === "reset") return { op: item.op };
    if (item.op === "select" || item.op === "remove") return { op: item.op, target };
    if (item.op === "setSpan") { const span = validSpan(item.span); if (!span) throw new Error("setSpan requires full, half, third, or quarter."); return { op: "setSpan", target, span }; }
    if (item.op === "addHtml") { if (typeof item.markup !== "string") throw new Error("addHtml requires markup."); validateBindings(item.markup); return { op: "addHtml", title: typeof item.title === "string" ? item.title : undefined, markup: item.markup, span: validSpan(item.span), after: typeof item.after === "string" ? item.after : undefined }; }
    if (item.op === "addTabs") { if (!Array.isArray(item.labels)) throw new Error("addTabs requires labels."); return { op: "addTabs", title: typeof item.title === "string" ? item.title : undefined, labels: item.labels.filter((label): label is string => typeof label === "string"), span: validSpan(item.span), after: typeof item.after === "string" ? item.after : undefined }; }
    if (item.op === "configure") { if (typeof item.markup === "string") validateBindings(item.markup); return { op: "configure", target, title: typeof item.title === "string" ? item.title : undefined, markup: typeof item.markup === "string" ? item.markup : undefined, tabLabels: Array.isArray(item.tabLabels) ? item.tabLabels.filter((label): label is string => typeof label === "string") : undefined }; }
    if (item.op === "move") return { op: "move", target, before: typeof item.before === "string" ? item.before : undefined, after: typeof item.after === "string" ? item.after : undefined, intoTab: isRecord(item.intoTab) && typeof item.intoTab.tabsId === "string" && typeof item.intoTab.tabId === "string" ? { tabsId: item.intoTab.tabsId, tabId: item.intoTab.tabId } : undefined, toRootEnd: item.toRootEnd === true };
    throw new Error(`Unsupported page operation: ${item.op}.`);
  });
}

export default function WorkspacePage({ onWebMcpStatusChange }: { onWebMcpStatusChange: (status: WebMcpStatus) => void }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [catalog, setCatalog] = useState<CatalogPage | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [resolvedCatalogKey, setResolvedCatalogKey] = useState("");
  const [search, setSearch] = useState("");
  const [ownerBand, setOwnerBand] = useState("All owner ranges");
  const [priceBand, setPriceBand] = useState("All prices");
  const [sortKey, setSortKey] = useState<SortKey>("ownersMax");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(0);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [showWidgetPrompts, setShowWidgetPrompts] = useState(false);
  const [activeTabs, setActiveTabs] = useState<Record<string, string>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [editingAudience, setEditingAudience] = useState(false);
  const [engagementFilters, setEngagementFilters] = useState<EngagementSourceFilters>(DEFAULT_ENGAGEMENT_FILTERS);
  const workspaceRef = useRef<Workspace | null>(null);
  const engagementFiltersRef = useRef(engagementFilters);
  const undoRef = useRef<Workspace | null>(null);
  const workspaceSectionRef = useRef<HTMLElement>(null);
  const widgetPromptMenuRef = useRef<HTMLElement>(null);
  const catalogRequestKey = JSON.stringify([search, ownerBand, priceBand, sortKey, sortDirection, page]);
  const catalogLoading = resolvedCatalogKey !== catalogRequestKey;

  useEffect(() => {
    if (!showWidgetPrompts) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !widgetPromptMenuRef.current?.contains(event.target)) setShowWidgetPrompts(false);
    };
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowWidgetPrompts(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnKeyDown);
    };
  }, [showWidgetPrompts]);

  const commitWorkspace = useCallback((next: Workspace, remember = true) => {
    if (remember && workspaceRef.current) { undoRef.current = structuredClone(workspaceRef.current); setCanUndo(true); }
    workspaceRef.current = next; setWorkspace(next); saveWorkspace(next);
  }, []);

  const undoWorkspace = useCallback(() => {
    if (!undoRef.current || !workspaceRef.current) return false;
    const previous = undoRef.current; undoRef.current = null; setCanUndo(false); commitWorkspace(previous, false); return true;
  }, [commitWorkspace]);

  useEffect(() => { const loaded = loadWorkspace(); workspaceRef.current = loaded; queueMicrotask(() => setWorkspace(loaded)); }, []);
  useEffect(() => { engagementFiltersRef.current = engagementFilters; }, [engagementFilters]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      loadCatalogPage({ search, ownerBand, priceBand, sort: sortKey, direction: sortDirection, page, pageSize: PAGE_SIZE }, controller.signal)
        .then((value) => { if (!controller.signal.aborted) { setCatalog(value); setCatalogError(""); setResolvedCatalogKey(catalogRequestKey); } })
        .catch((error: unknown) => { if (!controller.signal.aborted) { setCatalogError(error instanceof Error ? error.message : "Catalog unavailable."); setResolvedCatalogKey(catalogRequestKey); } });
    }, search ? 180 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  // The serialized filters are the request identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogRequestKey]);

  const recordCount = catalog?.meta.recordCount;
  const sourceSha256 = catalog?.meta.sourceSha256;
  useEffect(() => {
    if (recordCount === undefined || !workspaceRef.current) return;
    const context = document.modelContext ?? navigator.modelContext;
    if (!context) { queueMicrotask(() => onWebMcpStatusChange("preview")); return; }
    const controller = new AbortController();

    const createReport = async (input: Record<string, unknown>) => {
      const current = workspaceRef.current;
      if (!current) throw new Error("The page workspace is unavailable.");
      if (current.onboarding.stage !== "composition_ready") throw new Error("Page creation is locked until onboard_audience saves the survey, the agent proposes the most useful page, and the user approves that proposal with request_page_composition.");
      const created = createPresentation(input);
      const data = isRecord(input.data) ? input.data : {};
      const binding = normalizeBuilderAnalyticsBinding({ ...data, encoding: created.encoding });
      if (!binding) throw new Error("Invalid page report definition.");
      const fallbackTitle = binding.source.name === "customer_engagement" ? "Customer engagement report" : "Steam catalog report";
      const report: ReportBlock = { id: crypto.randomUUID(), type: "report", span: validSpan(input.span) ?? "full", title: text(input.title, fallbackTitle, 100), description: text(input.description, "", 220), createdAt: new Date().toISOString(), presentation: created.presentation, binding };
      const result = await runReport(report, engagementFiltersRef.current);
      const available = new Set(result.rows.flatMap(Object.keys));
      if ((report.presentation.mode === "metric" || report.presentation.mode === "mixed") && result.rows.length && !available.has(report.presentation.metric.valueField)) throw new Error(`Result field ${report.presentation.metric.valueField} is unavailable.`);
      if (report.presentation.mode === "table") { const missing = report.presentation.table.columns.find((column) => result.rows.length && !available.has(column.field)); if (missing) throw new Error(`Result field ${missing.field} is unavailable.`); }
      commitWorkspace(addReport(current, report));
      if (input.openInBrowser !== false) window.setTimeout(() => workspaceSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      return { report, result };
    };

    const onboardAudience = async (input: Record<string, unknown>) => {
      try {
        const current = workspaceRef.current;
        if (!current) throw new Error("The page workspace is unavailable.");
        if (input.operation === "start") {
          return {
            content: [{ type: "text", text: "Ask the user one concise survey containing all three questions: their first name, game company, and job role. Accept a natural-language answer, do not infer missing identity details, then call onboard_audience again with operation submit." }],
            structuredContent: {
              schemaVersion: "steam-desk.audience-onboarding/v1",
              stage: "survey_required",
              currentAudience: current.audience,
              survey: [
                { field: "firstName", question: "What is your first name?" },
                { field: "company", question: "What game company do you work for?" },
                { field: "jobRole", question: "What is your role there?" },
              ],
              instruction: "Ask all three questions now, then submit the user's answers with this tool. Company spelling is resolved by the tool; do not ask the user to manually search the catalog.",
            },
          };
        }
        if (input.operation !== "submit") throw new Error("operation must be start or submit.");
        const firstName = text(input.firstName, "", 60);
        const companyQuery = text(input.company, "", 120);
        const jobRole = text(input.jobRole, "", 100);
        if (!firstName || !companyQuery || !jobRole) throw new Error("Submit requires the user-provided first name, company, and job role.");
        const result = await resolveGameCompany(companyQuery, controller.signal);
        const requestedCompanyId = typeof input.companyId === "number" ? Math.floor(input.companyId) : 0;
        const selectable = new Map<number, GameCompany>();
        for (const company of [result.resolution.company, ...result.resolution.alternatives, ...result.candidates]) if (company) selectable.set(company.id, company);
        const company = requestedCompanyId ? selectable.get(requestedCompanyId) : result.resolution.company;
        if (requestedCompanyId && !company) throw new Error("The selected companyId is not in the resolver's current candidates. Ask the user to choose from the latest shortlist.");
        if (!company && result.resolution.status === "ambiguous") {
          return {
            content: [{ type: "text", text: "The company name has multiple plausible catalog matches. Ask the user one focused follow-up using the returned shortlist, then resubmit the same survey with the selected companyId." }],
            structuredContent: { schemaVersion: "steam-desk.audience-onboarding/v1", stage: "company_clarification", submitted: { firstName, company: companyQuery, jobRole }, candidates: result.resolution.alternatives, instruction: "Ask only which listed company they mean. Do not make an ambiguous employer choice." },
          };
        }
        if (!company) {
          return {
            content: [{ type: "text", text: "No credible Steam catalog company match was found after typo-tolerant resolution. Tell the user and ask for an alternate spelling or company name, then resubmit." }],
            structuredContent: { schemaVersion: "steam-desk.audience-onboarding/v1", stage: "company_not_found", submitted: { firstName, company: companyQuery, jobRole }, candidates: result.candidates, instruction: "Do not invent a company or silently substitute a weak match." },
          };
        }
        const next: Workspace = { ...current, audience: { firstName, jobRole, company: { id: company.id, name: company.name } }, onboarding: { stage: "proposal_required", proposal: null } };
        commitWorkspace(next);
        setEditingAudience(false);
        const corrected = result.resolution.status === "corrected" && companyQuery.localeCompare(company.name, undefined, { sensitivity: "accent" }) !== 0;
        return {
          content: [{ type: "text", text: `Saved the audience for ${firstName}, ${jobRole} at ${company.name}.${corrected ? ` Resolved “${companyQuery}” to the catalog company “${company.name}”.` : ""} Before requesting composition, propose what page would be most useful, explain the recommended sections and primary action, and wait for the user's approval or revisions.` }],
          structuredContent: {
            schemaVersion: "steam-desk.audience-onboarding/v1",
            stage: "proposal_required",
            audience: next.audience,
            companyResolution: { status: result.resolution.status, confidence: result.resolution.confidence, submittedName: companyQuery, canonicalName: company.name, corrected },
            proposalRequirements: ["State one clear page purpose.", "Recommend the most decision-useful signals for the role and company.", "List the page sections in reading order.", "Name one primary next action."],
            instruction: "Make the proposal to the user now. Do not call request_page_composition until the user approves or revises it.",
          },
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Audience onboarding failed." }], structuredContent: { ok: false } };
      }
    };

    const tools = [
      { name: "describe_page_data", description: "Describe the builder's reportable data, page outline, audience, onboarding stage, approved proposal, composition guide, and exact presentation modes. If onboarding is incomplete, use onboard_audience instead of collecting or saving identity through compose_page.", inputSchema: { type: "object", additionalProperties: false, properties: {} }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => { const current = workspaceRef.current!; return { content: [{ type: "text", text: `Described ${CATALOG_FIELD_CATALOG.length + ENGAGEMENT_FIELD_CATALOG.length} reportable fields across two builder sources and ${workspaceOutline(current).length} page blocks.` }], structuredContent: { schemaVersion: "steam-desk.workspace/v3", sources: [{ name: "steam_catalog", label: "Steam product catalog", recordCount, fields: CATALOG_FIELD_CATALOG }, { name: "customer_engagement", label: "Customer engagement", views: ["sessions", "funnel"], fields: ENGAGEMENT_FIELD_CATALOG, sharedFilters: engagementFiltersRef.current, guidance: ["Use sessions for users, sessions, duration, device, product, shop, and customer analysis.", "Use funnel for ordered Visitors, Sign-ups, Active, and Subscribed stages.", "Set inheritPageFilters to true for reports that should respond to the builder's filter panel.", "Supplier maps to publisher, brand to developer, productCategory to genre, and productClass to Steam category."] }], workspace: { storage: "local", audience: current.audience, onboarding: current.onboarding, selectedBlockId: current.selectedBlockId, blocks: workspaceOutline(current) }, htmlBindings: HTML_BINDINGS, compositionGuide: PAGE_COMPOSITION_GUIDE, spans: SPANS, composeOperations: ["inspect", "select", "addHtml", "addTabs", "move", "setSpan", "configure", "remove", "undo", "reset"], reportDefinition: { data: REPORT_DATA_SCHEMA, presentation: REPORT_PRESENTATION_SCHEMA }, presentationModes: REPORT_MODE_CATALOG, guidance: ["Use onboard_audience for the name, company, and role survey. After submission, propose the page and wait for approval before request_page_composition.", "Use create_report for every data-derived question, calculation, ranking, comparison, summary, table, chart, or narrative.", REPORT_PRESENTATION_DESCRIPTION] } }; } },
      { name: "onboard_audience", description: "Start or submit the agent-led audience survey. When the user says “onboard me” or uses a similar phrase such as “set me up” or “get started,” immediately call operation start. Ask for their first name, game company, and job role in one concise survey, then submit all three answers here. The tool resolves likely company typos itself, asks for user clarification only when catalog matches are genuinely ambiguous, stores the audience locally, and then requires you to propose the most useful page before composition.", inputSchema: ONBOARD_AUDIENCE_SCHEMA, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: onboardAudience },
      { name: "create_report", description: "Use for every request that asks for an answer, calculation, analysis, ranking, comparison, summary, table, chart, or narrative from the Steam product catalog or customer engagement data, even when the user does not say report or save. This is the reporting interface for all data-derived content and places the result inline. Choose exactly one presentation mode. Mixed means one headline metric plus one supporting chart and never includes a table; create separate reports or tabs when both a chart and table are needed. Requires a user-confirmed name and role plus a company candidate explicitly selected by the user. Use role and company context to tailor priorities and framing, and use quarter width for a row of four compact KPIs.", inputSchema: { type: "object", additionalProperties: false, properties: { title: { type: "string", maxLength: 100 }, description: { type: "string", maxLength: 220 }, span: { type: "string", enum: SPANS, description: "Choose full for primary or dense content, half for paired peers, third for three-up summaries, or quarter for four compact KPIs." }, data: REPORT_DATA_SCHEMA, presentation: REPORT_PRESENTATION_SCHEMA, openInBrowser: { type: "boolean", default: true } }, required: ["title", "data", "presentation"] }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input: Record<string, unknown>) => { try { const created = await createReport(input); return { content: [{ type: "text", text: `Created “${created.report.title}” and placed it on the page.` }], structuredContent: { schemaVersion: "steam-desk.report-receipt/v5", ok: true, report: { id: created.report.id, title: created.report.title, source: created.report.binding.source.name, mode: created.report.presentation.mode, span: created.report.span, rowCount: created.result.rows.length }, workspace: { storage: "local", selectedBlockId: created.report.id } } }; } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Report creation failed." }] }; } } },
      { name: "compose_page", description: "Inspect or compose the local page after the user has approved the agent's proposal through request_page_composition. Use create_report, not addHtml, for content that depends on catalog or engagement data. Follow the approved proposal and use the confirmed role and company to tailor priorities, framing, vocabulary, and the CTA.", inputSchema: COMPOSE_PAGE_SCHEMA, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async (input: Record<string, unknown>) => { try { const operations = normalizeOperations(input.operations); const current = workspaceRef.current; if (!current) throw new Error("The page workspace is unavailable."); const mutatesPage = operations.some((operation) => operation.op !== "inspect" && operation.op !== "select"); if (mutatesPage && current.onboarding.stage !== "composition_ready") throw new Error("Page composition is locked. Finish onboard_audience, propose the most useful page to the user, wait for approval, and call request_page_composition first."); if (operations.some((operation) => operation.op === "undo")) { if (operations.length !== 1) throw new Error("undo must be the only page operation."); const changed = undoWorkspace(); const restored = workspaceRef.current!; return { content: [{ type: "text", text: changed ? "Undid the last page change." : "There is no page change to undo." }], structuredContent: { ok: true, changed, compositionGuide: PAGE_COMPOSITION_GUIDE, workspace: { storage: "local", audience: restored.audience, onboarding: restored.onboarding, selectedBlockId: restored.selectedBlockId, blocks: workspaceOutline(restored) } } }; } const applied = applyOperations(current, operations); if (applied.changes.length) commitWorkspace(applied.workspace, !operations.every((operation) => operation.op === "select")); if (input.openInBrowser !== false && applied.changes.length) window.setTimeout(() => workspaceSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); return { content: [{ type: "text", text: applied.changes.length ? applied.changes.join(" ") : `The page contains ${workspaceOutline(applied.workspace).length} top-level blocks.` }], structuredContent: { schemaVersion: "steam-desk.compose-receipt/v2", ok: true, changed: Boolean(applied.changes.length), changes: applied.changes, approvedProposal: applied.workspace.onboarding.proposal, compositionGuide: PAGE_COMPOSITION_GUIDE, workspace: { storage: "local", audience: applied.workspace.audience, onboarding: applied.workspace.onboarding, selectedBlockId: applied.workspace.selectedBlockId, blocks: workspaceOutline(applied.workspace) } } }; } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Page composition failed." }], structuredContent: { ok: false } }; } } },
      { name: "render_report", description: "Render an inline report from the local page as bounded Markdown or a PNG.", inputSchema: { type: "object", additionalProperties: false, properties: { reportId: { type: "string", minLength: 1, maxLength: 128 }, renderMode: { type: "string", enum: ["auto", "markdown", "image"], default: "auto" } }, required: ["reportId"] }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: async (input: Record<string, unknown>) => { try { const current = workspaceRef.current; const report = current ? reportBlocks(current).find((item) => item.id === input.reportId) : null; if (!report) throw new Error("Report not found on this page."); const result = await runReport(report, engagementFiltersRef.current); const imageMode = input.renderMode === "image" || input.renderMode !== "markdown" && Boolean(result.figure); if (imageMode) { if (!result.figure) throw new Error("Image rendering is available only for chart reports."); return { content: [{ type: "text", text: `Rendered “${report.title}” as a PNG.` }, { type: "image", data: await renderPlotlyFigureToPng(result.figure), mimeType: "image/png" }], structuredContent: { ok: true, report: { id: report.id, title: report.title } } }; } return { content: [{ type: "text", text: markdownReport(report, result) }], structuredContent: { ok: true, report: { id: report.id, title: report.title } } }; } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Report rendering failed." }] }; } } },
    ];
    void Promise.all(tools.map((tool) => context.registerTool(tool, { signal: controller.signal })))
      .then(() => { if (!controller.signal.aborted) onWebMcpStatusChange("connected"); })
      .catch(() => { if (!controller.signal.aborted) onWebMcpStatusChange("preview"); });
    return () => controller.abort();
  }, [commitWorkspace, onWebMcpStatusChange, recordCount, sourceSha256, undoWorkspace]);

  const onboardingStage = workspace?.onboarding.stage;
  useEffect(() => {
    if (onboardingStage !== "proposal_required" || recordCount === undefined || !workspaceRef.current) return;
    const context = document.modelContext ?? navigator.modelContext;
    if (!context) return;
    const controller = new AbortController();
    const tool = {
      name: "request_page_composition",
      description: "Unlock page composition only after onboard_audience has saved the audience, you have proposed the most useful page in conversation, and the user has approved or revised that proposal. Submit the approved purpose, ordered sections, and primary action. Never call this immediately after audience submission or before user confirmation.",
      inputSchema: PAGE_PROPOSAL_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input: Record<string, unknown>) => {
        const current = workspaceRef.current;
        if (!current?.audience.firstName || !current.audience.jobRole || !current.audience.company) {
          return { isError: true, content: [{ type: "text", text: "The audience survey has not been submitted." }] };
        }
        if (current.onboarding.stage !== "proposal_required") return { isError: true, content: [{ type: "text", text: "The workspace is not waiting for a proposal approval." }] };
        if (input.userConfirmed !== true) return { isError: true, content: [{ type: "text", text: "Wait for the user to approve or revise the proposal, then call again with userConfirmed true." }] };
        const summary = text(input.summary, "", 400);
        const sections = Array.isArray(input.sections) ? input.sections.flatMap((section): string[] => typeof section === "string" && section.trim() ? [section.trim().slice(0, 120)] : []).slice(0, 8) : [];
        const primaryAction = text(input.primaryAction, "", 180);
        if (!summary || !sections.length || !primaryAction) return { isError: true, content: [{ type: "text", text: "The approved proposal requires a summary, at least one ordered section, and a primary action." }] };
        const proposal = { summary, sections, primaryAction };
        const next: Workspace = { ...current, onboarding: { stage: "composition_ready", proposal } };
        commitWorkspace(next);
        setEditingAudience(false);
        return {
          content: [{ type: "text", text: `${current.audience.firstName} approved the proposed page. Composition is unlocked. Build the approved sections now with compose_page and create_report; do not ask for the audience again.` }],
          structuredContent: {
            schemaVersion: "steam-desk.page-creation-request/v2",
            requestedAction: "create_page",
            audience: current.audience,
            approvedProposal: proposal,
            compositionGuide: PAGE_COMPOSITION_GUIDE,
            instruction: "Create the approved page now with compose_page and create_report. Follow the approved purpose, section order, and primary action.",
          },
        };
      },
    };
    void context.registerTool(tool, { signal: controller.signal }).catch(() => undefined);
    return () => controller.abort();
  }, [commitWorkspace, onboardingStage, recordCount]);

  const applyUiOperations = useCallback((operations: WorkspaceOperation[]) => {
    const current = workspaceRef.current; if (!current) return;
    try { const applied = applyOperations(current, operations); if (applied.changes.length) commitWorkspace(applied.workspace, !operations.every((operation) => operation.op === "select")); }
    catch { /* Invalid manual moves leave the current layout unchanged. */ }
  }, [commitWorkspace]);

  const audienceReady = Boolean(workspace?.audience.firstName && workspace?.audience.jobRole && workspace?.audience.company);
  const compositionReady = workspace?.onboarding.stage === "composition_ready";
  const onboardingActive = Boolean(workspace && (!compositionReady || editingAudience));
  const studioActive = Boolean(workspace && compositionReady && !editingAudience);

  const removeBlock = (id: string) => applyUiOperations([{ op: "remove", target: id }]);
  const cycleSpan = (id: string, current: BlockSpan) => applyUiOperations([{ op: "setSpan", target: id, span: SPANS[(SPANS.indexOf(current) + 1) % SPANS.length] }]);
  const selectBlock = (id: string) => applyUiOperations([{ op: "select", target: id }]);
  const moveInContainer = (blocks: WorkspaceBlock[] | LeafBlock[], id: string, direction: -1 | 1) => { const index = blocks.findIndex((block) => block.id === id); const target = blocks[index + direction]; if (!target) return; applyUiOperations([{ op: "move", target: id, ...(direction < 0 ? { before: target.id } : { after: target.id }) }]); };
  const startDrag = (id: string, event: React.DragEvent) => { setDraggedId(id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); };
  const dropBefore = (target: string, event: React.DragEvent) => { event.preventDefault(); event.stopPropagation(); const id = draggedId ?? event.dataTransfer.getData("text/plain"); setDraggedId(null); if (id && id !== target) applyUiOperations([{ op: "move", target: id, before: target }]); };
  const dropIntoTab = (tabsId: string, tabId: string, event: React.DragEvent) => { event.preventDefault(); event.stopPropagation(); const id = draggedId ?? event.dataTransfer.getData("text/plain"); setDraggedId(null); if (id) applyUiOperations([{ op: "move", target: id, intoTab: { tabsId, tabId } }]); };

  const renderLeaf = (block: LeafBlock, siblings: WorkspaceBlock[]) => <article key={block.id} className={`workspace-block span-${block.span} ${workspace?.selectedBlockId === block.id ? "is-selected" : ""}`} onClick={(event) => { event.stopPropagation(); selectBlock(block.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropBefore(block.id, event)}><BlockControls block={block} selected={workspace?.selectedBlockId === block.id} onSelect={() => selectBlock(block.id)} onMove={(direction) => moveInContainer(siblings, block.id, direction)} onSpan={() => cycleSpan(block.id, block.span)} onRemove={() => removeBlock(block.id)} onDragStart={(event) => startDrag(block.id, event)} />{block.type === "report" ? <ReportWidget block={block} pageFilters={engagementFilters} /> : <HtmlWidget block={block} recordCount={recordCount ?? 0} firstName={workspace?.audience.firstName ?? ""} jobRole={workspace?.audience.jobRole ?? ""} company={workspace?.audience.company?.name ?? ""} />}</article>;

  const renderTabs = (block: TabsBlock) => {
    const activeId = activeTabs[block.id] ?? block.tabs[0]?.id;
    const active = block.tabs.find((tab) => tab.id === activeId) ?? block.tabs[0];
    return <article key={block.id} className={`workspace-block workspace-tabs span-${block.span} ${workspace?.selectedBlockId === block.id ? "is-selected" : ""}`} onClick={(event) => { event.stopPropagation(); selectBlock(block.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropBefore(block.id, event)}><BlockControls block={block} selected={workspace?.selectedBlockId === block.id} onSelect={() => selectBlock(block.id)} onMove={(direction) => moveInContainer(workspace?.blocks ?? [], block.id, direction)} onSpan={() => cycleSpan(block.id, block.span)} onRemove={() => removeBlock(block.id)} onDragStart={(event) => startDrag(block.id, event)} /><header className="tabs-header"><div><p className="eyebrow"><span /> Page tabs</p><h3>{block.title}</h3></div><TabsNavigation blockId={block.id} title={block.title} tabs={block.tabs} activeId={active?.id} onSelect={(tabId) => setActiveTabs((value) => ({ ...value, [block.id]: tabId }))} /></header>{active ? <div className="tab-canvas" id={`tab-panel-${block.id}-${active.id}`} role="tabpanel" aria-labelledby={`tab-${block.id}-${active.id}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropIntoTab(block.id, active.id, event)}>{active.blocks.length ? active.blocks.map((item) => renderLeaf(item, active.blocks)) : <div className="tab-drop-zone">Drop a report or HTML widget into {active.label}</div>}</div> : null}</article>;
  };

  const games = catalog?.games ?? [];
  const total = catalog?.query.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visiblePage = Math.min(page, totalPages - 1);
  const start = total ? visiblePage * PAGE_SIZE + 1 : 0;
  const end = Math.min((visiblePage + 1) * PAGE_SIZE, total);
  const sortIndicator = (key: SortKey) => sortKey === key ? sortDirection === "asc" ? "↑" : "↓" : "↕";
  const changeSort = (next: SortKey) => { if (next === sortKey) setSortDirection((value) => value === "asc" ? "desc" : "asc"); else { setSortKey(next); setSortDirection(next === "title" ? "asc" : "desc"); } setPage(0); };
  return <main className={`site-shell builder-site-shell ${onboardingActive ? "is-onboarding" : ""}`}><section className={`release-desk builder-desk ${onboardingActive ? "onboarding-mode" : ""}`} aria-label="Steam Desk page builder">
    <section className={`page-workspace ${onboardingActive ? "onboarding-workspace" : ""}`} ref={workspaceSectionRef} aria-labelledby={onboardingActive ? "audience-brief-title" : "workspace-title"}>
      {!onboardingActive ? <header className="page-workspace-header" ref={widgetPromptMenuRef}>
        <div>
          <p className="eyebrow"><span /> Step 3 of 3 · Compose</p>
          <h2 id="workspace-title">Your page</h2>
          <p>{"Approved canvas for " + (workspace?.audience.firstName ?? "") + " · " + (workspace?.audience.jobRole ?? "") + " at " + (workspace?.audience.company?.name ?? "")}</p>
        </div>
        <div className="workspace-actions">
          <>
            <span>{workspace?.blocks.length ?? 0} blocks</span>
            <button type="button" onClick={() => { setShowWidgetPrompts(false); setEditingAudience(true); }}>Edit audience</button>
            <button type="button" disabled={!canUndo} onClick={undoWorkspace}>Undo</button>
            <button type="button" disabled={!workspace?.blocks.length} onClick={() => applyUiOperations([{ op: "reset" }])}>Clear page</button>
            <button type="button" className={`suggest-report add-widget${showWidgetPrompts ? " open" : ""}`} aria-label={showWidgetPrompts ? "Close widget suggestions" : "Add a widget"} aria-expanded={showWidgetPrompts} aria-controls="widget-prompt-guide" onClick={() => setShowWidgetPrompts((value) => !value)}>
              Add a widget <span aria-hidden="true">+</span>
            </button>
          </>
        </div>
        {showWidgetPrompts ? <section id="widget-prompt-guide" className="prompt-guide catalog-suggestion-menu widget-prompt-overlay" role="dialog" aria-modal="false" aria-labelledby="widget-prompt-guide-title"><header><div><p className="eyebrow"><span /> Compose naturally</p><h2 id="widget-prompt-guide-title">Helpful sample prompts</h2></div><p>Describe the outcome—not the grid. WebMCP knows your confirmed role and company, so ask it to connect market signals to your company’s portfolio, priorities, and next action.</p></header><div className="prompt-grid">{SAMPLE_PROMPTS.map((item) => <button type="button" className="prompt-card" key={item.prompt} onClick={() => void navigator.clipboard.writeText(item.prompt).then(() => { setCopiedPrompt(item.prompt); window.setTimeout(() => setCopiedPrompt(null), 1600); })}><span className="prompt-mode">{item.mode}</span><span className="prompt-copy">“{item.prompt}”</span><span className="prompt-action">{copiedPrompt === item.prompt ? "Copied ✓" : "Copy prompt ↗"}</span></button>)}</div></section> : null}
      </header> : null}
      {workspace && onboardingActive ? (
        <AudienceOnboarding
          stage={editingAudience ? "audience_required" : workspace.onboarding.stage}
          audience={workspace.audience}
          canCancel={audienceReady}
          onCancel={() => setEditingAudience(false)}
        />
      ) : workspace ? workspace.blocks.length ? (
        <div className="page-canvas" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { if (event.currentTarget !== event.target) return; const id = draggedId ?? event.dataTransfer.getData("text/plain"); setDraggedId(null); if (id) applyUiOperations([{ op: "move", target: id, toRootEnd: true }]); }}>
          {workspace.blocks.map((block) => block.type === "tabs" ? renderTabs(block) : renderLeaf(block, workspace.blocks))}
        </div>
      ) : (
        <div className="workspace-empty"><span aria-hidden="true">⌁</span><div><strong>Your page is ready for its first block</strong><p>Tell WebMCP what the page should help you accomplish. It will choose the reports, hierarchy, and layout.</p></div></div>
      ) : (
        <div className="workspace-empty"><div><strong>Loading your local page…</strong></div></div>
      )}
      {!onboardingActive ? <footer className="page-workspace-footer">
        <span>Stored in this browser</span>
        <span>{workspace?.audience.company ? workspace.audience.firstName + " · " + workspace.audience.jobRole + " · " + workspace.audience.company.name : "Audience setup required"}</span>
        <span>Catalog insights use the latest available data</span>
        <span>Selected: {workspace ? findBlock(workspace, workspace.selectedBlockId)?.title ?? "none" : "none"}</span>
      </footer> : null}
    </section>
    {studioActive ? <EngagementResourcePanel filters={engagementFilters} onFiltersChange={setEngagementFilters} /> : null}
    {studioActive ? <details className="builder-resource-panel catalog-resource-panel" aria-busy={catalogLoading}><summary><span><strong>Catalog data</strong><small>{catalogLoading ? "Updating catalog results" : catalog ? `${total.toLocaleString()} matching games available to the page` : catalogError}</small></span><b aria-hidden="true">+</b></summary><div id="catalog-browser" className="toolbar" aria-label="Catalog filters"><label className="search-field"><span className="sr-only">Search games</span><span aria-hidden="true">⌕</span><input disabled={!catalog} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search titles, developers, genres, tags" /></label><label className="select-field"><span className="sr-only">Owner range</span><select disabled={!catalog} value={ownerBand} onChange={(event) => { setOwnerBand(event.target.value); setPage(0); }}><option>All owner ranges</option>{OWNER_BANDS.map((item) => <option key={item} value={item}>{ownerBandLabels.get(item)}</option>)}</select></label><label className="select-field"><span className="sr-only">Price band</span><select disabled={!catalog} value={priceBand} onChange={(event) => { setPriceBand(event.target.value); setPage(0); }}><option>All prices</option>{PRICE_BANDS.map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="result-strip"><span aria-live="polite">{catalogLoading ? "Updating results..." : catalog ? <><strong>{total.toLocaleString()}</strong> games match</> : catalogError}</span><button type="button" disabled={!catalog} onClick={() => { setSearch(""); setOwnerBand("All owner ranges"); setPriceBand("All prices"); setPage(0); }}>Reset filters</button></div>
    <div className="table-wrap"><table><thead><tr><th><button type="button" onClick={() => changeSort("title")}>Game <span>{sortIndicator("title")}</span></button></th><th><button type="button" onClick={() => changeSort("ownersMax")}>Owners <span>{sortIndicator("ownersMax")}</span></button></th><th><button type="button" onClick={() => changeSort("priceCents")}>Price <span>{sortIndicator("priceCents")}</span></button></th><th><button type="button" onClick={() => changeSort("positiveRatio")}>Reviews <span>{sortIndicator("positiveRatio")}</span></button></th><th><button type="button" onClick={() => changeSort("ccu")}>Players <span>{sortIndicator("ccu")}</span></button></th><th>Avg. playtime</th></tr></thead><tbody>{catalogLoading ? <CatalogTableSkeleton /> : games.map((game) => { const accent = Math.abs(game.id) % coverMarks.length; return <tr key={game.id}><td><div className="game-cell"><span className={`cover cover-${accent}`} aria-hidden="true"><i>{coverMarks[accent]}</i><b>{game.title.split(" ").map((word) => word[0]).slice(0, 2).join("")}</b></span><span><strong>{game.title}</strong><small>{game.developer}{game.genres.length ? ` · ${game.genres.slice(0, 2).join(", ")}` : ""}</small></span></div></td><td><span className="genre-pill" title={game.owners}>{formatOwnerRange(game)}</span></td><td className="price-cell">{formatPrice(game.priceCents)}</td><td className="wishlist-cell">{formatPercent(game.positiveRatio)}</td><td className="wishlist-cell">{formatCompact(game.ccu)}</td><td><span className="status">{formatPlaytime(game.averageForever)}</span></td></tr>; })}{!catalogLoading && !games.length && <tr><td colSpan={6}><div className="empty-state"><strong>{catalogError ? "Catalog unavailable" : "No games found"}</strong><span>{catalogError || "Try broader filters."}</span></div></td></tr>}</tbody></table></div><footer className="desk-footer"><span>{catalogLoading ? "Updating catalog results..." : <>Showing {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}</>}</span><div><button type="button" disabled={catalogLoading || visiblePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>←</button><span>Page {visiblePage + 1} / {totalPages}</span><button type="button" disabled={catalogLoading || visiblePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>→</button></div></footer></details> : null}</section>
    </main>;
}
