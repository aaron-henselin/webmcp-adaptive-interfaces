import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import process from "node:process";

const input = path.resolve(process.argv[2] ?? "work/steam-catalog/import.sql");
const outputDirectory = path.resolve(process.argv[3] ?? "work/steam-catalog/chunks");
const maximumBytes = Number.parseInt(process.env.D1_IMPORT_CHUNK_BYTES ?? "500000", 10);

if (!Number.isInteger(maximumBytes) || maximumBytes < 100_000) throw new Error("D1_IMPORT_CHUNK_BYTES must be at least 100000.");
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

let chunkIndex = 0;
let chunkBytes = 0;
let statement = "";
let output;
const manifest = [];

async function openChunk() {
  chunkIndex += 1;
  const filename = `${String(chunkIndex).padStart(4, "0")}.sql`;
  const filePath = path.join(outputDirectory, filename);
  output = createWriteStream(filePath, { encoding: "utf8" });
  chunkBytes = 0;
  manifest.push({ filename, bytes: 0, sha256: "" });
}

async function closeChunk() {
  if (!output) return;
  output.end();
  await new Promise((resolve, reject) => { output.on("finish", resolve); output.on("error", reject); });
  const current = manifest.at(-1);
  current.bytes = chunkBytes;
  current.sha256 = createHash("sha256").update(await import("node:fs/promises").then(({ readFile }) => readFile(path.join(outputDirectory, current.filename)))).digest("hex");
  output = undefined;
}

async function writeStatement(value) {
  const bytes = Buffer.byteLength(value);
  if (!output) await openChunk();
  if (chunkBytes && chunkBytes + bytes > maximumBytes) { await closeChunk(); await openChunk(); }
  if (!output.write(value)) await new Promise((resolve) => output.once("drain", resolve));
  chunkBytes += bytes;
}

const lines = createInterface({ input: createReadStream(input, "utf8"), crlfDelay: Infinity });
for await (const line of lines) {
  statement += `${line}\n`;
  if (line.trimEnd().endsWith(";")) { await writeStatement(statement); statement = ""; }
}
if (statement.trim()) await writeStatement(statement);
await closeChunk();
await writeFile(path.join(outputDirectory, "manifest.json"), `${JSON.stringify({ source: input, maximumBytes, chunks: manifest }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputDirectory, chunks: manifest.length, bytes: manifest.reduce((sum, item) => sum + item.bytes, 0) }, null, 2));
