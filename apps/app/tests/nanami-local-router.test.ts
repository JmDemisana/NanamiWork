import { describe, expect, test } from "bun:test";
import {
  buildLocalRouterAccounts,
  resolveLocalRouterChoice,
  useLocalRouterStore,
  type LocalRouterAccount,
  type LocalRouterSettings,
} from "../src/react-app/domains/models/nanami-local-router";

const accounts: LocalRouterAccount[] = [
  { key: "b", kind: "local", providerID: "p", accountID: "b", label: "B", providerLabel: "P", models: [
    { key: "m2", modelID: "m2", label: "M2", remainingFraction: null, resetTime: null },
    { key: "m1", modelID: "m1", label: "M1", remainingFraction: 0.5, resetTime: null },
  ] },
  { key: "a", kind: "local", providerID: "p", accountID: "a", label: "A", providerLabel: "P", models: [
    { key: "m1", modelID: "m1", label: "M1", remainingFraction: 0.2, resetTime: null },
    { key: "m2", modelID: "m2", label: "M2", remainingFraction: 0, resetTime: null },
  ] },
];

const settings: LocalRouterSettings = {
  mode: "priority", strategies: ["round-robin"], modelOrder: [], accountOrder: [],
  excludedAccounts: [], excludedModels: [], usage: {},
};

