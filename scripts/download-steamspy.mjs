#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const API_URL = 'https://steamspy.com/api.php';
const REQUEST_INTERVAL_MS = 63_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

function printHelp() {
  console.log(`Download the SteamSpy catalog as resumable JSON page files.

Usage:
  node scripts/download-steamspy.mjs [options]

Options:
  --snapshot <name>     Snapshot folder. Defaults to today's UTC date.
  --output <path>       Output root. Defaults to data/steamspy/raw.
  --start-page <number> First page to download. Defaults to 0.
  --max-pages <number>  Stop after this many new pages. Useful for testing.
  --help                Show this help.

Examples:
  npm run steamspy:download
  npm run steamspy:download -- --max-pages 1
  npm run steamspy:download -- --snapshot 2026-08-27

SteamSpy's all request is limited to one request per 60 seconds. This script
waits at least 63 seconds between attempts, including retries and restarts.`);
}

function parseInteger(value, option, minimum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${option} must be an integer greater than or equal to ${minimum}.`);
  }
  return parsed;
}

function parseArguments(argv) {
  const options = {
    output: 'data/steamspy/raw',
    snapshot: new Date().toISOString().slice(0, 10),
    startPage: 0,
    maxPages: Number.POSITIVE_INFINITY,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    index += 1;

    if (argument === '--snapshot') options.snapshot = value;
    else if (argument === '--output') options.output = value;
    else if (argument === '--start-page') options.startPage = parseInteger(value, '--start-page', 0);
    else if (argument === '--max-pages') options.maxPages = parseInteger(value, '--max-pages', 1);
    else throw new Error(`Unknown option: ${argument}`);
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(options.snapshot)) {
    throw new Error('--snapshot may only contain letters, numbers, dots, underscores, and hyphens.');
  }
  return options;
}

function pageFileName(page) {
  return `page-${String(page).padStart(5, '0')}.json`;
}

function checksum(text) {
  return createHash('sha256').update(text).digest('hex');
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
}

async function writeJson(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const temporaryPath = `${path}.${process.pid}.partial`;
  await writeFile(temporaryPath, text, 'utf8');
  await rename(temporaryPath, path);
  return text;
}

function createManifest(options) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    source: API_URL,
    request: 'all',
    snapshot: options.snapshot,
    requestIntervalMs: REQUEST_INTERVAL_MS,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    lastRequestStartedAt: null,
    nextPage: options.startPage,
    pages: [],
  };
}

function validateManifest(manifest, options) {
  if (manifest.schemaVersion !== 1 || manifest.source !== API_URL || manifest.request !== 'all') {
    throw new Error('The existing manifest is not a compatible SteamSpy all snapshot.');
  }
  if (manifest.snapshot !== options.snapshot) {
    throw new Error('The existing manifest belongs to a different snapshot.');
  }
  if (manifest.requestIntervalMs !== REQUEST_INTERVAL_MS) {
    throw new Error(`The existing manifest does not use the required ${REQUEST_INTERVAL_MS / 1000}-second interval.`);
  }
}

async function recoverPageFiles(directory, manifest) {
  const names = await readdir(directory);
  const pageNames = names.filter((name) => /^page-\d{5}\.json$/.test(name)).sort();
  const knownPages = new Map((manifest.pages ?? []).map((entry) => [entry.page, entry]));

  for (const name of pageNames) {
    const page = Number(name.slice(5, 10));
    if (knownPages.has(page)) continue;
    const text = await readFile(resolve(directory, name), 'utf8');
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`${name} does not contain a SteamSpy object response.`);
    }
    knownPages.set(page, {
      page,
      file: name,
      fetchedAt: null,
      itemCount: Object.keys(data).length,
      bytes: Buffer.byteLength(text),
      sha256: checksum(text),
      recovered: true,
    });
  }

  manifest.pages = [...knownPages.values()].sort((left, right) => left.page - right.page);
  let nextPage = manifest.nextPage ?? 0;
  while (knownPages.has(nextPage)) nextPage += 1;
  manifest.nextPage = nextPage;
}

async function reserveRequestSlot(manifest, manifestPath) {
  const lastStarted = Date.parse(manifest.lastRequestStartedAt ?? '');
  if (Number.isFinite(lastStarted)) {
    const remaining = REQUEST_INTERVAL_MS - (Date.now() - lastStarted);
    if (remaining > 0) {
      console.log(`Waiting ${Math.ceil(remaining / 1000)} seconds for the SteamSpy cooldown...`);
      await sleep(remaining);
    }
  }

  // Persist before fetching so an immediate restart still honors the cooldown.
  manifest.lastRequestStartedAt = new Date().toISOString();
  manifest.updatedAt = manifest.lastRequestStartedAt;
  await writeJson(manifestPath, manifest);
}

async function fetchPage(page, manifest, manifestPath) {
  const url = `${API_URL}?request=all&page=${page}`;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await reserveRequestSlot(manifest, manifestPath);
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'webmcp-dashboard-steamspy-downloader/1.0',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

      const data = JSON.parse(await response.text());
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('SteamSpy did not return a JSON object.');
      }
      return data;
    } catch (error) {
      lastError = error;
      console.error(`Page ${page}, attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}`);
    }
  }

  throw lastError;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const directory = resolve(options.output, options.snapshot, 'all');
  await mkdir(directory, { recursive: true });
  const manifestPath = resolve(directory, 'manifest.json');
  const existingManifest = await readJson(manifestPath);
  const manifest = existingManifest ?? createManifest(options);
  if (existingManifest) validateManifest(manifest, options);
  await recoverPageFiles(directory, manifest);
  await writeJson(manifestPath, manifest);

  console.log(`Snapshot directory: ${directory}`);
  if (manifest.completedAt) {
    console.log(`Snapshot already completed at ${manifest.completedAt}.`);
    return;
  }

  let page = Math.max(options.startPage, manifest.nextPage ?? options.startPage);
  let downloaded = 0;

  while (downloaded < options.maxPages) {
    console.log(`Downloading SteamSpy all page ${page}...`);
    const data = await fetchPage(page, manifest, manifestPath);
    const itemCount = Object.keys(data).length;

    if (itemCount === 0) {
      manifest.completedAt = new Date().toISOString();
      manifest.updatedAt = manifest.completedAt;
      manifest.nextPage = page;
      await writeJson(manifestPath, manifest);
      console.log(`SteamSpy returned an empty page. Snapshot complete with ${manifest.pages.length} pages.`);
      return;
    }

    const file = pageFileName(page);
    const text = await writeJson(resolve(directory, file), data);
    manifest.pages = [
      ...manifest.pages.filter((entry) => entry.page !== page),
      {
        page,
        file,
        fetchedAt: new Date().toISOString(),
        itemCount,
        bytes: Buffer.byteLength(text),
        sha256: checksum(text),
      },
    ].sort((left, right) => left.page - right.page);
    manifest.nextPage = page + 1;
    manifest.updatedAt = new Date().toISOString();
    await writeJson(manifestPath, manifest);
    console.log(`Saved ${file} with ${itemCount.toLocaleString()} games.`);

    page += 1;
    downloaded += 1;
  }

  console.log(`Stopped after ${downloaded} new page${downloaded === 1 ? '' : 's'}. Run the same command to resume.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
