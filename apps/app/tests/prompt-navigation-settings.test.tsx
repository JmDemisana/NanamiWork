/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AppearanceView } from "../src/react-app/domains/settings/pages/appearance-view";
import { LocalProvider, useLocal } from "../src/react-app/kernel/local-provider";

test("the Appearance checkboxes independently persist prompt controls", async () => {
  const ownedDom = typeof window === "undefined";
  if (ownedDom) GlobalRegistrator.register({ url: "http://localhost/" });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const host = document.createElement("div");
  document.body.append(host);
  function Settings() {
    const local = useLocal();
    return <AppearanceView busy={false} themeMode="system" setThemeMode={() => {}} language="en" setLanguage={() => {}}
      hideTitlebar={false} toggleHideTitlebar={() => {}} promptNavigation={local.prefs.promptNavigation}
      setPromptNavigation={(key, value) => local.setPrefs((previous) => ({ ...previous, promptNavigation: { ...previous.promptNavigation, [key]: value } }))} />;
  }
  let root = createRoot(host);
  try {
    await act(async () => { root.render(<LocalProvider><Settings /></LocalProvider>); });
    const checkbox = (label: string) => host.querySelector<HTMLElement>(`[role="checkbox"][aria-label="${label}"]`);
    for (const label of ["Top", "Previous Prompt", "Next Prompt", "Latest"]) {
      expect(checkbox(label)?.getAttribute("aria-checked")).toBe("true");
    }
    await act(async () => { checkbox("Top")?.click(); checkbox("Next Prompt")?.click(); });
    expect(checkbox("Top")?.getAttribute("aria-checked")).toBe("false");
    expect(checkbox("Previous Prompt")?.getAttribute("aria-checked")).toBe("true");
    expect(checkbox("Next Prompt")?.getAttribute("aria-checked")).toBe("false");
    expect(checkbox("Latest")?.getAttribute("aria-checked")).toBe("true");

    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await act(async () => { root.render(<LocalProvider><Settings /></LocalProvider>); });
    expect(checkbox("Top")?.getAttribute("aria-checked")).toBe("false");
    expect(checkbox("Previous Prompt")?.getAttribute("aria-checked")).toBe("true");
    expect(checkbox("Next Prompt")?.getAttribute("aria-checked")).toBe("false");
    expect(checkbox("Latest")?.getAttribute("aria-checked")).toBe("true");

    await act(async () => { root.unmount(); });
    localStorage.setItem("openwork.preferences", JSON.stringify({ showPromptNavigation: false }));
    root = createRoot(host);
    await act(async () => { root.render(<LocalProvider><Settings /></LocalProvider>); });
    for (const label of ["Top", "Previous Prompt", "Next Prompt", "Latest"]) {
      expect(checkbox(label)?.getAttribute("aria-checked")).toBe("false");
    }
    await act(async () => { checkbox("Latest")?.click(); });
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await act(async () => { root.render(<LocalProvider><Settings /></LocalProvider>); });
    expect(checkbox("Top")?.getAttribute("aria-checked")).toBe("false");
    expect(checkbox("Latest")?.getAttribute("aria-checked")).toBe("true");
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    localStorage.clear();
    if (ownedDom) await GlobalRegistrator.unregister();
  }
});
