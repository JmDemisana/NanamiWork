import { expect, test } from "bun:test";
import { acquireLocalRouterLease, releaseLocalRouterLease } from "../src/local-router-lease.js";
import { proxyOpencodeRequest } from "../src/server.js";
import type { ServerConfig, WorkspaceInfo } from "../src/types.js";

test("the engine proxy fences ordinary sends and never forwards host or lease credentials", async () => {
  const seen: { path: string; hostHeader: boolean; leaseHeader: boolean; body: unknown }[] = [];
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = request.method === "POST" || request.method === "PUT" ? await request.json() : null;
    seen.push({ path, hostHeader: request.headers.has("x-openwork-host-token"), leaseHeader: request.headers.has("x-openwork-local-router-lease"), body });
    return path.endsWith("/prompt_async") ? new Response(null, { status: 204 }) : Response.json(true);
  } });
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client-fixture", hostToken: "host-fixture", approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated",
    logFormat: "json", logRequests: false, opencodeBaseUrl: `http://127.0.0.1:${engine.port}` };
  const workspace: WorkspaceInfo = { id: "workspace", name: "Fixture", path: ".", preset: "", workspaceType: "local", baseUrl: config.opencodeBaseUrl };
  const { id } = await acquireLocalRouterLease(config, { workspaceId: workspace.id, sessionId: "ses_fixture", providerId: "google", modelId: "model-a", ensureIdle: async () => {} });
  const forward = (path: string, body: unknown, leased: boolean, host = "host-fixture") => {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (leased) { headers.set("X-OpenWork-Host-Token", host); headers.set("X-OpenWork-Local-Router-Lease", id); }
    const request = new Request(`http://127.0.0.1/opencode${path}`, { method: path.startsWith("/auth/") ? "PUT" : "POST", headers, body: JSON.stringify(body) });
    return proxyOpencodeRequest({ config, workspace, request, url: new URL(request.url), proxyPath: `/opencode${path}` });
  };
  try {
    await expect(forward("/auth/google", { type: "oauth" }, true, "wrong-host")).rejects.toMatchObject({ status: 401 });
    expect((await forward("/auth/google", { type: "oauth" }, true)).status).toBe(200);
    expect((await forward("/session/ses_fixture/prompt_async", { messageID: "msg_fixture", model: { providerID: "google", modelID: "model-a" }, parts: [] }, true)).status).toBe(204);
    let ordinaryForwarded = false;
    const ordinary = forward("/session/ses_other/prompt_async", { messageID: "msg_other", model: { providerID: "other", modelID: "direct" }, parts: [] }, false)
      .then((response) => { ordinaryForwarded = true; return response; });
    await Promise.resolve();
    expect(ordinaryForwarded).toBe(false);
    releaseLocalRouterLease(config, id);
    expect((await ordinary).status).toBe(204);
    expect(seen.map((entry) => entry.path)).toEqual(["/auth/google", "/session/ses_fixture/prompt_async", "/session/ses_other/prompt_async"]);
    expect(seen.every((entry) => !entry.hostHeader && !entry.leaseHeader)).toBe(true);
  } finally {
    releaseLocalRouterLease(config, id);
    engine.stop(true);
  }
});
