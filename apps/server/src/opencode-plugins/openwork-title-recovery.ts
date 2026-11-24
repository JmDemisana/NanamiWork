/** Select a compatible small model and recover explicitly rejected title parameters.
 * The correlation header is removed unless already covered by an AWS signature.
 * No prompts, response bodies, URLs, or credentials enter diagnostics.
 */
const HEADER = "x-openwork-title-attempt";
const DEADLINE_MS = 60_000;
const MAX_ERROR_BYTES = 16_384;
const MAX_TITLE_REQUEST_BYTES = 1_048_576;
const ANTIGRAVITY_SMALL_MODELS = [
  "antigravity-gemini-3.8-flash-low",
  "antigravity-gemini-3.8-flash-tiered-low",
  "antigravity-gemini-3.8-flash-medium",
  "antigravity-gemini-3-flash",
];
const COPILOT_SMALL_MODELS = ["gpt-4.1", "gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"];

type SmallModel = { id: string; providerID: string; status?: string };
type SmallModelProvider = {
  id: string;
  options?: Record<string, unknown>;
  models: Record<string, SmallModel>;
};

type Diagnostic = {
  sessionID: string;
  providerID: string;
  modelID: string;
  outcome: string;
  recoveryAttempt: number;
  status?: number;
  parameter?: string;
};
type Attempt = {
  diagnostic: Diagnostic;
  report: (diagnostic: Diagnostic) => void;
  timer: ReturnType<typeof setTimeout>;
  retried: boolean;
};
const attempts = new Map<string, Attempt>();
let installed = false;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function report(attempt: Attempt, outcome: string, status?: number, parameter?: string) {
  attempt.diagnostic = {
    ...attempt.diagnostic, outcome, recoveryAttempt: attempt.retried ? 2 : 1,
    ...(status === undefined ? {} : { status }),
    ...(parameter === undefined ? {} : { parameter }),
  };
  attempt.report(attempt.diagnostic);
}

function finish(id: string) {
  const attempt = attempts.get(id);
  if (attempt) clearTimeout(attempt.timer);
  attempts.delete(id);
}

async function readBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | null> {
  const reader = body?.getReader();
  if (!reader) return null;
  let size = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) return null;
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch {
    return null;
  } finally {
    // A clone's tee can wait for the original consumer when cancelled.
    void reader.cancel().catch(() => undefined);
  }
}

