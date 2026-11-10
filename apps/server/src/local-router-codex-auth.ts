import { readFile, writeFile } from "node:fs/promises";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { ApiError } from "./errors.js";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function codexAccessTokenExpiry(token: unknown): number | null {
  if (typeof token !== "string") return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return record(payload) && typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch { return null; }
}

async function optionalText(path: string): Promise<string | null> {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if (record(error) && error.code === "ENOENT") return null;
    throw new ApiError(409, "local_router_auth_unknown", "Could not verify the current ChatGPT credentials. Nothing was sent.");
  }
}

/**
 * OpenCode may have rotated the active OAuth credential after the account list
 * was last read. Save it back to its matching private account before any
 * provider reload can replace it with an older token. Never guess an identity.
 */
export async function reconcileLocalRouterCodexAuth(input: { configPath: string; authPath: string }): Promise<void> {
  const rawConfig = await optionalText(input.configPath);
  if (!rawConfig) return;
  const errors: ParseError[] = [];
  const config: unknown = parse(rawConfig, errors);
  if (errors.length || !record(config)) throw new ApiError(409, "local_router_auth_unknown", "Could not verify the local account settings. Nothing was sent.");
  const meta = record(config.x_nanami_codex) ? config.x_nanami_codex : null;
  const accounts = Array.isArray(meta?.accounts) ? meta.accounts.filter(record) : [];
  if (!accounts.length) return;
  const rawAuth = await optionalText(input.authPath);
  if (!rawAuth) return;
  let authFile: unknown;
  try { authFile = JSON.parse(rawAuth); }
  catch { throw new ApiError(409, "local_router_auth_unknown", "Could not verify the current ChatGPT credentials. Nothing was sent."); }
  if (!record(authFile) || authFile.openai == null) return;
  const auth = authFile.openai;
  if (!record(auth)) throw new ApiError(409, "local_router_auth_unknown", "Could not verify the current ChatGPT credentials. Nothing was sent.");
  if (auth.type === "api") {
    if (typeof auth.key === "string" && accounts.some((account) => account.apiKey === auth.key)) return;
    throw new ApiError(409, "local_router_auth_unknown", "The current OpenAI credential is not linked to a saved account. Nothing was sent.");
  }
  if (auth.type !== "oauth" || typeof auth.access !== "string" || !auth.access.trim()
    || typeof auth.refresh !== "string" || !auth.refresh.trim()) {
    throw new ApiError(409, "local_router_auth_unknown", "Could not verify the current ChatGPT credentials. Nothing was sent.");
  }
  const matches = accounts.filter((account) =>
    (typeof auth.accountId === "string" && auth.accountId.length > 0 && account.accountId === auth.accountId)
    || account.accessToken === auth.access || account.refreshToken === auth.refresh);
  if (matches.length !== 1) throw new ApiError(409, "local_router_auth_unknown", "The current ChatGPT credential cannot be matched safely. Nothing was sent.");
  const selected = matches[0]!;
  if (selected.accessToken === auth.access && selected.refreshToken === auth.refresh) return;
  const engineExpiry = codexAccessTokenExpiry(auth.access);
  const savedExpiry = codexAccessTokenExpiry(selected.accessToken);
  if (engineExpiry === null || savedExpiry === null || engineExpiry === savedExpiry) {
    throw new ApiError(409, "local_router_auth_unknown", "Could not safely compare refreshed ChatGPT credentials. Nothing was sent.");
  }
  if (engineExpiry < savedExpiry) return;
  // Keep all other accounts, JSONC comments, and provider settings intact.
  const originalAccounts = Array.isArray(meta?.accounts) ? meta.accounts : [];
  const index = originalAccounts.indexOf(selected);
  let next = applyEdits(rawConfig, modify(rawConfig, ["x_nanami_codex", "accounts", index, "accessToken"], auth.access, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  next = applyEdits(next, modify(next, ["x_nanami_codex", "accounts", index, "refreshToken"], auth.refresh, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  try { await writeFile(input.configPath, next, "utf8"); }
  catch { throw new ApiError(409, "local_router_auth_unknown", "Could not save refreshed ChatGPT credentials. Nothing was sent."); }
}
