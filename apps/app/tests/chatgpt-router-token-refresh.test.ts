import { afterAll, expect, mock, test } from "bun:test";
import type { Client } from "../src/app/types";

let content = JSON.stringify({
  provider: { openai: { name: "keep provider" } },
  x_nanami_codex: { activeEmail: "one@example.invalid", accounts: [
    { email: "one@example.invalid", accessToken: "old-one", refreshToken: "refresh-one", planType: "plus" },
    { email: "two@example.invalid", accessToken: "old-two", refreshToken: "refresh-two", planType: "plus" },
  ] },
});
let writes = 0;
let refreshes = 0;

mock.module("../src/app/lib/desktop", () => ({
  getCachedDesktopHomeDir: async () => "C:/private-home",
  readOpencodeConfig: async () => ({ path: "C:/private-home/.config/nanamiwork/opencode.jsonc", content }),
  writeOpencodeConfig: async (_scope: string, _directory: string, next: string) => {
    await Promise.resolve();
    content = next;
    writes += 1;
    return { ok: true };
  },
  desktopFetchViaMain: async (url: string, init?: RequestInit) => {
    if (url.includes("auth.openai.com/oauth/token")) {
      refreshes += 1;
      const refresh = new URLSearchParams(String(init?.body)).get("refresh_token");
      const suffix = refresh === "refresh-one" ? "one" : "two";
      return Response.json({ access_token: `new-${suffix}`, refresh_token: `rotated-${suffix}` });
    }
    if (url.includes("/wham/usage")) {
      const headers = new Headers(init?.headers);
      if (headers.get("Authorization")?.includes("old-")) return new Response(null, { status: 401 });
      return Response.json({ plan_type: "plus", rate_limit: { primary_window: { used_percent: 50, limit_window_seconds: 1, reset_after_seconds: 0, reset_at: 0 } } });
    }
    if (url.includes("/codex/models")) return Response.json({ models: [] });
    throw new Error("Unexpected network request");
  },
  openDesktopUrl: async () => {},
}));

const { useChatGptAccountsStore, activateChatGptRouterAccount, chatGptProviderHasConflictingOverride } = await import("../src/react-app/domains/models/chatgpt-accounts-store");
afterAll(() => mock.restore());

test("concurrent quota refreshes preserve each account's rotated credentials", async () => {
  const account = (email: string, suffix: string, isActive: boolean) => ({
    email, planType: "plus" as const, accessToken: `old-${suffix}`, refreshToken: `refresh-${suffix}`,
    isActive, models: [], addedAt: 0, lastLoadedAt: 0,
  });
  useChatGptAccountsStore.setState({ accounts: [account("one@example.invalid", "one", true), account("two@example.invalid", "two", false)] });
  await Promise.all([useChatGptAccountsStore.getState().refreshQuotas(undefined, { allowTokenRefresh: true }), useChatGptAccountsStore.getState().refreshQuotas(undefined, { allowTokenRefresh: true })]);
  const saved = JSON.parse(content);
  expect(saved.x_nanami_codex.accounts.map((item: { refreshToken: string }) => item.refreshToken)).toEqual(["rotated-one", "rotated-two"]);
  expect(saved.x_nanami_codex.accounts.map((item: { accessToken: string }) => item.accessToken)).toEqual(["new-one", "new-two"]);
  expect(saved.provider.openai.name).toBe("keep provider");
  expect(writes).toBe(2);
  expect(refreshes).toBe(2);
});

test("background quota discovery never rotates credentials while another chat may be active", async () => {
  content = JSON.stringify({ x_nanami_codex: { accounts: [{ email: "one@example.invalid", accessToken: "old-one", refreshToken: "refresh-one", planType: "plus" }] } });
  writes = 0;
  refreshes = 0;
  useChatGptAccountsStore.setState({ accounts: [{ email: "one@example.invalid", planType: "plus", accessToken: "old-one",
    refreshToken: "refresh-one", isActive: true, models: [], addedAt: 0, lastLoadedAt: 0 }] });
  await useChatGptAccountsStore.getState().refreshQuotas();
  expect(refreshes).toBe(0);
  expect(writes).toBe(0);
  expect(useChatGptAccountsStore.getState().accounts[0]?.quotaError).toBe("Quota HTTP 401");
});

test("an unrelated OpenAI provider key or endpoint cannot silently override a routed account", () => {
  expect(chatGptProviderHasConflictingOverride({ provider: { openai: { name: "OpenAI" } } })).toBe(false);
  expect(chatGptProviderHasConflictingOverride({ provider: { openai: { options: { apiKey: "other" } } } })).toBe(true);
  expect(chatGptProviderHasConflictingOverride({ provider: { openai: { options: { apiKey: "same" } } } }, "same")).toBe(false);
  expect(chatGptProviderHasConflictingOverride({ provider: { openai: { options: { baseURL: "https://other.invalid" } } } })).toBe(true);
  expect(chatGptProviderHasConflictingOverride({ provider: { openai: { npm: "other-provider" } } })).toBe(true);
});

test("account activation uses the refreshed credentials belonging to each selected account", async () => {
  content = JSON.stringify({ x_nanami_codex: { activeEmail: "one@example.invalid", accounts: [
    { email: "one@example.invalid", accountId: "account-one", accessToken: "old-one", refreshToken: "refresh-one", planType: "plus" },
    { email: "two@example.invalid", accountId: "account-two", accessToken: "old-two", refreshToken: "refresh-two", planType: "plus" },
  ] } });
  const model = { modelID: "gpt-6.1-sol", displayName: "GPT", contextLimit: 1, outputLimit: 1, remainingFraction: 0.5, resetTime: null };
  useChatGptAccountsStore.setState({ accounts: [
    { email: "one@example.invalid", accountId: "account-one", planType: "plus", accessToken: "old-one", refreshToken: "refresh-one", isActive: true, models: [model], addedAt: 0, lastLoadedAt: 0 },
    { email: "two@example.invalid", accountId: "account-two", planType: "plus", accessToken: "old-two", refreshToken: "refresh-two", isActive: false, models: [model], addedAt: 0, lastLoadedAt: 0 },
  ] });
  const savedAuth: Array<{ accountId?: string; refresh?: string }> = [];
  let disposals = 0;
  const client = { config: { get: async () => ({ data: { provider: { openai: {} } } }) },
    auth: { set: async ({ auth }: { auth: { accountId?: string; refresh?: string } }) => { savedAuth.push(auth); return { data: true }; } },
    instance: { dispose: async () => { disposals += 1; return { data: true }; } },
  } as unknown as Client;
  await activateChatGptRouterAccount("one@example.invalid", "gpt-6.1-sol", client);
  await activateChatGptRouterAccount("two@example.invalid", "gpt-6.1-sol", client);
  expect(savedAuth.map((auth) => [auth.accountId, auth.refresh])).toEqual([["account-one", "rotated-one"], ["account-two", "rotated-two"]]);
  expect(disposals).toBe(2);
  expect(JSON.parse(content).x_nanami_codex.activeEmail).toBe("two@example.invalid");
});
