import { create } from "zustand";
import type { Client } from "@/app/types";
import {
  desktopFetchViaMain,
  getCachedDesktopHomeDir,
  openDesktopUrl,
  readOpencodeConfig,
  writeOpencodeConfig,
  type OpencodeConfigFile,
} from "@/app/lib/desktop";
import { applyEdits, modify, parse } from "jsonc-parser";

const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";

export type QuotaWindow = {
  usedPercent: number;
  remainingPercent: number;
  remainingFraction: number;
  limitWindowSeconds: number;
  resetAfterSeconds: number;
  resetAt: number;
  resetTimeIso: string | null;
};

export type ChatGptModelItem = {
  modelID: string;
  displayName: string;
  contextLimit: number;
  outputLimit: number;
  supportsReasoning?: boolean;
  remainingFraction: number | null;
  resetTime: string | null;
};

export const DEFAULT_CHATGPT_MODELS: readonly ChatGptModelItem[] = [
  {
    modelID: "gpt-6-luna",
    displayName: "GPT-6 Luna",
    contextLimit: 400000,
    outputLimit: 128000,
    supportsReasoning: true,
    remainingFraction: null,
    resetTime: null,
  },
  {
    modelID: "gpt-5.6-terra",
    displayName: "GPT-5.6 Terra",
    contextLimit: 400000,
    outputLimit: 128000,
    supportsReasoning: true,
    remainingFraction: null,
    resetTime: null,
  },
  {
    modelID: "gpt-5.6-luna",
    displayName: "GPT-5.6 Luna",
    contextLimit: 400000,
    outputLimit: 128000,
    supportsReasoning: true,
    remainingFraction: null,
    resetTime: null,
  },
];

export const PLUS_CHATGPT_MODELS: readonly ChatGptModelItem[] = [
  {
    modelID: "gpt-6.1-sol",
    displayName: "GPT-6.1 Sol",
    contextLimit: 400000,
    outputLimit: 128000,
    supportsReasoning: true,
    remainingFraction: null,
    resetTime: null,
  },
  {
    modelID: "gpt-6-astra",
    displayName: "GPT-6 Astra",
    contextLimit: 400000,
    outputLimit: 128000,
    supportsReasoning: true,
    remainingFraction: null,
    resetTime: null,
  },
  {
    modelID: "gpt-6.1-terra",
    displayName: "GPT-6.1 Terra",
    contextLimit: 400000,
    outputLimit: 128000,
    supportsReasoning: true,
    remainingFraction: null,
    resetTime: null,
  },
  {
    modelID: "gpt-6-sol",
    displayName: "GPT-6 Sol",
    contextLimit: 400000,
    outputLimit: 128000,
    supportsReasoning: true,
    remainingFraction: null,
    resetTime: null,
  },
  {
    modelID: "gpt-6-luna",
    displayName: "GPT-6 Luna",
    contextLimit: 400000,
    outputLimit: 128000,
    supportsReasoning: true,
    remainingFraction: null,
    resetTime: null,
  },
  {
    modelID: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    contextLimit: 400000,
    outputLimit: 128000,
    supportsReasoning: true,
    remainingFraction: null,
    resetTime: null,
  },
  {
    modelID: "gpt-5.6-terra",
    displayName: "GPT-5.6 Terra",
    contextLimit: 400000,
    outputLimit: 128000,
    supportsReasoning: true,
    remainingFraction: null,
    resetTime: null,
  },
  {
    modelID: "gpt-5.6-luna",
    displayName: "GPT-5.6 Luna",
    contextLimit: 400000,
    outputLimit: 128000,
    supportsReasoning: true,
    remainingFraction: null,
    resetTime: null,
  },
];

export type ChatGptAccountInfo = {
  email: string;
  planType: "free" | "plus" | "pro" | "team" | "api";
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  accountId?: string;
  apiKey?: string;
  isActive: boolean;
  primaryWindow?: QuotaWindow; // 5-hour rolling limit (Plus/Pro) or 30-day limit (Free)
  secondaryWindow?: QuotaWindow; // Weekly / 7-day limit (Plus/Pro)
  credits?: {
    balance: string;
    approxLocalMessages?: [number, number];
  };
  models: ChatGptModelItem[];
  quotaLoading?: boolean;
  quotaError?: string | null;
  addedAt: number;
  lastLoadedAt: number;
};

type StoredCodexAccount = {
  email: string;
  planType?: "free" | "plus" | "pro" | "team" | "api";
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  accountId?: string;
  apiKey?: string;
  addedAt?: number;
  lastLoadedAt?: number;
};

type NanamiCodexMeta = {
  activeEmail?: string;
  deletedAtByEmail?: Record<string, number>;
  accounts?: StoredCodexAccount[];
  accessToken?: string;
  accountId?: string;
  email?: string;
  planType?: string;
  apiKey?: string;
};

