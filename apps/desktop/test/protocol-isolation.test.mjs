import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PUBLIC_DESKTOP_DISTRIBUTION, CLOUD_DESKTOP_DISTRIBUTION, ENTERPRISE_DESKTOP_DISTRIBUTION } from "../electron/desktop-distribution.mjs";
import { buildOpenworkDesktopEntry, createLinuxDesktopIntegration, OPENWORK_DESKTOP_ID, OPENWORK_PROTOCOL_MIME } from "../electron/linux-desktop-integration.mjs";
import { extractConnectLinkToken, extractConnectExchange } from "../electron/connect-link.mjs";

test("desktop distributions and installer manifests register only NanamiWork links", async () => {
  for (const distribution of [PUBLIC_DESKTOP_DISTRIBUTION, CLOUD_DESKTOP_DISTRIBUTION, ENTERPRISE_DESKTOP_DISTRIBUTION]) {
    assert.equal(distribution.protocolScheme, "nanamiwork");
  }
  for (const file of ["electron-builder.yml", "electron-builder.cloud.yml", "electron-builder.enterprise.yml"]) {
    const config = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(config, /- nanamiwork\b/);
    assert.doesNotMatch(config, /- openwork\s*$/m);
  }
});

test("Linux integration uses a separate launcher and protocol", () => {
  assert.equal(OPENWORK_DESKTOP_ID, "ai.nanami.workbench.desktop");
  assert.equal(OPENWORK_PROTOCOL_MIME, "x-scheme-handler/nanamiwork");
  const entry = buildOpenworkDesktopEntry({ appImagePath: "/tmp/NanamiWork.AppImage", appName: "NanamiWork", appVersion: "1.1.3", distribution: "public" });
  assert.match(entry, /MimeType=x-scheme-handler\/nanamiwork;/);
  assert.doesNotMatch(entry, /x-scheme-handler\/openwork/);
});

test("Linux install and removal leave OpenWork's launcher and association alone", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nanami-protocol-"));
  const data = path.join(root, "data"), config = path.join(root, "config"), resources = path.join(root, "resources");
  const applications = path.join(data, "applications");
  const upstream = path.join(applications, "com.differentai.openwork.desktop");
  const associations = path.join(config, "mimeapps.list");
  const original = "[Default Applications]\nx-scheme-handler/openwork=com.differentai.openwork.desktop;\n";
  let handler = "";
  const calls = [];
  try {
    await mkdir(applications, { recursive: true });
    await mkdir(config, { recursive: true });
    await writeFile(upstream, "[Desktop Entry]\nName=OpenWork\n");
    await writeFile(associations, original);
    for (const size of [16, 24, 32, 48, 64, 96, 128, 256, 512]) {
      const icon = path.join(resources, "icons", "linux", `${size}x${size}.png`);
      await mkdir(path.dirname(icon), { recursive: true });
      await writeFile(icon, "icon");
    }
    const integration = createLinuxDesktopIntegration({
      app: { isPackaged: true, getVersion: () => "1.1.3" }, dialog: {}, appName: "NanamiWork", distribution: "public",
      platform: "linux", homeDir: root, resourcesPath: resources,
      env: { APPIMAGE: path.join(root, "NanamiWork.AppImage"), XDG_DATA_HOME: data, XDG_CONFIG_HOME: config, XDG_DATA_DIRS: root },
      runCommand: async (command, args) => {
        calls.push([command, ...args]);
        if (command === "xdg-mime" && args[0] === "default") handler = args[1];
        return { ok: true, stdout: command === "xdg-mime" && args[0] === "query" ? handler : "", stderr: "" };
      },
    });
    assert.equal((await integration.install()).ok, true);
    assert.equal((await integration.remove()).ok, true);
    assert.equal(await readFile(upstream, "utf8"), "[Desktop Entry]\nName=OpenWork\n");
    assert.equal(await readFile(associations, "utf8"), original);
    assert.ok(calls.filter(([command]) => command === "xdg-mime").every(args => args.at(-1) === OPENWORK_PROTOCOL_MIME));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("connect handoffs accept NanamiWork and manually supplied legacy links", () => {
  for (const scheme of ["nanamiwork", "openwork", "openwork-dev"]) {
    assert.equal(extractConnectLinkToken(`${scheme}://connect?token=example`), "example");
    assert.deepEqual(extractConnectExchange(`${scheme}://connect?code=abcdefghijklmnopqrstuvwxyz&apiBaseUrl=https%3A%2F%2Fexample.com`), {
      code: "abcdefghijklmnopqrstuvwxyz", apiBaseUrl: "https://example.com",
    });
  }
  assert.equal(extractConnectLinkToken("https://connect?token=example"), null);
});
