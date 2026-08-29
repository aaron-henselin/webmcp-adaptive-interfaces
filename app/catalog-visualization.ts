import type { PlotlyFigure, PlotlyTrace } from "./plotly-visualization";

type FigureBinding = {
  encoding: {
    x?: string;
    y?: string;
    labels?: string;
    values?: string;
    text?: string;
    series?: string;
    hover: string[];
  };
};

function clearTraceData(trace: PlotlyTrace) {
  const next: PlotlyTrace = { ...trace };
  delete next.x; delete next.y; delete next.labels; delete next.values; delete next.text; delete next.customdata;
  return next;
}

export function bindCatalogRowsToFigure(figure: PlotlyFigure, binding: FigureBinding, rows: Record<string, unknown>[]) {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = binding.encoding.series ? String(row[binding.encoding.series] ?? "Unspecified") : "";
    const group = grouped.get(key);
    if (group) group.push(row); else grouped.set(key, [row]);
  }
  if (!grouped.size) grouped.set("", []);
  const data = Array.from(grouped.entries()).slice(0, 12).map(([name, groupRows], index) => {
    const namedTemplate = figure.data.find((trace) => typeof trace.name === "string" && trace.name === name);
    const trace = clearTraceData(namedTemplate ?? figure.data[index % figure.data.length] ?? { type: "scatter" });
    if (binding.encoding.series) trace.name = name;
    if (binding.encoding.x) trace.x = groupRows.map((row) => row[binding.encoding.x!]);
    if (binding.encoding.y) trace.y = groupRows.map((row) => row[binding.encoding.y!]);
    if (binding.encoding.labels) trace.labels = groupRows.map((row) => row[binding.encoding.labels!]);
    if (binding.encoding.values) trace.values = groupRows.map((row) => row[binding.encoding.values!]);
    if (binding.encoding.text) trace.text = groupRows.map((row) => String(row[binding.encoding.text!] ?? ""));
    if (binding.encoding.hover.length) trace.customdata = groupRows.map((row) => binding.encoding.hover.map((field) => row[field]));
    return trace;
  });
  return { title: figure.title, description: figure.description, data, layout: figure.layout };
}
