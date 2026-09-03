import assert from "node:assert/strict";
import test from "node:test";
import {
  compileStorefrontTagGroupFilter,
  findMatchingStorefrontTagClause,
  parseStorefrontTagGroupFilters,
  storefrontTagGroupTags,
} from "../app/storefront-tag-groups.ts";

const giftFilters = parseStorefrontTagGroupFilters([
  {
    matchAnyClause: [
      { label: "First-person puzzlers", all: ["Puzzle", "First-Person"] },
    ],
  },
  {
    matchAnyClause: [
      { label: "Roguelike deckbuilders", all: ["Roguelike Deckbuilder", "Card Game"] },
      { label: "Sci-fi strategy", all: ["RTS", "Strategy", "Sci-fi"] },
    ],
  },
]);

test("legacy flat any and all groups remain backward compatible", () => {
  const filters = parseStorefrontTagGroupFilters([
    { tags: ["Puzzle", "First-Person"], match: "any" },
    { tags: ["RTS", "Strategy"], match: "all" },
  ]);

  assert.deepEqual(filters, [
    { tags: ["Puzzle", "First-Person"], match: "any" },
    { tags: ["RTS", "Strategy"], match: "all" },
  ]);
  assert.match(compileStorefrontTagGroupFilter(filters[0], 0).sql, /WHERE LOWER/);
  assert.match(compileStorefrontTagGroupFilter(filters[1], 1).sql, /HAVING COUNT/);
});

test("Jason requires a complete clause rather than one generic tag", () => {
  const jason = giftFilters[0];
  assert.ok("matchAnyClause" in jason);
  assert.equal(findMatchingStorefrontTagClause(jason, ["First-Person", "Shooter"]), null);

  const match = findMatchingStorefrontTagClause(jason, ["Atmospheric", "Puzzle", "First-Person"]);
  assert.deepEqual(match, {
    clauseIndex: 0,
    clauseLabel: "First-person puzzlers",
    matchedTags: ["Puzzle", "First-Person"],
    matchedReferences: [],
  });
});

test("Brian accepts either complete archetype and rejects a lone Sci-fi tag", () => {
  const brian = giftFilters[1];
  assert.ok("matchAnyClause" in brian);
  assert.equal(findMatchingStorefrontTagClause(brian, ["Sci-fi", "Battle Royale"]), null);
  assert.equal(findMatchingStorefrontTagClause(brian, ["Card Game", "Roguelike Deckbuilder"])?.clauseLabel, "Roguelike deckbuilders");
  assert.equal(findMatchingStorefrontTagClause(brian, ["Strategy", "Sci-fi", "RTS"])?.clauseLabel, "Sci-fi strategy");

  const compiled = compileStorefrontTagGroupFilter(brian, 1);
  assert.match(compiled.sql, /\) OR \(/);
  assert.match(compiled.sql, /HAVING COUNT/);
  assert.deepEqual(compiled.values, [
    "Roguelike Deckbuilder", "Card Game", 2,
    "RTS", "Strategy", "Sci-fi", 3,
  ]);
});

test("reference clauses use a threshold and explain the satisfied seed", () => {
  const [filter] = parseStorefrontTagGroupFilters([{
    matchAnyClause: [{
      label: "Slay-like",
      all: ["Card Game"],
      referenceSeeds: [{ title: "Slay the Spire", tags: ["Deckbuilding", "Roguelike", "Turn-Based", "Strategy", "Replay Value"] }],
      minimumSimilarity: 0.6,
    }],
  }]);
  assert.ok("matchAnyClause" in filter);
  assert.equal(findMatchingStorefrontTagClause(filter, ["Card Game", "Deckbuilding", "Roguelike"]), null);
  const match = findMatchingStorefrontTagClause(filter, ["Card Game", "Deckbuilding", "Roguelike", "Turn-Based"]);
  assert.equal(match?.clauseLabel, "Slay-like");
  assert.deepEqual(match?.matchedReferences, ["Slay the Spire"]);
  assert.deepEqual(match?.matchedTags, ["Card Game", "Deckbuilding", "Roguelike", "Turn-Based"]);
});

test("overlapping tags across named groups are retained once for explanations", () => {
  assert.deepEqual(storefrontTagGroupTags(giftFilters), [
    "Puzzle",
    "First-Person",
    "Roguelike Deckbuilder",
    "Card Game",
    "RTS",
    "Strategy",
    "Sci-fi",
  ]);
});
