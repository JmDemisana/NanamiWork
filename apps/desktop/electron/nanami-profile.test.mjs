import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { legacyNanamiProfile, migrateLegacyNanamiProfile, nanamiProfileEnvironment, nanamiTerminalEnvironment } from "./nanami-profile.mjs";
import { buildNukeManifest } from "./nuke.mjs";
import { openworkInstallMarkerPaths } from "./runtime.mjs";

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nanami-profile-test-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("private defaults preserve explicit overrides", () => {
  const result = nanamiProfileEnvironment({ env: { OPENCODE_DB: "/chosen.db", XDG_CONFIG_HOME: "/chosen-config" }, home: "/home/test", userDataDir: "/profile" });
  assert.equal(result.env.OPENCODE_DB, "/chosen.db");
  assert.equal(result.env.XDG_CONFIG_HOME, "/chosen-config");
  assert.equal(result.env.XDG_DATA_HOME, path.join("/home/test", ".config", "nanamiwork", "data"));
  assert.equal(result.env.OPENWORK_RUNTIME_DB, path.join("/profile", "nanamiwork-runtime", "runtime.sqlite"));
});

test("desktop terminals cannot accidentally launch plugins against another app's home", async () => fixture(async (root) => {
  const originalHome = path.join(root, "other-app-home");
  const engineHome = path.join(root, "nanami-engine");
  const source = { NANAMIWORK_ISOLATED: "1", NANAMIWORK_ENGINE_HOME: engineHome, HOME: originalHome, APPDATA: path.join(root, "shared") };
  const env = await nanamiTerminalEnvironment(source, { home: originalHome, platform: "win32" });
  assert.equal(env.USERPROFILE, engineHome);
  assert.equal(env.APPDATA, path.join(engineHome, "AppData", "Roaming"));
  assert.equal(env.NANAMIWORK_REAL_HOME, originalHome);
  assert.equal(source.APPDATA, path.join(root, "shared"));
}));

test("existing private accounts are recognized as an install rather than forcing fresh v2 routing", () => {
  const env = { OPENCODE_CONFIG_DIR: path.resolve("private-config"), XDG_DATA_HOME: path.resolve("private-data") };
  const markers = openworkInstallMarkerPaths({ userDataDir: path.resolve("profile"), serverConfigPath: path.resolve("runtime", "server.json"), env });
  assert.ok(markers.includes(path.join(env.OPENCODE_CONFIG_DIR, "antigravity-accounts.json")));
  assert.ok(markers.includes(path.join(env.OPENCODE_CONFIG_DIR, "codex-accounts.json")));
  assert.ok(markers.includes(path.join(env.XDG_DATA_HOME, "opencode", "auth.json")));
});

test("fresh-start cleanup cannot target other apps or workspace files", () => {
  const home = path.resolve("profile-home"), userDataDir = path.resolve("nanami-profile");
  const { env } = nanamiProfileEnvironment({ env: {}, home, userDataDir });
  const manifest = buildNukeManifest({ env, homedir: home, userDataPath: userDataDir, platform: process.platform, workspacePaths: [path.resolve("shared-workspace")] });
  const allowed = [userDataDir, path.join(home, ".config", "nanamiwork")];
  assert.ok(manifest.deletePaths.length > 0);
  for (const target of manifest.deletePaths) {
    assert.ok(allowed.some((root) => {
      const relative = path.relative(root, target);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    }), `unexpected deletion target: ${target}`);
  }
});

test("marks ambiguous shared state separately from a NanamiWork profile", async () => fixture(async (root) => {
  const home = path.join(root, "home");
  const userDataDir = path.join(root, "profile");
  const legacyDir = path.join(root, "legacy");
  const runtimeDir = path.join(userDataDir, "private");
  const env = { OPENWORK_SERVER_CONFIG: path.join(legacyDir, "server.json") };
  await mkdir(legacyDir, { recursive: true });
  await mkdir(userDataDir, { recursive: true });
  await writeFile(path.join(legacyDir, "server.json"), "{}");
  assert.equal(legacyNanamiProfile({ env, home, userDataDir, runtimeDir })?.hasNanamiMarker, false);
  await writeFile(path.join(userDataDir, "openwork-workspaces.json"), "{}");
  assert.equal(legacyNanamiProfile({ env, home, userDataDir, runtimeDir })?.legacyDir, legacyDir);
  assert.equal(legacyNanamiProfile({ env, home, userDataDir, runtimeDir })?.hasNanamiMarker, true);
}));

