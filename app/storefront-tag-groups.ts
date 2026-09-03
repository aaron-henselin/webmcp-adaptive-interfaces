export type StorefrontTagReferenceSeed = {
  title: string;
  tags: string[];
};

export type StorefrontTagClauseFilter = {
  label?: string;
  all: string[];
  referenceSeeds: StorefrontTagReferenceSeed[];
  minimumSimilarity: number;
};

export type StorefrontTagGroupFilter =
  | { tags: string[]; match: "any" | "all" }
  | { matchAnyClause: StorefrontTagClauseFilter[] };

export type StorefrontTagClauseMatch = {
  clauseIndex: number;
  clauseLabel: string;
  matchedTags: string[];
  matchedReferences: string[];
};

type SqlExpression = { sql: string; values: Array<string | number> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedText(value: unknown, maximum = 80) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
}

function normalizedTags(value: unknown, limit = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => normalizedText(tag))
    .filter(Boolean)
    .filter((tag, index, tags) => tags.findIndex((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index)
    .slice(0, limit);
}

function normalizedReferenceSeeds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((seed): StorefrontTagReferenceSeed[] => {
    if (!isRecord(seed)) return [];
    const title = normalizedText(seed.title, 120);
    const tags = normalizedTags(seed.tags, 5);
    return title && tags.length ? [{ title, tags }] : [];
  }).slice(0, 2);
}

function normalizedClause(value: unknown): StorefrontTagClauseFilter | null {
  if (!isRecord(value)) return null;
  const all = normalizedTags(value.all, 4);
  const referenceSeeds = normalizedReferenceSeeds(value.referenceSeeds);
  if (!all.length && !referenceSeeds.length) return null;
  const requestedSimilarity = typeof value.minimumSimilarity === "number" ? value.minimumSimilarity : 0.6;
  return {
    ...(normalizedText(value.label, 40) ? { label: normalizedText(value.label, 40) } : {}),
    all,
    referenceSeeds,
    minimumSimilarity: Math.min(1, Math.max(0.25, requestedSimilarity)),
  };
}

export function parseStorefrontTagGroupFilters(value: unknown): StorefrontTagGroupFilter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rawFilter): StorefrontTagGroupFilter[] => {
    if (!isRecord(rawFilter)) return [];
    const matchAnyClause = Array.isArray(rawFilter.matchAnyClause)
      ? rawFilter.matchAnyClause.flatMap((clause) => normalizedClause(clause) ?? []).slice(0, 3)
      : [];
    if (matchAnyClause.length) return [{ matchAnyClause }];
    const tags = normalizedTags(rawFilter.tags);
    return tags.length ? [{ tags, match: rawFilter.match === "all" ? "all" : "any" }] : [];
  }).slice(0, 8);
}

function allTagsExpression(tags: string[], alias: string, minimumCount = tags.length): SqlExpression {
  return {
    sql: `g.app_id IN (SELECT ${alias}_gt.app_id FROM game_tags ${alias}_gt JOIN tags ${alias}_t ON ${alias}_t.id = ${alias}_gt.tag_id WHERE LOWER(${alias}_t.name) IN (${tags.map(() => "LOWER(?)").join(", ")}) GROUP BY ${alias}_gt.app_id HAVING COUNT(DISTINCT LOWER(${alias}_t.name)) >= ?)`,
    values: [...tags, minimumCount],
  };
}

export function compileStorefrontTagGroupFilter(filter: StorefrontTagGroupFilter, filterIndex = 0): SqlExpression {
  if ("tags" in filter) {
    if (filter.match === "any") return {
      sql: `g.app_id IN (SELECT legacy_${filterIndex}_gt.app_id FROM game_tags legacy_${filterIndex}_gt JOIN tags legacy_${filterIndex}_t ON legacy_${filterIndex}_t.id = legacy_${filterIndex}_gt.tag_id WHERE LOWER(legacy_${filterIndex}_t.name) IN (${filter.tags.map(() => "LOWER(?)").join(", ")}))`,
      values: filter.tags,
    };
    return allTagsExpression(filter.tags, `legacy_${filterIndex}`);
  }

  const clauseExpressions = filter.matchAnyClause.map((clause, clauseIndex) => {
    const parts: SqlExpression[] = [];
    if (clause.all.length) parts.push(allTagsExpression(clause.all, `clause_${filterIndex}_${clauseIndex}`));
    if (clause.referenceSeeds.length) {
      const references = clause.referenceSeeds.map((seed, referenceIndex) => allTagsExpression(
        seed.tags,
        `reference_${filterIndex}_${clauseIndex}_${referenceIndex}`,
        Math.max(1, Math.ceil(seed.tags.length * clause.minimumSimilarity)),
      ));
      parts.push({
        sql: `(${references.map((reference) => reference.sql).join(" OR ")})`,
        values: references.flatMap((reference) => reference.values),
      });
    }
    return {
      sql: `(${parts.map((part) => part.sql).join(" AND ")})`,
      values: parts.flatMap((part) => part.values),
    };
  });
  return {
    sql: `(${clauseExpressions.map((clause) => clause.sql).join(" OR ")})`,
    values: clauseExpressions.flatMap((clause) => clause.values),
  };
}

export function storefrontTagGroupTags(filters: StorefrontTagGroupFilter[]) {
  return filters.flatMap((filter) => "tags" in filter
    ? filter.tags
    : filter.matchAnyClause.flatMap((clause) => [...clause.all, ...clause.referenceSeeds.flatMap((seed) => seed.tags)]))
    .filter((tag, index, tags) => tags.findIndex((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index);
}

export function findMatchingStorefrontTagClause(
  filter: Extract<StorefrontTagGroupFilter, { matchAnyClause: StorefrontTagClauseFilter[] }>,
  gameTags: string[],
): StorefrontTagClauseMatch | null {
  const canonicalTags = new Map(gameTags.map((tag) => [tag.toLocaleLowerCase(), tag]));
  for (const [clauseIndex, clause] of filter.matchAnyClause.entries()) {
    const requiredMatches = clause.all.flatMap((tag) => canonicalTags.get(tag.toLocaleLowerCase()) ?? []);
    if (requiredMatches.length !== clause.all.length) continue;
    const referenceMatches = clause.referenceSeeds
      .map((seed) => ({
        title: seed.title,
        tags: seed.tags.flatMap((tag) => canonicalTags.get(tag.toLocaleLowerCase()) ?? []),
        minimum: Math.max(1, Math.ceil(seed.tags.length * clause.minimumSimilarity)),
      }))
      .filter((match) => match.tags.length >= match.minimum)
      .sort((left, right) => right.tags.length - left.tags.length);
    if (clause.referenceSeeds.length && !referenceMatches.length) continue;
    const matchedTags = [...requiredMatches, ...(referenceMatches[0]?.tags ?? [])]
      .filter((tag, index, tags) => tags.findIndex((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index);
    return {
      clauseIndex,
      clauseLabel: clause.label ?? `Clause ${clauseIndex + 1}`,
      matchedTags,
      matchedReferences: referenceMatches.map((match) => match.title),
    };
  }
  return null;
}
