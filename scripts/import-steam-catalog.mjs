import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import parserStream from "stream-json";
import streamObject from "stream-json/streamers/stream-object.js";
const DEFAULT_INPUT = path.resolve("data", "steam-catalog", "raw", "games.json");
const DEFAULT_OUTPUT = path.resolve("work", "steam-catalog", "import.sql");
const SCHEMA_VERSION = 2;

function parseOptions(argv) {
  const options = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT, profile: false, maxRecords: Infinity };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--profile") options.profile = true;
    else if (argument === "--input") options.input = path.resolve(argv[++index] ?? "");
    else if (argument === "--output") options.output = path.resolve(argv[++index] ?? "");
    else if (argument === "--max-records") options.maxRecords = Number.parseInt(argv[++index] ?? "", 10);
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!Number.isFinite(options.maxRecords) && options.maxRecords !== Infinity) throw new Error("--max-records must be a positive integer.");
  if (options.maxRecords !== Infinity && options.maxRecords < 1) throw new Error("--max-records must be a positive integer.");
  return options;
}

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const integer = (value) => Math.max(0, Math.round(number(value)));
const label = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function strings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(label).filter(Boolean))];
}

function ownerRange(value) {
  const source = String(value ?? "0 - 0").trim() || "0 - 0";
  const [minimumText = "0", maximumText = "0"] = source.split(/\s+-\s+/).map((part) => part.replaceAll(",", ""));
  const minimum = integer(minimumText);
  const maximum = integer(maximumText);
  return { published: `${minimum.toLocaleString("en-US")} .. ${maximum.toLocaleString("en-US")}`, minimum, maximum };
}

function releaseDate(value) {
  const source = String(value ?? "").trim();
  if (!source) return { date: null, year: null };
  const timestamp = Date.parse(source);
  if (!Number.isFinite(timestamp)) return { date: null, year: null };
  const date = new Date(timestamp);
  return { date: date.toISOString().slice(0, 10), year: date.getUTCFullYear() };
}

function tagEntries(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return [];
  return Object.entries(value)
    .map(([name, weight]) => [label(name), integer(weight)])
    .filter(([name]) => Boolean(name));
}

function normalizeGame(key, value) {
  const source = value && typeof value === "object" ? value : {};
  const appId = integer(key);
  const owners = ownerRange(source.estimated_owners);
  const released = releaseDate(source.release_date);
  const positive = integer(source.positive);
  const negative = integer(source.negative);
  const reviewCount = positive + negative;
  const supportedLanguages = strings(source.supported_languages);
  const fullAudioLanguages = new Set(strings(source.full_audio_languages));
  const languageNames = [...new Set([...supportedLanguages, ...fullAudioLanguages])];
  return {
    appId,
    name: String(source.name ?? "Unknown game").trim() || "Unknown game",
    releaseDate: released.date,
    releaseYear: released.year,
    owners: owners.published,
    ownersMin: owners.minimum,
    ownersMax: owners.maximum,
    peakCcu: integer(source.peak_ccu),
    requiredAge: integer(source.required_age),
    priceCents: integer(number(source.price) * 100),
    discountPercent: number(source.discount),
    dlcCount: integer(source.dlc_count),
    metacriticScore: integer(source.metacritic_score),
    userScore: integer(source.user_score),
    positive,
    negative,
    reviewCount,
    positiveRatio: reviewCount ? Number((positive / reviewCount).toFixed(6)) : null,
    achievements: integer(source.achievements),
    recommendations: integer(source.recommendations),
    averageForever: integer(source.average_playtime_forever),
    average2Weeks: integer(source.average_playtime_2weeks),
    medianForever: integer(source.median_playtime_forever),
    median2Weeks: integer(source.median_playtime_2weeks),
    windows: Boolean(source.windows),
    mac: Boolean(source.mac),
    linux: Boolean(source.linux),
    headerImage: String(source.header_image ?? "").trim() || null,
    developers: strings(source.developers),
    publishers: strings(source.publishers),
    genres: strings(source.genres),
    categories: strings(source.categories),
    tags: tagEntries(source.tags),
    languages: languageNames.map((name) => [name, fullAudioLanguages.has(name)]),
  };
}

function createDimensions() {
  const create = () => new Map();
  return { developers: create(), publishers: create(), genres: create(), categories: create(), tags: create(), languages: create() };
}

function dimensionId(map, name) {
  const existing = map.get(name);
  if (existing !== undefined) return existing;
  const id = map.size + 1;
  map.set(name, id);
  return id;
}