describe("local router", () => {
  test("matches picker models and keeps disabled connected accounts visible", () => {
    const model = (providerID: string, modelID: string) => ({
      providerID, modelID, title: modelID, description: providerID,
      behaviorTitle: "", behaviorLabel: "", behaviorDescription: "", behaviorValue: null,
      isFree: false,
    });
    const result = buildLocalRouterAccounts({
      antigravity: [{ email: "test@example.invalid", models: [{ modelID: "g1", displayName: "G1", remainingFraction: 0.5, resetTime: null }] }],
      chatgpt: [{ email: "chat@example.invalid", models: [{ modelID: "o1", displayName: "O1", remainingFraction: 0.8, resetTime: null }] }],
      copilot: [{ username: "example", models: [{ modelID: "c1", displayName: "C1", remainingFraction: 0.4, resetTime: null }] }],
      disabledProviders: ["openai"],
      options: [model("google", "g1"), model("google", "hidden-tier"), model("openai", "hidden-openai"), model("github-copilot", "hidden-copilot"), model("nanami", "router"), model("other", "m1"), { ...model("other", "disabled"), disabled: true }],
    });
    expect(result.flatMap((account) => account.models.map((item) => item.modelID))).toEqual(["g1", "o1", "c1", "m1"]);
    expect(result.some((account) => account.providerID === "nanami")).toBe(false);
    expect(result.find((account) => account.kind === "chatgpt")?.unavailableReason).toContain("disabled");
    const blocked = result.find((account) => account.kind === "chatgpt");
    expect(blocked && resolveLocalRouterChoice([blocked], settings)).toBeNull();
  });

  test("an unverified Copilot provider cannot bypass account discovery", () => {
    const result = buildLocalRouterAccounts({ options: [{
      providerID: "github-copilot", modelID: "gpt-4.1", title: "Copilot", description: "Copilot",
      behaviorTitle: "", behaviorLabel: "", behaviorDescription: "", behaviorValue: null, isFree: false,
    }] });
    expect(result).toEqual([]);
  });

  test("list modes follow displayed default and saved order", () => {
    expect(resolveLocalRouterChoice(accounts, { ...settings, mode: "account" })?.account.key).toBe("b");
    expect(resolveLocalRouterChoice(accounts, { ...settings, mode: "model", modelOrder: ["m1", "m2"], accountOrder: ["a", "b"] })?.account.key).toBe("a");
    expect(resolveLocalRouterChoice(accounts, { ...settings, mode: "account", accountOrder: ["b", "a"], modelOrder: ["m1", "m2"] })?.model.key).toBe("m1");
  });

  test("skips exhausted quota and returns null when all candidates are exhausted", () => {
    expect(resolveLocalRouterChoice(accounts, { ...settings, mode: "account", accountOrder: ["a", "b"], modelOrder: ["m2", "m1"] })?.model.key).toBe("m1");
    const exhausted = accounts.map((account) => ({ ...account, models: account.models.map((model) => ({ ...model, remainingFraction: 0 })) }));
    expect(resolveLocalRouterChoice(exhausted, settings)).toBeNull();
  });

  test("skips an account if either its short or long quota window is exhausted", () => {
    const result = buildLocalRouterAccounts({
      chatgpt: [{
        email: "chat@example.invalid",
        primaryWindow: { remainingFraction: 0, resetTimeIso: "2099-11-10T00:00:00Z" },
        secondaryWindow: { remainingFraction: 0.9, resetTimeIso: null },
        models: [{ modelID: "gpt", displayName: "GPT", remainingFraction: 0.9, resetTime: null }],
      }],
      copilot: [{
        username: "example", quotaRemainingPct: 0,
        models: [{ modelID: "copilot", displayName: "Copilot", remainingFraction: null, resetTime: null }],
      }],
    });
    expect(result.flatMap((account) => account.models.map((model) => model.remainingFraction))).toEqual([0, 0]);
    expect(resolveLocalRouterChoice(result, settings)).toBeNull();
  });

  test("a cached empty quota after its reset becomes eligible for a fresh check", () => {
    const result = buildLocalRouterAccounts({ antigravity: [{ email: "test@example.invalid", models: [
      { modelID: "g1", displayName: "G1", remainingFraction: 0, resetTime: "2000-01-01T00:00:00Z" },
    ] }] });
    expect(result[0]?.models[0]?.remainingFraction).toBeNull();
    expect(resolveLocalRouterChoice(result, settings)?.model.modelID).toBe("g1");
  });

  test("unknown reset times use round robin to break ties", () => {
    const next = resolveLocalRouterChoice(accounts, { ...settings, strategies: ["nearest-reset"], usage: { "b|m2": { count: 1, lastUsedAt: 1 } } });
    expect(next?.model.modelID).not.toBe("m2");
  });

  test("earliest and latest reset choose the corresponding known reset", () => {
    const withResets: LocalRouterAccount[] = [{ ...accounts[0]!, models: [
      { ...accounts[0]!.models[0]!, resetTime: "2099-01-01T00:00:00Z" },
      { ...accounts[0]!.models[1]!, resetTime: "2099-02-01T00:00:00Z" },
    ] }];
    expect(resolveLocalRouterChoice(withResets, { ...settings, strategies: ["nearest-reset"] })?.model.modelID).toBe("m2");
    expect(resolveLocalRouterChoice(withResets, { ...settings, strategies: ["never-used"] })?.model.modelID).toBe("m1");
    withResets[0]!.models[0]!.resetTime = "invalid";
    expect(resolveLocalRouterChoice(withResets, { ...settings, strategies: ["never-used"] })?.model.modelID).toBe("m1");
  });

  test("quota priorities put unknown quota after known quota", () => {
    const next = resolveLocalRouterChoice(accounts, { ...settings, strategies: ["highest-quota"] });
    expect(next?.account.key).toBe("b");
    expect(next?.model.key).toBe("m1");
  });

  test("picker reordering preserves other account keys", () => {
    useLocalRouterStore.setState({ ...settings, accountOrder: ["b", "local", "a"] });
    useLocalRouterStore.getState().moveAccount("a", -1, ["b", "a"]);
    expect(useLocalRouterStore.getState().accountOrder).toEqual(["a", "local", "b"]);
  });

  test("strategy toggles select one option or turn routing off", () => {
    useLocalRouterStore.setState(settings);
    useLocalRouterStore.getState().toggleStrategy("highest-quota");
    expect(useLocalRouterStore.getState().strategies).toEqual(["highest-quota"]);
    useLocalRouterStore.getState().toggleStrategy("random");
    expect(useLocalRouterStore.getState().strategies).toEqual(["random"]);
    useLocalRouterStore.getState().toggleStrategy("random");
    expect(useLocalRouterStore.getState().strategies).toEqual([]);
    expect(resolveLocalRouterChoice(accounts, useLocalRouterStore.getState())).toBeNull();
  });
});
