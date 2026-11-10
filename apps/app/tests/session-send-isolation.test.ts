import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OpenworkSessionHistory } from "../src/app/lib/openwork-server";
import { useOpeningSessionHistory } from "../src/react-app/domains/session/surface/session-history";
import { createOpenworkServerClient } from "../src/app/lib/openwork-server";
import { composeNativeSessionHistory } from "../src/app/lib/opencode-session-native";
import { createClient } from "../src/app/lib/opencode";
import { LOCAL_ROUTER_MODEL } from "../src/app/lib/local-router-ref";
import { ModelAdmissionFence } from "../src/app/lib/model-admission-fence";
import { dispatchLocalRouterTurn } from "../src/react-app/domains/models/local-router-dispatch";
import type { LocalRouterAccount, LocalRouterSettings } from "../src/react-app/domains/models/nanami-local-router";
import { createSessionInterruptionClient, interruptSessionTurn, submitImmediateSessionTurn } from "../src/app/lib/opencode-interruption";
import { createClientV2 } from "../src/app/lib/opencode-v2-adapter";
import { buildOpenworkSessionSystemContext, clearOpenworkEnvSystemContextCache } from "../src/react-app/domains/session/sync/env-context";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
afterEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
  clearOpenworkEnvSystemContextCache();
});

function fixture(options: { renderer?: () => Promise<void> } = {}) {
  const main: Request[] = [];
  const renderer: Request[] = [];
  const directory = "/fixture/send";
  const session = (id: string) => ({ id, directory, parentID: id === "ses_child" ? "ses_root" : undefined, time: { created: 1, updated: 1 } });
  const messages = (id: string) => id === "ses_root" ? [
    { info: { id: "msg_user", sessionID: id, role: "user", time: { created: 1 } }, parts: [] },
    { info: { id: "msg_assistant", sessionID: id, parentID: "msg_user", role: "assistant", time: { created: 2 } }, parts: [{
      id: "prt_task", sessionID: id, messageID: "msg_assistant", type: "tool", tool: "task", callID: "call_child",
      state: { status: "running", input: { subagent_type: "explore" }, metadata: { sessionId: "ses_child" }, time: { start: 2 } },
    }] },
  ] : [];
  const respond = (request: Request) => {
    const path = new URL(request.url).pathname.replace("/workspace/ws_fixture/opencode", "");
    if (path === "/env/keys") return { keys: ["FIXTURE_KEY"] };
    if (path === "/path") return { directory, worktree: directory, home: directory, state: directory, config: directory };
    if (path === "/permission" || path === "/question") return [];
    if (path === "/session/status") return {};
    if (path.endsWith("/abort")) return true;
    const match = path.match(/^\/session\/(ses_root|ses_child)(\/message)?$/);
    if (!match) throw new Error(`Unexpected fixture request ${path}`);
    return match[2] ? messages(match[1]) : session(match[1]);
  };
  const raw: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    renderer.push(request);
    await options.renderer?.();
    return Response.json(respond(request));
  };
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: raw });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { fetch: raw, __OPENWORK_ELECTRON__: {
    invokeDesktop: async (command: string, url: string, init: RequestInit) => {
      expect(command).toBe("__fetch");
      const request = new Request(url, init);
      main.push(request);
      return { status: 200, statusText: "OK", headers: [["content-type", "application/json"]], body: JSON.stringify(respond(request)) };
    },
  } } });
  return { main, renderer, directory, base: "http://127.0.0.1:8788/workspace/ws_fixture/opencode" };
}

test("each router turn reaches the engine client as only a concrete model", async () => {
  const requests: Request[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __OPENWORK_ELECTRON__: {
    invokeDesktop: async (_command: string, url: string, init: RequestInit) => {
      requests.push(new Request(url, init));
      return { status: 204, statusText: "No Content", headers: [], body: "" };
    },
  } } });
  const client = createClient("http://127.0.0.1:8788/workspace/ws_fixture/opencode", "/fixture",
    { token: "client-fixture", mode: "openwork" }, { desktopTransport: "main" });
  const accounts: LocalRouterAccount[] = ["one", "two"].map((id) => ({
    key: id, kind: "local", providerID: "example", accountID: id, label: id, providerLabel: "Example",
    models: [{ key: id, modelID: `model-${id}`, label: id, remainingFraction: null, resetTime: null }],
  }));
  let settings: LocalRouterSettings = { mode: "priority", strategies: ["round-robin"], modelOrder: [], accountOrder: [], excludedAccounts: [], excludedModels: [], usage: {} };
  let tick = 0;
  const input = {
    selected: LOCAL_ROUTER_MODEL, variant: null, localRuntime: true, fence: new ModelAdmissionFence(),
    settings: () => settings, accounts: async () => accounts,
    ensureIdle: async () => {}, activate: async () => {},
    record: (candidate: { key: string }) => { settings = { ...settings, usage: { ...settings.usage, [candidate.key]: { count: 1, lastUsedAt: ++tick } } }; },
    send: async ({ model }: { model: { providerID: string; modelID: string } | null }) => client.session.promptAsync({
      sessionID: "ses_fixture", model: model ?? undefined, parts: [{ type: "text", text: "hello" }],
    }),
  };
  await dispatchLocalRouterTurn(input);
  await dispatchLocalRouterTurn(input);
  const bodies = await Promise.all(requests.map((request) => request.json()));
  expect(bodies.map((body) => body.model)).toEqual([
    { providerID: "example", modelID: "model-one" },
    { providerID: "example", modelID: "model-two" },
  ]);
  expect(JSON.stringify(bodies)).not.toContain("nanami-local-router");
  expect(input.selected).toEqual(LOCAL_ROUTER_MODEL);
});

