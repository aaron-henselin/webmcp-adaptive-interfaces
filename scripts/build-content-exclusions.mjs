import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { collectSexualContentExclusions, SEXUAL_CONTENT_POLICY_VERSION } from "./catalog-content-policy.mjs";

const input = path.resolve(process.argv[2] ?? "data/steam-catalog/raw/games.json");
const output = path.resolve(process.argv[3] ?? "drizzle/0204_exclude_sexual_content.sql");
const exclusions = await collectSexualContentExclusions(input);
const rows = [...exclusions].sort(([left], [right]) => left - right);
const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const chunks = [];
for (let index = 0; index < rows.length; index += 500) chunks.push(rows.slice(index, index + 500));

const statements = [
  "CREATE TABLE catalog_content_exclusions (app_id integer PRIMARY KEY NOT NULL, reason text NOT NULL, policy_version integer NOT NULL);",
  ...chunks.map((chunk) => `INSERT INTO catalog_content_exclusions (app_id, reason, policy_version) VALUES\n${chunk.map(([appId, signals]) => `(${appId},${sql(signals.join(","))},${SEXUAL_CONTENT_POLICY_VERSION})`).join(",\n")};`),
  "DELETE FROM engagement_sessions WHERE app_id IN (SELECT app_id FROM catalog_content_exclusions);",
  "DELETE FROM game_search WHERE CAST(app_id AS INTEGER) IN (SELECT app_id FROM catalog_content_exclusions);",
  "DELETE FROM game_languages WHERE app_id IN (SELECT app_id FROM catalog_content_exclusions);",
  "DELETE FROM game_tags WHERE app_id IN (SELECT app_id FROM catalog_content_exclusions);",
  "DELETE FROM game_categories WHERE app_id IN (SELECT app_id FROM catalog_content_exclusions);",
  "DELETE FROM game_genres WHERE app_id IN (SELECT app_id FROM catalog_content_exclusions);",
  "DELETE FROM game_publishers WHERE app_id IN (SELECT app_id FROM catalog_content_exclusions);",
  "DELETE FROM game_developers WHERE app_id IN (SELECT app_id FROM catalog_content_exclusions);",
  "DELETE FROM games WHERE app_id IN (SELECT app_id FROM catalog_content_exclusions);",
  "DELETE FROM company_search_grams;",
  "DELETE FROM company_search;",
  "DELETE FROM companies;",
  [
    "WITH company_names AS (SELECT name FROM developers UNION SELECT name FROM publishers)",
    "INSERT INTO companies (id, name, is_developer, is_publisher, game_count)",
    "SELECT ROW_NUMBER() OVER (ORDER BY lower(company_names.name), company_names.name), company_names.name,",
    "EXISTS(SELECT 1 FROM game_developers JOIN developers ON developers.id = game_developers.developer_id WHERE developers.name = company_names.name),",
    "EXISTS(SELECT 1 FROM game_publishers JOIN publishers ON publishers.id = game_publishers.publisher_id WHERE publishers.name = company_names.name),",
    "(SELECT COUNT(*) FROM (",
    "SELECT game_developers.app_id FROM game_developers JOIN developers ON developers.id = game_developers.developer_id WHERE developers.name = company_names.name",
    "UNION SELECT game_publishers.app_id FROM game_publishers JOIN publishers ON publishers.id = game_publishers.publisher_id WHERE publishers.name = company_names.name",
    ") company_games)",
    "FROM company_names WHERE EXISTS(SELECT 1 FROM game_developers JOIN developers ON developers.id = game_developers.developer_id WHERE developers.name = company_names.name)",
    "OR EXISTS(SELECT 1 FROM game_publishers JOIN publishers ON publishers.id = game_publishers.publisher_id WHERE publishers.name = company_names.name);",
  ].join("\n"),
  "INSERT INTO company_search (company_id, name) SELECT id, name FROM companies;",
  [
    "WITH RECURSIVE company_grams(company_id, name, position) AS (",
    "SELECT id, lower(trim(name)), 1 FROM companies WHERE length(trim(name)) >= 3",
    "UNION ALL SELECT company_id, name, position + 1 FROM company_grams WHERE position + 2 < length(name)",
    ") INSERT OR IGNORE INTO company_search_grams (company_id, gram)",
    "SELECT company_id, substr(name, position, 3) FROM company_grams;",
  ].join("\n"),
  "UPDATE catalog_imports SET schema_version = 3, record_count = (SELECT COUNT(*) FROM games);",
  "PRAGMA optimize;",
  "",
];

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, statements.join("\n"), "utf8");
console.log(JSON.stringify({ input, output, policyVersion: SEXUAL_CONTENT_POLICY_VERSION, exclusions: rows.length }, null, 2));
