import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let accountsFile = "";
let configFile = "";
let pinFile: string | null = null;
let writes = 0;
let metadataConfig = "{}";

mock.module("../src/app/lib/desktop", () => ({
  getCachedDesktopHomeDir: async () => "C:/private-home",
  readOpencodeConfig: async () => ({ path: "C:/private-home/.config/nanamiwork/opencode.jsonc", content: metadataConfig }),
  writeOpencodeConfig: async () => ({ ok: true }),
  readNanamiConfigFile: async (name: string) => name === "nanami-local-router-antigravity.json"
    ? { exists: pinFile !== null, content: pinFile }
    : { exists: true, content: name === "antigravity-accounts.json" ? accountsFile : configFile },
  writeNanamiConfigFile: async (name: string, content: string) => {
    writes += 1;
    if (name === "antigravity-accounts.json") accountsFile = content;
    else if (name === "nanami-local-router-antigravity.json") pinFile = content;
    else configFile = content;
    return { ok: true };
  },
  desktopFetchViaMain: async () => { throw new Error("Unexpected network request"); },
}));

const { syncAntigravityDiskState, restoreAntigravityRouterPin, syncDiskAccountsViaTerminal } = await import("../src/react-app/domains/models/antigravity-accounts-store");

beforeEach(() => {
  accountsFile = JSON.stringify({ version: 4, activeIndex: 0, accounts: [
    { email: "first@example.invalid", refreshToken: "first-token", enabled: true, marker: "keep" },
    { email: "second@example.invalid", refreshToken: "second-token", enabled: true },
    { email: "third@example.invalid", refreshToken: "third-token", enabled: false, verificationRequired: true },
  ] });
  configFile = JSON.stringify({ unrelated: "keep" });
  pinFile = null;
  writes = 0;
  metadataConfig = "{}";
});

test("recovers an unlabeled plugin account and adds the selected saved account", async () => {
  accountsFile = JSON.stringify({ version: 4, activeIndex: 0, accounts: [
    { refreshToken: "first-token", enabled: true, marker: "preserve" },
  ] });
  metadataConfig = JSON.stringify({ x_nanami_antigravity: { accounts: [
    { email: "first@example.invalid", refreshToken: "first-token", enabled: true },
    { email: "second@example.invalid", refreshToken: "second-token", enabled: true },
  ] } });
  await syncAntigravityDiskState("second@example.invalid", "model", { exactAccount: true, strict: true, expectedRefreshToken: "second-token" });
  const saved = JSON.parse(accountsFile);
  expect(saved.accounts.map((account: { email: string }) => account.email)).toEqual(["first@example.invalid", "second@example.invalid"]);
  expect(saved.accounts.map((account: { enabled: boolean }) => account.enabled)).toEqual([false, true]);
  expect(saved.accounts[0].marker).toBe("preserve");
  await restoreAntigravityRouterPin();
  expect(JSON.parse(accountsFile).accounts.map((account: { enabled: boolean }) => account.enabled)).toEqual([true, true]);
});

test("ambiguous unlabeled accounts fail before modifying files", async () => {
  accountsFile = JSON.stringify({ accounts: [{ refreshToken: "shared-token", enabled: true }] });
  metadataConfig = JSON.stringify({ x_nanami_antigravity: { accounts: [
    { email: "first@example.invalid", refreshToken: "shared-token" },
    { email: "second@example.invalid", refreshToken: "shared-token" },
  ] } });
  await expect(syncAntigravityDiskState("second@example.invalid", "model", { exactAccount: true, strict: true, expectedRefreshToken: "shared-token" })).rejects.toThrow("Could not prepare");
  expect(writes).toBe(0);
});

test("restoring a pin recovers an identity stripped by the plugin", async () => {
  metadataConfig = JSON.stringify({ x_nanami_antigravity: { accounts: [
    { email: "first@example.invalid", refreshToken: "first-token", enabled: true },
    { email: "second@example.invalid", refreshToken: "second-token", enabled: true },
    { email: "third@example.invalid", refreshToken: "third-token", enabled: false, verificationRequired: true },
  ] } });
  await syncAntigravityDiskState("second@example.invalid", "model", { exactAccount: true, strict: true, expectedRefreshToken: "second-token" });
  const changed = JSON.parse(accountsFile);
  delete changed.accounts[1].email;
  accountsFile = JSON.stringify(changed);
  await restoreAntigravityRouterPin();
  expect(JSON.parse(accountsFile).accounts.map((account: { enabled: boolean }) => account.enabled)).toEqual([true, true, false]);
});

test("a saved account cannot be recreated with a stale credential", async () => {
  accountsFile = JSON.stringify({ accounts: [{ email: "first@example.invalid", refreshToken: "first-token", enabled: true }] });
  metadataConfig = JSON.stringify({ x_nanami_antigravity: { accounts: [
    { email: "first@example.invalid", refreshToken: "first-token" },
    { email: "second@example.invalid", refreshToken: "replacement-token" },
  ] } });
  await expect(syncAntigravityDiskState("second@example.invalid", "model", { exactAccount: true, strict: true, expectedRefreshToken: "stale-token" })).rejects.toThrow("Could not prepare");
  expect(writes).toBe(0);
});

