import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { globalOpencodeConfigDir, resolveGlobalOpencodeConfigPath } from "@openwork/paths";
import { readJsoncFile } from "./jsonc.js";
import { readLocalProviderAuth } from "./opencode-v2-local-auth.js";

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const hasAccounts = (value: unknown) => record(value) && (
  (Array.isArray(value.accounts) && value.accounts.length > 0)
  || (typeof value.username === "string" && typeof value.oauthToken === "string" && value.oauthToken.length > 0)
);

/** v2 does not yet mirror v1 OAuth accounts; never silently switch those users away. */
export async function hasNanamiV1SignIns(): Promise<boolean> {
  if ((await readLocalProviderAuth()).signIns.size > 0) return true;
  const directory = globalOpencodeConfigDir();
  for (const name of ["codex-accounts.json", "antigravity-accounts.json"]) {
    let content: string;
    try { content = await readFile(join(directory, name), "utf8"); }
    catch (error) {
      if (record(error) && error.code === "ENOENT") continue;
      throw new Error("Could not inspect NanamiWork account state safely.");
    }
    try { if (hasAccounts(JSON.parse(content))) return true; }
    catch { throw new Error("Could not inspect NanamiWork account state safely."); }
  }
  const config = (await readJsoncFile<unknown>(resolveGlobalOpencodeConfigPath(), {})).data;
  return record(config) && [config.x_nanami_codex, config.x_nanami_antigravity, config.x_nanami_copilot].some(hasAccounts);
}