test("a router lease reaches account preparation and the concrete prompt through desktop transport", async () => {
  const requests: Request[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __OPENWORK_ELECTRON__: {
    invokeDesktop: async (command: string, url: string, init: RequestInit) => {
      expect(command).toBe("__fetch");
      const request = new Request(url, init);
      requests.push(request);
      return { status: url.endsWith("/prompt_async") ? 204 : 200, statusText: "OK", headers: [["content-type", "application/json"]], body: url.endsWith("/prompt_async") ? "" : "true" };
    },
  } } });
  const base = "http://127.0.0.1:8788/workspace/ws_fixture/opencode";
  const client = createClient(base, "/fixture", { token: "client-fixture", mode: "openwork" },
    { desktopTransport: "main", localRouterLease: { id: "lease-fixture", hostToken: "host-fixture" } });
  await client.auth.set({ providerID: "google", auth: { type: "oauth", refresh: "fixture", access: "", expires: 0 } });
  await client.instance.dispose();
  await client.session.promptAsync({ sessionID: "ses_fixture", messageID: "msg_fixture", model: { providerID: "google", modelID: "model-a" }, parts: [{ type: "text", text: "fixture" }] });
  expect(requests).toHaveLength(3);
  expect(requests.every((request) => request.headers.get("x-openwork-local-router-lease") === "lease-fixture"
    && request.headers.get("x-openwork-host-token") === "host-fixture"
    && request.headers.get("authorization") === "Bearer client-fixture")).toBe(true);
  expect((await requests[2]!.json()).model).toEqual({ providerID: "google", modelID: "model-a" });
});

test("only the uncached send-history preflight requests isolated transport; cached sends and background refresh keep their contracts", async () => {
  GlobalRegistrator.register({ url: "http://localhost/" });
  const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  try {
    for (const warm of [false, true]) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const host = document.createElement("div");
      const root = createRoot(host);
      const calls: ({ desktopTransport: "main" } | undefined)[] = [];
      const history: OpenworkSessionHistory = { session: { id: "ses_history", title: "History", version: "1", time: { created: 1, updated: 1 } }, messages: [] };
      const key = ["send-history-isolation", String(warm)];
      if (warm) client.setQueryData(key, history);
      let readSend: (() => Promise<OpenworkSessionHistory["messages"]>) | undefined;
      function Harness() {
        const opening = useOpeningSessionHistory({ owner: String(warm), sessionId: "ses_history", snapshotQueryKey: key,
          readSnapshot: async () => history,
          readLatest: async (_signal, options) => { calls.push(options); return history; },
        });
        readSend = opening.readSendHistory;
        return null;
      }
      try {
        await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Harness))));
        if (!readSend) throw new Error("Send-history callback was not mounted");
        expect(await readSend()).toEqual([]);
        expect(calls).toEqual(warm ? [undefined] : [{ desktopTransport: "main" }]);
        await act(async () => client.setQueryData(key, history));
        expect(await readSend()).toEqual([]);
        expect(calls).toHaveLength(1);
      } finally {
        await act(async () => root.unmount());
        client.clear();
      }
    }
  } finally {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
    await GlobalRegistrator.unregister();
  }
});

test("ordinary-send environment preflight opts in without changing other environment reads or disclosing values", async () => {
  const world = fixture();
  const client = createOpenworkServerClient({ baseUrl: "http://127.0.0.1:8788", token: "fixture-client", hostToken: "fixture-host" });
  const context = await buildOpenworkSessionSystemContext(client, { cacheKey: "ses_root", readPendingChanges: () => false, desktopTransport: "main" });
  expect(context).toContain("FIXTURE_KEY");
  expect(context).not.toContain("fixture-host");
  expect(world.renderer).toHaveLength(0);
  expect(world.main).toHaveLength(1);
  expect(world.main[0].headers.get("authorization")).toBe("Bearer fixture-client");
  expect(world.main[0].headers.get("x-openwork-host-token")).toBe("fixture-host");
  await client.listUserEnvKeys();
  expect(world.renderer).toHaveLength(1);
  expect(world.main).toHaveLength(1);
});

