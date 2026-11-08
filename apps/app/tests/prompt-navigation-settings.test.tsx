/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AppearanceView } from "../src/react-app/domains/settings/pages/appearance-view";
import { LocalProvider, useLocal } from "../src/react-app/kernel/local-provider";

test("the Appearance checkbox persists prompt bar visibility", async () => {
  const ownedDom = typeof window === "undefined";
  if (ownedDom) GlobalRegistrator.register({ url: "http://localhost/" });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const host = document.createElement("div");
  document.body.append(host);
  function Settings() {
    const local = useLocal();
    return <AppearanceView busy={false} themeMode="system" setThemeMode={() => {}} language="en" setLanguage={() => {}}
      hideTitlebar={false} toggleHideTitlebar={() => {}} showPromptNavigation={local.prefs.showPromptNavigation}
      setShowPromptNavigation={(value) => local.setPrefs((previous) => ({ ...previous, showPromptNavigation: value }))} />;
  }
  let root = createRoot(host);
  try {
    await act(async () => { root.render(<LocalProvider><Settings /></LocalProvider>); });
    const checkbox = host.querySelector<HTMLElement>('[role="checkbox"][aria-label="Prompt Navigation"]');
    expect(checkbox?.getAttribute("aria-checked")).toBe("true");
    await act(async () => { checkbox?.click(); });
    expect(checkbox?.getAttribute("aria-checked")).toBe("false");
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await act(async () => { root.render(<LocalProvider><Settings /></LocalProvider>); });
    expect(host.querySelector('[role="checkbox"][aria-label="Prompt Navigation"]')?.getAttribute("aria-checked")).toBe("false");
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    localStorage.clear();
    if (ownedDom) await GlobalRegistrator.unregister();
  }
});
