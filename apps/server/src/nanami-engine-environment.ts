import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { envKey, setEnv } from "@openwork/paths";

/** Some plugins ignore XDG on Windows and even migrate/delete another app's files. */
export async function isolateNanamiEngineEnvironment(
  env: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv | undefined,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const opts = { platform };
  const value = (source: NodeJS.ProcessEnv | undefined, key: string) => {
    const name = envKey(source, key, opts);
    return name === undefined ? undefined : source?.[name];
  };
  if (value(env, "NANAMIWORK_ISOLATED") !== "1") return;
  const home = value(env, "NANAMIWORK_ENGINE_HOME")?.trim();
  if (!home) throw new Error("NanamiWork's private engine home is not configured.");
  const realHome = value(env, platform === "win32" ? "USERPROFILE" : "HOME");
  if (realHome) setEnv(env, "NANAMIWORK_REAL_HOME", realHome, opts);
  const paths = platform === "win32"
    ? { HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local") }
    : { HOME: home };
  for (const [key, directory] of Object.entries(paths)) {
    if (value(overrides, key)?.trim()) continue;
    await mkdir(directory, { recursive: true });
    setEnv(env, key, directory, opts);
  }
}
