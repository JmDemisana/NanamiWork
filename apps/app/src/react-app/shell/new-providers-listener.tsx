/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";
import { resolveProviderDisplayName } from "@/app/utils";
import {
  newProvidersEvent,
  type NewProviderInfo,
  type NewProvidersEventDetail,
} from "@/app/lib/provider-events";
import { t } from "@/i18n";
import { useNotificationStore } from "@/react-app/kernel/notification-store";
import { readDenSettings } from "@/app/lib/den";
import { requestMemberActivityRefresh } from "@/react-app/kernel/activity-types";
import { notifyEvent } from "./notifications";
import { orgOnboardingVisibilityEvent } from "./reload-coordinator";

import { readOpencodeConfig, writeOpencodeConfig, type OpencodeConfigFile, openDesktopUrl, getCachedDesktopHomeDir } from "@/app/lib/desktop";
import { refreshProviderListQueries } from "@/react-app/infra/provider-list-query";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import { syncDiskAccountsViaTerminal, useAntigravityAccountsStore } from "@/react-app/domains/models/antigravity-accounts-store";
import { syncCodexDiskAccountsViaTerminal, useChatGptAccountsStore } from "@/react-app/domains/models/chatgpt-accounts-store";
import { applyEdits, modify, parse } from "jsonc-parser";

const SEEN_KEY = "openwork.seenProviderIds";
const NEW_PROVIDERS_DEDUPE_KEY = "new-providers";

/** Custom event to request the model picker to open. */
export const openModelPickerEvent = "openwork-open-model-picker";
/** Custom event to request the provider auth (connect API keys) modal to open. */
export const openProviderAuthEvent = "openwork-open-provider-auth";
/** Custom event to request the provider auth modal focused on ChatGPT/Codex. */
export const openCodexAuthEvent = "openwork-open-codex-auth";
/** Custom event to confirm ChatGPT/Codex OAuth sign-in and refresh NanamiWork. */
export const confirmCodexAuthEvent = "nanami-confirm-codex-auth";
/** Custom event to request NanamiWork's Antigravity account sign-in. */
export const openWorkbenchInstancesEvent = "nanami-open-workbench-instances";
/** Custom event to confirm Antigravity OAuth sign-in and refresh NanamiWork. */
export const confirmAntigravityAuthEvent = "nanami-confirm-antigravity-auth";

const DEFAULT_ANTIGRAVITY_MODALITIES = {
  input: ["text", "image", "pdf"],
  output: ["text"],
};

const ANTIGRAVITY_GOOGLE_MODELS: Record<string, unknown> = {
  "antigravity-gemini-3.8-flash-high": {
    name: "Gemini 3.8 Flash (High)",
    limit: { context: 1048576, output: 65536 },
    modalities: DEFAULT_ANTIGRAVITY_MODALITIES,
  },
  "antigravity-gemini-3.8-flash-medium": {
    name: "Gemini 3.8 Flash (Medium)",
    limit: { context: 1048576, output: 65536 },
    modalities: DEFAULT_ANTIGRAVITY_MODALITIES,
  },
  "antigravity-gemini-3.8-flash-low": {
    name: "Gemini 3.8 Flash (Low)",
    limit: { context: 1048576, output: 65536 },
    modalities: DEFAULT_ANTIGRAVITY_MODALITIES,
  },
  "antigravity-claude-sonnet-4-6": {
    name: "Claude Sonnet 4.6 (Thinking)",
    limit: { context: 200000, output: 64000 },
    modalities: DEFAULT_ANTIGRAVITY_MODALITIES,
  },
  "antigravity-claude-opus-4-6-thinking": {
    name: "Claude Opus 4.6 (Thinking)",
    limit: { context: 200000, output: 64000 },
    modalities: DEFAULT_ANTIGRAVITY_MODALITIES,
    variants: {
      low: { thinkingConfig: { thinkingBudget: 8192 } },
      max: { thinkingConfig: { thinkingBudget: 32768 } },
    },
  },
  "antigravity-gpt-oss-120b-medium": {
    name: "GPT-OSS 120B (Medium)",
    limit: { context: 131072, output: 32768 },
    modalities: DEFAULT_ANTIGRAVITY_MODALITIES,
  },
  "antigravity-gemini-4-argon": {
    name: "Gemini 4 Argon",
    limit: { context: 1048576, output: 65536 },
    modalities: DEFAULT_ANTIGRAVITY_MODALITIES,
  },
  "antigravity-gemini-4-argon-high": {
    name: "Gemini 4 Argon (High)",
    limit: { context: 1048576, output: 65536 },
    modalities: DEFAULT_ANTIGRAVITY_MODALITIES,
  },
};

