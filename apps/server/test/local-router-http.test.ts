import { expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setEnginePoolForConfig, clearEnginePoolForConfig, type EnginePool } from "../src/engine-pool.js";
import { startServer } from "../src/server.js";
import type { ServerConfig } from "../src/types.js";

test("host-only router admission is atomic with the managed engine proxy", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "router-http-test-")));
  const directory = join(root, "workspace"), configDir = join(root, "nanami"), dataDir = join(configDir, "data");
  await mkdir(directory, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  const overrides = { NANAMIWORK_ISOLATED: "1", OPENCODE_CONFIG_DIR: configDir, XDG_DATA_HOME: dataDir,
    HOME: root, USERPROFILE: root, OPENWORK_RUNTIME_DB: join(root, "runtime.sqlite"), OPENWORK_DATA_DIR: join(root, "runtime-data"),
    OPENWORK_TOKEN_STORE: join(root, "tokens.json"), OPENWORK_ENGINE_V2_PREVIEW: "0" };
  const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  let busy = false;
  let messages: unknown[] = [];
  const seen: Array<{ path: string; host: boolean; lease: boolean }> = [];
  const promptBodies: unknown[] = [];
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    seen.push({ path, host: request.headers.has("x-openwork-host-token"), lease: request.headers.has("x-openwork-local-router-lease") });
    if (path === "/session/status") return Response.json(busy ? { ses_other: { type: "busy" } } : {});
    if (path === "/permission" || path === "/question") return Response.json([]);
    if (path.endsWith("/message")) return Response.json(messages);
    if (path.endsWith("/prompt_async")) {
      promptBodies.push(await request.json());
      return new Response(null, { status: 204 });
    }
    return Response.json(true);
  } });
  const engineUrl = `http://127.0.0.1:${engine.port}`;
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client-fixture", hostToken: "host-fixture", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "ws_fixture", name: "Fixture", path: directory,
      preset: "starter", workspaceType: "local", baseUrl: engineUrl }], authorizedRoots: [root], readOnly: false, startedAt: Date.now(),
    tokenSource: "generated", hostTokenSource: "generated", logFormat: "json", logRequests: false, opencodeBaseUrl: engineUrl, engineAutoUpgrade: false };
  const connection = { generationId: "fixture", role: "primary" as const, baseUrl: engineUrl, username: "fixture", password: "fixture" };
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    server = await startServer(config, { deferManagedEngineStartup: true });
    const pool = { connections: () => [connection], routeRequest: () => ({ target: connection, fallback: null }), eventProxyCount: () => 0,
      reportRequestSuccess: () => {}, reportRequestFailure: () => {}, hasDrainingGeneration: () => false } as unknown as EnginePool;
    setEnginePoolForConfig(config, pool);
    const base = `http://127.0.0.1:${server.port}`;
    const payload = { workspaceId: "ws_fixture", sessionId: "ses_fixture", providerId: "google", modelId: "model-a" };
    const acquire = (host: string) => fetch(`${base}/runtime/local-router/acquire`, { method: "POST", headers: { "Content-Type": "application/json", "X-OpenWork-Host-Token": host }, body: JSON.stringify(payload) });
    expect((await acquire("wrong-host")).status).toBe(401);
    busy = true;
    expect((await acquire("host-fixture")).status).toBe(409);
    busy = false;
    const response = await acquire("host-fixture");
    expect(response.status).toBe(200);
    const lease: { id: string } = await response.json();
    expect(lease.id).toMatch(/^[a-f0-9]{64}$/);
    const headers = { Authorization: "Bearer client-fixture", "Content-Type": "application/json", "X-OpenWork-Host-Token": "host-fixture", "X-OpenWork-Local-Router-Lease": lease.id };
    const auth = await fetch(`${base}/workspace/ws_fixture/opencode/auth/google`, { method: "PUT", headers, body: JSON.stringify({ type: "oauth", refresh: "fixture", access: "", expires: 0 }) });
    expect(auth.status).toBe(200);
    const prompt = await fetch(`${base}/workspace/ws_fixture/opencode/session/ses_fixture/prompt_async`, { method: "POST", headers,
      body: JSON.stringify({ messageID: "msg_fixture", model: { providerID: "google", modelID: "model-a" }, parts: [{ type: "text", text: "fixture" }] }) });
    expect(prompt.status).toBe(204);
    expect(promptBodies).toEqual([{ messageID: "msg_fixture", model: { providerID: "google", modelID: "model-a" }, parts: [{ type: "text", text: "fixture" }] }]);
    expect(JSON.stringify(promptBodies)).not.toContain("nanami-local-router");
    const release = await fetch(`${base}/runtime/local-router/release`, { method: "POST", headers: { "Content-Type": "application/json", "X-OpenWork-Host-Token": "host-fixture" }, body: JSON.stringify({ id: lease.id }) });
    expect(release.status).toBe(200);
    expect((await acquire("host-fixture")).status).toBe(409);
    messages = [{ info: { id: "msg_reply", role: "assistant", sessionID: "ses_fixture", parentID: "msg_fixture", time: { completed: Date.now() }, finish: "stop" }, parts: [] }];
    const afterReply = await acquire("host-fixture");
    expect(afterReply.status).toBe(200);
    const nextLease: { id: string } = await afterReply.json();
    await fetch(`${base}/runtime/local-router/release`, { method: "POST", headers: { "Content-Type": "application/json", "X-OpenWork-Host-Token": "host-fixture" }, body: JSON.stringify({ id: nextLease.id }) });
    expect(seen.filter((entry) => entry.path === "/auth/google" || entry.path.endsWith("/prompt_async")).every((entry) => !entry.host && !entry.lease)).toBe(true);
  } finally {
    clearEnginePoolForConfig(config);
    await server?.stop();
    engine.stop(true);
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    try { await rm(root, { recursive: true, force: true }); }
    catch (error) {
      // Bun's cached SQLite handle can stay open until this test process exits on Windows.
      if (process.platform !== "win32" || !error || typeof error !== "object" || Reflect.get(error, "code") !== "EBUSY") throw error;
    }
  }
});