test("account synchronization preserves saved accounts when the plugin omits an email", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nanami-account-sync-"));
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let onExit: ((event: { terminalId: string }) => void) | undefined;
  let failure: unknown = null;
  let invoked = 0;
  try {
    writeFileSync(join(dir, "antigravity-accounts.json"), JSON.stringify({ accounts: [{ refreshToken: "first-token", enabled: true }] }));
    writeFileSync(join(dir, "opencode.jsonc"), JSON.stringify({ x_nanami_antigravity: { activeEmail: "first@example.invalid", accounts: [
      { email: "first@example.invalid", refreshToken: "first-token" },
      { email: "second@example.invalid", refreshToken: "second-token" },
    ] } }));
    Object.defineProperty(globalThis, "window", { configurable: true, value: { __OPENWORK_ELECTRON__: { terminal: {
      create: async () => ({ terminalId: "fixture" }),
      onExit: (callback: typeof onExit) => { onExit = callback; return () => {}; },
      write: (_id: string, command: string) => {
        invoked += 1;
        try {
          const encoded = /Buffer\.from\('([^']+)'/.exec(command)?.[1];
          if (!encoded) throw new Error("Missing fixture script");
          execFileSync(process.execPath, ["-e", Buffer.from(encoded, "base64").toString("utf8")], {
            env: { ...process.env, OPENCODE_CONFIG_DIR: dir }, stdio: "pipe",
          });
        } catch (error) { failure = error; }
        onExit?.({ terminalId: "fixture" });
      },
    } } } });
    await syncDiskAccountsViaTerminal();
    expect(failure).toBeNull();
    const saved = JSON.parse(readFileSync(join(dir, "opencode.jsonc"), "utf8"));
    expect(saved.x_nanami_antigravity.accounts.map((account: { email: string }) => account.email)).toEqual(["first@example.invalid", "second@example.invalid"]);
    expect(JSON.parse(readFileSync(join(dir, "antigravity-accounts.json"), "utf8")).accounts[0].email).toBe("first@example.invalid");
    const unrecognized = JSON.stringify({ accounts: [{ refreshToken: "unknown-token", enabled: true }] });
    writeFileSync(join(dir, "antigravity-accounts.json"), unrecognized);
    const configBefore = readFileSync(join(dir, "opencode.jsonc"), "utf8");
    failure = null;
    await syncDiskAccountsViaTerminal();
    expect(invoked).toBe(2);
    expect(readFileSync(join(dir, "antigravity-accounts.json"), "utf8")).toBe(unrecognized);
    expect(readFileSync(join(dir, "opencode.jsonc"), "utf8")).toBe(configBefore);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    for (const name of ["antigravity-accounts.json", "opencode.jsonc", "opencode.json"]) rmSync(join(dir, name), { force: true });
    rmdirSync(dir);
  }
});

afterAll(() => mock.restore());

test("a routed Antigravity selection permits only its chosen account", async () => {
  await syncAntigravityDiskState("second@example.invalid", "antigravity-claude-sonnet-5-5-high", {
    exactAccount: true, strict: true, expectedRefreshToken: "second-token",
  });
  const saved = JSON.parse(accountsFile);
  expect(saved.activeIndex).toBe(1);
  expect(saved.activeIndexByFamily).toEqual({ claude: 1, gemini: 1 });
  expect(saved.accounts.map((account: { enabled: boolean }) => account.enabled)).toEqual([false, true, false]);
  expect(saved.accounts[0].marker).toBe("keep");
  expect(JSON.parse(configFile).unrelated).toBe("keep");
  expect(JSON.parse(pinFile || "{}").originalEnabled).toEqual({ "first@example.invalid": true, "second@example.invalid": true, "third@example.invalid": false });
});

test("missing, changed, and unverified accounts fail before modifying files", async () => {
  for (const [email, token] of [["missing@example.invalid", "missing"], ["second@example.invalid", "stale"], ["third@example.invalid", "third-token"]]) {
    await expect(syncAntigravityDiskState(email, "model", { exactAccount: true, strict: true, expectedRefreshToken: token })).rejects.toThrow("Could not prepare");
  }
  expect(writes).toBe(0);
});

test("the original enabled flags are restored after routing leaves Antigravity", async () => {
  await syncAntigravityDiskState("first@example.invalid", "model", { exactAccount: true, strict: true, expectedRefreshToken: "first-token" });
  await syncAntigravityDiskState("second@example.invalid", "model", { exactAccount: true, strict: true, expectedRefreshToken: "second-token" });
  await restoreAntigravityRouterPin();
  expect(JSON.parse(accountsFile).accounts.map((account: { enabled: boolean }) => account.enabled)).toEqual([true, true, false]);
  expect(JSON.parse(pinFile || "{}")).toEqual({});
});

test("a concurrent manual account change is never overwritten during restoration", async () => {
  await syncAntigravityDiskState("first@example.invalid", "model", { exactAccount: true, strict: true, expectedRefreshToken: "first-token" });
  const changed = JSON.parse(accountsFile);
  changed.accounts[1].enabled = true;
  accountsFile = JSON.stringify(changed);
  await expect(restoreAntigravityRouterPin()).rejects.toThrow("accounts changed");
  expect(JSON.parse(accountsFile).accounts[1].enabled).toBe(true);
});

test("a passive model render cannot silently unpin a routed account", async () => {
  await syncAntigravityDiskState("first@example.invalid", "model", { exactAccount: true, strict: true, expectedRefreshToken: "first-token" });
  const pinned = accountsFile;
  const before = writes;
  await syncAntigravityDiskState("second@example.invalid", "model", { skipIfRouterPinned: true });
  expect(accountsFile).toBe(pinned);
  expect(writes).toBe(before);
});
