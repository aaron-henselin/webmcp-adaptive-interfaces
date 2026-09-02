import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSimilarityRecoveryAction,
  catalogQueryForRecommendation,
  qualifyRecommendationCandidates,
  resolveRecommendationQueryScope,
  similarityProfileForReference,
} from "../app/storefront-recommendation-workflow.ts";

const candidate = (overrides = {}) => ({
  title: "Unrelated Quest",
  developer: "Mario Example Studio",
  publisher: "Example Publisher",
  genres: ["Adventure"],
  tags: ["Story Rich"],
  intentFit: 0,
  tagCoverage: 0,
  ...overrides,
});

test("developer-name-only Mario matches do not qualify as game recommendations", () => {
  const qualified = qualifyRecommendationCandidates([candidate()], {
    query: "Mario",
    queryScope: "catalog",
    hasIntentSignals: false,
  });
  assert.equal(qualified.length, 0);
});

test("literal title matches receive a meaningful intent score", () => {
  const qualified = qualifyRecommendationCandidates([candidate({ title: "Mario Adventure" })], {
    query: "Mario",
    queryScope: "catalog",
    hasIntentSignals: false,
  });
  assert.equal(qualified.length, 1);
  assert.equal(qualified[0].intentFit, 1);
});

test("creator requests still qualify developer and publisher matches", () => {
  const query = "find games made by Valve";
  assert.equal(resolveRecommendationQueryScope(undefined, query), "creator");
  assert.equal(catalogQueryForRecommendation(query, "creator"), "valve");
  const qualified = qualifyRecommendationCandidates([candidate({ developer: "Valve" })], {
    query,
    queryScope: "creator",
    hasIntentSignals: false,
  });
  assert.equal(qualified.length, 1);
  assert.equal(qualified[0].intentFit, 1);
});

test("zero-signal candidates do not qualify for semantic retrieval", () => {
  const qualified = qualifyRecommendationCandidates([candidate()], {
    query: "",
    queryScope: "catalog",
    hasIntentSignals: true,
  });
  assert.equal(qualified.length, 0);
});

test("Mario recovery uses a Super Mario similarity profile", () => {
  assert.deepEqual(buildSimilarityRecoveryAction("Find me the best Mario game."), {
    action: "retry_as_similarity",
    query: "",
    queryScope: "catalog",
    reference: "Super Mario",
    includeTags: ["Platformer", "3D Platformer", "2D Platformer"],
    preferredTags: ["Family Friendly", "Colorful", "Controller"],
  });
  assert.ok(similarityProfileForReference("Super Mario"));
});
