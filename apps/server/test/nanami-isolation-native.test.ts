import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createManagedOpencodeServer } from "../src/managed-opencode.js";
import { createManagedOpencodeV2Server } from "../src/managed-opencode-v2.js";

const binary = (name: string) => {
  const filename = process.platform === "win32" ? `${name}.exe` : name;
  const packaged = fileURLToPath(new URL(`../../desktop/resources/sidecars/${filename}`, import.meta.url));
  const installed = join(process.env.LOCALAPPDATA || "", "Programs", "@openworkdesktop", "resources", "sidecars", filename);
  return existsSync(packaged) ? packaged : existsSync(installed) ? installed : undefined;
};
const v1Bin = process.env.NANAMI_TEST_V1_BIN || binary("opencode");
const v2Bin = process.env.NANAMI_TEST_V2_BIN || binary("opencode2");

test("both managed engines retain isolated fixture sessions across restart", { skip: !v1Bin || !v2Bin, timeout: 90_000 }, async () => {
  if (!v1Bin || !v2Bin) return;
  const root = await mkdtemp(join(tmpdir(), "nanami-engines-"));
  const home = join(root, "home"), workspace = join(root, "workspace"), config = join(root, "config");
  const data = join(root, "data"), state = join(root, "v1"), v2 = join(root, "v2");
  const shared = join(home, ".local", "share", "opencode", "auth.json");
  const sharedConfig = join(home, ".config", "opencode", "opencode.json");
  const auth = join(data, "opencode", "auth.json");
  const env = {
    HOME: home, USERPROFILE: home,
    XDG_CONFIG_HOME: join(root, "xdg"), XDG_DATA_HOME: data,
    XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_CONFIG_DIR: config, OPENCODE_DB: join(state, "opencode.db"),
    NANAMIWORK_ENGINE_HOME: join(root, "private-engine-home"),
    OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", NANAMIWORK_ISOLATED: "1",
  };
  const ambient = { ...env, APPDATA: join(root, "roaming"), LOCALAPPDATA: join(root, "local") };
  const { HOME: _home, USERPROFILE: _profile, ...managedEnv } = env;
  const secretKeys = Object.keys(process.env).filter((key) => /(?:_API_KEY|_TOKEN|_SECRET|_PASSWORD)$/i.test(key));
  const previous = new Map([...new Set([...Object.keys(ambient), ...secretKeys])].map((key) => [key, process.env[key]]));
  try {
    for (const dir of [home, workspace, config, state, join(data, "opencode")]) await mkdir(dir, { recursive: true });
    await mkdir(join(home, ".local", "share", "opencode"), { recursive: true });
    await mkdir(join(home, ".config", "opencode"), { recursive: true });
    await writeFile(shared, "other app credential");
    await writeFile(sharedConfig, '{"invalid-other-app-config":true}');
    await writeFile(auth, JSON.stringify({ fixture: { type: "api", key: "nanami-fixture-key" } }));
    for (const key of secretKeys) delete process.env[key];
    Object.assign(process.env, ambient);
    let engine = await createManagedOpencodeServer({ bin: v1Bin, cwd: workspace, stateDir: state, env: managedEnv });
    const fetchV1 = async (server: typeof engine, method: string, endpoint: string, body?: unknown) => {
      const url = new URL(endpoint, server.url);
      url.searchParams.set("directory", workspace.replace(/\\/g, "/"));
      const response = await fetch(url, { method, headers: { authorization: `Basic ${Buffer.from(`${server.username}:${server.password}`).toString("base64")}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      assert.equal(response.ok, true, await response.clone().text());
      return response.json();
    };
    try {
      const created = await fetchV1(engine, "POST", "/session", { title: "v1 fixture" });
      const id = created.id;
      assert.ok(id);
      await engine.close();
      engine = await createManagedOpencodeServer({ bin: v1Bin, cwd: workspace, stateDir: state, env: managedEnv });
      const sessions = await fetchV1(engine, "GET", "/session");
      assert.ok(sessions.some((session: { id: string }) => session.id === id));
    } finally { await engine.close(); }

    let engineV2 = await createManagedOpencodeV2Server({ bin: v2Bin, rootDir: v2, env: managedEnv });
    try {
      const created = await engineV2.fetchJson("/api/session", { method: "POST", directory: workspace, body: { title: "v2 fixture", location: { directory: workspace } } });
      assert.equal(created.status, 200, JSON.stringify(created.json));
      const payload = created.json;
      assert.ok(payload && typeof payload === "object" && "data" in payload && payload.data && typeof payload.data === "object" && "id" in payload.data);
      const id = payload.data.id;
      await engineV2.close();
      engineV2 = await createManagedOpencodeV2Server({ bin: v2Bin, rootDir: v2, env: managedEnv });
      const read = await engineV2.fetchJson(`/api/session/${id}`, { directory: workspace });
      assert.equal(read.status, 200, JSON.stringify(read.json));
    } finally { await engineV2.close(); }
    assert.equal(await readFile(shared, "utf8"), "other app credential");
    assert.equal(await readFile(sharedConfig, "utf8"), '{"invalid-other-app-config":true}');
    assert.equal(JSON.parse(await readFile(auth, "utf8")).fixture.key, "nanami-fixture-key");
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true, force: true });
  }
});
