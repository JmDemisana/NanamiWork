import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { Client } from "../src/app/types";

let content = "";
let writes = 0;
let tokenStatus = 200;
const calls: string[] = [];

mock.module("../src/app/lib/desktop", () => ({
  getCachedDesktopHomeDir: async () => "C:/private-home",
  readOpencodeConfig: async (scope: string) => scope === "global"
    ? { path: "C:/private-home/.config/nanamiwork/opencode.jsonc", content }
    : { path: "C:/private-home/.config/nanamiwork/opencode.jsonc", content },
  writeOpencodeConfig: async () => { writes += 1; },
  desktopFetchViaMain: async (url: string) => {
    calls.push(url);
    if (url.endsWith("/copilot_internal/v2/token")) return new Response(JSON.stringify({ token: "session-fixture", expires_at: Math.floor(Date.now() / 1000) + 3600, sku: "student" }), { status: tokenStatus });
    if (url.endsWith("/copilot_internal/user")) return new Response(JSON.stringify({ quota_snapshots: { premium_interactions: { percent_remaining: 42 } } }), { status: 200 });
    if (url.endsWith("/user")) return new Response(JSON.stringify({ login: "fixture-user" }), { status: 200 });
    throw new Error("Unexpected network request");
  },
}));

const { useCopilotAccountsStore, activateCopilotRouterAccount } = await import("../src/react-app/domains/models/copilot-accounts-store");

beforeEach(() => {
  content = JSON.stringify({ provider: { "github-copilot": { options: { apiKey: "gho_fixture" } } } });
  writes = 0;
  tokenStatus = 200;
  calls.length = 0;
  useCopilotAccountsStore.setState({ accounts: [], activeUsername: null, account: null, loading: false, hasLoadedAccounts: false, error: null });
});

afterAll(() => mock.restore());

test("recovers a verified Copilot account from the app's configured provider without writing config", async () => {
  await useCopilotAccountsStore.getState().loadAccounts();
  const state = useCopilotAccountsStore.getState();
  expect(state.accounts.map((account) => account.username)).toEqual(["fixture-user"]);
  expect(state.account?.source).toBe("configured-provider");
  expect(state.account?.models[0]?.remainingFraction).toBe(0.42);
  expect(writes).toBe(0);
  await state.selectAccount("fixture-user");
  expect(writes).toBe(0);
});

test("does not invent an account when entitlement verification fails", async () => {
  tokenStatus = 401;
  await useCopilotAccountsStore.getState().loadAccounts();
  expect(useCopilotAccountsStore.getState().accounts).toEqual([]);
  expect(writes).toBe(0);
});

test("does not restore an intentionally removed account", async () => {
  content = JSON.stringify({
    provider: { "github-copilot": { options: { apiKey: "gho_fixture" } } },
    x_nanami_copilot: { deletedAtByUsername: { "fixture-user": 123 }, accounts: [] },
  });
  await useCopilotAccountsStore.getState().loadAccounts();
  expect(useCopilotAccountsStore.getState().accounts).toEqual([]);
  expect(writes).toBe(0);
});

test("routing refreshes the verified configured provider and fails if its credential changes", async () => {
  await useCopilotAccountsStore.getState().loadAccounts();
  let disposals = 0;
  const client = { instance: { dispose: async () => { disposals += 1; return { data: true }; } } } as unknown as Client;
  await activateCopilotRouterAccount("fixture-user", "gpt-4.1", client);
  expect(disposals).toBe(1);
  expect(writes).toBe(0);
  content = JSON.stringify({ provider: { "github-copilot": { options: { apiKey: "gho_changed" } } } });
  await expect(activateCopilotRouterAccount("fixture-user", "gpt-4.1", client)).rejects.toThrow("account changed");
  expect(disposals).toBe(1);
});