test("snapshots WAL history and preserves an interrupted v2 copy without touching shared auth", async () => fixture(async (root) => {
  const legacyDir = path.join(root, "shared");
  const runtimeDir = path.join(root, "profile", "private");
  const v1 = path.join(legacyDir, "opencode-v1", "state", "opencode.db");
  const v2 = path.join(legacyDir, "opencode-v2", "state", "opencode.db");
  const copyDir = path.join(legacyDir, "opencode-v2", "history-copy");
  const backup = path.join(legacyDir, "opencode-v2", "backups", "before.db");
  const sharedAuth = path.join(root, "other-app-auth.json");
  await mkdir(path.dirname(v1), { recursive: true });
  await mkdir(path.dirname(v2), { recursive: true });
  await mkdir(path.join(copyDir, "converted"), { recursive: true });
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(sharedAuth, "other app secret");
  const database = new DatabaseSync(v1);
  database.exec("PRAGMA journal_mode=WAL; CREATE TABLE session (id TEXT); INSERT INTO session VALUES ('chat-1');");
  const target = new DatabaseSync(v2);
  target.exec("CREATE TABLE session_v2 (id TEXT); INSERT INTO session_v2 VALUES ('v2-chat');");
  target.close();
  const source = path.join(copyDir, "source.db");
  const stage = new DatabaseSync(source);
  stage.exec("CREATE TABLE session (id TEXT); INSERT INTO session VALUES ('staged');");
  stage.close();
  const converted = new DatabaseSync(path.join(copyDir, "converted", "opencode.db"));
  converted.exec("CREATE TABLE projection (id TEXT)");
  converted.close();
  const backupDb = new DatabaseSync(backup);
  backupDb.exec("CREATE TABLE snapshot (id TEXT)");
  backupDb.close();
  const digest = createHash("sha256").update(await readFile(source)).digest("hex");
  await writeFile(path.join(copyDir, "checkpoint.json"), JSON.stringify({ source: v1, target: v2, phase: "converting", sourceKey: digest, snapshotStartedAt: 1, backupPath: backup }));
  await writeFile(path.join(legacyDir, "engine-v2-preview.json"), JSON.stringify({ automaticHistoryCopy: true, v1HistoryCopyStartedAt: 1, historyCopyResult: { backupPath: backup } }));
  await migrateLegacyNanamiProfile({ legacyDir, bootstrap: null, runtimeDir });
  const copied = new DatabaseSync(path.join(runtimeDir, "opencode-v1", "state", "opencode.db"), { readOnly: true });
  assert.equal(copied.prepare("SELECT id FROM session").get().id, "chat-1");
  copied.close();
  const checkpoint = JSON.parse(await readFile(path.join(runtimeDir, "opencode-v2", "history-copy", "checkpoint.json"), "utf8"));
  assert.equal(checkpoint.source, path.join(runtimeDir, "opencode-v1", "state", "opencode.db"));
  assert.equal(checkpoint.target, path.join(runtimeDir, "opencode-v2", "state", "opencode.db"));
  assert.equal(checkpoint.backupPath, path.join(runtimeDir, "opencode-v2", "backups", "before.db"));
  const preview = JSON.parse(await readFile(path.join(runtimeDir, "engine-v2-preview.json"), "utf8"));
  assert.equal(preview.historyCopyResult.backupPath, checkpoint.backupPath);
  assert.equal(await readFile(sharedAuth, "utf8"), "other app secret");
  assert.equal(database.prepare("SELECT id FROM session").get().id, "chat-1");
  await assert.rejects(migrateLegacyNanamiProfile({ legacyDir, bootstrap: null, runtimeDir }), /already exists/);
  database.close();
}));

test("a corrupt legacy database never replaces or modifies either profile", async () => fixture(async (root) => {
  const legacyDir = path.join(root, "legacy");
  const runtimeDir = path.join(root, "profile", "private");
  await mkdir(legacyDir, { recursive: true });
  const source = path.join(legacyDir, "runtime.sqlite");
  await writeFile(source, "not a database");
  await assert.rejects(migrateLegacyNanamiProfile({ legacyDir, bootstrap: null, runtimeDir }));
  assert.equal(await readFile(source, "utf8"), "not a database");
  await assert.rejects(readFile(path.join(runtimeDir, "migration.json")), { code: "ENOENT" });
}));
