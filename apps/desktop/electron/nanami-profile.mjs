import { constants, createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { envKey, setEnv, openworkServerConfigPath, desktopBootstrapPath, legacyDesktopBootstrapPath } from "@openwork/paths";

// Only defaults are redirected. Explicitly selected storage remains the caller's choice.
export function nanamiProfileEnvironment({ env, home, userDataDir }) {
  const runtimeDir = path.join(userDataDir, "nanamiwork-runtime");
  const configDir = path.join(home, ".config", "nanamiwork");
  const defaults = {
    OPENWORK_SERVER_CONFIG: path.join(runtimeDir, "server.json"),
    OPENWORK_RUNTIME_DB: path.join(runtimeDir, "runtime.sqlite"),
    OPENWORK_ENV_STORE: path.join(runtimeDir, "env.json"),
    OPENWORK_TOKEN_STORE: path.join(runtimeDir, "tokens.json"),
    OPENWORK_DATA_DIR: path.join(runtimeDir, "data"),
    OPENWORK_DESKTOP_BOOTSTRAP_PATH: path.join(runtimeDir, "desktop-bootstrap.json"),
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_DB: path.join(runtimeDir, "opencode-v1", "state", "opencode.db"),
    XDG_CONFIG_HOME: path.join(configDir, "xdg-config"),
    XDG_DATA_HOME: path.join(configDir, "data"),
    XDG_CACHE_HOME: path.join(configDir, "cache"),
    XDG_STATE_HOME: path.join(configDir, "state"),
    NANAMIWORK_ENGINE_HOME: path.join(configDir, "engine-home"),
    NANAMIWORK_ISOLATED: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  };
  const result = { ...env };
  for (const [key, value] of Object.entries(defaults)) {
    const existing = envKey(result, key);
    if (existing === undefined || !String(result[existing] ?? "").trim()) result[existing ?? key] = value;
  }
  // An explicitly chosen server config or runtime DB defines its own storage root.
  const selectedRuntime = envKey(env, "OPENWORK_RUNTIME_DB");
  const selectedServer = envKey(env, "OPENWORK_SERVER_CONFIG");
  const runtimeRoot = selectedRuntime && env[selectedRuntime]?.trim()
    ? path.dirname(path.resolve(env[selectedRuntime]))
    : selectedServer && env[selectedServer]?.trim()
      ? path.dirname(path.resolve(env[selectedServer]))
      : runtimeDir;
  if ((!selectedRuntime || !env[selectedRuntime]?.trim()) && runtimeRoot !== runtimeDir) result.OPENWORK_RUNTIME_DB = path.join(runtimeRoot, "runtime.sqlite");
  const selectedV1 = envKey(env, "OPENCODE_DB");
  if ((!selectedV1 || !env[selectedV1]?.trim()) && runtimeRoot !== runtimeDir) result.OPENCODE_DB = path.join(runtimeRoot, "opencode-v1", "state", "opencode.db");
  result.NANAMIWORK_ISOLATED = "1";
  return { env: result, runtimeDir, configDir };
}

/** A desktop terminal can itself launch an engine or plugin, so it needs the same boundary. */
export async function nanamiTerminalEnvironment(env, { home, platform = process.platform }) {
  const result = { ...env };
  const opts = { platform };
  const get = (key) => result[envKey(result, key, opts) ?? key];
  if (get("NANAMIWORK_ISOLATED") !== "1") return result;
  const engineHome = String(get("NANAMIWORK_ENGINE_HOME") ?? "").trim();
  if (!engineHome) throw new Error("NanamiWork's private engine home is not configured.");
  setEnv(result, "NANAMIWORK_REAL_HOME", home, opts);
  const directories = platform === "win32"
    ? { HOME: engineHome, USERPROFILE: engineHome, APPDATA: path.join(engineHome, "AppData", "Roaming"), LOCALAPPDATA: path.join(engineHome, "AppData", "Local") }
    : { HOME: engineHome };
  for (const [key, directory] of Object.entries(directories)) {
    await mkdir(directory, { recursive: true });
    setEnv(result, key, directory, opts);
  }
  return result;
}

const legacyFiles = [
  "server.json", "runtime.sqlite", "runtime-opencode-config.json", "engine-instances.json",
  "engine-v2-preview.json", "tokens.json", "env.json", "connect-state.json",
  "opencode-v1/state/opencode.db", "opencode-v2/state/opencode.db",
];
const ownedMarkers = ["openwork-workspaces.json", "workspace-state.json", "openwork-server-tokens.json", "app-recovery.v1.json"];

export function legacyNanamiProfile({ env, home, userDataDir, runtimeDir }) {
  if (existsSync(runtimeDir)) return null;
  const hasNanamiMarker = ownedMarkers.some((name) => existsSync(path.join(userDataDir, name)));
  const serverConfig = openworkServerConfigPath({ env, homeDir: home });
  const legacyDir = path.dirname(serverConfig);
  if (!legacyFiles.some((name) => existsSync(path.join(legacyDir, name)))) return null;
  const bootstrap = desktopBootstrapPath({ env, homeDir: home, userDataDir });
  const fallback = legacyDesktopBootstrapPath({ env, homeDir: home });
  const configKey = envKey(env, "OPENCODE_CONFIG_DIR");
  const dataKey = envKey(env, "XDG_DATA_HOME");
  const privateV1 = path.join((configKey && env[configKey]?.trim()) || path.join(home, ".config", "nanamiwork"), "data", "opencode", "opencode.db");
  const sharedV1 = path.join((dataKey && env[dataKey]?.trim()) || path.join(home, ".local", "share"), "opencode", "opencode.db");
  return { legacyDir, hasNanamiMarker, privateV1, sharedV1, bootstrap: existsSync(bootstrap) ? bootstrap : existsSync(fallback) ? fallback : null };
}

// SQLite's backup API takes a coherent snapshot including committed WAL pages.
// Never move, overwrite, delete, or copy credentials from the shared OpenCode store.
async function snapshotDatabase(source, target) {
  const { DatabaseSync, backup } = await import("node:sqlite");
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, target); } finally { db.close(); }
  const snapshot = new DatabaseSync(target, { readOnly: true });
  try {
    const result = snapshot.prepare("PRAGMA quick_check").get();
    if (result?.quick_check !== "ok") throw new Error(`Invalid database snapshot: ${source}`);
  } finally { snapshot.close(); }
}

