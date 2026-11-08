import { expect, test } from "bun:test";
import { parseChatDeepLink, parseConnectDeepLink, parseDenAuthDeepLink } from "../src/app/lib/openwork-links";
import { parseManualAuthInput } from "../src/app/lib/manual-auth-input";

test("NanamiWork links and pasted legacy handoffs remain usable", () => {
  for (const scheme of ["nanamiwork", "openwork", "openwork-dev"]) {
    expect(parseChatDeepLink(`${scheme}://chat?prompt=hello`)?.prompt).toBe("hello");
    expect(parseConnectDeepLink(`${scheme}://connect?token=example`)?.rawUrl).toBe(`${scheme}://connect?token=example`);
    expect(parseDenAuthDeepLink(`${scheme}://den-auth?grant=example`)?.grant).toBe("example");
    expect(parseManualAuthInput(`Paste ${scheme}://den-auth?grant=example`)?.grant).toBe("example");
  }
  expect(parseConnectDeepLink("https://connect?token=example")).toBeNull();
});
