import { NextResponse } from "next/server";
import { normalizeEngagementAnalyticsBinding } from "@/app/engagement-analytics";
import { catalogDb } from "@/app/server/catalog-db";
import { compileEngagementReport } from "@/app/server/engagement-report";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const binding = normalizeEngagementAnalyticsBinding(await request.json());
    if (!binding) return NextResponse.json({ error: "Invalid customer engagement report definition." }, { status: 400 });
    const compiled = compileEngagementReport(binding);
    const result = await catalogDb().prepare(compiled.sql).bind(...compiled.values).all<Record<string, unknown>>();
    return NextResponse.json({ schemaVersion: "adaptive-interfaces.engagement-report-data/v1", rows: result.results, rowCount: result.results.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Customer engagement report execution failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
