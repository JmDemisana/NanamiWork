import { describe, expect, test } from "bun:test";
import { localModelPickerAvailable } from "../src/react-app/domains/models/local-model-picker-preference";

describe("local model picker availability", () => {
  test("enables standalone desktop sessions", () => {
    expect(localModelPickerAvailable({ desktop: true, signedOut: true, managedEnabled: false })).toBe(true);
  });

  test("honors managed deployment settings for other sessions", () => {
    expect(localModelPickerAvailable({ desktop: true, signedOut: false, managedEnabled: false })).toBe(false);
    expect(localModelPickerAvailable({ desktop: false, signedOut: true, managedEnabled: false })).toBe(false);
    expect(localModelPickerAvailable({ desktop: true, signedOut: false, managedEnabled: true })).toBe(true);
  });
});
