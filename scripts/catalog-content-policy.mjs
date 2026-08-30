import { createReadStream } from "node:fs";
import parserStream from "stream-json";
import streamObject from "stream-json/streamers/stream-object.js";

export const SEXUAL_CONTENT_POLICY_VERSION = 1;

const SEXUAL_CONTENT_TAGS = new Set([
  "hentai",
  "nsfw",
  "nudity",
  "sexual content",
]);

const SEXUAL_CONTENT_NOTE = /\b(?:sex(?:ual(?:ized|ization|ly)?|y)?|nud(?:e|ity)|erotic(?:a|ism)?|porn(?:ographic|ography)?|hentai|nsfw)\b/i;

function normalizedTagNames(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return [];
  return Object.keys(value).map((name) => name.trim().toLocaleLowerCase("en-US"));
}

export function sexualContentSignals(value) {
  const source = value && typeof value === "object" ? value : {};
  const signals = normalizedTagNames(source.tags)
    .filter((name) => SEXUAL_CONTENT_TAGS.has(name))
    .map((name) => `tag:${name}`);
  if (SEXUAL_CONTENT_NOTE.test(String(source.notes ?? ""))) signals.push("mature-content-note");
  return [...new Set(signals)];
}

export function hasSexualContent(value) {
  return sexualContentSignals(value).length > 0;
}

export async function collectSexualContentExclusions(input) {
  const exclusions = new Map();
  const pipeline = createReadStream(input).pipe(parserStream()).pipe(streamObject.asStream());
  for await (const entry of pipeline) {
    const appId = Number.parseInt(String(entry.key), 10);
    if (!Number.isInteger(appId) || appId <= 0) continue;
    const signals = sexualContentSignals(entry.value);
    if (signals.length) exclusions.set(appId, signals);
  }
  return exclusions;
}
