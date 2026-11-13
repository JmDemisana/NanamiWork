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