type ChatGptAccountsStore = {
  accounts: ChatGptAccountInfo[];
  activeEmail: string | null;
  account: ChatGptAccountInfo | null;
  loading: boolean;
  isConnecting: boolean;
  authUrl: string | null;
  error: string | null;
  modalOpen: boolean;

  setModalOpen: (open: boolean) => void;
  loadAccounts: (client?: Client | null) => Promise<void>;
  selectAccount: (email: string, client?: Client | null) => Promise<void>;
  deleteAccount: (email: string, client?: Client | null) => Promise<void>;
  refreshQuotas: (email?: string) => Promise<void>;
  confirmAndRefresh: () => Promise<boolean>;
  connectApiKey: (apiKey: string) => Promise<boolean>;
  startBrowserLogin: () => Promise<void>;
  disconnect: () => Promise<void>;
};

let latestClient: Client | null = null;

async function getNanamiConfigDir(): Promise<string> {
  const home = (await getCachedDesktopHomeDir()) || "C:/Users/jmdem";
  return `${home.replace(/\\/g, "/")}/.config/nanamiwork`;
}

async function readNanamiCodexMeta(): Promise<{
  configDir: string;
  meta: NanamiCodexMeta;
}> {
  const configDir = await getNanamiConfigDir();
  let meta: NanamiCodexMeta = {};
  try {
    const res = (await readOpencodeConfig("project", configDir)) as OpencodeConfigFile;
    if (res?.content?.trim()) {
      const parsed = (parse(res.content) ?? {}) as {
        x_nanami_codex?: NanamiCodexMeta;
      };
      if (parsed.x_nanami_codex && typeof parsed.x_nanami_codex === "object") {
        meta = parsed.x_nanami_codex;
      }
    }
  } catch {}
  return { configDir, meta };
}

