export type RecommendationQueryScope = "catalog" | "creator";

type RecommendationCandidate = {
  title: string;
  developer: string;
  publisher: string;
  genres: string[];
  tags: string[];
  intentFit?: number | null;
  tagCoverage?: number | null;
};

export type SimilarityRecoveryAction = {
  action: "retry_as_similarity";
  query: "";
  queryScope: "catalog";
  reference: string;
  includeTags?: string[];
  preferredTags?: string[];
};

const QUERY_FILLER = new Set([
  "a", "an", "are", "best", "by", "created", "developed", "find", "for", "from", "game", "games", "get",
  "give", "is", "made", "me", "my", "next", "of", "please", "published", "show", "that", "the", "to", "with",
]);

const CREATOR_QUERY = /\b(?:developer|developers|publisher|publishers|studio|studios)\b|\b(?:made|created|developed|published)\s+by\b/i;

const REFERENCE_PROFILES: Record<string, { includeTags: string[]; preferredTags: string[] }> = {
  "super mario": {
    includeTags: ["Platformer", "3D Platformer", "2D Platformer"],
    preferredTags: ["Family Friendly", "Colorful", "Controller"],
  },
};

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function queryTerms(value: string) {
  const tokens = normalize(value).split(/\s+/).filter(Boolean);
  const meaningful = tokens.filter((token) => !QUERY_FILLER.has(token));
  return meaningful.length ? meaningful : tokens;
}

function matchesTerms(values: string[], terms: string[]) {
  if (!terms.length) return false;
  const haystack = normalize(values.join(" "));
  return terms.every((term) => haystack.includes(term));
}

export function resolveRecommendationQueryScope(value: unknown, query: string): RecommendationQueryScope {
  if (value === "creator") return "creator";
  if (value === "catalog") return "catalog";
  return CREATOR_QUERY.test(query) ? "creator" : "catalog";
}

export function qualifyRecommendationCandidates<T extends RecommendationCandidate>(
  games: T[],
  request: { query: string; queryScope: RecommendationQueryScope; hasIntentSignals: boolean },
) {
  const terms = queryTerms(request.query);
  if (!terms.length && !request.hasIntentSignals) return games;

  return games.flatMap((game) => {
    let intentFit = Number(game.intentFit ?? 0);
    let tagCoverage = Number(game.tagCoverage ?? 0);

    if (!request.hasIntentSignals && terms.length) {
      const catalogMatch = matchesTerms([game.title, ...game.genres, ...game.tags], terms);
      const creatorMatch = matchesTerms([game.developer, game.publisher], terms);
      const literalMatch = request.queryScope === "creator" ? creatorMatch : catalogMatch;
      if (literalMatch) intentFit = Math.max(intentFit, 1);
      if (catalogMatch && matchesTerms([...game.genres, ...game.tags], terms)) tagCoverage = Math.max(tagCoverage, 1);
    }

    if (intentFit <= 0 && tagCoverage <= 0) return [];
    return [{ ...game, intentFit, tagCoverage }];
  });
}

export function similarityProfileForReference(reference: string) {
  return REFERENCE_PROFILES[normalize(reference)] ?? null;
}

export function buildSimilarityRecoveryAction(query: string): SimilarityRecoveryAction {
  const terms = queryTerms(query);
  const marioRequest = terms.length === 1 && terms[0] === "mario";
  const reference = marioRequest ? "Super Mario" : terms.join(" ") || query.trim() || "the requested game";
  const profile = similarityProfileForReference(reference);
  return {
    action: "retry_as_similarity",
    query: "",
    queryScope: "catalog",
    reference,
    ...(profile ? { includeTags: profile.includeTags, preferredTags: profile.preferredTags } : {}),
  };
}
