import assert from "node:assert/strict";
import { test } from "node:test";
import type { Client } from "../src/app/types";
import { configureNanamiUncensoredGrant } from "../src/react-app/domains/models/nanami-uncensored-grant";

test("installs the temporary grant without discarding existing provider settings", async () => {
  const current = { other: true, provider: { google: { name: "Google" }, nanami: {
    options: { baseURL: "https://example.invalid" }, models: { uncensored: { name: "Uncensored", headers: { existing: "kept" } }, gemini: { name: "Gemini" } },
  } } };
  let update: any;
  const client = { config: { get: async () => ({ data: current }), update: async (value: unknown) => { update = value; return { data: {} }; } } } as unknown as Client;
  await configureNanamiUncensoredGrant(client, "test-grant");
  assert.equal(update.config.provider.nanami.models.uncensored.headers["x-nami-nsfw-grant"], "test-grant");
  assert.equal(update.config.provider.nanami.models.uncensored.headers.existing, "kept");
  assert.deepEqual(update.config.provider.nanami.models.gemini, current.provider.nanami.models.gemini);
  assert.deepEqual(update.config.provider.google, current.provider.google);
  assert.deepEqual(current.provider.nanami.models.uncensored.headers, { existing: "kept" });
});

test("does not report success when the engine is disconnected or rejects the grant", async () => {
  await assert.rejects(configureNanamiUncensoredGrant(null, "test-grant"), /not connected/);
  const client = { config: { get: async () => ({ data: {} }), update: async () => ({ error: { message: "private upstream details" } }) } } as unknown as Client;
  await assert.rejects(configureNanamiUncensoredGrant(client, "test-grant"), /Could not save the temporary gateway grant/);
  const unreadable = { config: { get: async () => ({ error: "failure" }), update: async () => { throw new Error("must not update"); } } } as unknown as Client;
  await assert.rejects(configureNanamiUncensoredGrant(unreadable, "test-grant"), /Could not read the gateway configuration/);
});
