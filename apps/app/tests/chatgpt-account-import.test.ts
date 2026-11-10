import { afterAll, expect, mock, test } from "bun:test";
import { parse } from "jsonc-parser";
let config = '{\n  // keep this comment\n  "provider": {"github-copilot": {"options": {"apiKey": "copilot-fixture"}}},\n  "x_nanami_codex": {"accounts": [{"email":"existing@example.invalid","accessToken":"old"}]}\n}';
let pending = "";
let cleared = false;
const jwt = (payload: unknown) => `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
mock.module("../src/app/lib/desktop", () => ({
  getCachedDesktopHomeDir: async () => "C:/fixture",
  openDesktopUrl: async () => {}, desktopFetchViaMain: async () => new Response(null, { status: 500 }),
  readOpencodeConfig: async (scope: string) => scope === "global" ? { path: "C:/fixture/opencode.jsonc" } : { exists: true, content: config },
  writeOpencodeConfig: async (_scope: string, _dir: string, content: string) => { config = content; return { ok: true }; },
  readNanamiConfigFile: async () => ({ exists: true, content: pending }),
  writeNanamiConfigFile: async () => { cleared = true; return { ok: true }; },
}));
const { importPendingChatGptAccount } = await import("../src/react-app/domains/models/chatgpt-accounts-store");
afterAll(() => mock.restore());

test("ChatGPT callback adds the new account while preserving existing accounts, Copilot and JSONC comments", async () => {
  pending = JSON.stringify({ access_token: jwt({}), id_token: jwt({ email: "new@example.invalid", "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } }), refresh_token: "fixture-refresh", account_id: "fixture-id" });
  expect(await importPendingChatGptAccount()).toBe("new@example.invalid");
  const result = parse(config);
  expect(result.x_nanami_codex.accounts.map((account: { email: string }) => account.email)).toEqual(["existing@example.invalid", "new@example.invalid"]);
  expect(result.x_nanami_codex.activeEmail).toBe("new@example.invalid");
  expect(result.provider["github-copilot"].options.apiKey).toBe("copilot-fixture");
  expect(result.enabled_providers).toBeUndefined();
  expect(config).toContain("// keep this comment");
  expect(cleared).toBe(true);
});

test("adding ChatGPT preserves a custom OpenAI provider and other enabled providers", async () => {
  config = '{ "enabled_providers": ["github-copilot"], "provider": {"openai": {"options": {"baseURL": "https://example.invalid"}}} }';
  pending = JSON.stringify({ access_token: jwt({}), id_token: jwt({ email: "new@example.invalid" }) });
  await importPendingChatGptAccount();
  const result = parse(config);
  expect(result.enabled_providers).toEqual(["github-copilot", "openai"]);
  expect(result.provider.openai.options.baseURL).toBe("https://example.invalid");
});

test("ChatGPT callback without an account identity is not discarded or reported as successful", async () => {
  cleared = false;
  pending = JSON.stringify({ access_token: jwt({}), id_token: jwt({}) });
  await expect(importPendingChatGptAccount()).rejects.toThrow("account email");
  expect(cleared).toBe(false);
});
