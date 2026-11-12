import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { TextCommandCard, TextDiffCard } from "../src/components/chat/text-activity-details";

GlobalRegistrator.register({ url: "https://example.invalid/" });
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterAll(() => GlobalRegistrator.unregister());

test("command output remains readable and can be expanded", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const output = Array.from({ length: 14 }, (_, index) => `output line ${index + 1}`).join("\n");
  await act(async () => root.render(createElement(TextCommandCard, { command: "python -c 'print(1)'", output, failed: true })));
  expect(container.querySelector("[data-text-command-card]")?.textContent).toContain("$ python -c 'print(1)'");
  const pre = container.querySelector("[data-text-command-output]");
  expect(pre?.textContent).toContain("output line 12");
  expect(pre?.textContent).not.toContain("output line 14");
  expect(pre?.className).toContain("break-words");
  expect(pre?.className).toContain("text-red-11");
  expect(container.querySelector('button[aria-label]')).not.toBeNull();
  const toggle = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Show more"));
  expect(toggle).toBeDefined();
  await act(async () => toggle?.click());
  expect(container.querySelector("[data-text-command-output]")?.textContent).toBe(output);
  await act(async () => root.unmount());
  container.remove();
});

test("diff rows preserve text and distinguish removed and added lines", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(TextDiffCard, { removed: "old path/with spaces", added: "new path/with spaces" })));
  const rows = container.querySelectorAll("[data-text-diff-card] > div");
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain("old path/with spaces");
  expect(rows[1]?.textContent).toContain("new path/with spaces");
  expect(rows[0]?.className).toContain("bg-red-3/30");
  expect(rows[1]?.className).toContain("bg-green-3/30");
  expect(rows[0]?.lastElementChild?.className).toContain("break-words");
  await act(async () => root.unmount());
  container.remove();
});
