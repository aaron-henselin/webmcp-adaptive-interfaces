import { NextResponse } from "next/server";
import { catalogDb } from "@/app/server/catalog-db";

export const runtime = "edge";

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function ftsQuery(value: string) {
  return (value.match(/[\p{L}\p{N}]+/gu) ?? [])
    .slice(0, 8)
    .map((token) => '"' + token.replaceAll('"', '""') + '"*')
    .join(" AND ");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("query") ?? "").trim().slice(0, 120);
    const search = ftsQuery(query);
    const limit = boundedInteger(url.searchParams.get("limit"), 8, 1, 12);
    if (!search) return NextResponse.json({ schemaVersion: "steam-desk.company-search/v1", query, candidates: [] });

    const result = await catalogDb().prepare([
      "SELECT c.id, c.name,",
      "c.is_developer AS isDeveloper, c.is_publisher AS isPublisher,",
      "c.game_count AS gameCount",
      "FROM company_search",
      "JOIN companies c ON c.id = CAST(company_search.company_id AS INTEGER)",
      "WHERE company_search MATCH ?",
      "ORDER BY CASE WHEN lower(c.name) = lower(?) THEN 0 ELSE 1 END,",
      "bm25(company_search), c.game_count DESC, c.name COLLATE NOCASE",
      "LIMIT ?",
    ].join(" ")).bind(search, query, limit).all<Record<string, unknown>>();

    const candidates = result.results.map((company) => ({
      id: Number(company.id),
      name: String(company.name),
      roles: [company.isDeveloper ? "developer" : null, company.isPublisher ? "publisher" : null].filter(Boolean),
      gameCount: Number(company.gameCount),
    }));
    return NextResponse.json({ schemaVersion: "steam-desk.company-search/v1", query, candidates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Company search failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
