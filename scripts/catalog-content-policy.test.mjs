import assert from "node:assert/strict";
import test from "node:test";
import { hasSexualContent, sexualContentSignals } from "./catalog-content-policy.mjs";

test("flags the explicit sexual-content community tags", () => {
  for (const tag of ["Sexual Content", "Nudity", "Hentai", "NSFW"]) {
    assert.equal(hasSexualContent({ tags: { [tag]: 100 }, notes: "" }), true);
  }
});

test("flags direct sexual-content disclosures even without tags", () => {
  assert.equal(hasSexualContent({ tags: [], notes: "Contains explicit sex scenes and partial nudity." }), true);
  assert.deepEqual(sexualContentSignals({ tags: [], notes: "Contains erotic themes." }), ["mature-content-note"]);
});

test("does not classify unrelated mature or violent content as sexual", () => {
  assert.equal(hasSexualContent({ tags: { Gore: 100, Violent: 80 }, notes: "Frequent violence, gore, and strong language." }), false);
  assert.equal(hasSexualContent({ tags: {}, notes: "General Mature Content" }), false);
});