// ---------------------------------------------------------------------------
// Antigravity OAuth constants (mirrored from opencode-antigravity-auth plugin)
// ---------------------------------------------------------------------------
const ANTIGRAVITY_CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";
const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

/** Generate a PKCE code verifier (43-128 chars, URL-safe base64). */
async function generatePKCEVerifier(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** Derive the S256 code challenge from a verifier. */
async function derivePKCEChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Start Antigravity OAuth.
 *
 * When `serverStartAuth` is provided (plugin loaded in the OpenCode engine),
 * delegates to it so the server starts the :51121 callback listener before
 * the browser is opened — the correct two-step server-driven flow.
 *
 * Falls back to building the PKCE URL client-side when the plugin is not yet
 * loaded (browser opens but callback may fail; callers should show a
 * "restart Nanami" notice in this case).
 */
export async function startAntigravityOAuth(
  serverStartAuth?: (providerId: string) => Promise<unknown>,
): Promise<"server" | "client" | "error"> {
  // --- Stage 1: server-side auth when plugin is loaded ---
  if (serverStartAuth) {
    try {
      await serverStartAuth("google");
      return "server";
    } catch (err) {
      console.warn("Server-side Antigravity auth failed, falling back to client PKCE:", err);
    }
  }

  // --- Stage 2: DIY PKCE URL (plugin not yet loaded in engine) ---
  try {
    const verifier = await generatePKCEVerifier();
    const challenge = await derivePKCEChallenge(verifier);
    const state = btoa(JSON.stringify({ verifier, projectId: "" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", ANTIGRAVITY_REDIRECT_URI);
    url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "));
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");

    await openDesktopUrl(url.toString());
    return "client";
  } catch (err) {
    console.warn("Could not start Antigravity OAuth:", err);
    return "error";
  }
}

async function getNanamiworkConfigDir(): Promise<string> {
  const home = (await getCachedDesktopHomeDir()) || "";
  return home ? `${home.replace(/\\/g, "/")}/.config/nanamiwork` : ".config/nanamiwork";
}

export async function ensureAntigravityPluginInstalled(): Promise<boolean> {
  try {
    const configDir = await getNanamiworkConfigDir();
    const configRes = (await readOpencodeConfig("project", configDir)) as OpencodeConfigFile;
    let raw = configRes?.content?.trim()
      ? configRes.content
      : "{\n  \"$schema\": \"https://opencode.ai/config.json\"\n}\n";
    const parsed = (parse(raw) ?? {}) as {
      plugin?: unknown;
      provider?: { google?: { name?: string; models?: Record<string, unknown> } };
    };
    const plugins = Array.isArray(parsed.plugin) ? (parsed.plugin as string[]) : [];
    const installed = plugins.some((entry) => String(entry).startsWith("opencode-antigravity-auth"));
    let changed = false;
    if (!installed) {
      const edits = modify(raw, ["plugin"], [...plugins, "opencode-antigravity-auth@latest"], {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      });
      raw = applyEdits(raw, edits);
      changed = true;
    }
    const existingGoogleModels = parsed.provider?.google?.models ?? {};
    if (!existingGoogleModels["antigravity-gemini-3.8-flash-high"] || existingGoogleModels["antigravity-gemini-3.1-pro"]) {
      const googleConfig = {
        ...(parsed.provider?.google ?? {}),
        name: "Google Antigravity",
        models: {
          ...ANTIGRAVITY_GOOGLE_MODELS,
        },
      };
      const edits = modify(raw, ["provider", "google"], googleConfig, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      });
      raw = applyEdits(raw, edits);
      changed = true;
    }
    if (changed) {
      await writeOpencodeConfig("project", configDir, raw);
    }
    return changed;
  } catch (err) {
    console.warn("Could not ensure opencode-antigravity-auth plugin:", err);
    return false;
  }
}

export type AntigravityAuthStoreHandle = {
  startProviderAuth: (
    providerId?: string,
    methodIndex?: number,
  ) => Promise<{ methodIndex: number; authorization: { url: string; method: "oauth" | "code" | "auto"; instructions?: string } }>;
  completeProviderAuthOAuth: (
    providerId: string,
    methodIndex: number,
    code?: string,
  ) => Promise<{ connected: boolean; pending?: boolean; message?: string }>;
  refreshProviders: (options?: {
    dispose?: boolean;
    force?: boolean;
    configChanged?: boolean;
  }) => Promise<unknown>;
};

let pendingOAuthMethodIndex = 0;
let pendingOAuthPromise: Promise<{ connected: boolean; pending?: boolean; message?: string } | null> | null = null;

export async function runAntigravityOAuthFlow(store: AntigravityAuthStoreHandle): Promise<void> {
  useAntigravityAccountsStore.setState({ modalOpen: true, isConnecting: true, error: null });
  const configChanged = await ensureAntigravityPluginInstalled();
  if (configChanged) {
    await store.refreshProviders({ dispose: true, force: true, configChanged: true }).catch(() => undefined);
  }
  try {
    let authResult: { methodIndex: number; authorization: { url: string; method: string; instructions?: string } };
    try {
      authResult = await store.startProviderAuth("google");
    } catch {
      await store.refreshProviders({ dispose: true, force: true, configChanged: true }).catch(() => undefined);
      authResult = await store.startProviderAuth("google");
    }
    const methodIndex = typeof authResult?.methodIndex === "number" ? authResult.methodIndex : 0;
    pendingOAuthMethodIndex = methodIndex;
    const authUrl = authResult?.authorization?.url;
    useAntigravityAccountsStore.setState({ authUrl: authUrl || null, isConnecting: true });
    // The opencode-antigravity-auth server plugin already calls openBrowser() when method === "auto".
    // Only open from the frontend if the server fell back to manual/code mode.
    if (authUrl) {
      await openDesktopUrl(authUrl).catch(() => undefined);
    }
    // Immediately invoke completeProviderAuthOAuth in the background so the server's
    // callback() awaits the :51121 redirect, exchanges tokens, and saves antigravity-accounts.json!
    const completion = store
      .completeProviderAuthOAuth("google", methodIndex)
      .then(async (res) => {
        clearCachedProviderLists();
        await syncDiskAccountsViaTerminal().catch(() => undefined);
        await store.refreshProviders({ dispose: true, force: true }).catch(() => undefined);
        clearCachedProviderLists();
        await refreshProviderListQueries(getReactQueryClient()).catch(() => undefined);
        await useAntigravityAccountsStore.getState().loadAccounts().catch(() => undefined);
        useAntigravityAccountsStore.setState({ modalOpen: false, isConnecting: false });
        window.dispatchEvent(new CustomEvent(newProvidersEvent, { detail: { providers: [{ id: "google", name: "Google Antigravity" }], newProviderCount: 1, newModelCount: 6 } }));
        return res;
      })
      .catch((err) => {
        console.warn("Antigravity OAuth background completion warning:", err);
        return null;
      });
    pendingOAuthPromise = completion;
  } catch (err) {
    console.warn("Server-side Antigravity startProviderAuth failed, falling back to client PKCE:", err);
    await startAntigravityOAuth();
  }
}

function clearCachedProviderLists(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("openwork.providerList.")) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  } catch {}
}

export async function runAntigravityConfirmAndRefresh(store: AntigravityAuthStoreHandle): Promise<void> {
  try {
    clearCachedProviderLists();
    if (pendingOAuthPromise) {
      await Promise.race([
        pendingOAuthPromise,
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);
    }
    await syncDiskAccountsViaTerminal().catch(() => undefined);
    await Promise.race([
      store.refreshProviders({ dispose: true, force: true }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 1200)),
    ]);
    clearCachedProviderLists();
    await refreshProviderListQueries(getReactQueryClient()).catch(() => undefined);
    await useAntigravityAccountsStore.getState().loadAccounts().catch(() => undefined);
  } catch (err) {
    console.warn("Confirm & Refresh warning:", err);
  }
  window.location.reload();
}

let pendingCodexOAuthPromise: Promise<{ connected: boolean; pending?: boolean; message?: string } | null> | null = null;

export async function runChatGptOAuthFlow(store: AntigravityAuthStoreHandle): Promise<void> {
  useChatGptAccountsStore.setState({ modalOpen: true, isConnecting: true, error: null });
  try {
    let authResult: { methodIndex: number; authorization: { url: string; method: string; instructions?: string } };
    try {
      authResult = await store.startProviderAuth("openai", 0);
    } catch {
      await store.refreshProviders({ dispose: true, force: true, configChanged: true }).catch(() => undefined);
      authResult = await store.startProviderAuth("openai", 0);
    }
    const methodIndex = typeof authResult?.methodIndex === "number" ? authResult.methodIndex : 0;
    const authUrl = authResult?.authorization?.url;
    if (!authUrl) {
      throw new Error("Missing OpenAI OAuth authorization URL");
    }
    useChatGptAccountsStore.setState({ authUrl, isConnecting: true });
    await openDesktopUrl(authUrl).catch(() => undefined);

    const completion = store
      .completeProviderAuthOAuth("openai", methodIndex)
      .then(async (res) => {
        clearCachedProviderLists();
        await syncCodexDiskAccountsViaTerminal({ type: "confirm" }).catch(() => undefined);
        await store.refreshProviders({ dispose: true, force: true }).catch(() => undefined);
        clearCachedProviderLists();
        await refreshProviderListQueries(getReactQueryClient()).catch(() => undefined);
        await useChatGptAccountsStore.getState().loadAccounts().catch(() => undefined);
        useChatGptAccountsStore.setState({ modalOpen: false, isConnecting: false });
        return res;
      })
      .catch((err) => {
        console.warn("ChatGPT OAuth background completion warning:", err);
        return null;
      });
    pendingCodexOAuthPromise = completion;
  } catch (err) {
    console.warn("Server-side ChatGPT startProviderAuth failed, falling back to local PKCE:", err);
    await useChatGptAccountsStore.getState().startBrowserLogin();
  }
}

export async function runChatGptConfirmAndRefresh(store: AntigravityAuthStoreHandle): Promise<void> {
  try {
    clearCachedProviderLists();
    if (pendingCodexOAuthPromise) {
      await Promise.race([
        pendingCodexOAuthPromise,
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);
    }
    await syncCodexDiskAccountsViaTerminal({ type: "confirm" }).catch(() => undefined);
    await Promise.race([
      store.refreshProviders({ dispose: true, force: true }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 1200)),
    ]);
    clearCachedProviderLists();
    await refreshProviderListQueries(getReactQueryClient()).catch(() => undefined);
    await useChatGptAccountsStore.getState().loadAccounts().catch(() => undefined);
    useChatGptAccountsStore.setState({ modalOpen: false, isConnecting: false });
  } catch (err) {
    console.warn("ChatGPT Confirm & Refresh warning:", err);
  }
}

function readSeenProviderIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function markProvidersSeen(ids: string[]): void {
  try {
    const existing = readSeenProviderIds();
    for (const id of ids) existing.add(id);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...existing]));
  } catch {}
}