async function writeNanamiCodexMeta(
  updater: (prev: NanamiCodexMeta) => NanamiCodexMeta,
): Promise<void> {
  try {
    const configDir = await getNanamiConfigDir();
    const res = (await readOpencodeConfig("project", configDir)) as OpencodeConfigFile;
    const raw = res?.content?.trim()
      ? res.content
      : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
    const parsed = (parse(raw) ?? {}) as {
      x_nanami_codex?: NanamiCodexMeta;
    };
    const nextMeta = updater(parsed.x_nanami_codex ?? {});
    const edits = modify(raw, ["x_nanami_codex"], nextMeta, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    await writeOpencodeConfig("project", configDir, applyEdits(raw, edits));
  } catch (err) {
    console.warn("Could not write x_nanami_codex metadata:", err);
  }
}

function buildQuotaWindow(raw?: {
  used_percent: number;
  limit_window_seconds: number;
  reset_after_seconds: number;
  reset_at: number;
}): QuotaWindow | undefined {
  if (!raw) return undefined;
  const usedPercent = Math.min(100, Math.max(0, Math.round(raw.used_percent)));
  const remainingPercent = Math.min(100, Math.max(0, 100 - usedPercent));
  const remainingFraction = remainingPercent / 100;
  const resetTimeIso = raw.reset_at
    ? new Date(raw.reset_at * 1000).toISOString()
    : raw.reset_after_seconds > 0
      ? new Date(Date.now() + raw.reset_after_seconds * 1000).toISOString()
      : null;
  return {
    usedPercent,
    remainingPercent,
    remainingFraction,
    limitWindowSeconds: raw.limit_window_seconds,
    resetAfterSeconds: raw.reset_after_seconds,
    resetAt: raw.reset_at,
    resetTimeIso,
  };
}

function defaultModelsForPlan(
  planType: string,
  remainingFraction: number | null = null,
  resetTime: string | null = null,
): ChatGptModelItem[] {
  const base = planType === "plus" || planType === "pro" || planType === "team"
    ? PLUS_CHATGPT_MODELS
    : DEFAULT_CHATGPT_MODELS;
  return base.map((m) => ({
    ...m,
    remainingFraction,
    resetTime,
  }));
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string; state: string }> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const randBytes = new Uint8Array(43);
  crypto.getRandomValues(randBytes);
  const verifier = Array.from(randBytes, (b) => chars[b % chars.length]).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const stateBytes = new Uint8Array(32);
  crypto.getRandomValues(stateBytes);
  const state = btoa(String.fromCharCode(...stateBytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge, state };
}

export const useChatGptAccountsStore = create<ChatGptAccountsStore>((set, get) => ({
  accounts: [],
  activeEmail: null,
  account: null,
  loading: false,
  isConnecting: false,
  authUrl: null,
  error: null,
  modalOpen: false,

  setModalOpen: (open) =>
    set({
      modalOpen: open,
      error: null,
      ...(open ? {} : { isConnecting: false }),
    }),

  loadAccounts: async (client) => {
    if (client) latestClient = client;
    try {
      set({ loading: true, error: null });
      await syncCodexDiskAccountsViaTerminal();

      const { meta } = await readNanamiCodexMeta();
      let rawAccounts: StoredCodexAccount[] = Array.isArray(meta.accounts) ? [...meta.accounts] : [];
      let activeEmail: string | null = meta.activeEmail || null;
      const deletedMap = meta.deletedAtByEmail ?? {};

      // Also merge from global opencode.json if present
      try {
        const globalRes = (await readOpencodeConfig("global", "")) as OpencodeConfigFile;
        if (globalRes?.content?.trim()) {
          const parsed = (parse(globalRes.content) ?? {}) as Record<string, unknown>;
          const gMeta = parsed?.x_nanami_codex as NanamiCodexMeta | undefined;
          if (Array.isArray(gMeta?.accounts)) {
            for (const gAcc of gMeta.accounts) {
              if (!gAcc?.email) continue;
              if (!rawAccounts.some((a) => a.email.toLowerCase() === gAcc.email.toLowerCase())) {
                rawAccounts.push(gAcc);
              }
            }
            if (!activeEmail && gMeta.activeEmail) activeEmail = gMeta.activeEmail;
          }
        }
      } catch {}

      // Filter out deleted accounts unless re-added more recently
      rawAccounts = rawAccounts.filter((acc) => {
        if (!acc?.email || (!acc.accessToken && !acc.apiKey)) return false;
        const delAt = deletedMap[acc.email.toLowerCase()];
        const ts = Math.max(acc.addedAt ?? 0, acc.lastLoadedAt ?? 0);
        if (delAt && ts <= delAt) return false;
        return true;
      });

      if (rawAccounts.length === 0) {
        set({ accounts: [], activeEmail: null, account: null, loading: false });
        return;
      }

      const activeLower = (activeEmail || rawAccounts[0]?.email || "").toLowerCase();
      const prevAccounts = get().accounts;

      const accounts: ChatGptAccountInfo[] = rawAccounts.map((raw) => {
        const existing = prevAccounts.find(
          (p) => p.email.toLowerCase() === raw.email.toLowerCase(),
        );
        const planType = raw.planType || existing?.planType || (raw.apiKey ? "api" : "free");
        const isActive = raw.email.toLowerCase() === activeLower;
        return {
          email: raw.email,
          planType,
          accessToken: raw.accessToken,
          refreshToken: raw.refreshToken,
          idToken: raw.idToken,
          accountId: raw.accountId,
          apiKey: raw.apiKey,
          isActive,
          primaryWindow: existing?.primaryWindow,
          secondaryWindow: existing?.secondaryWindow,
          credits: existing?.credits,
          models:
            existing?.models && existing.models.length > 0
              ? existing.models
              : defaultModelsForPlan(planType),
          quotaLoading: true,
          quotaError: null,
          addedAt: raw.addedAt || Date.now(),
          lastLoadedAt: raw.lastLoadedAt || Date.now(),
        };
      });

      if (!accounts.some((a) => a.isActive) && accounts.length > 0) {
        accounts[0] = { ...accounts[0], isActive: true };
      }

      const activeAcc = accounts.find((a) => a.isActive) || accounts[0] || null;

      set({
        accounts,
        activeEmail: activeAcc?.email || null,
        account: activeAcc,
        loading: false,
      });

      // Ensure active account's OAuth credentials are registered in OpenCode engine
      if (activeAcc?.accessToken && latestClient) {
        try {
          await latestClient.auth.set({
            providerID: "openai",
            auth: {
              type: "oauth",
              refresh: activeAcc.refreshToken || "",
              access: activeAcc.accessToken,
              expires: Date.now() + 3600_000,
              ...(activeAcc.accountId ? { accountId: activeAcc.accountId } : {}),
            } as unknown as Parameters<Client["auth"]["set"]>[0]["auth"],
          });
        } catch {}
      }

      // Fetch live limits and models for each account independently (no pooling)
      void get().refreshQuotas();
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  selectAccount: async (email: string, client) => {
    if (client) latestClient = client;
    const activeClient = client ?? latestClient;
    const lower = email.toLowerCase();
    const current = get().accounts;
    const target = current.find((a) => a.email.toLowerCase() === lower);
    if (!target) return;
    const wasAlreadyActive = target.isActive;

    const updatedAccounts = current.map((a) => ({
      ...a,
      isActive: a.email.toLowerCase() === lower,
    }));

    set({
      accounts: updatedAccounts,
      activeEmail: target.email,
      account: { ...target, isActive: true },
    });

    await writeNanamiCodexMeta((prev) => ({
      ...prev,
      activeEmail: target.email,
    }));

    if (!wasAlreadyActive) {
      if (target.accessToken) {
        try {
          await activeClient?.auth.set({
            providerID: "openai",
            auth: {
              type: "oauth",
              refresh: target.refreshToken || "",
              access: target.accessToken,
              expires: Date.now() + 3600_000,
              ...(target.accountId ? { accountId: target.accountId } : {}),
            } as unknown as Parameters<Client["auth"]["set"]>[0]["auth"],
          });
        } catch {}
      }
      await syncCodexDiskAccountsViaTerminal({ type: "select", email: target.email });
      try {
        await activeClient?.instance.dispose();
      } catch {}
    }

    void get().refreshQuotas(target.email);
  },

  deleteAccount: async (email: string, client) => {
    if (client) latestClient = client;
    const lower = email.toLowerCase();
    const remaining = get().accounts.filter((a) => a.email.toLowerCase() !== lower);
    const nextActive = remaining.find((a) => a.isActive) ?? remaining[0] ?? null;

    const updatedAccounts = remaining.map((a) => ({
      ...a,
      isActive: nextActive ? a.email.toLowerCase() === nextActive.email.toLowerCase() : false,
    }));

    set({
      accounts: updatedAccounts,
      activeEmail: nextActive?.email || null,
      account: nextActive,
    });

    await writeNanamiCodexMeta((prev) => ({
      ...prev,
      activeEmail: nextActive?.email ?? "",
      deletedAtByEmail: {
        ...(prev.deletedAtByEmail ?? {}),
        [lower]: Date.now(),
      },
      accounts: (prev.accounts ?? []).filter((a) => a?.email?.toLowerCase() !== lower),
    }));

    await syncCodexDiskAccountsViaTerminal({ type: "delete", email });
  },

  refreshQuotas: async (targetEmail?: string) => {
    const { accounts } = get();
    if (accounts.length === 0) return;

    const targets = targetEmail
      ? accounts.filter((a) => a.email.toLowerCase() === targetEmail.toLowerCase())
      : accounts;

    await Promise.all(
      targets.map(async (acc) => {
        if (!acc.accessToken) {
          set((state) => ({
            accounts: state.accounts.map((item) =>
              item.email.toLowerCase() === acc.email.toLowerCase()
                ? { ...item, quotaLoading: false }
                : item,
            ),
          }));
          return;
        }

        set((state) => ({
          accounts: state.accounts.map((a) =>
            a.email.toLowerCase() === acc.email.toLowerCase()
              ? { ...a, quotaLoading: true, quotaError: null }
              : a,
          ),
        }));

        try {
          let accessToken = acc.accessToken;
          let accountId = acc.accountId;

          const fetchUsage = (token: string) =>
            desktopFetchViaMain(
              "https://chatgpt.com/backend-api/wham/usage",
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  ...(accountId ? { "Chatgpt-Account-Id": accountId } : {}),
                },
              },
              10000,
            );

          let res = await fetchUsage(accessToken);

          // Auto-refresh expired OAuth access token if refreshToken is present
          if (res.status === 401 && acc.refreshToken) {
            const refreshRes = await desktopFetchViaMain(
              "https://auth.openai.com/oauth/token",
              {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  grant_type: "refresh_token",
                  refresh_token: acc.refreshToken,
                  client_id: OPENAI_CODEX_CLIENT_ID,
                }).toString(),
              },
              10000,
            );
            if (refreshRes.ok) {
              const refreshed = (await refreshRes.json()) as {
                access_token?: string;
                refresh_token?: string;
              };
              if (refreshed.access_token) {
                accessToken = refreshed.access_token;
                res = await fetchUsage(accessToken);
              }
            }
          }

          // Also fetch account's entitled Codex models in parallel
          let fetchedModels: ChatGptModelItem[] | null = null;
          try {
            const modelsRes = await desktopFetchViaMain(
              "https://chatgpt.com/backend-api/codex/models?client_version=26.1029.61003",
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "User-Agent": "codex_cli_rs/0.1.0",
                  ...(accountId ? { "Chatgpt-Account-Id": accountId } : {}),
                },
              },
              10000,
            );
            if (modelsRes.ok) {
              const modelsData = (await modelsRes.json()) as {
                models?: Array<{
                  slug?: string;
                  display_name?: string;
                  visibility?: string;
                  context_window?: number;
                }>;
              };
              const visible = (modelsData.models ?? []).filter(
                (m) => m.slug && m.visibility === "list",
              );
              if (visible.length > 0) {
                fetchedModels = visible.map((m) => ({
                  modelID: m.slug!,
                  displayName: m.display_name || m.slug!,
                  contextLimit: m.context_window || 400000,
                  outputLimit: 128000,
                  supportsReasoning: true,
                  remainingFraction: null,
                  resetTime: null,
                }));
              }
            }
          } catch {}

          if (res.ok) {
            const data = (await res.json()) as {
              plan_type?: string;
              email?: string;
              account_id?: string;
              rate_limit?: {
                primary_window?: {
                  used_percent: number;
                  limit_window_seconds: number;
                  reset_after_seconds: number;
                  reset_at: number;
                };
                secondary_window?: {
                  used_percent: number;
                  limit_window_seconds: number;
                  reset_after_seconds: number;
                  reset_at: number;
                };
              };
              credits?: {
                balance: string;
                approx_local_messages?: [number, number];
              };
            };

            const planType =
              (data.plan_type as "free" | "plus" | "pro" | "team") || acc.planType;
            const primaryWindow = buildQuotaWindow(data.rate_limit?.primary_window);
            const secondaryWindow = buildQuotaWindow(data.rate_limit?.secondary_window);
            const baseModels =
              fetchedModels ?? defaultModelsForPlan(planType);
            const stampedModels = baseModels.map((m) => ({
              ...m,
              remainingFraction: primaryWindow ? primaryWindow.remainingFraction : null,
              resetTime: primaryWindow ? primaryWindow.resetTimeIso : null,
            }));

            set((state) => {
              const nextAccounts = state.accounts.map((item) => {
                if (item.email.toLowerCase() !== acc.email.toLowerCase()) return item;
                return {
                  ...item,
                  email: data.email || item.email,
                  accountId: data.account_id || accountId,
                  accessToken,
                  planType,
                  primaryWindow,
                  secondaryWindow,
                  credits: data.credits
                    ? {
                        balance: data.credits.balance,
                        approxLocalMessages: data.credits.approx_local_messages,
                      }
                    : undefined,
                  models: stampedModels,
                  quotaLoading: false,
                  quotaError: null,
                  lastLoadedAt: Date.now(),
                };
              });
              const activeAcc =
                nextAccounts.find((a) => a.isActive) || nextAccounts[0] || null;
              return { accounts: nextAccounts, account: activeAcc };
            });
          } else {
            set((state) => ({
              accounts: state.accounts.map((item) =>
                item.email.toLowerCase() === acc.email.toLowerCase()
                  ? {
                      ...item,
                      quotaLoading: false,
                      quotaError: `Quota HTTP ${res.status}`,
                    }
                  : item,
              ),
            }));
          }
        } catch (err) {
          set((state) => ({
            accounts: state.accounts.map((item) =>
              item.email.toLowerCase() === acc.email.toLowerCase()
                ? {
                    ...item,
                    quotaLoading: false,
                    quotaError: err instanceof Error ? err.message : String(err),
                  }
                : item,
            ),
          }));
        }
      }),
    );
  },

  startBrowserLogin: async () => {
    try {
      set({ isConnecting: true, error: null });
      const { verifier, challenge, state } = await generatePKCE();
      const params = new URLSearchParams({
        response_type: "code",
        client_id: OPENAI_CODEX_CLIENT_ID,
        redirect_uri: OPENAI_CODEX_REDIRECT_URI,
        scope: "openid profile email offline_access",
        code_challenge: challenge,
        code_challenge_method: "S256",
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        state,
        originator: "opencode",
      });
      const authUrl = `https://auth.openai.com/oauth/authorize?${params.toString()}`;
      set({ authUrl });

      // Start a local 1455 OAuth callback listener via Node in background terminal
      // so the browser callback is captured and exchanged even if opencode's internal server isn't listening
      void startLocalCodexCallbackServerViaTerminal(verifier, state).then((ok) => {
        if (ok) {
          void get().confirmAndRefresh();
        }
      });

      // Immediately open the default browser!
      await openDesktopUrl(authUrl);
    } catch (e) {
      set({
        isConnecting: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  confirmAndRefresh: async () => {
    try {
      set({ loading: true, error: null });
      await syncCodexDiskAccountsViaTerminal({ type: "confirm" });
      await get().loadAccounts();
      set({ loading: false, isConnecting: false, modalOpen: false });
      return true;
    } catch (e) {
      set({
        loading: false,
        isConnecting: false,
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  },

  connectApiKey: async (rawKey: string) => {
    const apiKey = rawKey.trim();
    if (!apiKey) {
      set({ error: "Please enter an OpenAI API key." });
      return false;
    }

    try {
      set({ isConnecting: true, error: null });

      const res = await desktopFetchViaMain(
        "https://api.openai.com/v1/models",
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
        10000,
      );

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Invalid OpenAI API key. Please check your credentials.");
        }
        if (res.status === 429) {
          throw new Error("OpenAI API rate limit or quota exceeded for this key.");
        }
        throw new Error(`OpenAI verification failed (${res.status} ${res.statusText}).`);
      }

      await saveOpenAiConfig(apiKey);
      await get().loadAccounts();
      set({ isConnecting: false, modalOpen: false });
      return true;
    } catch (e) {
      set({ isConnecting: false, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  disconnect: async () => {
    try {
      set({ loading: true, error: null });
      const configRes = (await readOpencodeConfig("global", "")) as OpencodeConfigFile;
      if (configRes?.content) {
        let raw = configRes.content;
        let edits = modify(raw, ["x_nanami_codex"], undefined, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        });
        raw = applyEdits(raw, edits);
        await writeOpencodeConfig("global", "", raw);
      }
      set({ accounts: [], activeEmail: null, account: null, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));

async function startLocalCodexCallbackServerViaTerminal(
  verifier: string,
  expectedState: string,
): Promise<boolean> {
  const terminal =
    typeof window !== "undefined" ? window.__OPENWORK_ELECTRON__?.terminal : undefined;
  if (!terminal?.create || !terminal?.write) return false;

  try {
    const home = (await getCachedDesktopHomeDir()) || "";
    if (!home) return false;

    const script = `
const http = require('http');
const fs = require('fs');
const path = require('path');
const home = ${JSON.stringify(home)};
const verifier = ${JSON.stringify(verifier)};
const expectedState = ${JSON.stringify(expectedState)};
const clientId = ${JSON.stringify(OPENAI_CODEX_CLIENT_ID)};
const redirectUri = ${JSON.stringify(OPENAI_CODEX_REDIRECT_URI)};

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || '/', 'http://localhost:1455');
    if (u.pathname !== '/auth/callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const code = u.searchParams.get('code');
    const st = u.searchParams.get('state');
    if (!code || (expectedState && st !== expectedState)) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h3>Authorization failed or state mismatch.</h3>');
      setTimeout(() => process.exit(1), 300);
      return;
    }
    const tokenRes = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      }).toString(),
    });
    if (!tokenRes.ok) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h3>Token exchange failed (' + tokenRes.status + ').</h3>');
      setTimeout(() => process.exit(1), 300);
      return;
    }
    const tokens = await tokenRes.json();
    let accountId = '';
    try {
      const jwt = tokens.id_token || tokens.access_token || '';
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
      accountId = payload.chatgpt_account_id || (payload['https://api.openai.com/auth'] && payload['https://api.openai.com/auth'].chatgpt_account_id) || '';
    } catch {}

    // 1. Save to ~/.codex/auth.json
    const codexDir = path.join(home, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'auth.json'), JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: tokens.id_token || '',
        access_token: tokens.access_token || '',
        refresh_token: tokens.refresh_token || '',
        account_id: accountId,
      },
      last_refresh: new Date().toISOString(),
    }, null, 2), 'utf8');

    // 2. Save to ~/.local/share/opencode/auth.json
    const ocShareDir = path.join(home, '.local', 'share', 'opencode');
    fs.mkdirSync(ocShareDir, { recursive: true });
    const ocAuthFile = path.join(ocShareDir, 'auth.json');
    let ocAuth = {};
    if (fs.existsSync(ocAuthFile)) {
      try { ocAuth = JSON.parse(fs.readFileSync(ocAuthFile, 'utf8')); } catch {}
    }
    ocAuth.openai = {
      type: 'oauth',
      refresh: tokens.refresh_token || '',
      access: tokens.access_token || '',
      expires: Date.now() + (tokens.expires_in || 3600) * 1000,
      ...(accountId ? { accountId } : {}),
    };
    fs.writeFileSync(ocAuthFile, JSON.stringify(ocAuth, null, 2), 'utf8');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body style="font-family:system-ui;background:#0d1117;color:#e6edf3;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>ChatGPT Connected to NanamiWork!</h2><p>You can close this tab and return to NanamiWork.</p></div></body></html>');
    console.log('__NANAMI_CODEX_OAUTH_SUCCESS__');
    setTimeout(() => { server.close(); process.exit(0); }, 300);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
    setTimeout(() => process.exit(1), 300);
  }
});

server.on('error', () => {
  // Port 1455 may already be bound by opencode; exit quietly
  process.exit(0);
});

server.listen(1455, '127.0.0.1');
setTimeout(() => process.exit(0), 180000);
`.trim();

    const b64 = btoa(script);
    const { terminalId } = await terminal.create({ cwd: home, cols: 80, rows: 10 });
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubData?.();
        unsubExit?.();
        void terminal.kill?.(terminalId).catch(() => undefined);
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), 180000);
      const unsubData = terminal.onData?.((payload) => {
        if (
          payload.terminalId === terminalId &&
          payload.data.includes("__NANAMI_CODEX_OAUTH_SUCCESS__")
        ) {
          done(true);
        }
      });
      const unsubExit = terminal.onExit?.((payload) => {
        if (payload.terminalId === terminalId) {
          done(false);
        }
      });
      void terminal.write?.(
        terminalId,
        `node -e "eval(Buffer.from('${b64}','base64').toString('utf8'))"\r\n`,
      );
    });
  } catch {
    return false;
  }
}

export async function syncCodexDiskAccountsViaTerminal(action?: {
  type: "select" | "delete" | "confirm";
  email?: string;
}): Promise<void> {
  const terminal =
    typeof window !== "undefined" ? window.__OPENWORK_ELECTRON__?.terminal : undefined;
  if (!terminal?.create || !terminal?.write) return;

  try {
    const home = (await getCachedDesktopHomeDir()) || "";
    if (!home) return;

    const script = `
const fs=require('fs'),path=require('path');
const parseJ=(r)=>JSON.parse(String(r||'').replace(/^\\uFEFF/,'').replace(/\\\\"|"(?:\\\\"|[^"])*"|(\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\/)/g,(m,g)=>(g?'':m)).replace(/,(\\s*[}\\]])/g,'$1'));
const home=${JSON.stringify(home)},action=${JSON.stringify(action ?? null)};
const cfgDir=path.join(home,'.config','nanamiwork');
fs.mkdirSync(cfgDir,{recursive:true});
const codexAccFile=path.join(cfgDir,'codex-accounts.json'),jsoncFile=path.join(cfgDir,'opencode.jsonc'),jsonFile=path.join(cfgDir,'opencode.json');
const codexAuthFile=path.join(home,'.codex','auth.json'),ocShareAuthFile=path.join(home,'.local','share','opencode','auth.json');
const decode=(t)=>{try{const p=JSON.parse(Buffer.from(String(t||'').split('.')[1],'base64').toString('utf8')),pr=p['https://api.openai.com/profile']||{},au=p['https://api.openai.com/auth']||{};return{email:p.email||pr.email||'',planType:au.chatgpt_plan_type||p.chatgpt_plan_type||'free',accountId:au.chatgpt_account_id||p.chatgpt_account_id||''};}catch{return{};}};
let meta={activeEmail:'',deletedAtByEmail:{},accounts:[]};
for(const f of[codexAccFile,jsoncFile,jsonFile]){if(fs.existsSync(f)){try{const d=parseJ(fs.readFileSync(f,'utf8')),cx=d.x_nanami_codex||d;if(cx.deletedAtByEmail)meta.deletedAtByEmail={...meta.deletedAtByEmail,...cx.deletedAtByEmail};if(Array.isArray(cx.accounts)){for(const a of cx.accounts){if(a&&a.email&&(a.accessToken||a.apiKey)&&!meta.accounts.some(e=>e.email.toLowerCase()===a.email.toLowerCase()))meta.accounts.push(a);}}if(!meta.activeEmail&&cx.activeEmail)meta.activeEmail=cx.activeEmail;}catch{}}}
const upsert=(acc,act)=>{if(!acc||!acc.email||!acc.accessToken)return;const k=acc.email.toLowerCase();if(action&&action.type==='confirm')delete meta.deletedAtByEmail[k];else if(meta.deletedAtByEmail[k])return;const i=meta.accounts.findIndex(a=>a.email.toLowerCase()===k);if(i>=0)meta.accounts[i]={...meta.accounts[i],...acc};else meta.accounts.push(acc);if(act||!meta.activeEmail)meta.activeEmail=acc.email;};
if(fs.existsSync(ocShareAuthFile)){try{const oc=parseJ(fs.readFileSync(ocShareAuthFile,'utf8')).openai;if(oc&&oc.access){const c=decode(oc.access);if(c.email)upsert({email:c.email,planType:c.planType,accessToken:oc.access,refreshToken:oc.refresh||'',accountId:oc.accountId||c.accountId,addedAt:Date.now(),lastLoadedAt:Date.now()},action&&action.type==='confirm');}}catch{}}
if(fs.existsSync(codexAuthFile)){try{const tk=parseJ(fs.readFileSync(codexAuthFile,'utf8')).tokens;if(tk&&tk.access_token){const ic=decode(tk.id_token),ac=decode(tk.access_token),em=ic.email||ac.email;if(em)upsert({email:em,planType:ic.planType||ac.planType,accessToken:tk.access_token,refreshToken:tk.refresh_token||'',idToken:tk.id_token||'',accountId:tk.account_id||ic.accountId||ac.accountId,addedAt:Date.now(),lastLoadedAt:Date.now()},action&&action.type==='confirm');}}catch{}}
if(action&&action.type==='delete'&&action.email){const dk=action.email.toLowerCase();meta.deletedAtByEmail[dk]=Date.now();meta.accounts=meta.accounts.filter(a=>a.email.toLowerCase()!==dk);if((meta.activeEmail||'').toLowerCase()===dk)meta.activeEmail=meta.accounts[0]?.email||'';}else if(action&&action.type==='select'&&action.email){meta.activeEmail=action.email;}
const act=meta.accounts.find(a=>a.email.toLowerCase()===(meta.activeEmail||'').toLowerCase())||meta.accounts[0];
if(act){meta.activeEmail=act.email;if(act.accessToken){try{fs.mkdirSync(path.dirname(ocShareAuthFile),{recursive:true});const oc=fs.existsSync(ocShareAuthFile)?parseJ(fs.readFileSync(ocShareAuthFile,'utf8')):{};oc.openai={type:'oauth',refresh:act.refreshToken||'',access:act.accessToken,expires:Date.now()+3600000,...(act.accountId?{accountId:act.accountId}:{})};fs.writeFileSync(ocShareAuthFile,JSON.stringify(oc,null,2),'utf8');}catch{}if(action&&action.type==='select'){try{fs.mkdirSync(path.dirname(codexAuthFile),{recursive:true});fs.writeFileSync(codexAuthFile,JSON.stringify({auth_mode:'chatgpt',OPENAI_API_KEY:null,tokens:{id_token:act.idToken||act.accessToken,access_token:act.accessToken,refresh_token:act.refreshToken||'',account_id:act.accountId||''},last_refresh:new Date().toISOString()},null,2),'utf8');}catch{}}}}
fs.writeFileSync(codexAccFile,JSON.stringify(meta,null,2)+'\\n','utf8');
const mDef=(n)=>({name:n,limit:{context:400000,output:128000},modalities:{input:['text','image'],output:['text']}});
const codexModels={'gpt-6.1-sol':mDef('GPT-6.1 Sol'),'gpt-6-astra':mDef('GPT-6 Astra'),'gpt-6.1-terra':mDef('GPT-6.1 Terra'),'gpt-6-sol':mDef('GPT-6 Sol'),'gpt-6-luna':mDef('GPT-6 Luna'),'gpt-5.6-sol':mDef('GPT-5.6 Sol'),'gpt-5.6-terra':mDef('GPT-5.6 Terra'),'gpt-5.6-luna':mDef('GPT-5.6 Luna')};
for(const f of[jsoncFile,jsonFile]){if(fs.existsSync(f)){try{const cfg=parseJ(fs.readFileSync(f,'utf8'));cfg.x_nanami_codex=meta;if(!cfg.provider)cfg.provider={};if(!cfg.provider.openai||!cfg.provider.openai.options||!cfg.provider.openai.options.apiKey)cfg.provider.openai={name:'OpenAI / ChatGPT',models:codexModels};fs.writeFileSync(f,JSON.stringify(cfg,null,2)+'\\n','utf8');}catch{}}}
`.trim();

    const b64 = btoa(script);
    const { terminalId } = await terminal.create({ cwd: home, cols: 80, rows: 10 });
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub?.();
        void terminal.kill?.(terminalId).catch(() => undefined);
        resolve();
      };
      const timer = setTimeout(done, 1500);
      const unsub = terminal.onExit?.((payload) => {
        if (payload.terminalId === terminalId) {
          done();
        }
      });
      void terminal.write?.(
        terminalId,
        `node -e "eval(Buffer.from('${b64}','base64').toString('utf8'));process.exit(0)"\r\nexit\r\n`,
      );
    });
  } catch (err) {
    console.warn("Could not sync Codex accounts via terminal:", err);
  }
}

async function saveOpenAiConfig(apiKey: string) {
  const configDir = await getNanamiConfigDir();
  const configRes = (await readOpencodeConfig("project", configDir)) as OpencodeConfigFile;
  let raw = configRes?.content?.trim()
    ? configRes.content
    : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';

  const parsed = parse(raw) as Record<string, unknown>;
  const enabled = Array.isArray(parsed?.enabled_providers)
    ? (parsed.enabled_providers as string[])
    : [];
  if (!enabled.includes("openai")) {
    const edits = modify(raw, ["enabled_providers"], [...enabled, "openai"], {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    raw = applyEdits(raw, edits);
  }

  const openaiProviderConfig = {
    npm: "@ai-sdk/openai-compatible",
    name: "OpenAI / ChatGPT",
    options: {
      baseURL: "https://api.openai.com/v1",
      apiKey: apiKey.trim(),
    },
    models: {
      "gpt-4o": {
        name: "GPT-4o",
        limit: { context: 128000, output: 4096 },
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      },
      "gpt-4o-mini": {
        name: "GPT-4o mini",
        limit: { context: 128000, output: 4096 },
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      },
      o1: {
        name: "o1",
        limit: { context: 200000, output: 100000 },
        capabilities: {
          tools: true,
          reasoning: true,
          input: ["text", "image"],
          output: ["text"],
        },
      },
      "o3-mini": {
        name: "o3-mini",
        limit: { context: 200000, output: 100000 },
        capabilities: { tools: true, reasoning: true, input: ["text"], output: ["text"] },
      },
    },
  };

  const edits = modify(raw, ["provider", "openai"], openaiProviderConfig, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  raw = applyEdits(raw, edits);

  await writeOpencodeConfig("project", configDir, raw);
}
