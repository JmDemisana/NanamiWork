import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { nanamiApiKey } from "../src/nanami-gateway.js";
import { OpenWorkGatewayQuota } from "../src/opencode-plugins/openwork-gateway-quota.js";
import { isolateNanamiEngineEnvironment } from "../src/nanami-engine-environment.js";
import { hasNanamiV1SignIns } from "../src/nanami-v1-accounts.js";
import { createEngineV2Preview } from "../src/engine-v2-preview.js";
import type { ServerConfig } from "../src/types.js";

const installedPlugin = join(process.env.USERPROFILE || process.env.HOME || "", ".cache", "opencode", "packages", "opencode-antigravity-auth@latest", "node_modules", "opencode-antigravity-auth", "dist", "src", "plugin", "storage.js");

if (process.platform === "win32" && existsSync(installedPlugin)) test("the installed Antigravity plugin cannot migrate another app's Windows accounts", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanami-plugin-"));
  const shared = join(root, "shared", "opencode", "antigravity-accounts.json");
  const engineHome = join(root, "engine"), config = join(root, "config");
  const env = { NANAMIWORK_ISOLATED: "1", NANAMIWORK_ENGINE_HOME: engineHome, HOME: root, USERPROFILE: root,
    APPDATA: join(root, "shared"), LOCALAPPDATA: join(root, "shared-local"), OPENCODE_CONFIG_DIR: config,
    XDG_CONFIG_HOME: join(root, "xdg"), XDG_DATA_HOME: join(root, "data") };
  const previous = new Map([...Object.keys(env), "NANAMIWORK_REAL_HOME"].map((key) => [key, process.env[key]]));
  try {
    await mkdir(join(root, "shared", "opencode"), { recursive: true });
    await mkdir(config, { recursive: true });
    await writeFile(shared, "other app account sentinel");
    await isolateNanamiEngineEnvironment(env, undefined, "win32");
    Object.assign(process.env, env);
    const plugin = await import(pathToFileURL(installedPlugin).href);
    assert.equal(plugin.getStoragePath(), join(config, "antigravity-accounts.json"));
    assert.equal(await readFile(shared, "utf8"), "other app account sentinel");
    assert.equal(existsSync(join(config, "antigravity-accounts.json")), false);
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows plugin paths are private unless the caller explicitly overrides them", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanami-plugin-paths-"));
  try {
    const env = { NANAMIWORK_ISOLATED: "1", NANAMIWORK_ENGINE_HOME: join(root, "engine"), HOME: join(root, "other-home"), USERPROFILE: join(root, "other-home"), APPDATA: join(root, "other"), LOCALAPPDATA: join(root, "other-local") };
    await isolateNanamiEngineEnvironment(env, undefined, "win32");
    assert.equal(env.APPDATA, join(root, "engine", "AppData", "Roaming"));
    assert.equal(env.LOCALAPPDATA, join(root, "engine", "AppData", "Local"));
    assert.equal(env.USERPROFILE, join(root, "engine"));
    const explicit = { ...env, APPDATA: join(root, "chosen") };
    await isolateNanamiEngineEnvironment(explicit, { APPDATA: explicit.APPDATA }, "win32");
    assert.equal(explicit.APPDATA, join(root, "chosen"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("automatic v2 routing leaves v1 OAuth users on their working engine", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanami-upgrade-"));
  const configDir = join(root, "config"), dataDir = join(root, "data");
  const env = { NANAMIWORK_ISOLATED: "1", OPENCODE_CONFIG_DIR: configDir, XDG_DATA_HOME: dataDir,
    OPENWORK_RUNTIME_DB: join(root, "runtime.sqlite"), OPENCODE_DB: join(root, "v1.db"), OPENWORK_ENGINE_V2_PREVIEW: "" };
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false,
    startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "json", logRequests: false,
  };
  let engine: ReturnType<typeof createEngineV2Preview> | undefined;
  try {
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "codex-accounts.json"), JSON.stringify({ accounts: [{ email: "fixture@example.invalid" }] }));
    Object.assign(process.env, env);
    const errors: string[] = [];
    engine = createEngineV2Preview({ config, deferStart: true, autoUpgradeError: (message) => errors.push(message) });
    engine.start();
    for (let attempt = 0; attempt < 100 && errors.length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(errors[0] ?? "", /existing accounts need v1/);
    assert.equal(engine.status().chatRouting, false);
  } finally {
    await engine?.stop();
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true, force: true });
  }
});

test("account sync uses only the selected private data and config", async () => {
  const root = await mkdtemp(join(tmpdir(), "nanami-account-"));
  const config = join(root, "nanami", "config"), data = join(root, "nanami", "data");
  const other = join(root, ".config", "opencode", "opencode.json");
  const env = { HOME: root, USERPROFILE: root, OPENCODE_CONFIG_DIR: config, XDG_DATA_HOME: data };
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  try {
    await mkdir(config, { recursive: true });
    await mkdir(join(root, ".config", "opencode"), { recursive: true });
    await writeFile(other, JSON.stringify({ provider: { nanami: { options: { apiKey: "other-app-key" } } } }));
    await writeFile(join(config, "codex-accounts.json"), JSON.stringify({ activeEmail: "fixture@example.invalid", accounts: [{ email: "fixture@example.invalid", accessToken: "private-token", refreshToken: "private-refresh" }] }));
    assert.equal(nanamiApiKey(env), "", "another app's API key is not imported");
    Object.assign(process.env, env);
    assert.equal(await hasNanamiV1SignIns(), true, "v1 sign-ins must block an automatic switch that cannot mirror them");
    const configured = { enabled_providers: ["custom"], disabled_providers: ["other"], permission: { bash: "ask" }, provider: { openai: { options: { apiKey: "explicit-fixture" } } } };
    await (await OpenWorkGatewayQuota()).config(configured);
    assert.deepEqual(configured.enabled_providers, ["custom"]);
    assert.deepEqual(configured.disabled_providers, ["other"]);
    assert.deepEqual(configured.permission, { bash: "ask" });
    assert.equal(configured.provider.openai.options.apiKey, "explicit-fixture");
    const authPath = join(data, "opencode", "auth.json");
    assert.equal(JSON.parse(await readFile(authPath, "utf8")).openai.access, "private-token");
    await (await OpenWorkGatewayQuota()).config({});
    assert.equal(JSON.parse(await readFile(authPath, "utf8")).openai.refresh, "private-refresh");
    assert.equal(JSON.parse(await readFile(other, "utf8")).provider.nanami.options.apiKey, "other-app-key");
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true, force: true });
  }
});
