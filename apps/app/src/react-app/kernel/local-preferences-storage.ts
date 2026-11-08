export const LOCAL_PREFERENCES_KEY = "openwork.preferences";
export const DEFAULT_SHOW_THINKING = true;

export type LinkOpenDestination = "openwork" | "external";

export function isLinkOpenDestination(value: unknown): value is LinkOpenDestination {
  return value === "openwork" || value === "external";
}

/**
 * One-time reset (2026-10): Show model reasoning now asks providers for
 * readable reasoning, so it starts off for everyone. Saved preferences without
 * this marker predate the change and still hold the old default of on.
 */
export const SHOW_THINKING_RESET_MARKER = "showThinkingResetToOff";

/** True when saved preferences predate the reset and must be switched off once. */
export function needsShowThinkingReset(stored: unknown): boolean {
  return Boolean(stored) && typeof stored === "object" && Reflect.get(stored as object, SHOW_THINKING_RESET_MARKER) !== true;
}

/**
 * Settings › Show model reasoning, read outside React when a prompt is sent.
 * NanamiWork always asks providers for readable reasoning.
 */
export function readShowThinkingPreference(): boolean {
  return DEFAULT_SHOW_THINKING;
}
