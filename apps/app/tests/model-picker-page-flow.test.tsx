import { afterAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { ModelOption } from "../src/app/types";

GlobalRegistrator.register({ url: "https://web.example/" });
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

mock.module("../src/react-app/domains/models/model-picker-panel", () => ({
  ModelPickerPanel: ({ leading }: { leading: ReactNode }) => createElement("div", { "data-testid": "model-list" }, leading),
}));
mock.module("../src/react-app/domains/models/model-picker-list", () => ({
  ModelProviderLoginBar: () => createElement("div", null, "Provider logins"),
}));
mock.module("../src/react-app/domains/models/use-model-catalog", () => ({
  useModelChoice: () => ({ loginOpen: false, choose: (_option: unknown, commit: () => void) => commit() }),
}));
mock.module("../src/react-app/shell/workspace-provider", () => ({
  useWorkspace: () => ({ client: null, opencodeBaseUrl: "", selectedWorkspaceRoot: "" }),
  useWorkspaceMaybe: () => null,
}));
mock.module("../src/react-app/kernel/use-workspace-model-default", () => ({ useSetWorkspaceDefaultModel: () => () => {} }));
mock.module("../src/react-app/domains/cloud/desktop-config-provider", () => ({ useCheckDesktopRestriction: () => () => false }));
mock.module("../src/react-app/domains/cloud/den-auth-provider", () => ({ useDenAuth: () => ({ isSignedIn: false, status: "signed_out" }) }));
const providerListModule = await import("../src/react-app/infra/provider-list-query");
mock.module("../src/react-app/infra/provider-list-query", () => ({
  ...providerListModule,
  useProviderListQuery: () => ({ data: null }),
  getConnectedProviderItems: () => [],
}));

const { ModelPickerPage } = await import("../src/react-app/domains/models/model-picker-page");
const { ModelPickerPageHostProvider, useModelPickerPageHost } = await import("../src/react-app/domains/models/model-picker-page-host");
const { useChatGptAccountsStore } = await import("../src/react-app/domains/models/chatgpt-accounts-store");
const { useCopilotAccountsStore } = await import("../src/react-app/domains/models/copilot-accounts-store");

const option = (providerID: string, modelID: string): ModelOption => ({
  providerID, modelID, title: modelID, description: providerID,
  behaviorTitle: "", behaviorLabel: "", behaviorDescription: "", behaviorValue: null, isFree: false,
});

function TestShell() {
  const host = useModelPickerPageHost();
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  return createElement("main", null,
    createElement("div", { ref: host?.setHost, hidden: !host?.active, "data-testid": "page-host" }),
    createElement("div", { hidden: host?.active, "data-testid": "chat" },
      "Chat stays mounted",
      createElement(ModelPickerPage, {
        open, options: [option("nanami", "gemini"), option("anthropic", "claude")], query, setQuery,
        disabledProviders: ["openai"],
        target: "session", current: { providerID: "", modelID: "" },
        onSelect: () => {}, onBehaviorChange: () => {}, onOpenSettings: () => {}, onClose: () => setOpen(false),
      }),
    ),
  );
}

afterAll(() => {
  mock.restore();
  GlobalRegistrator.unregister();
});

test("the picker occupies the page, keeps chat mounted, and opens router settings as a page", async () => {
  useChatGptAccountsStore.setState({ accounts: [{
    email: "chat@example.invalid", planType: "plus", isActive: true, addedAt: 0, lastLoadedAt: 0,
    models: [{ modelID: "gpt-test", displayName: "GPT test", contextLimit: 1, outputLimit: 1, remainingFraction: 0.5, resetTime: null }],
  }] });
  useCopilotAccountsStore.setState({ accounts: [{
    username: "example", planSku: "test", expiresAt: 0, addedAt: 0, lastUsed: 0, oauthToken: "", copilotToken: "", isActive: true,
    models: [{ modelID: "copilot-test", displayName: "Copilot test", contextLimit: 1, outputLimit: 1, remainingFraction: 0.5, resetTime: null }],
  }] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(ModelPickerPageHostProvider, null, createElement(TestShell))));
  const chat = container.querySelector<HTMLElement>('[data-testid="chat"]');
  const picker = container.querySelector<HTMLElement>('[data-testid="model-picker-page"]');
  expect(chat?.hidden).toBe(true);
  expect(picker?.parentElement?.dataset.testid).toBe("page-host");
  expect(picker?.classList.contains("fixed")).toBe(false);
  expect(picker?.querySelector("h1")?.classList.contains("sr-only")).toBe(true);
  expect(picker?.textContent).not.toContain("available");
  expect(picker?.querySelector('[data-testid="nanami-local-router"] button')?.querySelector("svg")).toBeNull();
  const edit = container.querySelector<HTMLButtonElement>('[aria-label="Edit local router settings"]');
  expect(edit).not.toBeNull();
  await act(async () => edit?.click());
  const settings = container.querySelector<HTMLElement>('[data-testid="local-router-settings-page"]');
  expect(settings).not.toBeNull();
  expect(settings?.textContent).toContain("claude");
  expect(settings?.textContent).toContain("gemini");
  expect(settings?.textContent).toContain("GPT test");
  expect(settings?.textContent).toContain("Copilot test");
  expect(settings?.textContent).toContain("Provider is disabled in AI providers.");
  const roundRobin = settings?.querySelector<HTMLElement>('[aria-label="Round robin routing"]');
  const highest = settings?.querySelector<HTMLElement>('[aria-label="Highest quota routing"]');
  expect(highest?.getAttribute("aria-disabled")).toBe("true");
  expect(settings?.textContent).toContain("must be last");
  await act(async () => roundRobin?.click());
  expect(highest?.getAttribute("aria-disabled")).not.toBe("true");
  await act(async () => highest?.click());
  const random = settings?.querySelector<HTMLElement>('[aria-label="Random routing"]');
  const lowest = settings?.querySelector<HTMLElement>('[aria-label="Lowest quota routing"]');
  await act(async () => random?.click());
  expect(highest?.getAttribute("aria-checked")).toBe("true");
  expect(random?.getAttribute("aria-checked")).toBe("true");
  expect(lowest?.getAttribute("aria-disabled")).toBe("true");
  expect([...settings!.querySelectorAll('[data-testid^="router-strategy-"]')].slice(0, 2).map((row) => row.getAttribute("data-testid")))
    .toEqual(["router-strategy-highest-quota", "router-strategy-random"]);
  const modelsBack = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Models");
  await act(async () => modelsBack?.click());
  expect(container.querySelector('[data-testid="local-router-settings-page"]')).toBeNull();
  const chatBack = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Chat");
  await act(async () => chatBack?.click());
  expect(container.querySelector('[data-testid="chat"]')).toBe(chat);
  expect(chat?.hidden).toBe(false);
  await act(async () => root.unmount());
  useChatGptAccountsStore.setState({ accounts: [] });
  useCopilotAccountsStore.setState({ accounts: [] });
  container.remove();
});
