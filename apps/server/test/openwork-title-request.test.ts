import { expect, test } from "bun:test";
import { OpenWorkTitleRecovery } from "../src/opencode-plugins/openwork-title-recovery.js";

test("recovers an unsigned JSON Request and leaves signed payloads intact", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ body: unknown; headers: Headers }> = [];
  const fakeFetch: typeof fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init);
    const body = await request.json();
    calls.push({ body, headers: request.headers });
    if (body && typeof body === "object" && "temperature" in body) {
      return Response.json({ error: { code: "unsupported_parameter", param: "temperature" } }, { status: 400 });
    }
    return Response.json({ ok: true });
  }, originalFetch);
  globalThis.fetch = fakeFetch;
  const plugin = await OpenWorkTitleRecovery({ client: { app: { log: async () => undefined } } });
  const titleInput = { sessionID: "ses_title", agent: "title", model: { id: "model", providerID: "provider" } };
  const payload = { model: "model", temperature: 0.3 };
  try {
    const unsigned: Record<string, string> = { "content-type": "application/json" };
    await plugin["chat.headers"](titleInput, { headers: unsigned });
    const response = await fetch(new Request("https://provider.invalid/title", {
      method: "POST", headers: unsigned, body: JSON.stringify(payload),
    }));
    expect(response.ok).toBe(true);
    expect(calls.map((call) => call.body)).toEqual([payload, { model: "model" }]);
    expect(calls.every((call) => !call.headers.has("x-openwork-title-attempt"))).toBe(true);

    const signed = { ...unsigned, authorization: "AWS4-HMAC-SHA256 test-fixture" };
    await plugin["chat.headers"](titleInput, { headers: signed });
    const rejected = await fetch("https://provider.invalid/title", {
      method: "POST", headers: signed, body: JSON.stringify(payload),
    });
    expect(rejected.status).toBe(400);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.headers.has("x-openwork-title-attempt")).toBe(true);
    expect(calls[2]?.body).toEqual(payload);
  } finally {
    await plugin.dispose();
    globalThis.fetch = originalFetch;
  }
});

test("uses a provider-native small model for Antigravity OAuth and Copilot", async () => {
  const plugin = await OpenWorkTitleRecovery({ client: { app: { log: async () => undefined } } });
  const choose = plugin["experimental.provider.small_model"];
  const googleFlash = { id: "gemini-3.8-flash", providerID: "google" };
  const oauthFlash = { id: "antigravity-gemini-3.8-flash-low", providerID: "google" };
  const google = {
    id: "google",
    options: { apiKey: "antigravity-oauth" },
    models: { [googleFlash.id]: googleFlash, [oauthFlash.id]: oauthFlash },
  };
  const oauth: { model?: typeof oauthFlash } = {};
  await choose({ provider: google }, oauth);
  expect(oauth.model).toBe(oauthFlash);

  const api = {};
  await choose({ provider: { ...google, options: {} } }, api);
  expect(api).toEqual({});

  const copilot = { id: "gpt-4.1", providerID: "github-copilot" };
  const copilotCatalog = { id: copilot.providerID, models: { [copilot.id]: copilot } };
  const selected: { model?: typeof copilot } = {};
  await choose({ provider: copilotCatalog }, selected);
  expect(selected.model).toBe(copilot);

  const otherProvider = {};
  await choose({ provider: { ...copilotCatalog, models: { [copilot.id]: oauthFlash } } }, otherProvider);
  expect(otherProvider).toEqual({});

  const override = { model: googleFlash };
  await choose({ provider: google }, override);
  expect(override.model).toBe(googleFlash);
  await plugin.dispose();
});