async function scan(input, maximum, onGame) {
  const hash = createHash("sha256");
  const inputStream = createReadStream(input);
  inputStream.on("data", (chunk) => hash.update(chunk));
  const pipeline = inputStream.pipe(parserStream()).pipe(streamObject.asStream());
  let count = 0;
  for await (const entry of pipeline) {
    const game = normalizeGame(entry.key, entry.value);
    if (!game.appId) continue;
    await onGame(game);
    count += 1;
    if (count >= maximum) {
      inputStream.destroy();
      break;
    }
  }
  return { count, sha256: maximum === Infinity ? hash.digest("hex") : "partial" };
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''").replaceAll("\u0000", "")}'`;
}

function insert(table, columns, rows) {
  if (!rows.length) return "";
  return `INSERT INTO ${table} (${columns.join(",")}) VALUES\n${rows.map((row) => `(${row.map(sql).join(",")})`).join(",\n")};\n`;
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

async function writeText(stream, value) {
  if (!value) return;
  if (!stream.write(value)) await new Promise((resolve) => stream.once("drain", resolve));
}

function collectStats(stats, game) {
  stats.games += 1;
  stats.gameDevelopers += game.developers.length;
  stats.gamePublishers += game.publishers.length;
  stats.gameGenres += game.genres.length;
  stats.gameCategories += game.categories.length;
  stats.gameTags += game.tags.length;
  stats.gameLanguages += game.languages.length;
  if (!game.releaseDate) stats.missingReleaseDate += 1;
  if (!game.genres.length) stats.missingGenres += 1;
  if (!game.tags.length) stats.missingTags += 1;
}

async function firstPass(options) {
  const dimensions = createDimensions();
  const stats = { games: 0, gameDevelopers: 0, gamePublishers: 0, gameGenres: 0, gameCategories: 0, gameTags: 0, gameLanguages: 0, missingReleaseDate: 0, missingGenres: 0, missingTags: 0 };
  const result = await scan(options.input, options.maxRecords, (game) => {
    collectStats(stats, game);
    for (const name of game.developers) dimensionId(dimensions.developers, name);
    for (const name of game.publishers) dimensionId(dimensions.publishers, name);
    for (const name of game.genres) dimensionId(dimensions.genres, name);
    for (const name of game.categories) dimensionId(dimensions.categories, name);
    for (const [name] of game.tags) dimensionId(dimensions.tags, name);
    for (const [name] of game.languages) dimensionId(dimensions.languages, name);
  });
  return { dimensions, stats, ...result };
}

async function writeDimensions(output, dimensions) {
  for (const [table, values] of Object.entries(dimensions)) {
    for (const rows of chunk([...values].map(([name, id]) => [id, name]), 100)) {
      await writeText(output, insert(table, ["id", "name"], rows));
    }
  }
}

async function writeGameChunk(output, games, dimensions) {
  const gameRows = games.map((game) => [game.appId, game.name, game.releaseDate, game.releaseYear, game.owners, game.ownersMin, game.ownersMax, game.peakCcu, game.requiredAge, game.priceCents, game.discountPercent, game.dlcCount, game.metacriticScore, game.userScore, game.positive, game.negative, game.reviewCount, game.positiveRatio, game.achievements, game.recommendations, game.averageForever, game.average2Weeks, game.medianForever, game.median2Weeks, game.windows, game.mac, game.linux, game.headerImage]);
  await writeText(output, insert("games", ["app_id", "name", "release_date", "release_year", "owners", "owners_min", "owners_max", "peak_ccu", "required_age", "price_cents", "discount_percent", "dlc_count", "metacritic_score", "user_score", "positive", "negative", "review_count", "positive_ratio", "achievements", "recommendations", "average_forever", "average_2weeks", "median_forever", "median_2weeks", "windows", "mac", "linux", "header_image"], gameRows));

  const relationships = [
    ["game_developers", ["app_id", "developer_id"], games.flatMap((game) => game.developers.map((name) => [game.appId, dimensions.developers.get(name)]))],
    ["game_publishers", ["app_id", "publisher_id"], games.flatMap((game) => game.publishers.map((name) => [game.appId, dimensions.publishers.get(name)]))],
    ["game_genres", ["app_id", "genre_id"], games.flatMap((game) => game.genres.map((name) => [game.appId, dimensions.genres.get(name)]))],
    ["game_categories", ["app_id", "category_id"], games.flatMap((game) => game.categories.map((name) => [game.appId, dimensions.categories.get(name)]))],
    ["game_tags", ["app_id", "tag_id", "weight"], games.flatMap((game) => game.tags.map(([name, weight]) => [game.appId, dimensions.tags.get(name), weight]))],
    ["game_languages", ["app_id", "language_id", "full_audio"], games.flatMap((game) => game.languages.map(([name, fullAudio]) => [game.appId, dimensions.languages.get(name), fullAudio]))],
  ];
  for (const [table, columns, rows] of relationships) {
    for (const batch of chunk(rows, 100)) await writeText(output, insert(table, columns, batch));
  }
  for (const rows of chunk(games.map((game) => [game.appId, game.name, game.developers.join(" "), game.publishers.join(" "), game.genres.join(" "), game.tags.map(([name]) => name).join(" ")]), 20)) {
    await writeText(output, insert("game_search", ["app_id", "name", "developers", "publishers", "genres", "tags"], rows));
  }
}

async function buildImport(options, profile) {
  await mkdir(path.dirname(options.output), { recursive: true });
  const output = createWriteStream(options.output, { encoding: "utf8" });
  await writeText(output, "DELETE FROM company_search_grams;\nDELETE FROM company_search;\nDELETE FROM companies;\nDELETE FROM game_search;\nDELETE FROM game_languages;\nDELETE FROM game_tags;\nDELETE FROM game_categories;\nDELETE FROM game_genres;\nDELETE FROM game_publishers;\nDELETE FROM game_developers;\nDELETE FROM games;\nDELETE FROM languages;\nDELETE FROM tags;\nDELETE FROM categories;\nDELETE FROM genres;\nDELETE FROM publishers;\nDELETE FROM developers;\nDELETE FROM catalog_imports;\n");
  await writeDimensions(output, profile.dimensions);
  let pending = [];
  await scan(options.input, options.maxRecords, async (game) => {
    pending.push(game);
    if (pending.length >= 50) {
      await writeGameChunk(output, pending, profile.dimensions);
      pending = [];
    }
  });
  await writeGameChunk(output, pending, profile.dimensions);
  await writeText(output, [
    "WITH company_names AS (",
    "  SELECT name FROM developers",
    "  UNION",
    "  SELECT name FROM publishers",
    ")",
    "INSERT INTO companies (id, name, is_developer, is_publisher, game_count)",
    "SELECT",
    "  ROW_NUMBER() OVER (ORDER BY lower(company_names.name), company_names.name),",
    "  company_names.name,",
    "  EXISTS(SELECT 1 FROM developers WHERE developers.name = company_names.name),",
    "  EXISTS(SELECT 1 FROM publishers WHERE publishers.name = company_names.name),",
    "  (",
    "    SELECT COUNT(*) FROM (",
    "      SELECT game_developers.app_id FROM game_developers JOIN developers ON developers.id = game_developers.developer_id WHERE developers.name = company_names.name",
    "      UNION",
    "      SELECT game_publishers.app_id FROM game_publishers JOIN publishers ON publishers.id = game_publishers.publisher_id WHERE publishers.name = company_names.name",
    "    ) company_games",
    "  )",
    "FROM company_names;",
    "INSERT INTO company_search (company_id, name) SELECT id, name FROM companies;",
    "WITH RECURSIVE company_grams(company_id, name, position) AS (",
    "  SELECT id, lower(trim(name)), 1 FROM companies WHERE length(trim(name)) >= 3",
    "  UNION ALL",
    "  SELECT company_id, name, position + 1 FROM company_grams WHERE position + 2 < length(name)",
    ")",
    "INSERT OR IGNORE INTO company_search_grams (company_id, gram)",
    "SELECT company_id, substr(name, position, 3) FROM company_grams;",
    "",
  ].join("\n"));
  await writeText(output, insert("catalog_imports", ["schema_version", "source_filename", "source_sha256", "imported_at", "record_count"], [[SCHEMA_VERSION, path.basename(options.input), profile.sha256, new Date().toISOString(), profile.count]]));
  await writeText(output, "PRAGMA optimize;\n");
  output.end();
  await new Promise((resolve, reject) => { output.on("finish", resolve); output.on("error", reject); });
  return stat(options.output);
}

const options = parseOptions(process.argv.slice(2));
const profile = await firstPass(options);
const source = await stat(options.input);
const summary = {
  source: options.input,
  sourceBytes: source.size,
  sourceSha256: profile.sha256,
  ...profile.stats,
  dimensions: Object.fromEntries(Object.entries(profile.dimensions).map(([name, values]) => [name, values.size])),
};

if (options.profile) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const output = await buildImport(options, profile);
  console.log(JSON.stringify({ ...summary, output: options.output, outputBytes: output.size }, null, 2));
}
