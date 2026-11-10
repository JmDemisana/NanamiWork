import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveGlobalOpencodeConfigPath } from "@openwork/paths";

function inside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** A router may never read or modify a separate OpenCode profile. */
export function localRouterProfilePaths(env: NodeJS.ProcessEnv): { configPath: string; authPath: string } | null {
  const config = env.OPENCODE_CONFIG_DIR?.trim() ?? "";
  const data = env.XDG_DATA_HOME?.trim() ?? "";
  if (env.NANAMIWORK_ISOLATED !== "1" || !isAbsolute(config) || !isAbsolute(data) || !inside(config, data)) return null;
  const home = env.NANAMIWORK_REAL_HOME?.trim() || env.USERPROFILE?.trim() || env.HOME?.trim();
  if (home && (inside(join(home, ".config", "opencode"), config) || inside(join(home, ".local", "share", "opencode"), data))) return null;
  return { configPath: resolveGlobalOpencodeConfigPath({ env }), authPath: join(data, "opencode", "auth.json") };
}
