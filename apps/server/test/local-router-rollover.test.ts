import { expect, test } from "bun:test";
import { EnginePool } from "../src/engine-pool.js";
import { acquireLocalRouterLease, releaseLocalRouterLease } from "../src/local-router-lease.js";
import type { ServerConfig, WorkspaceInfo } from "../src/types.js";

test("a background engine rollover waits until router account preparation and admission finish", async () => {
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture", approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated",
    logFormat: "json", logRequests: false };
  const workspace: WorkspaceInfo = { id: "workspace", name: "Fixture", path: ".", preset: "", workspaceType: "local" };
  const calls: string[] = [];
  const pool = new EnginePool({ config, template: { cwd: ".", runtimeConfigPath: "fixture-missing-config.json", env: {}, reservedPorts: () => [] }, hooks: {
    writeRuntimeConfigFile: async () => { calls.push("prepare"); return { path: "fixture-missing-config.json" }; },
    engineBusy: async () => false,
    reloadInPlace: async () => { calls.push("reload"); },
    postRefreshSync: async () => {}, registerTrusted: () => {}, clearTrusted: () => {},
  } });
  const { id } = await acquireLocalRouterLease(config, { workspaceId: "workspace", sessionId: "ses_fixture", providerId: "google", modelId: "model-a", ensureIdle: async () => {} });
  try {
    const rollover = pool.requestRollover({ reason: "fixture", workspace, manual: true });
    await Promise.resolve();
    expect(calls).toEqual([]);
    releaseLocalRouterLease(config, id);
    expect(await rollover).toEqual({ action: "reloaded_in_place" });
    expect(calls).toEqual(["prepare", "reload"]);
  } finally {
    releaseLocalRouterLease(config, id);
    await pool.disposeAll();
  }
});
