import type { UIMessage } from "ai";

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? Reflect.get(value, key) : undefined;
}

/** Last reported request input, including cached input; absent placeholder counts stay absent. */
export function contextUsageFromInfo(info: unknown): number | undefined {
  if (field(info, "role") !== "assistant") return undefined;
  const tokens = field(info, "tokens");
  const input = field(tokens, "input");
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) return undefined;
  const cache = field(tokens, "cache");
  const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  const total = input + count(field(cache, "read")) + count(field(cache, "write"));
  return total > 0 && Number.isFinite(total) ? total : undefined;
}

export function latestContextUsage(messages: readonly UIMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const meta = field(message.metadata, "opencode");
    const used = field(meta, "contextUsage");
    if (typeof used !== "number" || !Number.isFinite(used) || used <= 0) continue;
    const model = field(meta, "replyModel");
    const providerID = field(model, "providerID");
    const modelID = field(model, "modelID");
    return { used, providerID: typeof providerID === "string" ? providerID : undefined, modelID: typeof modelID === "string" ? modelID : undefined };
  }
  return null;
}
