type JsonSchema = Record<string, unknown>;

export const REPORT_PRESENTATION_DESCRIPTION =
  "Choose exactly one presentation mode. Metric renders one headline value; table renders rows; chart renders one visualization; narrative renders one written finding; mixed renders exactly one headline metric and one supporting chart. Mixed is not a generic combination and never renders a table.";

export const REPORT_MODE_CATALOG = [
  { mode: "metric", renders: ["headline metric"], useWhen: "The result is one headline value.", requires: ["metric"], excludes: ["table", "narrative", "visualization"] },
  { mode: "table", renders: ["table"], useWhen: "The result is a small set of comparable rows.", requires: ["table"], excludes: ["metric", "narrative", "visualization"] },
  { mode: "chart", renders: ["chart"], useWhen: "A pattern, distribution, or relationship is easier to understand visually.", requires: ["visualization"], excludes: ["metric", "table", "narrative"] },
  { mode: "narrative", renders: ["written finding"], useWhen: "The result is best expressed as a concise written finding.", requires: ["narrative"], excludes: ["metric", "table", "visualization"] },
  { mode: "mixed", renders: ["headline metric", "chart"], useWhen: "One headline value benefits from one supporting chart. Use separate reports or tabs when a table is also needed.", requires: ["metric", "visualization"], excludes: ["table", "narrative"] },
] as const;

type PresentationSchemaParts = {
  metric: JsonSchema;
  tableColumn: JsonSchema;
  visualization: JsonSchema;
};

export function createReportPresentationSchema({ metric, tableColumn, visualization }: PresentationSchemaParts) {
  const table = {
    type: "object",
    additionalProperties: false,
    description: "Columns rendered in a table report.",
    properties: { columns: { type: "array", minItems: 1, maxItems: 8, items: tableColumn } },
    required: ["columns"],
  };
  const narrative = {
    type: "object",
    additionalProperties: false,
    description: "The concise finding rendered by a narrative report.",
    properties: { body: { type: "string", maxLength: 800 } },
    required: ["body"],
  };

  return {
    type: "object",
    description: REPORT_PRESENTATION_DESCRIPTION,
    oneOf: [
      {
        title: "Metric report",
        description: "Renders exactly one headline metric and no chart or table.",
        type: "object",
        additionalProperties: false,
        properties: { mode: { type: "string", const: "metric" }, metric },
        required: ["mode", "metric"],
      },
      {
        title: "Table report",
        description: "Renders rows as a table and no headline metric or chart.",
        type: "object",
        additionalProperties: false,
        properties: { mode: { type: "string", const: "table" }, table },
        required: ["mode", "table"],
      },
      {
        title: "Chart report",
        description: "Renders exactly one chart and no headline metric or table.",
        type: "object",
        additionalProperties: false,
        properties: { mode: { type: "string", const: "chart" }, visualization },
        required: ["mode", "visualization"],
      },
      {
        title: "Narrative report",
        description: "Renders one concise written finding and no metric, table, or chart.",
        type: "object",
        additionalProperties: false,
        properties: { mode: { type: "string", const: "narrative" }, narrative },
        required: ["mode", "narrative"],
      },
      {
        title: "Metric with chart report",
        description: "Renders exactly one headline metric followed by one supporting chart. It never renders a table; create a separate table report or use tabs when tabular detail is needed.",
        type: "object",
        additionalProperties: false,
        properties: { mode: { type: "string", const: "mixed" }, metric, visualization },
        required: ["mode", "metric", "visualization"],
      },
    ],
  };
}

const MODE_FIELDS = {
  metric: ["metric"],
  table: ["table"],
  chart: ["visualization"],
  narrative: ["narrative"],
  mixed: ["metric", "visualization"],
} as const;

export function reportPresentationShapeError(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "A report presentation is required.";
  const presentation = value as Record<string, unknown>;
  const mode = presentation.mode;
  if (typeof mode !== "string" || !Object.hasOwn(MODE_FIELDS, mode)) {
    return "Choose one report presentation mode: metric, table, chart, narrative, or mixed.";
  }

  const required = MODE_FIELDS[mode as keyof typeof MODE_FIELDS];
  const missing = required.filter((field) => !Object.hasOwn(presentation, field));
  if (missing.length) {
    if (mode === "mixed") return "A mixed report requires both a headline metric and a supporting visualization. It never renders a table.";
    return `A ${mode} report requires ${missing.map((field) => `a ${field} definition`).join(" and ")}.`;
  }

  const allowed = new Set<string>(["mode", ...required]);
  const extra = Object.keys(presentation).filter((field) => !allowed.has(field));
  if (!extra.length) return null;
  if (mode === "mixed" && extra.includes("table")) {
    return "A mixed report renders exactly one headline metric and one supporting chart; it does not render a table. Create a separate table report or put the chart and table in separate tabs.";
  }
  return `A ${mode} report accepts only ${["mode", ...required].join(", ")}; remove ${extra.join(", ")}.`;
}
