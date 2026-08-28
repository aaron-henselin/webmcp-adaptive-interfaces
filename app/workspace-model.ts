import { normalizeCatalogAnalyticsBinding, type CatalogAnalyticsBinding } from "./catalog-analytics";
import { normalizePlotlyFigure, type PlotlyFigure } from "./plotly-visualization";

export type BlockSpan = "full" | "half" | "third";
export type ValueFormat = "number" | "integer" | "compact" | "currencyCents" | "percent" | "minutes";
export type MetricSpec = { valueField: string; label: string; format: ValueFormat; context: string };
export type TableColumn = { field: string; label: string; format: ValueFormat };
export type ReportPresentation =
  | { mode: "metric"; metric: MetricSpec }
  | { mode: "table"; table: { columns: TableColumn[] } }
  | { mode: "chart"; figure: PlotlyFigure }
  | { mode: "narrative"; narrative: { body: string } }
  | { mode: "mixed"; metric: MetricSpec; figure: PlotlyFigure };

export type ReportBlock = {
  id: string;
  type: "report";
  span: BlockSpan;
  title: string;
  description: string;
  createdAt: string;
  presentation: ReportPresentation;
  binding: CatalogAnalyticsBinding;
};

export type HtmlBlock = { id: string; type: "html"; span: BlockSpan; title: string; markup: string };
export type LeafBlock = ReportBlock | HtmlBlock;
export type TabDefinition = { id: string; label: string; blocks: LeafBlock[] };
export type TabsBlock = { id: string; type: "tabs"; span: BlockSpan; title: string; tabs: TabDefinition[] };
export type WorkspaceBlock = LeafBlock | TabsBlock;
export type Workspace = { schemaVersion: 1; updatedAt: string; selectedBlockId: string | null; blocks: WorkspaceBlock[] };

export type WorkspaceOperation =
  | { op: "inspect" }
  | { op: "select"; target: string }
  | { op: "addHtml"; title?: string; markup: string; span?: BlockSpan; after?: string }
  | { op: "addTabs"; title?: string; labels: string[]; span?: BlockSpan; after?: string }
  | { op: "move"; target: string; before?: string; after?: string; intoTab?: { tabsId: string; tabId: string }; toRootEnd?: boolean }
  | { op: "setSpan"; target: string; span: BlockSpan }
  | { op: "configure"; target: string; title?: string; markup?: string; tabLabels?: string[] }
  | { op: "remove"; target: string }
  | { op: "undo" }
  | { op: "reset" };

export const WORKSPACE_KEY = "steam-desk:workspace:v1";
export const LEGACY_REPORTS_KEY = "steam-desk:saved-reports:v5";
export const MAX_WORKSPACE_BLOCKS = 32;
export const MAX_TABS = 6;
export const MAX_HTML_LENGTH = 2_000;
export const SPANS: BlockSpan[] = ["full", "half", "third"];
export const VALUE_FORMATS: ValueFormat[] = ["number", "integer", "compact", "currencyCents", "percent", "minutes"];

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const BINDING_PATTERN = /{{\s*([A-Za-z][A-Za-z0-9_.]*)\s*}}/g;
export const HTML_BINDINGS = ["time.greeting", "user.firstName", "today.long", "today.short", "currentYear", "page.title", "catalog.recordCount"] as const;
const ALLOWED_BINDINGS = new Set<string>(HTML_BINDINGS);
const ALLOWED_TAGS = new Set(["P", "DIV", "SPAN", "H2", "H3", "H4", "STRONG", "EM", "SMALL", "TIME", "UL", "OL", "LI", "A", "BR", "HR"]);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const cleanText = (value: unknown, fallback: string, limit: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : fallback;
const span = (value: unknown): BlockSpan => SPANS.includes(value as BlockSpan) ? value as BlockSpan : "full";
const valueFormat = (value: unknown): ValueFormat => VALUE_FORMATS.includes(value as ValueFormat) ? value as ValueFormat : "number";

function metric(value: unknown): MetricSpec | null {
  if (!isRecord(value) || typeof value.valueField !== "string" || !FIELD_NAME.test(value.valueField)) return null;
  return { valueField: value.valueField, label: cleanText(value.label, value.valueField, 80), format: valueFormat(value.format), context: cleanText(value.context, "", 180) };
}

function tableColumns(value: unknown): TableColumn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): TableColumn[] => isRecord(item) && typeof item.field === "string" && FIELD_NAME.test(item.field)
    ? [{ field: item.field, label: cleanText(item.label, item.field, 60), format: valueFormat(item.format) }]
    : []).slice(0, 8);
}