test("Stop verification uses its scoped client for foreground descendants, ownership, idle and approvals", async () => {
  const world = fixture();
  const ordinaryClient = createClient(world.base, world.directory, { token: "fixture-client", mode: "openwork" });
  const client = createSessionInterruptionClient(world.base, ordinaryClient, world.directory, "fixture-client");
  await interruptSessionTurn(world.base, client, "ses_root", world.directory, { timeoutMs: 2_000 });
  expect(world.renderer).toHaveLength(0);
  const paths = world.main.map(request => new URL(request.url).pathname.replace("/workspace/ws_fixture/opencode", ""));
  for (const path of ["/session/ses_root/abort", "/session/ses_child/abort", "/session/ses_child", "/session/ses_child/message", "/path", "/session/status", "/permission", "/question"]) expect(paths).toContain(path);
  expect(paths.some(path => path.includes("prompt"))).toBe(false);
  expect(world.main.every(request => request.headers.get("authorization") === "Bearer fixture-client" && new URL(request.url).searchParams.get("directory") === world.directory)).toBe(true);
});

for (const fault of ["blocked", "rejected"]) {
  test(`immediate foreground handoff completes once while ordinary renderer traffic is ${fault}`, async () => {
    const rendererGate = Promise.withResolvers<void>();
    let rendererSettled = false;
    const world = fixture({ renderer: async () => {
      if (fault === "rejected") throw new Error("Renderer unavailable");
      await rendererGate.promise;
    } });
    const ordinaryClient = createClient(world.base, world.directory, { token: "fixture-client", mode: "openwork" });
    const client = createSessionInterruptionClient(world.base, ordinaryClient, ` ${world.directory} `, "fixture-client");
    const history = await composeNativeSessionHistory({ opencodeBaseUrl: world.base, token: "fixture-client", desktopTransport: "main" }, "ses_root");
    world.main.length = 0;
    const background = ordinaryClient.session.status().finally(() => { rendererSettled = true; });
    const sends: boolean[] = [];
    const sending = submitImmediateSessionTurn(world.base, client, "ses_root", history.messages, async (afterStop) => {
      sends.push(afterStop);
      return "accepted";
    }, { directory: world.directory, messageID: "msg_successor" });
    const deadline = Promise.withResolvers<never>();
    const timer = setTimeout(() => deadline.reject(new Error("Interruption waited on renderer traffic")), 1_000);
    try {
      expect(await Promise.race([sending, deadline.promise])).toBe("accepted");
      expect(sends).toEqual([true]);
      expect(world.renderer).toHaveLength(1);
      expect(new URL(world.renderer[0].url).pathname).toEndWith("/session/status");
      if (fault === "blocked") expect(rendererSettled).toBe(false);
      else expect((await background).error).toBeDefined();
      const paths = world.main.map(request => new URL(request.url).pathname.replace("/workspace/ws_fixture/opencode", ""));
      for (const path of ["/session/ses_root/abort", "/session/ses_child/abort", "/session/ses_child", "/session/ses_child/message", "/path", "/session/status", "/permission", "/question"]) expect(paths).toContain(path);
      expect(paths.some(path => path.includes("prompt"))).toBe(false);
      expect(world.main.every(request => request.headers.get("authorization") === "Bearer fixture-client" && new URL(request.url).searchParams.get("directory") === world.directory)).toBe(true);
    } finally {
      clearTimeout(timer);
      rendererGate.resolve();
      await Promise.allSettled([background, sending]);
    }
    expect(sends).toEqual([true]);
  });
}

test("immediate sends without foreground delegation do not interrupt or reroute ordinary reads", async () => {
  const world = fixture();
  const ordinaryClient = createClient(world.base, world.directory, { token: "fixture-client", mode: "openwork" });
  const client = createSessionInterruptionClient(world.base, ordinaryClient, world.directory, "fixture-client");
  const sends: boolean[] = [];
  await submitImmediateSessionTurn(world.base, client, "ses_root", [], async (afterStop) => { sends.push(afterStop); });
  expect(sends).toEqual([false]);
  expect(world.main).toHaveLength(0);
  await ordinaryClient.session.status();
  expect(world.renderer).toHaveLength(1);
  expect(world.main).toHaveLength(0);
});

test("v2 interruption preserves the ordinary adapter instance", () => {
  const world = fixture();
  const base = world.base.replace(/opencode$/, "opencode2");
  const ordinaryClient = createClientV2(base, world.directory, { token: "fixture-client" });
  expect(createSessionInterruptionClient(base, ordinaryClient, world.directory, "fixture-client")).toBe(ordinaryClient);
  expect(world.main).toHaveLength(0);
  expect(world.renderer).toHaveLength(0);
});

test("Stop's final history refresh opts in without changing ordinary snapshot transport", async () => {
  const world = fixture();
  const endpoint = { opencodeBaseUrl: world.base, token: "fixture-client" };
  const snapshot = await composeNativeSessionHistory({ ...endpoint, desktopTransport: "main" }, "ses_root");
  expect(snapshot.session.id).toBe("ses_root");
  expect(snapshot.messages).toHaveLength(2);
  expect(world.renderer).toHaveLength(0);
  expect(world.main).toHaveLength(2);
  await composeNativeSessionHistory(endpoint, "ses_root");
  expect(world.renderer).toHaveLength(2);
  expect(world.main).toHaveLength(2);
});