type ListenerState = {
  active: boolean;
  providers: NewProviderInfo[];
  newProviderCount: number;
  newModelCount: number;
};

const EMPTY_STATE: ListenerState = {
  active: false,
  providers: [],
  newProviderCount: 0,
  newModelCount: 0,
};

/**
 * Headless listener: converts "new providers available" events (cloud sync,
 * sign-in, local config changes) into a single coalesced notification center
 * entry instead of a popup. Accumulates until the entry is read, so repeated
 * syncs update one entry with the full summary.
 */
export function NewProvidersListener() {
  const [state, setState] = useState<ListenerState>(EMPTY_STATE);
  const [orgOnboardingVisible, setOrgOnboardingVisible] = useState(false);
  const [pendingProviders, setPendingProviders] = useState<NewProviderInfo[]>([]);

  const showProviders = useCallback((detail: NewProvidersEventDetail) => {
    const seen = readSeenProviderIds();
    const genuinelyNew = detail.providers.filter((p) => !seen.has(p.id));
    const newProviderCount = detail.newProviderCount ?? genuinelyNew.length;
    const newModelCount = detail.newModelCount ?? 0;
    if (genuinelyNew.length === 0 && newModelCount === 0) return;

    setState((prev) => ({
      active: true,
      providers: prev.active
        ? [...prev.providers, ...detail.providers.filter((p) => !prev.providers.some((e) => e.id === p.id))]
        : detail.providers,
      newProviderCount: prev.active
        ? prev.newProviderCount + newProviderCount
        : newProviderCount,
      newModelCount: prev.active
        ? prev.newModelCount + newModelCount
        : newModelCount,
    }));
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<NewProvidersEventDetail>).detail;
      // The engine catalog describes materialization, not member entitlement.
      // Signed-in provider changes belong to the scoped inventory observer;
      // never add a second, profile-wide cloud entry (including on first sync).
      if (readDenSettings().authToken?.trim()) {
        requestMemberActivityRefresh();
        return;
      }
      if (detail.providers.length === 0 && !detail.newModelCount) return;
      if (orgOnboardingVisible) {
        setPendingProviders((current) => [
          ...current,
          ...detail.providers.filter((p) => !current.some((existing) => existing.id === p.id)),
        ]);
        return;
      }
      showProviders(detail);
    };
    window.addEventListener(newProvidersEvent, handler);
    return () => window.removeEventListener(newProvidersEvent, handler);
  }, [orgOnboardingVisible, showProviders]);

  useEffect(() => {
    const handler = (event: Event) => {
      setOrgOnboardingVisible(Boolean((event as CustomEvent<{ visible?: boolean }>).detail?.visible));
    };
    window.addEventListener(orgOnboardingVisibilityEvent, handler);
    return () => window.removeEventListener(orgOnboardingVisibilityEvent, handler);
  }, []);

  useEffect(() => {
    if (orgOnboardingVisible || pendingProviders.length === 0) return;
    showProviders({ providers: pendingProviders, source: "cloud_sync" });
    setPendingProviders([]);
  }, [orgOnboardingVisible, pendingProviders, showProviders]);

  // Write the accumulated summary into the notification center. The dedupe
  // key keeps one unread entry that absorbs repeated provider syncs.
  useEffect(() => {
    if (!state.active || (state.providers.length === 0 && state.newModelCount === 0)) {
      return;
    }

    markProvidersSeen(state.providers.map((p) => p.id));

    const parts: string[] = [];
    if (state.newProviderCount > 0) {
      parts.push(`${state.newProviderCount} new ${state.newProviderCount === 1 ? "provider" : "providers"}`);
    }
    if (state.newModelCount > 0) {
      parts.push(`${state.newModelCount} new ${state.newModelCount === 1 ? "model" : "models"}`);
    }
    const summary =
      parts.join(" & ") ||
      resolveProviderDisplayName(
        state.providers[0]?.name || state.providers[0]?.providerId || "Models",
      );

    notifyEvent({
      kind: "providers",
      severity: "info",
      dedupeKey: NEW_PROVIDERS_DEDUPE_KEY,
      title: `${summary} available`,
      action: {
        type: "open-model-picker",
        providerIds: state.providers.map((p) => p.id),
      },
      actionLabel: t("notifications.select_model"),
    });
  }, [state]);

  // Once the entry is read (or cleared), restart accumulation so the next
  // sync produces a fresh unread entry.
  useEffect(
    () =>
      useNotificationStore.subscribe((store) => {
        const unread = store.notifications.some(
          (notification) =>
            notification.dedupeKey === NEW_PROVIDERS_DEDUPE_KEY && notification.readAt === null,
        );
        if (!unread) {
          setState((prev) => (prev.active ? EMPTY_STATE : prev));
        }
      }),
    [],
  );

  return null;
}