export function normalizePresentation(value: unknown): ReportPresentation | null {
  if (!isRecord(value) || typeof value.mode !== "string") return null;
  const metricSpec = metric(value.metric);
  if (value.mode === "metric" && metricSpec) return { mode: "metric", metric: metricSpec };
  if (value.mode === "table" && isRecord(value.table)) {
    const columns = tableColumns(value.table.columns);
    if (columns.length) return { mode: "table", table: { columns } };
  }
  if (value.mode === "narrative" && isRecord(value.narrative)) {
    const body = cleanText(value.narrative.body, "", 800);
    if (body) return { mode: "narrative", narrative: { body } };
  }
  if ((value.mode === "chart" || value.mode === "mixed") && isRecord(value.figure)) {
    try {
      const figure = normalizePlotlyFigure(value.figure);
      if (value.mode === "chart") return { mode: "chart", figure };
      if (metricSpec) return { mode: "mixed", metric: metricSpec, figure };
    } catch { return null; }
  }
  return null;
}

function normalizeReport(value: unknown): ReportBlock | null {
  if (!isRecord(value)) return null;
  const binding = normalizeCatalogAnalyticsBinding(value.binding);
  const presentation = normalizePresentation(value.presentation);
  if (!binding || !presentation) return null;
  return {
    id: cleanText(value.id, crypto.randomUUID(), 128), type: "report", span: span(value.span),
    title: cleanText(value.title, "Steam catalog report", 100), description: cleanText(value.description, "", 220),
    createdAt: cleanText(value.createdAt ?? value.savedAt, new Date().toISOString(), 40), presentation, binding,
  };
}

function normalizeHtml(value: unknown): HtmlBlock | null {
  if (!isRecord(value) || typeof value.markup !== "string") return null;
  return { id: cleanText(value.id, crypto.randomUUID(), 128), type: "html", span: span(value.span), title: cleanText(value.title, "HTML widget", 100), markup: value.markup.slice(0, MAX_HTML_LENGTH) };
}

function normalizeLeaf(value: unknown): LeafBlock | null {
  if (!isRecord(value)) return null;
  return value.type === "report" ? normalizeReport(value) : value.type === "html" ? normalizeHtml(value) : null;
}

function normalizeTabs(value: unknown): TabsBlock | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null;
  const tabs = value.tabs.flatMap((item): TabDefinition[] => {
    if (!isRecord(item)) return [];
    const blocks = Array.isArray(item.blocks) ? item.blocks.flatMap((block): LeafBlock[] => {
      const normalized = normalizeLeaf(block); return normalized ? [normalized] : [];
    }) : [];
    return [{ id: cleanText(item.id, crypto.randomUUID(), 128), label: cleanText(item.label, "Tab", 60), blocks }];
  }).slice(0, MAX_TABS);
  if (!tabs.length) return null;
  return { id: cleanText(value.id, crypto.randomUUID(), 128), type: "tabs", span: span(value.span), title: cleanText(value.title, "Tabs", 100), tabs };
}

function totalBlocks(blocks: WorkspaceBlock[]) {
  return blocks.reduce((total, block) => total + 1 + (block.type === "tabs" ? block.tabs.reduce((sum, tab) => sum + tab.blocks.length, 0) : 0), 0);
}

