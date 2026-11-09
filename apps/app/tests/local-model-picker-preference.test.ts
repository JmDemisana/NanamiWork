import { describe, expect, test } from "bun:test";
import { localModelPickerAvailable, useLocalModelPickerPreference } from "../src/react-app/domains/models/local-model-picker-preference";

describe("local model picker availability", () => {
  test("signed-out desktop works without the managed feature service", () => {
    expect(localModelPickerAvailable({ desktop: true, signedOut: true, localEnabled: true, managedEnabled: false })).toBe(true);
  });

  test("managed sessions and the web cannot bypass a disabled flag", () => {
    expect(localModelPickerAvailable({ desktop: true, signedOut: false, localEnabled: true, managedEnabled: false })).toBe(false);
    expect(localModelPickerAvailable({ desktop: false, signedOut: true, localEnabled: true, managedEnabled: false })).toBe(false);
    expect(localModelPickerAvailable({ desktop: true, signedOut: false, localEnabled: true, managedEnabled: true })).toBe(true);
  });

  test("the local switch disables both paths", () => {
    expect(localModelPickerAvailable({ desktop: true, signedOut: true, localEnabled: false, managedEnabled: false })).toBe(false);
    expect(localModelPickerAvailable({ desktop: true, signedOut: false, localEnabled: false, managedEnabled: true })).toBe(false);
    useLocalModelPickerPreference.getState().setEnabled(false);
    expect(useLocalModelPickerPreference.getState().enabled).toBe(false);
    useLocalModelPickerPreference.getState().setEnabled(true);
    expect(useLocalModelPickerPreference.getState().enabled).toBe(true);
  });
});
