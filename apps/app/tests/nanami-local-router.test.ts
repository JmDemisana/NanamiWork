import { describe, expect, test } from "bun:test";
import {
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
});