export function emptyWorkspace(): Workspace {
  return { schemaVersion: 1, updatedAt: new Date().toISOString(), selectedBlockId: null, blocks: [] };
}

export function normalizeWorkspace(value: unknown): Workspace | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.blocks)) return null;
  const blocks = value.blocks.flatMap((block): WorkspaceBlock[] => {
    if (!isRecord(block)) return [];
    const normalized = block.type === "tabs" ? normalizeTabs(block) : normalizeLeaf(block);
    return normalized ? [normalized] : [];
  });
  if (totalBlocks(blocks) > MAX_WORKSPACE_BLOCKS) return null;
  const selected = typeof value.selectedBlockId === "string" ? value.selectedBlockId : null;
  return { schemaVersion: 1, updatedAt: cleanText(value.updatedAt, new Date().toISOString(), 40), selectedBlockId: selected, blocks };
}

export function loadWorkspace(): Workspace {
  try {
    const stored = window.localStorage.getItem(WORKSPACE_KEY);
    if (stored) {
      const workspace = normalizeWorkspace(JSON.parse(stored));
      if (workspace) return workspace;
    }
    const legacy = window.localStorage.getItem(LEGACY_REPORTS_KEY);
    const parsed = legacy ? JSON.parse(legacy) : [];
    const reports = Array.isArray(parsed) ? parsed.flatMap((item): ReportBlock[] => {
      const report = normalizeReport(item); return report ? [{ ...report, span: "full" }] : [];
    }) : [];
    return { ...emptyWorkspace(), blocks: reports.slice(0, MAX_WORKSPACE_BLOCKS) };
  } catch { return emptyWorkspace(); }
}

export function saveWorkspace(workspace: Workspace) {
  window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ ...workspace, updatedAt: new Date().toISOString() }));
}

type BlockLocation = { container: WorkspaceBlock[] | LeafBlock[]; index: number; block: WorkspaceBlock };

function locate(workspace: Workspace, id: string): BlockLocation | null {
  const rootIndex = workspace.blocks.findIndex((block) => block.id === id);
  if (rootIndex >= 0) return { container: workspace.blocks, index: rootIndex, block: workspace.blocks[rootIndex] };
  for (const block of workspace.blocks) {
    if (block.type !== "tabs") continue;
    for (const tab of block.tabs) {
      const index = tab.blocks.findIndex((item) => item.id === id);
      if (index >= 0) return { container: tab.blocks, index, block: tab.blocks[index] };
    }
  }
  return null;
}

export function findBlock(workspace: Workspace, id: string | null) {
  return id ? locate(workspace, id)?.block ?? null : null;
}

export function reportBlocks(workspace: Workspace) {
  const reports: ReportBlock[] = [];
  for (const block of workspace.blocks) {
    if (block.type === "report") reports.push(block);
    if (block.type === "tabs") for (const tab of block.tabs) for (const item of tab.blocks) if (item.type === "report") reports.push(item);
  }
  return reports;
}

const resolveTarget = (workspace: Workspace, target: string) => target === "selected" ? workspace.selectedBlockId : target;

function insertAfter(workspace: Workspace, block: WorkspaceBlock, after?: string) {
  if (!after) { workspace.blocks.push(block); return; }
  const id = resolveTarget(workspace, after);
  const destination = id ? locate(workspace, id) : null;
  if (!destination) throw new Error(`The destination block “${after}” was not found.`);
  if (block.type === "tabs" && destination.container !== workspace.blocks) throw new Error("Tabs cannot be nested inside tabs.");
  destination.container.splice(destination.index + 1, 0, block as LeafBlock & WorkspaceBlock);
}

