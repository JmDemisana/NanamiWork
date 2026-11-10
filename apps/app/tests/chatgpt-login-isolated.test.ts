import { afterAll, expect, mock, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
const root = await mkdtemp(join(tmpdir(), "nanami-chatgpt-test-"));
const authDir = join(root, "data", "opencode");
await mkdir(authDir, { recursive: true });
const configPath = join(root, "opencode.jsonc");
await writeFile(configPath, '{\n  // preserve\n  "provider": {"github-copilot": {"options": {"apiKey": "copilot-fixture"}}}\n}');
await writeFile(join(authDir, "auth.json"), JSON.stringify({ "github-copilot": { type: "api", key: "copilot-fixture" } }));
const reserve = createServer();
await new Promise<void>((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const address = reserve.address();
if (!address || typeof address === "string") throw new Error("Could not reserve a test port");
const port = address.port;
await new Promise<void>((resolve) => reserve.close(() => resolve()));
const jwt = (value: unknown) => `header.${Buffer.from(JSON.stringify(value)).toString("base64url")}.signature`;
const tokens = { access_token: jwt({}), id_token: jwt({ email: "new@example.invalid" }), refresh_token: "fixture-refresh", expires_in: 3600 };
let onData: ((payload: { terminalId: string; data: string }) => void) | undefined;
let onExit: ((payload: { terminalId: string; exitCode: number | null }) => void) | undefined;
let child: ChildProcess | undefined;
let opened = 0;
mock.module("../src/app/lib/desktop", () => ({
  getCachedDesktopHomeDir: async () => root,
  readOpencodeConfig: async (scope: string) => scope === "global" ? { path: configPath } : { exists: true, content: await readFile(configPath, "utf8") },
  writeOpencodeConfig: async (_scope: string, _dir: string, content: string) => { await writeFile(configPath, content); return { ok: true }; },
  readNanamiConfigFile: async (name: string) => { try { return { exists: true, content: await readFile(join(root, name), "utf8") }; } catch { return { exists: false, content: null }; } },
  writeNanamiConfigFile: async (name: string, content: string) => { await writeFile(join(root, name), content); return { ok: true }; },
  desktopFetchViaMain: async () => new Response(null, { status: 500 }),
  openDesktopUrl: async (url: string) => {
    opened++;
    const state = new URL(url).searchParams.get("state");
    const callback = await fetch(`http://127.0.0.1:${port}/auth/callback?code=fixture-code&state=${encodeURIComponent(state ?? "")}`);
    expect(callback.status).toBe(200);
  },
}));
Object.defineProperty(globalThis, "window", { configurable: true, value: { __OPENWORK_ELECTRON__: { terminal: {
  create: async () => ({ terminalId: "fixture" }),
  onData: (fn: typeof onData) => { onData = fn; return () => { onData = undefined; }; },
  onExit: (fn: typeof onExit) => { onExit = fn; return () => { onExit = undefined; }; },
  kill: async () => child?.kill(),
  write: async (_id: string, command: string) => {
    const encoded = /Buffer\.from\('([^']+)'/.exec(command)?.[1];
    if (!encoded) throw new Error("Missing callback script");
    const callbackScript = Buffer.from(encoded, "base64").toString("utf8").replaceAll("1455", String(port));
    const stub = `globalThis.fetch = async () => new Response(${JSON.stringify(JSON.stringify(tokens))}, {status:200,headers:{'content-type':'application/json'}});`;
    child = spawn(process.execPath, ["-e", stub + callbackScript], { env: { ...process.env, OPENCODE_CONFIG_DIR: root, XDG_DATA_HOME: join(root, "data") }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (data) => onData?.({ terminalId: "fixture", data: String(data) }));
    child.on("exit", (code) => onExit?.({ terminalId: "fixture", exitCode: code }));
  },
} } } });
const { useChatGptAccountsStore } = await import("../src/react-app/domains/models/chatgpt-accounts-store");
afterAll(async () => { child?.kill(); mock.restore(); await rm(root, { recursive: true, force: true }); });

test("the isolated ChatGPT browser callback adds an account without replacing Copilot", async () => {
  await useChatGptAccountsStore.getState().startBrowserLogin();
  const deadline = Date.now() + 5000;
  while (useChatGptAccountsStore.getState().isConnecting && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  expect(opened).toBe(1);
  expect(useChatGptAccountsStore.getState().error).toBeNull();
  expect(useChatGptAccountsStore.getState().accounts.map((account) => account.email)).toEqual(["new@example.invalid"]);
  const config = parse(await readFile(configPath, "utf8"));
  expect(config.provider["github-copilot"].options.apiKey).toBe("copilot-fixture");
  const auth = JSON.parse(await readFile(join(authDir, "auth.json"), "utf8"));
  expect(auth["github-copilot"].key).toBe("copilot-fixture");
  expect((await readFile(configPath, "utf8"))).toContain("// preserve");
});
