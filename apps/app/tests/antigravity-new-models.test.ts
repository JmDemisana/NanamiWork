import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverNewAntigravityModels } from "../src/react-app/domains/models/antigravity-new-models";

test("discovers only enabled Hydrogen and Carbon tiers for each account", () => {
  const models = discoverNewAntigravityModels({
    "gemini-4-hydrogen-low": { quotaInfo: { remainingFraction: 0.25, resetTime: "tomorrow" } },
    "gemini-4-hydrogen-medium": { disabled: true },
    "gemini-4-hydrogen-high": { selectable: false },
    "gemini-4-carbon-disabled": { disabled: true },
  }, "medium");
  assert.equal(models.length, 1);
  assert.equal(models[0].modelID, "antigravity-gemini-4-hydrogen-low");
  assert.equal(models[0].remainingFraction, 0.25);
  assert.equal(models[0].tierModelIds?.medium, undefined);
  assert.equal(models[0].resetTime, "tomorrow");
});

test("an enabled Carbon account can select its reported tier without inventing quota", () => {
  const models = discoverNewAntigravityModels({ "gemini-4-carbon-high": {} }, "high");
  assert.equal(models[0].modelID, "antigravity-gemini-4-carbon-high");
  assert.equal(models[0].remainingFraction, null);
  assert.deepEqual(discoverNewAntigravityModels({ "gemini-4-hydrogen-disabled": { disabled: true } }, "low"), []);
});

test("treats resetTime-only quotaInfo as 0% exhausted rather than unknown", () => {
  const models = discoverNewAntigravityModels({
    "gemini-4-hydrogen-medium": { quotaInfo: { resetTime: "2026-11-15T18:00:00Z" } },
  }, "medium");
  assert.equal(models.length, 1);
  assert.equal(models[0].remainingFraction, 0);
  assert.equal(models[0].resetTime, "2026-11-15T18:00:00Z");
});

test("discovers enabled Gemini 4 Neon tiers and hides disabled Neon entries", () => {
  const models = discoverNewAntigravityModels({
    "gemini-4-neon-low": { quotaInfo: { remainingFraction: 0.9, resetTime: "later" } },
    "gemini-4-neon-medium": { quotaInfo: { remainingFraction: 0.9, resetTime: "later" } },
    "gemini-4-neon-high": { quotaInfo: { remainingFraction: 0.9, resetTime: "later" } },
  }, "medium");
  assert.equal(models.length, 1);
  assert.equal(models[0].familyKey, "gemini-4-neon");
  assert.equal(models[0].displayName, "Gemini 4 Neon");
  assert.equal(models[0].modelID, "antigravity-gemini-4-neon-medium");
  assert.equal(models[0].tierModelIds?.low, "antigravity-gemini-4-neon-low");
  assert.equal(models[0].tierModelIds?.high, "antigravity-gemini-4-neon-high");
  assert.deepEqual(discoverNewAntigravityModels({ "gemini-4-neon-disabled": { disabled: true } }, "high"), []);
});
