import { env } from "cloudflare:workers";

export function catalogDb() {
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) throw new Error("The DB binding is unavailable.");
  return database;
}
