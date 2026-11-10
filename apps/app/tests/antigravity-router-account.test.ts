import { afterAll, beforeEach, expect, mock, test } from "bun:test";

let accountsFile = "";
let configFile = "";
let pinFile: string | null = null;
let writes = 0;

mock.module("../src/app/lib/desktop", () => ({
  getCachedDesktopHomeDir: async () => "C:/private-home",
  readOpencodeConfig: async () => ({ path: "C:/private-home/.config/nanamiwork/opencode.jsonc", content: "{}" }),
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

const { syncAntigravityDiskState, restoreAntigravityRouterPin } = await import("../src/react-app/domains/models/antigravity-accounts-store");

beforeEach(() => {
  accountsFile = JSON.stringify({ version: 4, activeIndex: 0, accounts: [
    { email: "first@example.invalid", refreshToken: "first-token", enabled: true, marker: "keep" },
    { email: "second@example.invalid", refreshToken: "second-token", enabled: true },
    { email: "third@example.invalid", refreshToken: "third-token", enabled: false, verificationRequired: true },
  ] });
  configFile = JSON.stringify({ unrelated: "keep" });
  pinFile = null;
  writes = 0;
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
