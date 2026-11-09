import { afterAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

GlobalRegistrator.register({ url: "https://web.example/" });
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

mock.module("../src/react-app/domains/models/use-local-model-picker", () => ({ useLocalModelPickerEnabled: () => true }));
mock.module("../src/react-app/domains/models/model-picker-page", () => ({
  ModelPickerPage: (props: { open: boolean; onSelectWithBehavior: (model: { providerID: string; modelID: string }, behavior: { variant: string }) => void }) =>
    props.open ? createElement("button", {
      "data-testid": "full-page-composer-picker",
      onClick: () => props.onSelectWithBehavior({ providerID: "local", modelID: "next" }, { variant: "high" }),
    }, "Choose") : null,
}));
mock.module("../src/react-app/domains/models/use-model-catalog", () => ({
  useModelChoice: () => ({ loginOpen: false, pendingOptions: [], disabledProviders: [], choose: (_option: unknown, commit: () => void) => commit() }),
  useModelCatalog: () => ({ options: [], knownOptions: [], actionOptions: [], catalogState: { state: "ready" }, restrictToCloud: false, autoVisible: false }),
}));
mock.module("../src/react-app/shell/workspace-provider", () => ({
  useWorkspace: () => ({ client: null, opencodeBaseUrl: "", selectedWorkspaceRoot: "" }),
  useWorkspaceMaybe: () => null,
}));
mock.module("../src/react-app/kernel/use-workspace-model-default", () => ({ useSetWorkspaceDefaultModel: () => () => {} }));
mock.module("../src/react-app/domains/cloud/desktop-config-provider", () => ({ useCheckDesktopRestriction: () => () => false }));
mock.module("../src/react-app/domains/session/status/use-desktop-feature", () => ({ useDesktopFeature: () => false }));

const { ModelSelect } = await import("../src/components/model-select");

afterAll(() => {
  mock.restore();
  GlobalRegistrator.unregister();
});

test("the composer opens the full-page picker and preserves the chosen variant", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const changes: Array<{ model: { providerID: string; modelID: string }; variant: string | null | undefined }> = [];
  await act(async () => root.render(createElement(ModelSelect, {
    open: true,
    value: { providerID: "local", modelID: "previous" },
    onOpenChange: () => {},
    onChange: (model, variant) => changes.push({ model, variant }),
  })));
  const picker = container.querySelector<HTMLButtonElement>('[data-testid="full-page-composer-picker"]');
  expect(picker).not.toBeNull();
  await act(async () => picker?.click());
  expect(changes).toEqual([{ model: { providerID: "local", modelID: "next" }, variant: "high" }]);
  await act(async () => root.unmount());
  container.remove();
});
