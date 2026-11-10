import { expect, test } from "bun:test";
import { createCopilotOAuthFetch } from "../src/copilot-oauth-fetch.js";

test("Copilot inference uses the exchanged session token, not the saved GitHub login", async () => {
  const seen: { url: string; authorization: string | null; custom: string | null }[] = [];
  const fetcher = createCopilotOAuthFetch("gho_fixture", { now: () => 1_000_000, fetch: async (input, init) => {
    const request = new Request(input, init);
    seen.push({ url: request.url, authorization: request.headers.get("authorization"), custom: request.headers.get("x-fixture") });
    return request.url.includes("copilot_internal") ? Response.json({ token: "session-fixture", expires_at: 3000 }) : Response.json({ ok: true });
  } });
  const response = await fetcher("https://api.githubcopilot.com/chat/completions", { method: "POST", headers: { Authorization: "Bearer gho_fixture", "X-Fixture": "keep" }, body: "{}" });
  expect(response.status).toBe(200);
  expect(seen.map((entry) => entry.authorization)).toEqual(["token gho_fixture", "Bearer session-fixture"]);
  expect(seen[1]?.custom).toBe("keep");
});

test("concurrent requests share one token exchange", async () => {
  let resolve: (response: Response) => void = () => {};
  const exchange = new Promise<Response>((done) => { resolve = done; });
  let exchanges = 0;
  const fetcher = createCopilotOAuthFetch("gho_fixture", { now: () => 1_000_000, fetch: async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("copilot_internal")) { exchanges += 1; return exchange; }
    return Response.json({ ok: true });
  } });
  const first = fetcher("https://api.githubcopilot.com/chat/completions");
  const second = fetcher("https://api.githubcopilot.com/chat/completions");
  resolve(Response.json({ token: "session-fixture", expires_at: 3000 }));
  expect((await first).status).toBe(200);
  expect((await second).status).toBe(200);
  expect(exchanges).toBe(1);
});

test("only an explicit 401 refreshes and retries the same Copilot request once", async () => {
  let calls = 0;
  let exchanges = 0;
  const credentials: string[] = [];
  const fetcher = createCopilotOAuthFetch("gho_fixture", { token: "old-session", expiresAt: 3000, now: () => 1_000_000,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (request.url.includes("copilot_internal")) { exchanges += 1; return Response.json({ token: "new-session", expires_at: 4000 }); }
      credentials.push(request.headers.get("authorization") || "");
      calls += 1;
      return new Response(null, { status: calls === 1 ? 401 : 200 });
    },
  });
  expect((await fetcher("https://api.githubcopilot.com/chat/completions", { method: "POST", body: "{}" })).status).toBe(200);
  expect(credentials).toEqual(["Bearer old-session", "Bearer new-session"]);
  expect(exchanges).toBe(1);
});

test("the Copilot credential never goes to another origin", async () => {
  let called = false;
  const fetcher = createCopilotOAuthFetch("gho_fixture", { fetch: async () => { called = true; return new Response(); } });
  await expect(fetcher("https://other.example.invalid/chat/completions")).rejects.toThrow("restricted");
  expect(called).toBe(false);
});

test("a quota rejection is not replayed or routed to another credential", async () => {
  let calls = 0;
  const fetcher = createCopilotOAuthFetch("gho_fixture", { token: "session-fixture", expiresAt: 3000, now: () => 1_000_000,
    fetch: async () => { calls += 1; return new Response(null, { status: 429 }); } });
  expect((await fetcher("https://api.githubcopilot.com/chat/completions")).status).toBe(429);
  expect(calls).toBe(1);
});
