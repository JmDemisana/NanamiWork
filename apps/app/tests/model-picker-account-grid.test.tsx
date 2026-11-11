import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

GlobalRegistrator.register({ url: "https://web.example/" });
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { ModelPickerList } = await import("../src/react-app/domains/models/model-picker-list");
const { useAntigravityAccountsStore } = await import("../src/react-app/domains/models/antigravity-accounts-store");
const { useChatGptAccountsStore } = await import("../src/react-app/domains/models/chatgpt-accounts-store");
const { useCopilotAccountsStore } = await import("../src/react-app/domains/models/copilot-accounts-store");
const { useLocalRouterStore } = await import("../src/react-app/domains/models/nanami-local-router");
const { PlatformProvider, createDefaultPlatform } = await import("../src/react-app/kernel/platform");

afterAll(() => GlobalRegistrator.unregister());

test("account groups use a borderless responsive grid in the saved order", async () => {
  const account = (email: string) => ({
    email, refreshToken: "", projectId: "", managedProjectId: "", addedAt: 0, lastUsed: 0,
    isActive: false, isPlus: false, quotas: [], quotaLoading: false, quotaError: null,
    models: [{ familyKey: "example", modelID: "example", rawId: "example", displayName: "Example", remainingFraction: 1, resetTime: null, supportsThinkingTier: false }],
  });
  useAntigravityAccountsStore.setState({ accounts: [account("a@example.invalid"), account("b@example.invalid"), account("c@example.invalid")] });
  useChatGptAccountsStore.setState({ accounts: [], loadAccounts: async () => {} });
  useCopilotAccountsStore.setState({ accounts: [], loadAccounts: async () => {} });
  useLocalRouterStore.setState({ accountOrder: ["google:b@example.invalid", "google:a@example.invalid", "google:c@example.invalid"] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const options = [{ providerID: "nanami", modelID: "router", title: "Gemini", description: "Nanami Router Models", behaviorTitle: "", behaviorLabel: "", behaviorDescription: "", behaviorValue: null, isFree: false }];
  await act(async () => root.render(createElement(PlatformProvider, { value: createDefaultPlatform() }, createElement(ModelPickerList, {
    chrome: "page", options, current: { providerID: "", modelID: "" }, query: "",
    onQueryChange: () => {}, onSelect: () => {}, leading: createElement("span", { "data-test-router": "" }, "Router"),
  }))));
  const grid = container.querySelector<HTMLElement>('[data-testid="model-account-grid"]');
  expect(grid?.classList.contains("grid")).toBe(true);
  expect(grid?.className).toContain("@[50rem]/modelgrid:grid-cols-2");
  expect(grid?.className).toContain("@[75rem]/modelgrid:grid-cols-3");
  expect(grid?.className).not.toContain("columns-");
  const groups = [...(grid?.children ?? [])];
  expect(groups.map((group) => group.querySelector("[data-testid]")?.getAttribute("data-testid"))).toEqual([
    "antigravity-account-group-b@example.invalid",
    "antigravity-account-group-a@example.invalid",
    "antigravity-account-group-c@example.invalid",
  ]);
  expect(groups.every((group) => !group.className.includes("border") && !group.className.includes("bg-card"))).toBe(true);
  const router = container.querySelector("[data-test-router]");
  expect(router?.parentElement?.textContent).toContain("Local Router");
  expect(router?.parentElement?.className).not.toContain("border");
  const topGrid = router?.parentElement?.parentElement;
  expect(topGrid?.classList.contains("grid")).toBe(true);
  expect(topGrid?.textContent).toContain("Nanami Router Models");

  await act(async () => root.render(createElement(PlatformProvider, { value: createDefaultPlatform() }, createElement(ModelPickerList, {
    chrome: "page", options: [], current: { providerID: "", modelID: "" }, query: "b@example.invalid",
    onQueryChange: () => {}, onSelect: () => {},
  }))));
  const filteredGrid = container.querySelector('[data-testid="model-account-grid"]');
  expect(filteredGrid?.children.length).toBe(1);
  expect(filteredGrid?.querySelector('[aria-label="Move b@example.invalid up"]')).toBeNull();
  await act(async () => root.unmount());
  container.remove();
});
