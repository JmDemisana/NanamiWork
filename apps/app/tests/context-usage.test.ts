import { expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { snapshotToUIMessages } from "../src/react-app/domains/session/sync/usechat-adapter";
import { contextUsageFromInfo, latestContextUsage } from "../src/react-app/domains/session/sync/context-usage";

test("reads reported input and cache tokens without treating placeholders as usage", () => {
  expect(contextUsageFromInfo({ role: "assistant", tokens: { input: 200, cache: { read: 300, write: 50 } } })).toBe(550);
  expect(contextUsageFromInfo({ role: "assistant", tokens: { input: 0, cache: { read: 0, write: 0 } } })).toBeUndefined();
  expect(contextUsageFromInfo({ role: "user", tokens: { input: 100 } })).toBeUndefined();
  expect(contextUsageFromInfo({ role: "assistant", tokens: { input: NaN } })).toBeUndefined();
});

test("uses the latest measured assistant request and its actual model", () => {
  const messages: UIMessage[] = [
    { id: "1", role: "assistant", parts: [], metadata: { opencode: { contextUsage: 550, replyModel: { providerID: "openai", modelID: "model-a" } } } },
    { id: "2", role: "user", parts: [] },
    { id: "3", role: "assistant", parts: [], metadata: { opencode: {} } },
  ];
  expect(latestContextUsage(messages)).toEqual({ used: 550, providerID: "openai", modelID: "model-a" });
  expect(latestContextUsage([])).toBeNull();
});


test("snapshot projection retains usage for the composer", () => {
  const snapshot = { messages: [{ info: { id: "m", role: "assistant", time: { created: 1 }, providerID: "openai", modelID: "model-a", tokens: { input: 200, output: 4, reasoning: 0, cache: { read: 300, write: 50 } } }, parts: [] }] };
  const messages = snapshotToUIMessages(snapshot as unknown as Parameters<typeof snapshotToUIMessages>[0]);
  expect(latestContextUsage(messages)).toEqual({ used: 550, providerID: "openai", modelID: "model-a" });
});
