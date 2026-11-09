import { create } from "zustand";

const STORAGE_KEY = "openwork.localModelPicker.enabled";

function readEnabled(): boolean {
  try {
    return typeof window === "undefined" || window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Standalone desktop rollout, independent of Den. The local switch is also a kill switch. */
export const useLocalModelPickerPreference = create<{
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}>((set) => ({
  enabled: readEnabled(),
  setEnabled: (enabled) => {
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // Keep the preference for this session if storage is unavailable.
    }
    set({ enabled });
  },
}));

/** Managed and browser sessions still require the registry-backed deployment flag. */
export function localModelPickerAvailable(input: {
  desktop: boolean;
  signedOut: boolean;
  localEnabled: boolean;
  managedEnabled: boolean;
}): boolean {
  return input.localEnabled && ((input.desktop && input.signedOut) || input.managedEnabled);
}