export async function migrateLegacyNanamiProfile({ legacyDir, bootstrap, runtimeDir, v1Source }) {
  if (existsSync(runtimeDir)) throw new Error("NanamiWork's private runtime already exists; it will not be overwritten.");
  const previewPath = path.join(legacyDir, "engine-v2-preview.json");
  let preview;
  if (existsSync(previewPath)) {
    preview = JSON.parse(await readFile(previewPath, "utf8"));
  }
  await mkdir(path.dirname(runtimeDir), { recursive: true });
  const staging = await mkdtemp(`${runtimeDir}-migration-`);
  let published = false;
  try {
    for (const name of legacyFiles) {
      const source = path.join(legacyDir, name);
      if (!existsSync(source)) continue;
      const target = path.join(staging, name);
      await mkdir(path.dirname(target), { recursive: true });
      if (name.endsWith(".sqlite") || name.endsWith(".db")) await snapshotDatabase(source, target);
      else await copyFile(source, target, constants.COPYFILE_EXCL);
    }
    const v1Name = "opencode-v1/state/opencode.db";
    if (v1Source && !existsSync(path.join(staging, v1Name))) {
      const target = path.join(staging, v1Name);
      await mkdir(path.dirname(target), { recursive: true });
      await snapshotDatabase(v1Source, target);
    }
    const copyBackup = async (backupPath) => {
      const relative = path.relative(legacyDir, path.resolve(backupPath));
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("The saved history backup is outside the legacy profile.");
      const destination = path.join(staging, relative);
      if (!existsSync(destination)) {
        await mkdir(path.dirname(destination), { recursive: true });
        await snapshotDatabase(backupPath, destination);
      }
      return path.join(runtimeDir, relative);
    };
    if (preview?.historyCopyResult?.backupPath) {
      preview.historyCopyResult.backupPath = await copyBackup(preview.historyCopyResult.backupPath);
      await writeFile(path.join(staging, "engine-v2-preview.json"), JSON.stringify(preview) + "\n", "utf8");
    }
    const checkpointName = "opencode-v2/history-copy/checkpoint.json";
    const checkpointPath = path.join(legacyDir, checkpointName);
    if (existsSync(checkpointPath)) {
      const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
      const oldSource = path.resolve(v1Source || path.join(legacyDir, "opencode-v1/state/opencode.db"));
      const oldTarget = path.resolve(legacyDir, "opencode-v2/state/opencode.db");
      if (path.resolve(checkpoint.source) !== oldSource || path.resolve(checkpoint.target) !== oldTarget) {
        throw new Error("The unfinished history copy belongs to another profile; its files were preserved.");
      }
      const sourceName = "opencode-v2/history-copy/source.db";
      const source = path.join(legacyDir, sourceName);
      if (existsSync(source)) {
        const walSize = await stat(`${source}-wal`).then((entry) => entry.size).catch(() => 0);
        if (walSize) throw new Error("The saved history snapshot has an active WAL. Close its owner and retry.");
        await mkdir(path.dirname(path.join(staging, sourceName)), { recursive: true });
        const destination = path.join(staging, sourceName);
        await copyFile(source, destination, constants.COPYFILE_EXCL);
        if (checkpoint.sourceKey) {
          const hash = createHash("sha256");
          for await (const chunk of createReadStream(destination)) hash.update(chunk);
          if (hash.digest("hex") !== checkpoint.sourceKey) {
            throw new Error("The saved history snapshot changed; it was preserved without migration.");
          }
        }
      } else if (checkpoint.phase !== "snapshot") {
        throw new Error("The unfinished history copy is missing its snapshot.");
      }
      const convertedName = "opencode-v2/history-copy/converted/opencode.db";
      const converted = path.join(legacyDir, convertedName);
      if (existsSync(converted)) {
        await mkdir(path.dirname(path.join(staging, convertedName)), { recursive: true });
        await snapshotDatabase(converted, path.join(staging, convertedName));
      }
      checkpoint.source = path.join(runtimeDir, "opencode-v1/state/opencode.db");
      checkpoint.target = path.join(runtimeDir, "opencode-v2/state/opencode.db");
      if (checkpoint.backupPath) {
        checkpoint.backupPath = await copyBackup(checkpoint.backupPath);
      }
      await writeFile(path.join(staging, checkpointName), JSON.stringify(checkpoint), { flag: "wx", mode: 0o600 });
      const fenceName = "opencode-v2/state/history-copy.pending";
      if (existsSync(path.join(legacyDir, fenceName))) {
        await mkdir(path.dirname(path.join(staging, fenceName)), { recursive: true });
        await copyFile(path.join(legacyDir, fenceName), path.join(staging, fenceName), constants.COPYFILE_EXCL);
      }
    } else if (preview?.v1HistoryCopyStartedAt || preview?.automaticHistoryCopy === true) {
      throw new Error("The unfinished history copy is missing its checkpoint; no files were changed.");
    }
    if (bootstrap && existsSync(bootstrap)) {
      await copyFile(bootstrap, path.join(staging, "desktop-bootstrap.json"), constants.COPYFILE_EXCL);
    }
    await writeFile(path.join(staging, "migration.json"), JSON.stringify({ version: 1, source: legacyDir }) + "\n", { flag: "wx", mode: 0o600 });
    await rename(staging, runtimeDir);
    published = true;
  } finally {
    if (!published) await rm(staging, { recursive: true, force: true });
  }
}
