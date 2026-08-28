import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SNAPSHOT = process.env.STEAMSPY_SNAPSHOT ?? "2026-08-27";
const PAGE_COUNT = Number.parseInt(process.env.STEAMSPY_PAGES ?? "3", 10);
const INPUT_DIR = path.resolve("data", "steamspy", "raw", SNAPSHOT, "all");
const OUTPUT_FILE = path.resolve("app", "steamspy-snapshot.json");

if (!Number.isInteger(PAGE_COUNT) || PAGE_COUNT < 1) {
  throw new Error("STEAMSPY_PAGES must be a positive integer.");
}

const parseNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const parseOwners = (owners) => {
  const [minimum = "0", maximum = "0"] = String(owners)
    .split("..")
    .map((part) => part.replaceAll(",", "").trim());
  return [parseNumber(minimum), parseNumber(maximum)];
};

const records = [];
const sourceFiles = [];

for (let page = 0; page < PAGE_COUNT; page += 1) {
  const filename = `page-${String(page).padStart(5, "0")}.json`;
  const filePath = path.join(INPUT_DIR, filename);
  const body = await readFile(filePath, "utf8");
  const payload = JSON.parse(body);
  const games = Object.values(payload);

  if (games.length === 0) {
    throw new Error(`${filename} is empty; refusing to build an incomplete snapshot.`);
  }

  sourceFiles.push({
    page,
    filename,
    records: games.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  });

  for (const game of games) {
    const [ownersMin, ownersMax] = parseOwners(game.owners);
    const positive = parseNumber(game.positive);
    const negative = parseNumber(game.negative);
    const reviewCount = positive + negative;

    records.push({
      id: parseNumber(game.appid),
      title: String(game.name ?? "Unknown game"),
      developer: String(game.developer ?? "Unknown developer") || "Unknown developer",
      publisher: String(game.publisher ?? "Unknown publisher") || "Unknown publisher",
      owners: String(game.owners ?? "0 .. 0"),
      ownersMin,
      ownersMax,
      priceCents: parseNumber(game.price),
      initialPriceCents: parseNumber(game.initialprice),
      discountPercent: parseNumber(game.discount),
      positive,
      negative,
      reviewCount,
      positiveRatio: reviewCount === 0 ? null : Number((positive / reviewCount).toFixed(4)),
      ccu: parseNumber(game.ccu),
      averageForever: parseNumber(game.average_forever),
      average2Weeks: parseNumber(game.average_2weeks),
      medianForever: parseNumber(game.median_forever),
      median2Weeks: parseNumber(game.median_2weeks),
    });
  }
}

const uniqueRecords = [...new Map(records.map((game) => [game.id, game])).values()];

if (uniqueRecords.length !== records.length) {
  throw new Error(`Found ${records.length - uniqueRecords.length} duplicate app ids.`);
}

const snapshot = {
  source: "SteamSpy",
  sourceUrl: "https://steamspy.com/api.php",
  request: "all",
  snapshotDate: SNAPSHOT,
  pageCount: PAGE_COUNT,
  recordCount: uniqueRecords.length,
  sourceFiles,
  games: uniqueRecords,
};

await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
await writeFile(OUTPUT_FILE, `${JSON.stringify(snapshot)}\n`, "utf8");

console.log(
  `Built ${path.relative(process.cwd(), OUTPUT_FILE)} from ${PAGE_COUNT} pages (${uniqueRecords.length} games).`,
);