export function applyOperations(current: Workspace, operations: WorkspaceOperation[]) {
  const workspace = structuredClone(current);
  const changes: string[] = [];
  for (const operation of operations.slice(0, 16)) {
    if (operation.op === "inspect") continue;
    if (operation.op === "reset") { workspace.blocks = []; workspace.selectedBlockId = null; changes.push("Reset the page."); continue; }
    if (operation.op === "undo") continue;
    if (operation.op === "addHtml") {
      if (totalBlocks(workspace.blocks) >= MAX_WORKSPACE_BLOCKS) throw new Error(`The page may contain at most ${MAX_WORKSPACE_BLOCKS} blocks.`);
      const block: HtmlBlock = { id: crypto.randomUUID(), type: "html", span: span(operation.span), title: cleanText(operation.title, "HTML widget", 100), markup: operation.markup.slice(0, MAX_HTML_LENGTH) };
      insertAfter(workspace, block, operation.after); workspace.selectedBlockId = block.id; changes.push(`Added “${block.title}”.`); continue;
    }
    if (operation.op === "addTabs") {
      if (totalBlocks(workspace.blocks) >= MAX_WORKSPACE_BLOCKS) throw new Error(`The page may contain at most ${MAX_WORKSPACE_BLOCKS} blocks.`);
      const labels = operation.labels.map((label) => cleanText(label, "Tab", 60)).filter(Boolean).slice(0, MAX_TABS);
      if (!labels.length) throw new Error("Tabs require at least one label.");
      const block: TabsBlock = { id: crypto.randomUUID(), type: "tabs", span: span(operation.span), title: cleanText(operation.title, "Tabs", 100), tabs: labels.map((label) => ({ id: crypto.randomUUID(), label, blocks: [] })) };
      insertAfter(workspace, block, operation.after); workspace.selectedBlockId = block.id; changes.push(`Added “${block.title}” with ${labels.length} tabs.`); continue;
    }
    const id = resolveTarget(workspace, operation.target);
    if (!id) throw new Error("No page block is selected.");
    const location = locate(workspace, id);
    if (!location) throw new Error(`The block “${operation.target}” was not found.`);
    if (operation.op === "select") { workspace.selectedBlockId = id; changes.push(`Selected “${location.block.title}”.`); continue; }
    if (operation.op === "remove") { location.container.splice(location.index, 1); if (workspace.selectedBlockId === id) workspace.selectedBlockId = null; changes.push(`Removed “${location.block.title}”.`); continue; }
    if (operation.op === "setSpan") { location.block.span = operation.span; changes.push(`Set “${location.block.title}” to ${operation.span} width.`); continue; }
    if (operation.op === "configure") {
      if (operation.title !== undefined) location.block.title = cleanText(operation.title, location.block.title, 100);
      if (location.block.type === "html" && operation.markup !== undefined) location.block.markup = operation.markup.slice(0, MAX_HTML_LENGTH);
      if (location.block.type === "tabs" && operation.tabLabels) {
        const labels = operation.tabLabels.slice(0, MAX_TABS);
        location.block.tabs = labels.map((label, index) => ({ id: location.block.type === "tabs" ? location.block.tabs[index]?.id ?? crypto.randomUUID() : crypto.randomUUID(), label: cleanText(label, "Tab", 60), blocks: location.block.type === "tabs" ? location.block.tabs[index]?.blocks ?? [] : [] }));
      }
      changes.push(`Updated “${location.block.title}”.`); continue;
    }
    if (operation.op === "move") {
      const moving = location.block;
      location.container.splice(location.index, 1);
      if (operation.intoTab) {
        if (moving.type === "tabs") throw new Error("Tabs cannot be nested inside tabs.");
        const tabs = locate(workspace, operation.intoTab.tabsId)?.block;
        if (!tabs || tabs.type !== "tabs") throw new Error("The destination tabs block was not found.");
        const tab = tabs.tabs.find((item) => item.id === operation.intoTab?.tabId || item.label === operation.intoTab?.tabId);
        if (!tab) throw new Error("The destination tab was not found.");
        tab.blocks.push(moving); changes.push(`Moved “${moving.title}” into “${tab.label}”.`); continue;
      }
      if (operation.toRootEnd) { workspace.blocks.push(moving); changes.push(`Moved “${moving.title}” to the end of the page.`); continue; }
      const reference = operation.before ?? operation.after;
      if (!reference) throw new Error("Move requires before, after, intoTab, or toRootEnd.");
      const destinationId = resolveTarget(workspace, reference);
      const destination = destinationId ? locate(workspace, destinationId) : null;
      if (!destination) throw new Error("The move destination was not found.");
      if (moving.type === "tabs" && destination.container !== workspace.blocks) throw new Error("Tabs cannot be nested inside tabs.");
      destination.container.splice(destination.index + (operation.after ? 1 : 0), 0, moving as LeafBlock & WorkspaceBlock);
      changes.push(`Moved “${moving.title}”.`);
    }
  }
  workspace.updatedAt = new Date().toISOString();
  return { workspace, changes };
}

