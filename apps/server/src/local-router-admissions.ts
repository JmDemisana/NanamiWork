/**
 * prompt_async and the command proxy can acknowledge before the engine reports
 * a busy session. Remember those admissions until a terminal reply is observed;
 * an idle status alone is not enough to safely replace provider credentials.
 */
export type PendingRouterAdmission = {
  workspaceId: string;
  sessionId: string;
  messageId: string | null;
  startedAt: number;
  phase: "sending" | "accepted" | "unknown";
};

const admissions = new WeakMap<object, Map<symbol, PendingRouterAdmission>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Called only after the engine's status and waiting-request probes are idle. */
export function routerAdmissionHasTerminalReply(messages: unknown, entry: PendingRouterAdmission): boolean {
  if (!entry.messageId || !Array.isArray(messages)) return false;
  return messages.some((message) => {
    if (!isRecord(message) || !isRecord(message.info)) return false;
    const info = message.info;
    if (info.role !== "assistant" || info.sessionID !== entry.sessionId || !isRecord(info.time)
      || typeof info.time.completed !== "number" || info.finish === "tool-calls") return false;
    if (info.parentID !== entry.messageId) return false;
    if (!Array.isArray(message.parts)) return false;
    return !message.parts.some((part) => isRecord(part) && part.type === "tool" && isRecord(part.state)
      && (part.state.status === "pending" || part.state.status === "running"));
  });
}

export function beginRouterAdmission(config: object, input: Omit<PendingRouterAdmission, "phase" | "startedAt">): (status?: number) => void {
  const entries = admissions.get(config) ?? new Map<symbol, PendingRouterAdmission>();
  admissions.set(config, entries);
  const key = Symbol();
  const entry: PendingRouterAdmission = { ...input, phase: "sending", startedAt: Date.now() };
  entries.set(key, entry);
  let done = false;
  return (status) => {
    if (done) return;
    done = true;
    if (status !== undefined && status >= 400 && status < 500) entries.delete(key);
    else {
      entry.phase = status !== undefined && status >= 200 && status < 400 ? "accepted" : "unknown";
      if (entry.phase === "accepted") {
        // A later accepted turn in the same session covers earlier accepted
        // steering messages. Unknown or still-forwarding admissions stay put.
        let newest: symbol | undefined;
        for (const [candidate, value] of entries) {
          if (value.workspaceId === entry.workspaceId && value.sessionId === entry.sessionId && value.phase === "accepted") newest = candidate;
        }
        for (const [candidate, value] of entries) {
          if (candidate !== newest && value.workspaceId === entry.workspaceId && value.sessionId === entry.sessionId && value.phase === "accepted") entries.delete(candidate);
        }
      }
    }
  };
}

export async function assessRouterAdmissions(
  config: object,
  terminal: (entry: PendingRouterAdmission) => Promise<boolean>,
): Promise<"idle" | "busy" | "unknown"> {
  const entries = admissions.get(config);
  if (!entries?.size) return "idle";
  let busy = false;
  let unknown = false;
  for (const [key, entry] of entries) {
    if (entry.phase === "sending") {
      busy = true;
      continue;
    }
    let completed = false;
    try { completed = await terminal(entry); } catch { /* Unknown must fail closed. */ }
    if (completed) entries.delete(key);
    else unknown = true;
  }
  return busy ? "busy" : unknown ? "unknown" : "idle";
}
