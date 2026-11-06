import { create } from "zustand";
import {
  desktopFetchViaMain,
  readOpencodeConfig,
  writeOpencodeConfig,
  type OpencodeConfigFile,
} from "@/app/lib/desktop";
import { applyEdits, modify, parse } from "jsonc-parser";

export type QuotaWindow = {
  usedPercent: number;
  limitWindowSeconds: number;
  resetAfterSeconds: number;
  resetAt: number;
};

export type ChatGptAccountInfo = {
  email?: string;
  planType: "free" | "plus" | "pro" | "team" | "api";
  accessToken?: string;
  accountId?: string;
  apiKey?: string;
  primaryWindow?: QuotaWindow; // 5-hour rolling limit
  secondaryWindow?: QuotaWindow; // Weekly limit
  credits?: {
    balance: string;
    approxLocalMessages?: [number, number];
  };
  addedAt: number;
  lastLoadedAt: number;
};

type ChatGptAccountsStore = {
  account: ChatGptAccountInfo | null;
  loading: boolean;
  isConnecting: boolean;
  error: string | null;
  modalOpen: boolean;
  activePlatformTab: "antigravity" | "chatgpt" | "copilot";

  setActivePlatformTab: (tab: "antigravity" | "chatgpt" | "copilot") => void;
  setModalOpen: (open: boolean, initialTab?: "antigravity" | "chatgpt" | "copilot") => void;
  loadAccount: () => Promise<void>;
  refreshQuotas: () => Promise<void>;
  connectApiKey: (apiKey: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
};

export const useChatGptAccountsStore = create<ChatGptAccountsStore>((set, get) => ({
  account: null,
  loading: false,
  isConnecting: false,
  error: null,
  modalOpen: false,
  activePlatformTab: "antigravity",

  setActivePlatformTab: (tab) => set({ activePlatformTab: tab }),
  setModalOpen: (open, initialTab) =>
    set({
      modalOpen: open,
      error: null,
      ...(initialTab ? { activePlatformTab: initialTab } : {}),
    }),

  loadAccount: async () => {
    try {
      set({ loading: true, error: null });
      const configRes = (await readOpencodeConfig("global", "")) as OpencodeConfigFile;
      if (!configRes?.content) {
        set({ account: null, loading: false });
        return;
      }

      const parsed = parse(configRes.content) as Record<string, unknown>;
      const codexMeta = parsed?.x_nanami_codex as
        | {
            accessToken?: string;
            accountId?: string;
            email?: string;
            planType?: string;
            apiKey?: string;
          }
        | undefined;

      const openaiProvider = (parsed?.provider as Record<string, unknown> | undefined)?.openai as
        | { options?: { apiKey?: string } }
        | undefined;

      const apiKey = openaiProvider?.options?.apiKey || codexMeta?.apiKey;
      const accessToken = codexMeta?.accessToken;

      if (!accessToken && !apiKey) {
        set({ account: null, loading: false });
        return;
      }

      const account: ChatGptAccountInfo = {
        email: codexMeta?.email || (apiKey ? "API Key Account" : "ChatGPT User"),
        planType: (codexMeta?.planType as "free" | "plus" | "pro") || (apiKey ? "api" : "free"),
        accessToken,
        accountId: codexMeta?.accountId,
        apiKey,
        addedAt: Date.now(),
        lastLoadedAt: Date.now(),
      };

      set({ account, loading: false });

      // If we have an access token, fetch live limits from OpenAI backend
      if (accessToken) {
        void get().refreshQuotas();
      }
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  refreshQuotas: async () => {
    const { account } = get();
    if (!account?.accessToken) return;

    try {
      const res = await desktopFetchViaMain(
        "https://chatgpt.com/backend-api/wham/usage",
        {
          headers: {
            Authorization: `Bearer ${account.accessToken}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            ...(account.accountId ? { "Chatgpt-Account-Id": account.accountId } : {}),
          },
        },
        10000,
      );

      if (res.ok) {
        const data = (await res.json()) as {
          plan_type?: string;
          email?: string;
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

        const updated: ChatGptAccountInfo = {
          ...account,
          email: data.email || account.email,
          planType: (data.plan_type as "free" | "plus" | "pro") || account.planType,
          primaryWindow: data.rate_limit?.primary_window
            ? {
                usedPercent: data.rate_limit.primary_window.used_percent,
                limitWindowSeconds: data.rate_limit.primary_window.limit_window_seconds,
                resetAfterSeconds: data.rate_limit.primary_window.reset_after_seconds,
                resetAt: data.rate_limit.primary_window.reset_at,
              }
            : undefined,
          secondaryWindow: data.rate_limit?.secondary_window
            ? {
                usedPercent: data.rate_limit.secondary_window.used_percent,
                limitWindowSeconds: data.rate_limit.secondary_window.limit_window_seconds,
                resetAfterSeconds: data.rate_limit.secondary_window.reset_after_seconds,
                resetAt: data.rate_limit.secondary_window.reset_at,
              }
            : undefined,
          credits: data.credits
            ? {
                balance: data.credits.balance,
                approxLocalMessages: data.credits.approx_local_messages,
              }
            : undefined,
          lastLoadedAt: Date.now(),
        };

        set({ account: updated });
      }
    } catch (e) {
      console.warn("Could not refresh ChatGPT/Codex quotas:", e);
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

      // Validate key against OpenAI models endpoint
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

      set({
        account: {
          apiKey,
          planType: "api",
          email: "API Key Account",
          addedAt: Date.now(),
          lastLoadedAt: Date.now(),
        },
        isConnecting: false,
        modalOpen: false,
      });
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

        edits = modify(raw, ["provider", "openai"], undefined, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        });
        raw = applyEdits(raw, edits);

        await writeOpencodeConfig("global", "", raw);
      }
      set({ account: null, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));

async function saveOpenAiConfig(apiKey: string) {
  const configRes = (await readOpencodeConfig("global", "")) as OpencodeConfigFile;
  let raw = configRes?.content?.trim()
    ? configRes.content
    : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';

  // 1. Enable openai in enabled_providers
  const parsed = parse(raw) as Record<string, unknown>;
  const enabled = Array.isArray(parsed?.enabled_providers) ? (parsed.enabled_providers as string[]) : [];
  if (!enabled.includes("openai")) {
    const edits = modify(raw, ["enabled_providers"], [...enabled, "openai"], {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    raw = applyEdits(raw, edits);
  }

  // 2. Configure openai provider
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
        capabilities: {
          tools: true,
          input: ["text", "image"],
          output: ["text"],
        },
      },
      "gpt-4o-mini": {
        name: "GPT-4o mini",
        limit: { context: 128000, output: 4096 },
        capabilities: {
          tools: true,
          input: ["text", "image"],
          output: ["text"],
        },
      },
      "o1": {
        name: "o1",
        limit: { context: 200000, output: 100000 },
        capabilities: {
          tools: true,
          reasoning: true,
          input: ["text", "image"],
          output: ["text"],
        },
      },
      "o1-mini": {
        name: "o1-mini",
        limit: { context: 128000, output: 65536 },
        capabilities: {
          tools: true,
          reasoning: true,
          input: ["text"],
          output: ["text"],
        },
      },
      "o3-mini": {
        name: "o3-mini",
        limit: { context: 200000, output: 100000 },
        capabilities: {
          tools: true,
          reasoning: true,
          input: ["text"],
          output: ["text"],
        },
      },
    },
  };

  const edits = modify(raw, ["provider", "openai"], openaiProviderConfig, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  raw = applyEdits(raw, edits);

  await writeOpencodeConfig("global", "", raw);
}