export function addReport(current: Workspace, report: ReportBlock) {
  const workspace = structuredClone(current);
  if (totalBlocks(workspace.blocks) >= MAX_WORKSPACE_BLOCKS) throw new Error(`The page may contain at most ${MAX_WORKSPACE_BLOCKS} blocks.`);
  const selected = workspace.selectedBlockId ? locate(workspace, workspace.selectedBlockId) : null;
  if (selected && selected.block.type !== "tabs") selected.container.splice(selected.index + 1, 0, report as LeafBlock & WorkspaceBlock);
  else workspace.blocks.push(report);
  workspace.selectedBlockId = report.id;
  workspace.updatedAt = new Date().toISOString();
  return workspace;
}

export function workspaceOutline(workspace: Workspace) {
  return workspace.blocks.map((block, index) => block.type === "tabs"
    ? { id: block.id, type: block.type, title: block.title, span: block.span, position: index, tabs: block.tabs.map((tab) => ({ id: tab.id, label: tab.label, blocks: tab.blocks.map((item, childIndex) => ({ id: item.id, type: item.type, title: item.title, span: item.span, position: childIndex })) })) }
    : { id: block.id, type: block.type, title: block.title, span: block.span, position: index });
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function renderHtmlWidget(markup: string, values: { pageTitle: string; recordCount: number; userFirstName: string }) {
  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  const bindings: Record<string, string> = {
    "time.greeting": greeting, "user.firstName": values.userFirstName,
    "today.long": now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    "today.short": now.toLocaleDateString(), currentYear: String(now.getFullYear()),
    "page.title": values.pageTitle, "catalog.recordCount": values.recordCount.toLocaleString(),
  };
  const resolved = markup.replace(BINDING_PATTERN, (_, name: string) => escapeHtml(ALLOWED_BINDINGS.has(name) ? bindings[name] ?? "" : `{{${name}}}`));
  const document = new DOMParser().parseFromString(resolved, "text/html");
  for (const element of [...document.body.querySelectorAll("*")]) {
    if (!ALLOWED_TAGS.has(element.tagName)) { element.replaceWith(...element.childNodes); continue; }
    for (const attribute of [...element.attributes]) {
      if (element.tagName === "A" && attribute.name === "href") {
        try { const url = new URL(attribute.value, window.location.origin); if (!["http:", "https:"].includes(url.protocol)) element.removeAttribute(attribute.name); }
        catch { element.removeAttribute(attribute.name); }
      } else element.removeAttribute(attribute.name);
    }
    if (element.tagName === "A") {
      const href = element.getAttribute("href") ?? "";
      if (!href.startsWith("#") && !href.startsWith("/")) { element.setAttribute("rel", "noreferrer"); element.setAttribute("target", "_blank"); }
    }
  }
  return document.body.innerHTML;
}

export function validateBindings(markup: string) {
  const invalid = [...markup.matchAll(BINDING_PATTERN)].map((match) => match[1]).filter((name) => !ALLOWED_BINDINGS.has(name));
  if (invalid.length) throw new Error(`Unsupported bindings: ${[...new Set(invalid)].join(", ")}.`);
}
