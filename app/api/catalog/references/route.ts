import { NextResponse } from "next/server";
import { catalogDb } from "@/app/server/catalog-db";

export const runtime = "edge";

const GENERIC_REFERENCE_TAGS = ["Indie", "Singleplayer", "Action", "Adventure", "Casual"];

function requestedReferences(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((reference) => String(reference).trim().replace(/\s+/g, " ").slice(0, 120))
      .filter(Boolean)
      .filter((reference, index, references) => references.findIndex((candidate) => candidate.toLocaleLowerCase() === reference.toLocaleLowerCase()) === index)
      .slice(0, 24);
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const references = requestedReferences(new URL(request.url).searchParams.get("names"));
    if (!references.length) return NextResponse.json({ references: [] });
    const database = catalogDb();
    const gameResults = await database.batch(references.map((reference) => database.prepare(
      `SELECT app_id AS appId, name AS title
       FROM games
       WHERE LOWER(name) = LOWER(?)
       ORDER BY owners_max DESC, app_id ASC
       LIMIT 1`,
    ).bind(reference)));
    const games = gameResults.map((result, index) => {
      const game = result.results[0] as { appId?: number; title?: string } | undefined;
      return game?.appId ? { requested: references[index], appId: Number(game.appId), title: String(game.title ?? references[index]) } : null;
    });
    const resolvedGames = games.filter((game): game is NonNullable<typeof game> => Boolean(game));
    const tagResults = resolvedGames.length ? await database.batch(resolvedGames.map((game) => database.prepare(
      `SELECT t.name
       FROM game_tags gt
       JOIN tags t ON t.id = gt.tag_id
       WHERE gt.app_id = ? AND LOWER(t.name) NOT IN (${GENERIC_REFERENCE_TAGS.map(() => "LOWER(?)").join(", ")})
       ORDER BY gt.weight DESC, t.name
       LIMIT 5`,
    ).bind(game.appId, ...GENERIC_REFERENCE_TAGS))) : [];
    const resolved = resolvedGames.map((game, index) => ({
      requested: game.requested,
      title: game.title,
      tags: (tagResults[index]?.results ?? []).map((tag) => String((tag as { name?: string }).name ?? "")).filter(Boolean),
    })).filter((reference) => reference.tags.length);
    return NextResponse.json({ references: resolved, unresolved: references.filter((reference) => !resolved.some((item) => item.requested.toLocaleLowerCase() === reference.toLocaleLowerCase())) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Catalog reference lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
