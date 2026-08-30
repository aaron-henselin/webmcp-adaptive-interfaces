import { NextResponse } from "next/server";
import { catalogDb } from "@/app/server/catalog-db";

export const runtime = "edge";

const PRICE_BAND_SQL = `CASE
  WHEN g.price_cents = 0 THEN 'Free'
  WHEN g.price_cents < 1000 THEN 'Under $10'
  WHEN g.price_cents < 3000 THEN '$10–$29.99'
  WHEN g.price_cents < 6000 THEN '$30–$59.99'
  ELSE '$60+'
END`;

const REVIEW_BAND_SQL = `CASE
  WHEN g.positive_ratio IS NULL THEN 'No reviews'
  WHEN g.positive_ratio >= 0.95 THEN '95%+ positive'
  WHEN g.positive_ratio >= 0.9 THEN '90–94% positive'
  WHEN g.positive_ratio >= 0.8 THEN '80–89% positive'
  WHEN g.positive_ratio >= 0.7 THEN '70–79% positive'
  ELSE 'Below 70%'
END`;

const SORT_FIELDS = {
  ownersMax: "g.owners_max",
  title: "g.name COLLATE NOCASE",
  priceCents: "g.price_cents",
  positiveRatio: "g.positive_ratio",
  ccu: "g.peak_ccu",
} as const;

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function ftsQuery(value: string) {
  return (value.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
}

function filters(params: URLSearchParams) {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  const search = ftsQuery((params.get("search") ?? "").slice(0, 120));
  const ownerBand = (params.get("ownerBand") ?? "All owner ranges").slice(0, 40);
  const priceBand = (params.get("priceBand") ?? "All prices").slice(0, 30);
  if (search) {
    clauses.push("g.app_id IN (SELECT CAST(app_id AS INTEGER) FROM game_search WHERE game_search MATCH ?)");
    values.push(search);
  }
  if (ownerBand !== "All owner ranges") {
    clauses.push("g.owners = ?");
    values.push(ownerBand);
  }
  if (priceBand !== "All prices") {
    clauses.push(`${PRICE_BAND_SQL} = ?`);
    values.push(priceBand);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

function parseJsonArray(value: unknown) {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = boundedInteger(url.searchParams.get("page"), 0, 0, 100_000);
    const pageSize = boundedInteger(url.searchParams.get("pageSize"), 12, 1, 100);
    const sort = url.searchParams.get("sort") as keyof typeof SORT_FIELDS;
    const sortSql = SORT_FIELDS[sort] ?? SORT_FIELDS.ownersMax;
    const direction = url.searchParams.get("direction") === "asc" ? "ASC" : "DESC";
    const where = filters(url.searchParams);
    const database = catalogDb();
    const pageSql = `SELECT
      g.app_id AS id,
      g.name AS title,
      g.header_image AS headerImage,
      COALESCE((SELECT group_concat(name, ', ') FROM (SELECT d.name FROM game_developers gd JOIN developers d ON d.id = gd.developer_id WHERE gd.app_id = g.app_id ORDER BY d.name)), 'Unknown developer') AS developer,
      COALESCE((SELECT group_concat(name, ', ') FROM (SELECT p.name FROM game_publishers gp JOIN publishers p ON p.id = gp.publisher_id WHERE gp.app_id = g.app_id ORDER BY p.name)), 'Unknown publisher') AS publisher,
      g.owners,
      g.owners_min AS ownersMin,
      g.owners_max AS ownersMax,
      g.price_cents AS priceCents,
      g.price_cents AS initialPriceCents,
      g.discount_percent AS discountPercent,
      g.positive,
      g.negative,
      g.review_count AS reviewCount,
      g.positive_ratio AS positiveRatio,
      g.peak_ccu AS ccu,
      g.average_forever AS averageForever,
      g.average_2weeks AS average2Weeks,
      g.median_forever AS medianForever,
      g.median_2weeks AS median2Weeks,
      g.release_date AS releaseDate,
      g.release_year AS releaseYear,
      COALESCE((SELECT json_group_array(name) FROM (SELECT ge.name FROM game_genres gg JOIN genres ge ON ge.id = gg.genre_id WHERE gg.app_id = g.app_id ORDER BY ge.name)), '[]') AS genres,
      COALESCE((SELECT json_group_array(name) FROM (SELECT t.name FROM game_tags gt JOIN tags t ON t.id = gt.tag_id WHERE gt.app_id = g.app_id ORDER BY gt.weight DESC, t.name LIMIT 12)), '[]') AS tags
    FROM games g
    ${where.sql}
    ORDER BY ${sortSql} ${direction}, g.app_id ASC
    LIMIT ? OFFSET ?`;

    const statements = [
      database.prepare(`SELECT COUNT(*) AS total FROM games g ${where.sql}`).bind(...where.values),
      database.prepare(pageSql).bind(...where.values, pageSize, page * pageSize),
      database.prepare("SELECT schema_version AS schemaVersion, source_filename AS sourceFilename, source_sha256 AS sourceSha256, imported_at AS importedAt, record_count AS recordCount FROM catalog_imports ORDER BY id DESC LIMIT 1"),
      database.prepare(`SELECT g.owners AS label, COUNT(*) AS value FROM games g ${where.sql} GROUP BY g.owners ORDER BY MAX(g.owners_max) DESC`).bind(...where.values),
      database.prepare(`SELECT ${REVIEW_BAND_SQL} AS label, COUNT(*) AS value FROM games g ${where.sql} GROUP BY label ORDER BY MIN(CASE label WHEN '95%+ positive' THEN 1 WHEN '90–94% positive' THEN 2 WHEN '80–89% positive' THEN 3 WHEN '70–79% positive' THEN 4 WHEN 'Below 70%' THEN 5 ELSE 6 END)`).bind(...where.values),
      database.prepare(`SELECT ${PRICE_BAND_SQL} AS label, COUNT(*) AS value FROM games g ${where.sql} GROUP BY label ORDER BY MIN(g.price_cents)`).bind(...where.values),
      database.prepare("SELECT ge.name AS label, COUNT(*) AS value FROM game_genres gg JOIN genres ge ON ge.id = gg.genre_id GROUP BY ge.id ORDER BY value DESC, ge.name LIMIT 40"),
      database.prepare("SELECT t.name AS label, COUNT(*) AS value FROM game_tags gt JOIN tags t ON t.id = gt.tag_id GROUP BY t.id ORDER BY value DESC, t.name LIMIT 60"),
    ];
    const [countResult, gamesResult, importResult, ownersResult, reviewsResult, priceResult, genresResult, tagsResult] = await database.batch(statements);
    const total = Number((countResult.results[0] as { total?: number } | undefined)?.total ?? 0);
    const imported = importResult.results[0] as Record<string, unknown> | undefined;
    const games = (gamesResult.results as Array<Record<string, unknown>>).map((game) => ({ ...game, genres: parseJsonArray(game.genres), tags: parseJsonArray(game.tags) }));
    return NextResponse.json({
      schemaVersion: "steam-desk.catalog-page/v1",
      meta: {
        recordCount: Number(imported?.recordCount ?? total),
        importedAt: String(imported?.importedAt ?? ""),
        sourceFilename: String(imported?.sourceFilename ?? "games.json"),
        sourceSha256: String(imported?.sourceSha256 ?? ""),
      },
      query: { total, page, pageSize },
      games,
      distributions: { owners: ownersResult.results, reviews: reviewsResult.results, price: priceResult.results },
      facets: { genres: genresResult.results, tags: tagsResult.results },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Catalog query failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
