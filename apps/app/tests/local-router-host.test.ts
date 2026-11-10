import { expect, test } from "bun:test";
import { isConfiguredRouterHost } from "../src/react-app/domains/models/local-router-runtime";

test("router host credentials are sent only to the configured local server", () => {
  expect(isConfiguredRouterHost("http://127.0.0.1:8787", { urlOverride: "http://127.0.0.1:8787/" })).toBe(true);
  expect(isConfiguredRouterHost("http://127.0.0.1:8787", { portOverride: 8787 })).toBe(true);
  expect(isConfiguredRouterHost("http://127.0.0.1:9999", { portOverride: 8787 })).toBe(false);
  expect(isConfiguredRouterHost("http://localhost:8787", { urlOverride: "http://127.0.0.1:8787" })).toBe(false);
  expect(isConfiguredRouterHost("https://example.invalid", { urlOverride: "https://example.invalid" })).toBe(false);
  expect(isConfiguredRouterHost("http://127.0.0.1:8787", {})).toBe(false);
});
