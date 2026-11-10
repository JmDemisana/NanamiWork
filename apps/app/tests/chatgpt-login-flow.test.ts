import { afterAll, expect, mock, test } from "bun:test";
let opened = 0;
let creates = 0;
let dataListener: ((payload: { terminalId: string; data: string }) => void) | undefined;
let exitListener: ((payload: { terminalId: string; exitCode: number | null }) => void) | undefined;
let failToBind = false;
mock.module("../src/app/lib/desktop", () => ({
  readNanamiConfigFile: async () => ({ exists: false, content: null }),
  writeNanamiConfigFile: async () => ({ ok: true }),
  getCachedDesktopHomeDir: async () => "C:/fixture",
  openDesktopUrl: async () => { opened++; },
  desktopFetchViaMain: async () => new Response(null, { status: 500 }),
  readOpencodeConfig: async () => ({ exists: false }),
  writeOpencodeConfig: async () => ({ ok: true }),
}));
Object.defineProperty(globalThis, "window", { configurable: true, value: { __OPENWORK_ELECTRON__: { terminal: {
  create: async () => { creates++; return { terminalId: "fixture" }; },
  write: async () => { queueMicrotask(() => failToBind ? exitListener?.({ terminalId: "fixture", exitCode: 1 }) : dataListener?.({ terminalId: "fixture", data: "__NANAMI_CODEX_OAUTH_READY__" })); },
  kill: async () => {},
  onData: (fn: typeof dataListener) => { dataListener = fn; return () => { dataListener = undefined; }; },
  onExit: (fn: typeof exitListener) => { exitListener = fn; return () => { exitListener = undefined; }; },
} } } });
const { useChatGptAccountsStore } = await import("../src/react-app/domains/models/chatgpt-accounts-store");
afterAll(() => mock.restore());

test("ChatGPT sign-in starts only one flow and waits for its listener before opening", async () => {
  await Promise.all([useChatGptAccountsStore.getState().startBrowserLogin(), useChatGptAccountsStore.getState().startBrowserLogin()]);
  expect(creates).toBe(1);
  expect(opened).toBe(1);
  expect(useChatGptAccountsStore.getState().isConnecting).toBe(true);
  useChatGptAccountsStore.getState().setModalOpen(false);
  expect(useChatGptAccountsStore.getState().isConnecting).toBe(true);
  exitListener?.({ terminalId: "fixture", exitCode: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(useChatGptAccountsStore.getState().isConnecting).toBe(false);
  expect(useChatGptAccountsStore.getState().authUrl).toBeNull();
});

test("ChatGPT sign-in reports a callback failure without opening a broken URL", async () => {
  failToBind = true;
  await useChatGptAccountsStore.getState().startBrowserLogin();
  expect(opened).toBe(1);
  expect(useChatGptAccountsStore.getState().error).toContain("port 1455");
});
