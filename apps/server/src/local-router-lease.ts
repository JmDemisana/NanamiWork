import { randomBytes } from "node:crypto";
import { ApiError } from "./errors.js";
import { withEngineSwitchFence } from "./engine-switch-fence.js";

type RouterLease = {
  id: string;
  workspaceId: string;
  sessionId: string;
  providerId: string;
  modelId: string;
  active: number;
  closing: boolean;
  submitted: boolean;
  finish: () => void;
  timer: ReturnType<typeof setTimeout>;
};

type RouterLeaseState = { pending: boolean; current: RouterLease | null };
const states = new WeakMap<object, RouterLeaseState>();
const LEASE_TTL_MS = 90_000;

function stateFor(config: object): RouterLeaseState {
  let state = states.get(config);
  if (!state) {
    state = { pending: false, current: null };
    states.set(config, state);
  }
  return state;
}

function close(state: RouterLeaseState, lease: RouterLease): void {
  lease.closing = true;
  clearTimeout(lease.timer);
  if (lease.active === 0 && state.current === lease) {
    state.current = null;
    lease.finish();
  }
}

/**
 * Hold the existing engine-switch fence through an account update and prompt
 * admission. Other OpenWork clients and recovery sends use that same fence.
 * A lease is host-only, scoped to one workspace/session/model, and expires if
 * its renderer disappears. Already forwarded requests finish before release.
 */
export async function acquireLocalRouterLease(config: object, input: {
  workspaceId: string;
  sessionId: string;
  providerId: string;
  modelId: string;
  ensureIdle: () => Promise<void>;
  signal?: AbortSignal;
}): Promise<{ id: string }> {
  const state = stateFor(config);
  if (state.pending || state.current) {
    throw new ApiError(409, "local_router_busy", "Another message is starting. Try Local Router again shortly.");
  }
  state.pending = true;
  let ready: (result: { id: string }) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const acquired = new Promise<{ id: string }>((resolve, fail) => { ready = resolve; reject = fail; });
  const operation = withEngineSwitchFence(config, { from: "v1", to: "v1", signal: input.signal, operation: async () => {
    input.signal?.throwIfAborted();
    await input.ensureIdle();
    input.signal?.throwIfAborted();
    let finish: () => void = () => {};
    const held = new Promise<void>((resolve) => { finish = resolve; });
    const lease: RouterLease = {
      id: randomBytes(32).toString("hex"), workspaceId: input.workspaceId, sessionId: input.sessionId,
      providerId: input.providerId, modelId: input.modelId, active: 0, closing: false, submitted: false,
      finish, timer: setTimeout(() => close(state, lease), LEASE_TTL_MS),
    };
    lease.timer.unref?.();
    state.current = lease;
    ready({ id: lease.id });
    await held;
  } });
  void operation.catch(reject).finally(() => { state.pending = false; });
  return acquired;
}

export function releaseLocalRouterLease(config: object, id: string): void {
  const state = stateFor(config);
  if (!state.current || state.current.id !== id) return;
  close(state, state.current);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Permit only the exact account preparation and turn bound to this lease. */
export async function enterLocalRouterLease(config: object, input: {
  id: string;
  workspaceId: string;
  method: string;
  path: string;
  request: Request;
}): Promise<(response?: Response) => void> {
  const state = stateFor(config);
  const lease = state.current;
  if (!lease || lease.id !== input.id || lease.closing || lease.workspaceId !== input.workspaceId) {
    throw new ApiError(409, "local_router_lease_expired", "Local Router could not safely prepare this message. Try again.");
  }
  const method = input.method.toUpperCase();
  const authPath = `/auth/${encodeURIComponent(lease.providerId)}`;
  const turnPrefix = `/session/${encodeURIComponent(lease.sessionId)}/`;
  const isAuth = method === "PUT" && input.path === authPath;
  const isDispose = method === "POST" && input.path === "/instance/dispose";
  const isPrompt = method === "POST" && (input.path === `${turnPrefix}prompt_async` || input.path === `${turnPrefix}command`);
  if (!isAuth && !isDispose && !isPrompt) {
    throw new ApiError(403, "local_router_lease_scope", "This request is outside the Local Router admission.");
  }
  if (isPrompt) {
    if (lease.submitted) throw new ApiError(409, "local_router_already_sent", "This Local Router message was already submitted.");
    let body: unknown;
    try { body = await input.request.clone().json(); }
    catch { throw new ApiError(400, "invalid_request", "Expected a JSON request body."); }
    const model = isRecord(body) ? body.model : undefined;
    const matches = isRecord(model) ? model.providerID === lease.providerId && model.modelID === lease.modelId
      : model === `${lease.providerId}/${lease.modelId}`;
    if (!matches) throw new ApiError(403, "local_router_lease_model", "The Local Router model changed while preparing the message.");
    if (state.current !== lease || lease.closing) throw new ApiError(409, "local_router_lease_expired", "Local Router could not safely prepare this message. Try again.");
    if (lease.submitted) throw new ApiError(409, "local_router_already_sent", "This Local Router message was already submitted.");
    // Claim before forwarding: concurrent duplicate requests cannot both enter.
    lease.submitted = true;
  }
  lease.active += 1;
  let finished = false;
  return (response) => {
    if (finished) return;
    finished = true;
    // Only an explicit client rejection proves that it was not admitted.
    if (isPrompt && response && response.status >= 400 && response.status < 500) lease.submitted = false;
    lease.active -= 1;
    if (lease.closing) close(state, lease);
  };
}
