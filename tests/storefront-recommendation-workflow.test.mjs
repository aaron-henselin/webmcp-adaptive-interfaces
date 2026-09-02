import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAndVerifyStorefrontResults,
  buildSimilarityRecoveryAction,
  catalogQueryForRecommendation,
  qualifyRecommendationCandidates,
  resolveRecommendationQueryScope,
  similarityProfileForReference,
  verifyStorefrontApplyReceipt,
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

test("verified A-to-B application replaces the rendered featured recommendation", async () => {
  let visibleStorefront = { recommendationId: "", featuredAppIds: [], featuredTitle: "" };
  const apply = async (recommendationId, featuredAppId, featuredTitle) => {
    visibleStorefront = { recommendationId, featuredAppIds: [featuredAppId], featuredTitle };
    return {
      rendered: true,
      recommendationId,
      featuredAppIds: [featuredAppId],
      visibleAppIds: [featuredAppId],
      summaryVisible: true,
    };
  };

  await applyAndVerifyStorefrontResults(
    { recommendationId: "recommendation-a", expectedFeaturedAppIds: [101] },
    () => apply("recommendation-a", 101, "Recommendation A"),
  );

  const stagedB = { recommendationId: "recommendation-b", status: "staged", requiresApply: true, featuredAppIds: [202], featuredTitle: "Recommendation B" };
  assert.equal(stagedB.status, "staged");
  assert.equal(stagedB.requiresApply, true);
  assert.equal(visibleStorefront.featuredTitle, "Recommendation A", "staging B must not be mistaken for rendering B");

  const receipt = await applyAndVerifyStorefrontResults(
    { recommendationId: stagedB.recommendationId, expectedFeaturedAppIds: stagedB.featuredAppIds },
    () => apply(stagedB.recommendationId, stagedB.featuredAppIds[0], stagedB.featuredTitle),
  );
  assert.equal(receipt.rendered, true);
  assert.equal(receipt.recommendationId, "recommendation-b");
  assert.deepEqual(receipt.featuredAppIds, [202]);
  assert.equal(visibleStorefront.featuredTitle, "Recommendation B");
});

test("apply verification rejects stale recommendation IDs and featured winners", () => {
  const expectation = { recommendationId: "recommendation-b", expectedFeaturedAppIds: [202] };
  assert.throws(() => verifyStorefrontApplyReceipt({
    rendered: false,
    recommendationId: "recommendation-b",
    featuredAppIds: [202],
    visibleAppIds: [202],
    summaryVisible: true,
  }, expectation), /did not confirm/);
  assert.throws(() => verifyStorefrontApplyReceipt({
    rendered: true,
    recommendationId: "recommendation-a",
    featuredAppIds: [101],
    visibleAppIds: [101],
    summaryVisible: true,
  }, expectation), /different recommendation/);
  assert.throws(() => verifyStorefrontApplyReceipt({
    rendered: true,
    recommendationId: "recommendation-b",
    featuredAppIds: [101],
    visibleAppIds: [101],
    summaryVisible: true,
  }, expectation), /do not match/);
});
