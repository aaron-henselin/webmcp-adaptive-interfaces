import { NextResponse } from "next/server";
import {
  DEFAULT_ENGAGEMENT_FILTERS,
  normalizeEngagementFilters,
  type EngagementAnalyticsBinding,
  type EngagementAnalyticsOperation,
  type EngagementSourceFilters,
} from "@/app/engagement-analytics";
import { catalogDb } from "@/app/server/catalog-db";
import { compileEngagementReport } from "@/app/server/engagement-report";

export const runtime = "edge";

function multi(params: URLSearchParams, name: string) {
  return params.getAll(name).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
}

function filtersFromParams(params: URLSearchParams) {
  return normalizeEngagementFilters({
    dateFrom: params.get("dateFrom") ?? DEFAULT_ENGAGEMENT_FILTERS.dateFrom,
    dateTo: params.get("dateTo") ?? DEFAULT_ENGAGEMENT_FILTERS.dateTo,
    shops: multi(params, "shop"),
    suppliers: multi(params, "supplier"),
    productCategories: multi(params, "productCategory"),
    brands: multi(params, "brand"),
    productClasses: multi(params, "productClass"),
    sexes: multi(params, "sex"),
    customerTypes: multi(params, "customerType"),
    devices: multi(params, "device"),
  });
}

function shiftedPreviousPeriod(filters: EngagementSourceFilters) {
  const from = new Date(filters.dateFrom + "T00:00:00Z");
  const to = new Date(filters.dateTo + "T00:00:00Z");
  const day = 86_400_000;
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / day) + 1);
  const previousTo = new Date(from.getTime() - day);
  const previousFrom = new Date(previousTo.getTime() - (days - 1) * day);
  return {
    ...filters,
    dateFrom: previousFrom.toISOString().slice(0, 10),
    dateTo: previousTo.toISOString().slice(0, 10),
  };
}

function binding(
  filters: EngagementSourceFilters,
  view: "sessions" | "funnel",
  pipeline: EngagementAnalyticsOperation[],
  encoding: EngagementAnalyticsBinding["encoding"] = { hover: [] },
): EngagementAnalyticsBinding {
  return { source: { name: "customer_engagement", view, inheritPageFilters: false, filters }, pipeline, encoding, resultLimit: 2_000 };
}

const metricPipeline: EngagementAnalyticsOperation[] = [
  { operation: "aggregate", measures: [
    { function: "distinct", field: "userId", as: "totalUsers" },
    { function: "count", as: "activeSessions" },
    { function: "sum", field: "subscribed", as: "subscribedSessions" },
    { function: "mean", field: "durationSeconds", as: "averageDurationSeconds" },
  ] },
  { operation: "calculate", as: "conversionRatio", operator: "divide", left: "subscribedSessions", right: { field: "activeSessions" } },
  { operation: "calculate", as: "conversionRate", operator: "multiply", left: "conversionRatio", right: { value: 100 } },
];

function percentChange(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return (current - previous) / previous * 100;
}