async function errorBody(response: Response): Promise<unknown> {
  const text = await readBody(response.clone().body, MAX_ERROR_BYTES);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function requestCopyForRecovery(input: Parameters<typeof fetch>[0], init?: RequestInit): Request | null {
  if (!(input instanceof Request) || input.bodyUsed || !input.body || init?.body != null) return null;
  if (!/application\/json/i.test(new Headers(init?.headers ?? input.headers).get("content-type") ?? "")) return null;
  try { return input.clone(); } catch { return null; }
}

function correction(body: string, value: unknown): { body: string; parameter: string } | null {
  if (!record(value) || !record(value.error)) return null;
  const error = value.error;
  if (error.code !== "unsupported_value" && error.code !== "unsupported_parameter") return null;
  const parameter = error.param;
  // Never change identity, content, tools, token limits, or required parameters.
  if (parameter !== "reasoning.effort" && parameter !== "reasoning_effort"
    && parameter !== "temperature" && parameter !== "top_p") return null;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (!record(parsed)) return null;
  const target = parameter === "reasoning.effort" ? parsed.reasoning : parsed;
  const key = parameter === "reasoning.effort" ? "effort" : parameter;
  if (!record(target) || !Object.hasOwn(target, key)) return null;

  // Provider text is used only to recognize a fixed vocabulary of effort values.
  // If it supplies no recognizable list, let the same model use its default.
  const message = typeof error.message === "string" ? error.message : "";
  const supported = /Supported values are:\s*([^\n]+)/i.exec(message)?.[1] ?? "";
  const efforts = new Set([...supported.matchAll(/['"](none|minimal|low|medium|high|xhigh|max)['"]/g)]
    .map((match) => match[1]));
  const effort = ["low", "minimal", "medium", "high", "xhigh", "max", "none"]
    .find((candidate) => efforts.has(candidate) && candidate !== target[key]);
  if ((parameter === "reasoning.effort" || parameter === "reasoning_effort") && effort) target[key] = effort;
  else delete target[key];
  return { body: JSON.stringify(parsed), parameter };
}

function failure(status: number, value?: unknown): string {
  const messages = typeof value === "string" ? [value] : record(value) ? [value.message, value.__type] : [];
  if (status === 403 && messages.some((part) =>
    typeof part === "string" && /SignatureDoesNotMatch|signature we calculated does not match/i.test(part))) {
    return "signature_rejected";
  }
  if (status === 401 || status === 403) return "access_rejected";
  if (status === 404) return "model_or_endpoint_missing";
  if (status === 429) return "rate_or_quota_limited";
  if (status === 400 || status === 422) return "request_rejected";
  return "provider_error";
}

function install() {
  if (installed) return;
  installed = true;
  const base = globalThis.fetch;
  const patched = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const id = headers.get(HEADER);
    if (!id) return base(input, init);
    // Removing a signed header here invalidates SigV4's canonical request.
    const signed = /^AWS4-HMAC-SHA256\s/i.test(headers.get("authorization") ?? "");
    if (!signed) headers.delete(HEADER);
    const externalSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const deadline = AbortSignal.timeout(DEADLINE_MS);
    const options = { ...init, headers, signal: externalSignal ? AbortSignal.any([externalSignal, deadline]) : deadline };
    const attempt = attempts.get(id);
    // Unknown/expired markers are stripped too, except when already signed.
    if (!attempt) return base(input, options);
    const copy = !signed && !attempt.retried ? requestCopyForRecovery(input, init) : null;
    try {
      const response = await base(input, options);
      if (!response.ok) {
        const value = response.status === 400 || response.status === 403 ? await errorBody(response) : null;
        report(attempt, failure(response.status, value), response.status);
        if (!signed && !attempt.retried && response.status === 400) {
          const body = typeof init?.body === "string" ? init.body :
            copy && record(value) && record(value.error) ? await readBody(copy.body, MAX_TITLE_REQUEST_BYTES) : null;
          const recovered = body === null ? null : correction(body, value);
          if (recovered && attempts.get(id) === attempt && !options.signal.aborted) {
            attempt.retried = true;
            report(attempt, "retrying_parameter", response.status, recovered.parameter);
            void response.body?.cancel().catch(() => undefined);
            const retryHeaders = new Headers(headers);
            retryHeaders.delete("content-length");
            const retry = await base(input, { ...options, headers: retryHeaders, body: recovered.body });
            const retryError = retry.status === 403 ? await errorBody(retry) : null;
            report(attempt, retry.ok ? "accepted_after_recovery" : failure(retry.status, retryError), retry.status);
            return retry;
          }
        }
      } else report(attempt, "accepted", response.status);
      return response;
    } catch (error) {
      report(attempt, externalSignal?.aborted ? "cancelled" : deadline.aborted ? "timed_out" : "transport_failed");
      throw error;
    } finally {
      if (copy?.body && !copy.body.locked) void copy.body.cancel().catch(() => undefined);
    }
  };
  globalThis.fetch = Object.assign(patched, base);
}

// Only export the factory: the engine treats every export as a plugin.
export const OpenWorkTitleRecovery = async (input: {
  client: { app: { log: (input: { body: {
    service: string; level: "info" | "warn"; message: string; extra: Diagnostic;
  } }) => Promise<unknown> } };
}) => {
  install();
  const owned = new Set<string>();
  const emit = (diagnostic: Diagnostic) => {
    const level = ["started", "accepted", "accepted_after_recovery", "title_available"].includes(diagnostic.outcome)
      ? "info" : "warn";
    void input.client.app.log({ body: {
      service: "openwork.title", level, message: "Automatic title generation", extra: diagnostic,
    } }).catch(() => undefined);
  };
  return {
    "experimental.provider.small_model": async (
      { provider }: { provider: SmallModelProvider },
      output: { model?: SmallModel },
    ) => {
      if (output.model) return;
      // The native small-model heuristic can choose the public Flash model
      // for both catalogs. The OAuth route requires the Antigravity alias,
      // while Copilot's automatic selection already uses its own GPT model.
      const ids = provider.id === "google" && provider.options?.apiKey === "antigravity-oauth"
        ? ANTIGRAVITY_SMALL_MODELS
        : provider.id === "github-copilot" || provider.id.startsWith("github-copilot-")
          ? COPILOT_SMALL_MODELS
          : [];
      for (const id of ids) {
        const model = provider.models[id];
        if (model?.providerID !== provider.id || model.status === "deprecated") continue;
        output.model = model;
        break;
      }
    },
    "chat.headers": async (request: {
      sessionID: string; agent: string; model: { id: string; providerID: string };
    }, output: { headers: Record<string, string> }) => {
      if (request.agent !== "title") return;
      const id = crypto.randomUUID();
      const diagnostic = {
        sessionID: request.sessionID, providerID: request.model.providerID,
        modelID: request.model.id, outcome: "started", recoveryAttempt: 1,
      };
      if (attempts.size >= 512) {
        emit({ ...diagnostic, outcome: "tracking_capacity_reached" });
        return;
      }
      const timer = setTimeout(() => {
        const attempt = attempts.get(id);
        if (attempt && ["started", "accepted", "accepted_after_recovery"].includes(attempt.diagnostic.outcome)) {
          report(attempt, "title_unconfirmed");
        }
        finish(id);
        owned.delete(id);
      }, DEADLINE_MS);
      timer.unref?.();
      attempts.set(id, { diagnostic, report: emit, timer, retried: false });
      owned.add(id);
      output.headers[HEADER] = id;
      emit(diagnostic);
    },
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== "session.updated" || !record(event.properties) || !record(event.properties.info)) return;
      const info = event.properties.info;
      if (typeof info.title !== "string" || !info.title.trim() || info.title.startsWith("New session - ")) return;
      for (const id of owned) {
        const attempt = attempts.get(id);
        if (!attempt || attempt.diagnostic.sessionID !== info.id) continue;
        report(attempt, "title_available");
        finish(id);
        owned.delete(id);
      }
    },
    dispose: async () => {
      for (const id of owned) finish(id);
      owned.clear();
    },
  };
};
