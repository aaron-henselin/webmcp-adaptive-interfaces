import { NextResponse } from "next/server";
import { normalizeCatalogAnalyticsBinding } from "@/app/catalog-analytics";
import { catalogDb } from "@/app/server/catalog-db";
import { compileCatalogReport } from "@/app/server/catalog-report";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const binding = normalizeCatalogAnalyticsBinding(body);
    if (!binding) return NextResponse.json({ error: "Invalid catalog report definition." }, { status: 400 });
    const compiled = compileCatalogReport(binding);
    const result = await catalogDb().prepare(compiled.sql).bind(...compiled.values).all<Record<string, unknown>>();
    return NextResponse.json({ schemaVersion: "adaptive-interfaces.report-data/v1", rows: result.results, rowCount: result.results.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report execution failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
