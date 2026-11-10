import { expect, test } from "bun:test";
import { enterEngineMutation } from "../src/engine-switch-fence.js";
import { acquireLocalRouterLease, enterLocalRouterLease, releaseLocalRouterLease } from "../src/local-router-lease.js";

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const leaseInput = (ensureIdle: () => Promise<void>) => ({
  workspaceId: "workspace", sessionId: "ses_fixture", providerId: "google", modelId: "model-a", ensureIdle,
});

function prompt(model: unknown = { providerID: "google", modelID: "model-a" }) {
  return new Request("http://localhost/session/ses_fixture/prompt_async", {
    method: "POST", body: JSON.stringify({ model, parts: [] }),
  });
}

test("account preparation drains other admissions and fences new mutations until release", async () => {
  const config = {};
  const previous = await enterEngineMutation(config, "v1");
  let checked = false;
  const acquiring = acquireLocalRouterLease(config, leaseInput(async () => { checked = true; }));
  await Promise.resolve();
  expect(checked).toBe(false);
  await previous();
  const lease = await acquiring;
  expect(checked).toBe(true);
  let forwarded = false;
  const waiting = enterEngineMutation(config, "v1").then(async (release) => { forwarded = true; await release(); });
  await Promise.resolve();
  expect(forwarded).toBe(false);
  releaseLocalRouterLease(config, lease.id);
  await waiting;
  expect(forwarded).toBe(true);
});

test("a busy or unknown engine never grants an account lease", async () => {
  const config = {};
  await expect(acquireLocalRouterLease(config, leaseInput(async () => { throw new Error("activity unknown"); }))).rejects.toThrow("activity unknown");
  await (await enterEngineMutation(config, "v1"))();
});

test("leases only allow their workspace, session, provider and exact model", async () => {
  const config = {};
  const { id } = await acquireLocalRouterLease(config, leaseInput(async () => {}));
  const input = { id, workspaceId: "workspace", method: "POST", path: "/session/ses_fixture/prompt_async", request: prompt() };
  await expect(enterLocalRouterLease(config, { ...input, workspaceId: "other" })).rejects.toThrow("could not safely prepare");
  await expect(enterLocalRouterLease(config, { ...input, path: "/session/ses_other/prompt_async" })).rejects.toThrow("outside the Local Router admission");
  await expect(enterLocalRouterLease(config, { ...input, request: prompt({ providerID: "google", modelID: "other" }) })).rejects.toThrow("model changed");
  await expect(enterLocalRouterLease(config, { ...input, method: "PUT", path: "/auth/openai" })).rejects.toThrow("outside the Local Router admission");
  const endAuth = await enterLocalRouterLease(config, { ...input, method: "PUT", path: "/auth/google" });
  endAuth(new Response(null, { status: 200 }));
  const endPrompt = await enterLocalRouterLease(config, input);
  await expect(enterLocalRouterLease(config, input)).rejects.toThrow("already submitted");
  endPrompt(new Response(null, { status: 204 }));
  releaseLocalRouterLease(config, id);
});

test("an explicit rejection can be retried, but an unknown admission cannot", async () => {
  const config = {};
  const { id } = await acquireLocalRouterLease(config, leaseInput(async () => {}));
  const input = { id, workspaceId: "workspace", method: "POST", path: "/session/ses_fixture/prompt_async", request: prompt() };
  const first = await enterLocalRouterLease(config, input);
  first(new Response(null, { status: 400 }));
  const second = await enterLocalRouterLease(config, input);
  second();
  await expect(enterLocalRouterLease(config, input)).rejects.toThrow("already submitted");
  releaseLocalRouterLease(config, id);
});

test("releasing a lease cannot abandon a request already forwarded to the engine", async () => {
  const config = {};
  const { id } = await acquireLocalRouterLease(config, leaseInput(async () => {}));
  const finishRequest = await enterLocalRouterLease(config, {
    id, workspaceId: "workspace", method: "POST", path: "/session/ses_fixture/prompt_async", request: prompt(),
  });
  releaseLocalRouterLease(config, id);
  const entered = deferred();
  const waiting = enterEngineMutation(config, "v1").then(async (release) => { entered.resolve(); await release(); });
  let observed = false;
  void entered.promise.then(() => { observed = true; });
  await Promise.resolve();
  expect(observed).toBe(false);
  finishRequest(new Response(null, { status: 204 }));
  await waiting;
  expect(observed).toBe(true);
});
