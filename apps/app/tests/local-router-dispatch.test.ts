import { expect, test } from "bun:test";
import { LOCAL_ROUTER_MODEL } from "../src/app/lib/local-router-ref";
import { ModelAdmissionFence } from "../src/app/lib/model-admission-fence";
import { dispatchLocalRouterTurn } from "../src/react-app/domains/models/local-router-dispatch";
import { LocalRouterQuotaExhaustedError } from "../src/react-app/domains/models/local-router-errors";
import type { LocalRouterAccount, LocalRouterSettings } from "../src/react-app/domains/models/nanami-local-router";

const accounts: LocalRouterAccount[] = [
  { key: "a", kind: "antigravity", providerID: "google", accountID: "a", label: "A", providerLabel: "Antigravity", models: [
    { key: "m", modelID: "model-a", label: "Model A", remainingFraction: 0.5, resetTime: null, variant: "high" },
  ] },
  { key: "b", kind: "chatgpt", providerID: "openai", accountID: "b", label: "B", providerLabel: "ChatGPT", models: [
    { key: "n", modelID: "model-b", label: "Model B", remainingFraction: 0.7, resetTime: null, variant: "medium" },
  ] },
];

function setup() {
  let settings: LocalRouterSettings = { mode: "priority", strategies: ["round-robin"], accountOrder: [], modelOrder: [], excludedAccounts: [], excludedModels: [], usage: {} };
  let clock = 0;
  const activated: string[] = [];
  const sent: string[] = [];
  let idle = true;
  const input = {
    selected: LOCAL_ROUTER_MODEL, variant: null, localRuntime: true, fence: new ModelAdmissionFence(),
    settings: () => settings,
    accounts: async () => accounts,
    ensureIdle: async () => { if (!idle) throw new Error("Another chat is active"); },
    activate: async (candidate: { account: LocalRouterAccount }) => { activated.push(candidate.account.key); },
    record: (candidate: { key: string }) => { settings = { ...settings, usage: { ...settings.usage, [candidate.key]: { count: 1, lastUsedAt: ++clock } } }; },
    send: async (selection: { model: { providerID: string; modelID: string } | null; variant: string | null }) => {
      sent.push(`${selection.model?.providerID}/${selection.model?.modelID}:${selection.variant}`);
      return "accepted";
    },
  };
  return { input, sent, activated, setSettings: (next: Partial<LocalRouterSettings>) => { settings = { ...settings, ...next }; }, setIdle: (value: boolean) => { idle = value; } };
}

test("the selected router resolves a concrete model separately for each turn", async () => {
  const fixture = setup();
  await dispatchLocalRouterTurn(fixture.input);
  await dispatchLocalRouterTurn(fixture.input);
  expect(fixture.activated).toEqual(["a", "b"]);
  expect(fixture.sent).toEqual(["google/model-a:high", "openai/model-b:medium"]);
});

test("no strategy, exhausted accounts, and a busy engine never admit a turn", async () => {
  const fixture = setup();
  fixture.setSettings({ strategies: [] });
  await expect(dispatchLocalRouterTurn(fixture.input)).rejects.toThrow("Choose a routing strategy");
  fixture.setSettings({ strategies: ["round-robin"], excludedAccounts: ["a", "b"] });
  await expect(dispatchLocalRouterTurn(fixture.input)).rejects.toThrow("Include at least one");
  fixture.setSettings({ excludedAccounts: [] });
  fixture.setIdle(false);
  await expect(dispatchLocalRouterTurn(fixture.input)).rejects.toThrow("Another chat is active");
  expect(fixture.activated).toEqual([]);
  expect(fixture.sent).toEqual([]);
});

test("a failed admission is not recorded or replayed", async () => {
  const fixture = setup();
  const failure = { ...fixture.input, send: async () => { throw new Error("acceptance unknown"); } };
  await expect(dispatchLocalRouterTurn(failure)).rejects.toThrow("acceptance unknown");
  await dispatchLocalRouterTurn(fixture.input);
  expect(fixture.activated).toEqual(["a", "a"]);
  expect(fixture.sent).toEqual(["google/model-a:high"]);
});

test("ordinary models pass through unchanged and do not activate accounts", async () => {
  const fixture = setup();
  await dispatchLocalRouterTurn({ ...fixture.input, selected: { providerID: "other", modelID: "direct" }, variant: "low" });
  expect(fixture.sent).toEqual(["other/direct:low"]);
  expect(fixture.activated).toEqual([]);
});


test("a candidate exhausted during refresh falls through to the next account", async () => {
  const fixture = setup();
  const activated: string[] = [];
  await dispatchLocalRouterTurn({ ...fixture.input, activate: async (candidate) => {
    activated.push(candidate.account.key);
    if (candidate.account.key === "a") throw new LocalRouterQuotaExhaustedError();
  } });
  expect(activated).toEqual(["a", "b"]);
  expect(fixture.sent).toEqual(["openai/model-b:medium"]);
});

test("unknown quota is refreshed and is not mistaken for exhausted quota", async () => {
  const fixture = setup();
  const unknown = [{ ...accounts[0]!, models: [{ ...accounts[0]!.models[0]!, remainingFraction: null }] }];
  let refreshed = false;
  await dispatchLocalRouterTurn({ ...fixture.input,
    accounts: async () => refreshed ? accounts.slice(0, 1) : unknown,
    activate: async () => { refreshed = true; },
  });
  expect(fixture.sent).toEqual(["google/model-a:high"]);
  fixture.sent.length = 0;
  await expect(dispatchLocalRouterTurn({ ...fixture.input, accounts: async () => unknown })).rejects.toThrow("could not verify quota");
  expect(fixture.sent).toEqual([]);
});

test("steering stays on the active routed model without switching or refreshing accounts", async () => {
  const fixture = setup();
  const account = accounts[1]!;
  const model = account.models[0]!;
  await dispatchLocalRouterTurn({ ...fixture.input,
    steer: true,
    steeringCandidate: () => ({ key: "active", account, model, ref: { providerID: account.providerID, modelID: model.modelID } }),
    accounts: async () => { throw new Error("steering must not reload accounts"); },
    ensureIdle: async () => { throw new Error("steering must not acquire a lease"); },
  });
  expect(fixture.activated).toEqual([]);
  expect(fixture.sent).toEqual(["openai/model-b:medium"]);
});
