import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { reconcileLocalRouterCodexAuth } from "../src/local-router-codex-auth.js";
import { localRouterProfilePaths } from "../src/local-router-profile.js";

const token = (exp: number) => `fixture.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.fixture`;

test("a newer engine credential is saved only to its matching private account", async () => {
  const root = await mkdtemp(join(tmpdir(), "router-auth-test-"));
  const configPath = join(root, "opencode.jsonc"), authPath = join(root, "auth.json");
  const old = token(100), fresh = token(200);
  const original = `{
    // keep this comment and unrelated providers
    "provider": { "other": { "name": "untouched" } },
    "x_nanami_codex": { "activeEmail": "one@example.invalid", "accounts": [
      { "email": "one@example.invalid", "accountId": "account-one", "accessToken": "${old}", "refreshToken": "old-refresh" },
      { "email": "two@example.invalid", "accountId": "account-two", "accessToken": "second", "refreshToken": "second-refresh" }
    ] }
  }`;
  try {
    await writeFile(configPath, original);
    await writeFile(authPath, JSON.stringify({ openai: { type: "oauth", accountId: "account-one", access: fresh, refresh: "new-refresh" } }));
    await reconcileLocalRouterCodexAuth({ configPath, authPath });
    const result = await readFile(configPath, "utf8");
    const parsed = parse(result);
    expect(result).toContain("// keep this comment");
    expect(parsed.x_nanami_codex.accounts[0].accessToken).toBe(fresh);
    expect(parsed.x_nanami_codex.accounts[0].refreshToken).toBe("new-refresh");
    expect(parsed.x_nanami_codex.accounts[1].refreshToken).toBe("second-refresh");
    expect(parsed.provider.other.name).toBe("untouched");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ambiguous or unreadable credentials fail closed without changing the account file", async () => {
  const root = await mkdtemp(join(tmpdir(), "router-auth-test-"));
  const configPath = join(root, "opencode.jsonc"), authPath = join(root, "auth.json");
  const original = JSON.stringify({ x_nanami_codex: { accounts: [{ email: "one@example.invalid", accountId: "one", accessToken: token(100), refreshToken: "saved" }] } });
  try {
    await writeFile(configPath, original);
    await writeFile(authPath, JSON.stringify({ openai: { type: "oauth", accountId: "other", access: token(200), refresh: "different" } }));
    await expect(reconcileLocalRouterCodexAuth({ configPath, authPath })).rejects.toThrow("cannot be matched safely");
    expect(await readFile(configPath, "utf8")).toBe(original);
    await writeFile(authPath, "{ invalid");
    await expect(reconcileLocalRouterCodexAuth({ configPath, authPath })).rejects.toThrow("Could not verify");
    expect(await readFile(configPath, "utf8")).toBe(original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the router refuses a shared OpenCode profile or data outside NanamiWork's chosen config", async () => {
  const home = await mkdtemp(join(tmpdir(), "router-profile-test-"));
  const privateConfig = join(home, ".config", "nanamiwork");
  await mkdir(privateConfig, { recursive: true });
  try {
    const env = { NANAMIWORK_ISOLATED: "1", USERPROFILE: home, HOME: home, OPENCODE_CONFIG_DIR: privateConfig, XDG_DATA_HOME: join(privateConfig, "data") };
    expect(localRouterProfilePaths(env)?.authPath).toBe(join(privateConfig, "data", "opencode", "auth.json"));
    expect(localRouterProfilePaths({ ...env, OPENCODE_CONFIG_DIR: join(home, ".config", "opencode"), XDG_DATA_HOME: join(home, ".config", "opencode", "data") })).toBeNull();
    expect(localRouterProfilePaths({ ...env, XDG_DATA_HOME: join(home, ".local", "share") })).toBeNull();
    expect(localRouterProfilePaths({ ...env, NANAMIWORK_ISOLATED: "0" })).toBeNull();
  } finally { await rm(home, { recursive: true, force: true }); }
});
