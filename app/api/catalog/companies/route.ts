import { NextResponse } from "next/server";
import { catalogDb } from "@/app/server/catalog-db";

export const runtime = "edge";

type CompanyCandidate = {
  id: number;
  name: string;
  roles: Array<"developer" | "publisher">;
  gameCount: number;
  similarity: number;
};

const COMPANY_SUFFIXES = new Set(["co", "company", "corp", "corporation", "inc", "incorporated", "limited", "llc", "ltd"]);

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

function normalizedName(value: string) {
  const tokens = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US").match(/[a-z0-9]+/g) ?? [];
  while (tokens.length > 1 && COMPANY_SUFFIXES.has(tokens.at(-1) ?? "")) tokens.pop();
  return tokens.join(" ");
}

function trigrams(value: string) {
  const source = value.toLocaleLowerCase("en-US").trim();
  if (source.length < 3) return [];
  const grams = new Set<string>();
  for (let index = 0; index <= source.length - 3 && grams.size < 48; index += 1) grams.add(source.slice(index, index + 3));
  return [...grams];
}

function editDistance(left: string, right: string) {
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function similarity(query: string, candidate: string) {
  const left = normalizedName(query);
  const right = normalizedName(candidate);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const editScore = 1 - editDistance(left, right) / Math.max(left.length, right.length);
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const contained = [...rightTokens].every((token) => leftTokens.has(token)) || [...leftTokens].every((token) => rightTokens.has(token));
  return Math.max(editScore, contained ? 0.88 : 0);
}

function candidate(value: Record<string, unknown>, query: string): CompanyCandidate {
  const name = String(value.name);
  return {
    id: Number(value.id),
    name,
    roles: [value.isDeveloper ? "developer" as const : null, value.isPublisher ? "publisher" as const : null].filter((role): role is "developer" | "publisher" => role !== null),
    gameCount: Number(value.gameCount),
    similarity: Number(similarity(query, name).toFixed(3)),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("query") ?? "").trim().slice(0, 120);
    const search = ftsQuery(query);
    const limit = boundedInteger(url.searchParams.get("limit"), 8, 1, 12);
    if (!search) return NextResponse.json({ schemaVersion: "adaptive-interfaces.company-search/v2", query, candidates: [], resolution: { status: "not_found", confidence: 0 } });

    const database = catalogDb();
    const exactPromise = database.prepare([
      "SELECT c.id, c.name,",
      "c.is_developer AS isDeveloper, c.is_publisher AS isPublisher,",
      "c.game_count AS gameCount",
      "FROM company_search",
      "JOIN companies c ON c.id = CAST(company_search.company_id AS INTEGER)",
      "WHERE company_search MATCH ?",
      "ORDER BY CASE WHEN lower(c.name) = lower(?) THEN 0 ELSE 1 END,",
      "bm25(company_search), c.game_count DESC, c.name COLLATE NOCASE",
      "LIMIT ?",
    ].join(" ")).bind(search, query, Math.max(limit, 12)).all<Record<string, unknown>>();

    const grams = trigrams(query);
    const fuzzyPromise = grams.length
      ? database.prepare([
          "SELECT c.id, c.name, c.is_developer AS isDeveloper, c.is_publisher AS isPublisher, c.game_count AS gameCount,",
          "COUNT(*) AS overlapCount",
          "FROM company_search_grams grams",
          "JOIN companies c ON c.id = grams.company_id",
          `WHERE grams.gram IN (${grams.map(() => "?").join(", ")})`,
          "GROUP BY c.id, c.name, c.is_developer, c.is_publisher, c.game_count",
          "ORDER BY overlapCount DESC, c.game_count DESC, c.name COLLATE NOCASE",
          "LIMIT 48",
        ].join(" ")).bind(...grams).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[], success: false, meta: {} }))
      : Promise.resolve({ results: [] as Record<string, unknown>[], success: true, meta: {} });

    const [exactResult, fuzzyResult] = await Promise.all([exactPromise, fuzzyPromise]);
    const merged = new Map<number, CompanyCandidate>();
    for (const value of [...exactResult.results, ...fuzzyResult.results]) {
      const item = candidate(value, query);
      const current = merged.get(item.id);
      if (!current || item.similarity > current.similarity) merged.set(item.id, item);
    }
    const ranked = [...merged.values()]
      .filter((item) => item.similarity >= 0.35)
      .sort((left, right) => right.similarity - left.similarity || right.gameCount - left.gameCount || left.name.localeCompare(right.name))
      .slice(0, Math.max(limit, 8));

    const top = ranked[0];
    const runnerUp = ranked[1];
    const exact = ranked.find((item) => normalizedName(item.name) === normalizedName(query));
    const threshold = normalizedName(query).length <= 5 ? 0.78 : 0.82;
    const decisive = top && top.similarity >= threshold && (!runnerUp || top.similarity - runnerUp.similarity >= 0.06);
    const status = exact ? "matched" : decisive ? "corrected" : top && top.similarity >= 0.55 ? "ambiguous" : "not_found";
    const resolved = exact ?? (decisive ? top : undefined);
    const confidence = resolved?.similarity ?? top?.similarity ?? 0;
    const candidates = ranked.slice(0, limit);

    return NextResponse.json({
      schemaVersion: "adaptive-interfaces.company-search/v2",
      query,
      candidates,
      resolution: {
        status,
        confidence,
        company: resolved,
        correctedFrom: status === "corrected" ? query : undefined,
        alternatives: status === "ambiguous" ? candidates.slice(0, 5) : [],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Company search failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
