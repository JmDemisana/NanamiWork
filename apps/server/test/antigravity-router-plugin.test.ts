import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Optional integration with the exact plugin installed in the isolated local
// profile. The manager sees synthetic credentials and a temporary directory.
const packageRoot = join(process.env.USERPROFILE || process.env.HOME || "", ".config", "nanamiwork", "cache", "opencode", "packages", "opencode-antigravity-auth@latest", "node_modules", "opencode-antigravity-auth");
const modulePath = join(packageRoot, "dist", "src", "plugin", "accounts.js");
const packagePath = join(packageRoot, "package.json");
if (existsSync(modulePath) && existsSync(packagePath) && JSON.parse(readFileSync(packagePath, "utf8")).version === "2.1.2") {
  test("installed Antigravity manager cannot fall back to disabled accounts on quota exhaustion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "router-plugin-test-"));
    const previous = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = directory;
    try {
      const { AccountManager } = await import(pathToFileURL(modulePath).href);
      const manager = new AccountManager({ type: "oauth", refresh: "token-a", access: "", expires: 0 }, {
        version: 4, activeIndex: 0, activeIndexByFamily: { claude: 0, gemini: 0 }, accounts: [
          { email: "one@example.invalid", refreshToken: "token-a", enabled: true },
          { email: "two@example.invalid", refreshToken: "token-b", enabled: false },
        ],
      });
      const selected = manager.getCurrentOrNextForFamily("claude", "claude-sonnet-4-6", "sticky");
      expect(selected?.email).toBe("one@example.invalid");
      manager.markRateLimited(selected, 60_000, "claude", "antigravity", "claude-sonnet-4-6");
      expect(manager.getCurrentOrNextForFamily("claude", "claude-sonnet-4-6", "sticky")).toBeNull();
      await manager.retire();
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CONFIG_DIR;
      else process.env.OPENCODE_CONFIG_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });
}
