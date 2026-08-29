import type { EngagementAnalyticsBinding, EngagementSourceFilters } from "./engagement-analytics";

export type EngagementMetric = {
  key: "totalUsers" | "activeSessions" | "conversionRate" | "averageDurationSeconds";
  label: string;
  value: number;
  change: number;
  format: "integer" | "percent" | "duration";
};

export type EngagementDashboard = {
  schemaVersion: "steam-desk.engagement-dashboard/v1";
  filters: EngagementSourceFilters;
  comparison: { dateFrom: string; dateTo: string };
  metrics: EngagementMetric[];
  engagement: Array<{ sessionDate: string; activeUsers: number }>;
  funnel: Array<{ stage: string; stageOrder: number; users: number }>;
  devices: Array<{ deviceType: string; sessions: number }>;
  recentUsers: Array<{
    userId: number;
    firstName: string;
    lastName: string;
    email: string;
    customerStatus: string;
    city: string;
    region: string;
    startedAt: string;
  }>;
  options: {
    shops: string[];
    suppliers: string[];
    productCategories: string[];
    brands: string[];
    productClasses: string[];
  };
};

function appendList(params: URLSearchParams, name: string, values: string[]) {
  for (const value of values) params.append(name, value);
}

export async function loadEngagementDashboard(filters: EngagementSourceFilters, signal?: AbortSignal) {
  const params = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  appendList(params, "shop", filters.shops);
  appendList(params, "supplier", filters.suppliers);
  appendList(params, "productCategory", filters.productCategories);
  appendList(params, "brand", filters.brands);
  appendList(params, "productClass", filters.productClasses);
  appendList(params, "sex", filters.sexes);
  appendList(params, "customerType", filters.customerTypes);
  appendList(params, "device", filters.devices);
  const response = await fetch("/api/engagement?" + params, { signal, cache: "no-store" });
  const value = await response.json() as EngagementDashboard | { error?: string };
  if (!response.ok || !("metrics" in value)) throw new Error("error" in value && value.error ? value.error : "Customer engagement request failed with status " + response.status + ".");
  return value;
}

export async function executeEngagementReport(binding: EngagementAnalyticsBinding, signal?: AbortSignal) {
  const response = await fetch("/api/engagement/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(binding),
    signal,
  });
  const value = await response.json() as { rows?: Record<string, unknown>[]; error?: string };
  if (!response.ok || !Array.isArray(value.rows)) throw new Error(value.error || "Customer engagement report failed with status " + response.status + ".");
  return value.rows;
}