export async function GET(request: Request) {
  try {
    const filters = filtersFromParams(new URL(request.url).searchParams);
    const previousFilters = shiftedPreviousPeriod(filters);
    const reports = [
      binding(filters, "sessions", metricPipeline),
      binding(previousFilters, "sessions", metricPipeline),
      binding(filters, "sessions", [
        { operation: "groupBy", fields: ["sessionDate"] },
        { operation: "aggregate", measures: [{ function: "distinct", field: "userId", as: "activeUsers" }] },
        { operation: "sort", fields: [{ field: "sessionDate", direction: "ascending" }] },
      ]),
      binding(filters, "funnel", [
        { operation: "groupBy", fields: ["stage", "stageOrder"] },
        { operation: "aggregate", measures: [{ function: "distinct", field: "userId", as: "users" }] },
        { operation: "sort", fields: [{ field: "stageOrder", direction: "ascending" }] },
      ]),
      binding(filters, "sessions", [
        { operation: "groupBy", fields: ["deviceType"] },
        { operation: "aggregate", measures: [{ function: "count", as: "sessions" }] },
        { operation: "sort", fields: [{ field: "sessions", direction: "descending" }] },
      ]),
      binding(filters, "sessions", [
        { operation: "window", partitionBy: ["userId"], sortBy: [{ field: "startedAt", direction: "descending" }], measures: [{ function: "rowNumber", offset: 1, frame: "partition", rows: 1, as: "recentRank" }] },
        { operation: "filter", field: "recentRank", operator: "equal", value: 1 },
        { operation: "sort", fields: [{ field: "startedAt", direction: "descending" }] },
        { operation: "limit", count: 6 },
      ]),
    ].map(compileEngagementReport);

    const database = catalogDb();
    const statements = [
      ...reports.map((report) => database.prepare(report.sql).bind(...report.values)),
      database.prepare("SELECT name AS label FROM engagement_shops ORDER BY name"),
      database.prepare("SELECT p.name AS label FROM game_publishers gp JOIN publishers p ON p.id = gp.publisher_id GROUP BY p.id ORDER BY COUNT(*) DESC, p.name LIMIT 40"),
      database.prepare("SELECT ge.name AS label FROM game_genres gg JOIN genres ge ON ge.id = gg.genre_id WHERE lower(trim(ge.name)) <> 'sexual content' GROUP BY ge.id ORDER BY COUNT(*) DESC, ge.name LIMIT 40"),
      database.prepare("SELECT d.name AS label FROM game_developers gd JOIN developers d ON d.id = gd.developer_id GROUP BY d.id ORDER BY COUNT(*) DESC, d.name LIMIT 40"),
      database.prepare("SELECT c.name AS label FROM game_categories gc JOIN categories c ON c.id = gc.category_id GROUP BY c.id ORDER BY COUNT(*) DESC, c.name LIMIT 40"),
    ];
    const [currentResult, previousResult, engagementResult, funnelResult, deviceResult, recentResult, shopsResult, suppliersResult, categoriesResult, brandsResult, classesResult] = await database.batch(statements);
    const current = currentResult.results[0] as Record<string, unknown> | undefined;
    const previous = previousResult.results[0] as Record<string, unknown> | undefined;
    const metric = (row: Record<string, unknown> | undefined, key: string) => Number(row?.[key] ?? 0);
    const metricRows = [
      { key: "totalUsers", label: "Total users", value: metric(current, "totalUsers"), change: percentChange(metric(current, "totalUsers"), metric(previous, "totalUsers")), format: "integer" },
      { key: "activeSessions", label: "Active sessions", value: metric(current, "activeSessions"), change: percentChange(metric(current, "activeSessions"), metric(previous, "activeSessions")), format: "integer" },
      { key: "conversionRate", label: "Conversion rate", value: metric(current, "conversionRate"), change: percentChange(metric(current, "conversionRate"), metric(previous, "conversionRate")), format: "percent" },
      { key: "averageDurationSeconds", label: "Avg. session duration", value: metric(current, "averageDurationSeconds"), change: percentChange(metric(current, "averageDurationSeconds"), metric(previous, "averageDurationSeconds")), format: "duration" },
    ];
    const labels = (result: D1Result<unknown>) => result.results.map((row) => String((row as { label?: unknown }).label ?? "")).filter(Boolean);
    return NextResponse.json({
      schemaVersion: "adaptive-interfaces.engagement-dashboard/v1",
      filters,
      comparison: { dateFrom: previousFilters.dateFrom, dateTo: previousFilters.dateTo },
      metrics: metricRows,
      engagement: engagementResult.results,
      funnel: funnelResult.results,
      devices: deviceResult.results,
      recentUsers: recentResult.results,
      options: {
        shops: labels(shopsResult),
        suppliers: labels(suppliersResult),
        productCategories: labels(categoriesResult),
        brands: labels(brandsResult),
        productClasses: labels(classesResult),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Customer engagement data is unavailable.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
