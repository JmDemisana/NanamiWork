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
  test("includes other eligible providers and avoids duplicate account models", () => {
    const model = (providerID: string, modelID: string) => ({
      providerID, modelID, title: modelID, description: providerID,
      behaviorTitle: "", behaviorLabel: "", behaviorDescription: "", behaviorValue: null,
      isFree: false,
    });
    const result = buildLocalRouterAccounts({
      antigravity: [{ email: "test@example.invalid", models: [{ modelID: "g1", displayName: "G1", remainingFraction: 0.5, resetTime: null }] }],
      options: [model("google", "g1"), model("google", "g2"), model("nanami", "router"), model("other", "m1"), { ...model("other", "disabled"), disabled: true }],
    });
    expect(result.flatMap((account) => account.models.map((item) => item.modelID))).toEqual(["g1", "g2", "router", "m1"]);
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

  test("unknown reset times tie and fall through to the next priority", () => {
    const next = resolveLocalRouterChoice(accounts, { ...settings, strategies: ["nearest-reset", "lowest-quota"] });
    expect(next?.account.key).toBe("a");
    expect(next?.model.key).toBe("m1");
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

  test("round robin and random are exclusive at first and always last", () => {
    useLocalRouterStore.setState(settings);
    useLocalRouterStore.getState().toggleStrategy("highest-quota");
    expect(useLocalRouterStore.getState().strategies).toEqual(["round-robin"]);
    useLocalRouterStore.getState().toggleStrategy("round-robin");
    expect(resolveLocalRouterChoice(accounts, useLocalRouterStore.getState())).toBeNull();
    useLocalRouterStore.getState().toggleStrategy("highest-quota");
    useLocalRouterStore.getState().toggleStrategy("random");
    useLocalRouterStore.getState().toggleStrategy("lowest-quota");
    expect(useLocalRouterStore.getState().strategies).toEqual(["highest-quota", "lowest-quota", "random"]);
    useLocalRouterStore.getState().moveStrategy("random", -1);
    useLocalRouterStore.getState().moveStrategy("lowest-quota", 1);
    useLocalRouterStore.getState().toggleStrategy("round-robin");
    expect(useLocalRouterStore.getState().strategies).toEqual(["highest-quota", "lowest-quota", "random"]);
  });
});
