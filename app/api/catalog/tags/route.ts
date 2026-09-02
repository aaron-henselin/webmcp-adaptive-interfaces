import { NextResponse } from "next/server";
import { catalogDb } from "@/app/server/catalog-db";

export const runtime = "edge";

function requestedTagNames(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((tag) => String(tag).trim().replace(/\s+/g, " ").slice(0, 80))
      .filter(Boolean)
      .filter((tag, index, tags) => tags.findIndex((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index)
      .slice(0, 96);
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const names = requestedTagNames(new URL(request.url).searchParams.get("names"));
    if (!names.length) return NextResponse.json({ tags: [] });
    const result = await catalogDb().prepare(
      `SELECT name FROM tags WHERE LOWER(name) IN (${names.map(() => "LOWER(?)").join(", ")}) ORDER BY name`,
    ).bind(...names).all<{ name: string }>();
    return NextResponse.json({ tags: result.results.map((tag) => tag.name) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Catalog tag lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
