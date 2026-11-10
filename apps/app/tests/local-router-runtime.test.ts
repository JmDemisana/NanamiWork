import { afterAll, expect, mock, test } from "bun:test";
import type { Client, ModelRef } from "../src/app/types";
import type { OpenworkServerClient } from "../src/app/lib/openwork-server";
import { LOCAL_ROUTER_MODEL } from "../src/app/lib/local-router-ref";

const acquired: Array<{ workspaceId: string; sessionId: string; providerId: string; modelId: string }> = [];
const released: string[] = [];
const activated: string[] = [];
const accounts = ["one@example.invalid", "two@example.invalid"].map((email) => ({
  email, models: [{ modelID: "model-a", displayName: "Model A", remainingFraction: 0.5, resetTime: null, supportsThinkingTier: true }],
}));
const antigravity = { accounts, thinkingTier: "high", lastLoadedAt: 1 };

mock.module("../src/app/lib/runtime-env", () => ({ isDesktopRuntime: () => true }));
mock.module("../src/app/lib/openwork-server", () => ({
  isLoopbackOpenworkServerUrl: (value: string) => value.startsWith("http://127.0.0.1:"),
  readOpenworkServerSettings: () => ({ urlOverride: "http://127.0.0.1:8787", hostToken: "host-fixture" }),
  createOpenworkServerClient: () => ({
    acquireLocalRouterLease: async (input: typeof acquired[number]) => { acquired.push(input); return { id: (acquired.length === 1 ? "a" : "b").repeat(64) }; },
    releaseLocalRouterLease: async (id: string) => { released.push(id); return { ok: true }; },
  }),
}));
mock.module("../src/app/lib/opencode-v2-adapter", () => ({ isOpencodeV2BaseUrl: () => false }));
mock.module("../src/app/lib/opencode", () => ({ createClient: (_url: string, _root: string, _auth: unknown, options: { localRouterLease: { id: string } }) => ({ lease: options.localRouterLease.id }) }));
mock.module("../src/react-app/domains/connections/managed-engine-config", () => ({ readManagedDisabledProviders: async () => [] }));
mock.module("../src/react-app/domains/models/antigravity-accounts-store", () => ({
  useAntigravityAccountsStore: { getState: () => antigravity },
  activateAntigravityRouterAccount: async (email: string) => { activated.push(email); },
  restoreAntigravityRouterPin: async () => {},
}));
mock.module("../src/react-app/domains/models/chatgpt-accounts-store", () => ({
  useChatGptAccountsStore: { getState: () => ({ hasLoadedAccounts: true, accounts: [] }) }, activateChatGptRouterAccount: async () => {},
}));
mock.module("../src/react-app/domains/models/copilot-accounts-store", () => ({
  useCopilotAccountsStore: { getState: () => ({ hasLoadedAccounts: true, accounts: [] }) }, activateCopilotRouterAccount: async () => {},
}));

const { dispatchConfiguredLocalRouterTurn } = await import("../src/react-app/domains/models/local-router-runtime");
const { useLocalRouterStore } = await import("../src/react-app/domains/models/nanami-local-router");
afterAll(() => mock.restore());

test("each routed turn chooses a concrete account and releases its scoped server lease", async () => {
  useLocalRouterStore.setState({ mode: "priority", strategies: ["round-robin"], accountOrder: [], modelOrder: [], excludedAccounts: [], excludedModels: [], usage: {} });
  const sent: Array<{ model: ModelRef | null; lease: string }> = [];
  const input = {
    selected: LOCAL_ROUTER_MODEL, variant: null, sessionId: "ses_fixture", opencodeClient: {} as Client,
    opencodeBaseUrl: "http://127.0.0.1:8787/workspace/workspace/opencode",
    openworkClient: { baseUrl: "http://127.0.0.1:8787", token: "client-fixture" } as OpenworkServerClient,
    workspaceId: "workspace", workspaceRoot: "/fixture", options: [], localWorkspace: true, restrictToCloud: false, enabled: true,
    send: async ({ model, client }: { model: ModelRef | null; client: Client }) => {
      sent.push({ model, lease: String(Reflect.get(client, "lease")) });
      return "accepted";
    },
  };
  await dispatchConfiguredLocalRouterTurn(input);
  await dispatchConfiguredLocalRouterTurn(input);
  expect(input.selected).toEqual(LOCAL_ROUTER_MODEL);
  expect(activated).toEqual(["one@example.invalid", "two@example.invalid"]);
  expect(sent.map((entry) => entry.model)).toEqual([{ providerID: "google", modelID: "model-a" }, { providerID: "google", modelID: "model-a" }]);
  expect(sent.map((entry) => entry.lease)).toEqual(["a".repeat(64), "b".repeat(64)]);
  expect(released).toEqual(sent.map((entry) => entry.lease));
  expect(acquired.every((entry) => entry.sessionId === "ses_fixture" && entry.modelId === "model-a")).toBe(true);
});

test("a failed admission releases the lease without recording or replaying the turn", async () => {
  const before = JSON.stringify(useLocalRouterStore.getState().usage);
  const count = released.length;
  const input = {
    selected: LOCAL_ROUTER_MODEL, variant: null, sessionId: "ses_fixture", opencodeClient: {} as Client,
    opencodeBaseUrl: "http://127.0.0.1:8787/workspace/workspace/opencode",
    openworkClient: { baseUrl: "http://127.0.0.1:8787", token: "client-fixture" } as OpenworkServerClient,
    workspaceId: "workspace", workspaceRoot: "/fixture", options: [], localWorkspace: true, restrictToCloud: false, enabled: true,
    send: async () => { throw new Error("acceptance unknown"); },
  };
  await expect(dispatchConfiguredLocalRouterTurn(input)).rejects.toThrow("acceptance unknown");
  expect(released).toHaveLength(count + 1);
  expect(JSON.stringify(useLocalRouterStore.getState().usage)).toBe(before);
});
