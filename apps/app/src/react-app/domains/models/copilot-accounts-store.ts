import { create } from "zustand";
import {
  desktopFetchViaMain,
  getCachedDesktopHomeDir,
  readOpencodeConfig,
  writeOpencodeConfig,
  type OpencodeConfigFile,
} from "@/app/lib/desktop";
import { applyEdits, modify, parse } from "jsonc-parser";
import type { Client } from "@/app/types";

async function getNanamiConfigDir(): Promise<string> {
  const home = (await getCachedDesktopHomeDir()) || "C:/Users/jmdem";
  return `${home.replace(/\\/g, "/")}/.config/nanamiwork`;
}

const GITHUB_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe81";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const GITHUB_USER_URL = "https://api.github.com/user";

export type CopilotModelItem = {
  modelID: string;
  displayName: string;
  contextLimit: number;
  outputLimit: number;
  supportsReasoning?: boolean;
};

export const DEFAULT_COPILOT_MODELS: CopilotModelItem[] = [
  {
    modelID: "auto",
    displayName: "Auto (Copilot Fusion)",
    contextLimit: 128000,
    outputLimit: 8192,
  },
  {
    modelID: "gpt-4o",
    displayName: "GPT-4o (Copilot)",
    contextLimit: 128000,
    outputLimit: 4096,
  },
  {
    modelID: "gpt-4o-mini",
    displayName: "GPT-4o mini (Copilot)",
    contextLimit: 128000,
    outputLimit: 4096,
  },
  {
    modelID: "claude-3.5-sonnet",
    displayName: "Claude 3.5 Sonnet (Copilot)",
    contextLimit: 200000,
    outputLimit: 8192,
  },
  {
    modelID: "o1-mini",
    displayName: "o1-mini (Copilot)",
    contextLimit: 128000,
    outputLimit: 65536,
    supportsReasoning: true,
  },
  {
    modelID: "o1-preview",
    displayName: "o1-preview (Copilot)",
    contextLimit: 128000,
    outputLimit: 32768,
    supportsReasoning: true,
  },
];

export type CopilotAccountInfo = {
  username: string;
  name?: string;
  avatarUrl?: string;
  planSku: string;
  expiresAt: number;
  addedAt: number;
  lastUsed: number;
  oauthToken: string;
  copilotToken: string;
  isActive: boolean;
  models: CopilotModelItem[];
  loading?: boolean;
};

export type CopilotDeviceFlowState = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

type StoredCopilotMeta = {
  activeUsername?: string;
  deletedAtByUsername?: Record<string, number>;
  accounts?: Array<{
    username: string;
    name?: string;
    avatarUrl?: string;
    planSku?: string;
    expiresAt?: number;
    addedAt?: number;
    lastUsed?: number;
    oauthToken: string;
    copilotToken: string;
  }>;
};

type CopilotAccountsStore = {
  accounts: CopilotAccountInfo[];
  activeUsername: string | null;
  account: CopilotAccountInfo | null;
  loading: boolean;
  error: string | null;
  deviceFlow: CopilotDeviceFlowState | null;
  isConnecting: boolean;
  modalOpen: boolean;

  setModalOpen: (open: boolean) => void;
  loadAccounts: (client?: Client | null) => Promise<void>;
  selectAccount: (username: string, client?: Client | null) => Promise<void>;
  deleteAccount: (username: string, client?: Client | null) => Promise<void>;
  startDeviceFlow: () => Promise<CopilotDeviceFlowState | null>;
  cancelDeviceFlow: () => void;
  pollDeviceFlow: () => Promise<boolean>;
  refreshCopilotToken: (username?: string) => Promise<string | null>;
  disconnect: () => Promise<void>;
};

let activePollAbortController: AbortController | null = null;
let latestClient: Client | null = null;

async function readNanamiCopilotMeta(): Promise<{
  configDir: string;
  meta: StoredCopilotMeta;
}> {
  const configDir = await getNanamiConfigDir();
  let meta: StoredCopilotMeta = {};
  try {
    const res = (await readOpencodeConfig("project", configDir)) as OpencodeConfigFile;
    if (res?.content?.trim()) {
      const parsed = (parse(res.content) ?? {}) as {
        x_nanami_copilot?: StoredCopilotMeta | CopilotAccountInfo;
      };
      const raw = parsed.x_nanami_copilot;
      if (raw && typeof raw === "object") {
        if ("oauthToken" in raw && "username" in raw) {
          // Migrating legacy single-account format
          const single = raw as CopilotAccountInfo;
          meta = {
            activeUsername: single.username,
            accounts: [
              {
                username: single.username,
                name: single.name,
                avatarUrl: single.avatarUrl,
                planSku: single.planSku,
                expiresAt: single.expiresAt,
                addedAt: single.addedAt || Date.now(),
                lastUsed: single.lastUsed || Date.now(),
                oauthToken: single.oauthToken,
                copilotToken: single.copilotToken,
              },
            ],
          };
        } else {
          meta = raw as StoredCopilotMeta;
        }
      }
    }
  } catch {}
  return { configDir, meta };
}

async function writeNanamiCopilotMeta(
  updater: (prev: StoredCopilotMeta) => StoredCopilotMeta,
  activeAccount?: CopilotAccountInfo | null,
): Promise<void> {
  try {
    const configDir = await getNanamiConfigDir();
    const res = (await readOpencodeConfig("project", configDir)) as OpencodeConfigFile;
    let raw = res?.content?.trim()
      ? res.content
      : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';

    const parsed = (parse(raw) ?? {}) as Record<string, unknown>;
    const enabled = Array.isArray(parsed?.enabled_providers)
      ? (parsed.enabled_providers as string[])
      : ["nanami", "google"];
    if (!enabled.includes("github-copilot")) {
      raw = applyEdits(
        raw,
        modify(raw, ["enabled_providers"], [...enabled, "github-copilot"], {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }),
      );
    }

    const nextMeta = updater(
      (parsed.x_nanami_copilot as StoredCopilotMeta) ?? { accounts: [] },
    );
    raw = applyEdits(
      raw,
      modify(raw, ["x_nanami_copilot"], nextMeta, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );

    if (activeAccount && activeAccount.copilotToken) {
      const configuredModels: Record<string, unknown> = {};
      for (const m of activeAccount.models || DEFAULT_COPILOT_MODELS) {
        configuredModels[m.modelID] = {
          name: m.displayName,
          limit: { context: m.contextLimit, output: m.outputLimit },
          capabilities: {
            tools: true,
            ...(m.supportsReasoning ? { reasoning: true } : {}),
            input: ["text", "image"],
            output: ["text"],
          },
        };
      }
      const copilotProviderConfig = {
        npm: "@ai-sdk/openai-compatible",
        name: "GitHub Copilot (Fusion)",
        options: {
          baseURL: "https://api.githubcopilot.com",
          apiKey: activeAccount.copilotToken,
          headers: {
            "Editor-Version": "vscode/1.96.2",
            "Editor-Plugin-Version": "copilot-chat/0.22.4",
            "Copilot-Integration-Id": "vscode-chat",
            "Openai-Organization": "github-copilot",
            "Openai-Intent": "conversation-panel",
          },
        },
        models: configuredModels,
      };
      raw = applyEdits(
        raw,
        modify(raw, ["provider", "github-copilot"], copilotProviderConfig, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }),
      );
    }

    await writeOpencodeConfig("project", configDir, raw);
  } catch (err) {
    console.warn("Could not write x_nanami_copilot metadata:", err);
  }
}

export const useCopilotAccountsStore = create<CopilotAccountsStore>((set, get) => ({
  accounts: [],
  activeUsername: null,
  account: null,
  loading: false,
  error: null,
  deviceFlow: null,
  isConnecting: false,
  modalOpen: false,

  setModalOpen: (open) => set({ modalOpen: open }),

  loadAccounts: async (client) => {
    if (client) latestClient = client;
    try {
      set({ loading: true, error: null });
      const { meta } = await readNanamiCopilotMeta();
      let rawAccounts = Array.isArray(meta.accounts) ? [...meta.accounts] : [];
      const activeUsername = meta.activeUsername || null;
      const deletedMap = meta.deletedAtByUsername ?? {};

      rawAccounts = rawAccounts.filter((acc) => {
        if (!acc?.username || !acc?.oauthToken) return false;
        const delAt = deletedMap[acc.username.toLowerCase()];
        const ts = Math.max(acc.addedAt ?? 0, acc.lastUsed ?? 0);
        if (delAt && ts <= delAt) return false;
        return true;
      });

      if (rawAccounts.length === 0) {
        set({ accounts: [], activeUsername: null, account: null, loading: false });
        return;
      }

      const activeLower = (activeUsername || rawAccounts[0]?.username || "").toLowerCase();
      const prevAccounts = get().accounts;

      const accounts: CopilotAccountInfo[] = rawAccounts.map((raw) => {
        const existing = prevAccounts.find(
          (p) => p.username.toLowerCase() === raw.username.toLowerCase(),
        );
        const isActive = raw.username.toLowerCase() === activeLower;
        return {
          username: raw.username,
          name: raw.name,
          avatarUrl: raw.avatarUrl,
          planSku: raw.planSku || "student",
          expiresAt: raw.expiresAt || 0,
          addedAt: raw.addedAt || Date.now(),
          lastUsed: raw.lastUsed || Date.now(),
          oauthToken: raw.oauthToken,
          copilotToken: raw.copilotToken,
          isActive,
          models: existing?.models?.length ? existing.models : DEFAULT_COPILOT_MODELS,
          loading: false,
        };
      });

      if (!accounts.some((a) => a.isActive) && accounts.length > 0) {
        accounts[0].isActive = true;
      }

      const activeAcc = accounts.find((a) => a.isActive) || accounts[0] || null;

      set({
        accounts,
        activeUsername: activeAcc?.username || null,
        account: activeAcc,
        loading: false,
      });

      // Check if any active account token is expiring within 5 minutes and auto-refresh
      const now = Math.floor(Date.now() / 1000);
      if (activeAcc && (!activeAcc.copilotToken || activeAcc.expiresAt <= now + 300)) {
        void get().refreshCopilotToken(activeAcc.username);
      }
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  selectAccount: async (username: string, client) => {
    if (client) latestClient = client;
    const activeClient = client ?? latestClient;
    const lower = username.toLowerCase();
    const current = get().accounts;
    const target = current.find((a) => a.username.toLowerCase() === lower);
    if (!target) return;
    const wasAlreadyActive = target.isActive;

    const updatedAccounts = current.map((a) => ({
      ...a,
      isActive: a.username.toLowerCase() === lower,
    }));

    set({
      accounts: updatedAccounts,
      activeUsername: target.username,
      account: { ...target, isActive: true },
    });

    await writeNanamiCopilotMeta(
      (prev) => ({
        ...prev,
        activeUsername: target.username,
      }),
      { ...target, isActive: true },
    );

    if (!wasAlreadyActive) {
      try {
        await activeClient?.instance.dispose();
      } catch {}
    }
  },

  deleteAccount: async (username: string, client) => {
    if (client) latestClient = client;
    const lower = username.toLowerCase();
    const remaining = get().accounts.filter((a) => a.username.toLowerCase() !== lower);
    const nextActive = remaining.find((a) => a.isActive) ?? remaining[0] ?? null;

    const updatedAccounts = remaining.map((a) => ({
      ...a,
      isActive: nextActive ? a.username.toLowerCase() === nextActive.username.toLowerCase() : false,
    }));

    set({
      accounts: updatedAccounts,
      activeUsername: nextActive?.username || null,
      account: nextActive,
    });

    await writeNanamiCopilotMeta(
      (prev) => ({
        ...prev,
        activeUsername: nextActive?.username ?? "",
        deletedAtByUsername: {
          ...(prev.deletedAtByUsername ?? {}),
          [lower]: Date.now(),
        },
        accounts: (prev.accounts ?? []).filter((a) => a?.username?.toLowerCase() !== lower),
      }),
      nextActive,
    );
  },

  startDeviceFlow: async () => {
    try {
      get().cancelDeviceFlow();
      set({ isConnecting: true, error: null });

      const controller = new AbortController();
      activePollAbortController = controller;

      const res = await desktopFetchViaMain(
        GITHUB_DEVICE_CODE_URL,
        {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: GITHUB_COPILOT_CLIENT_ID,
            scope: "read:user",
          }),
        },
        15000,
      );

      if (!res.ok) {
        throw new Error(`Failed to request GitHub device code: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as {
        device_code?: string;
        user_code?: string;
        verification_uri?: string;
        expires_in?: number;
        interval?: number;
        error?: string;
        error_description?: string;
      };

      if (!data.device_code || !data.user_code) {
        throw new Error(data.error_description || data.error || "Invalid response from GitHub device auth.");
      }

      const deviceFlowState: CopilotDeviceFlowState = {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri || "https://github.com/login/device",
        expiresIn: data.expires_in || 900,
        interval: Math.max(data.interval || 5, 5),
      };

      set({ deviceFlow: deviceFlowState, isConnecting: false });
      return deviceFlowState;
    } catch (e) {
      set({ isConnecting: false, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  cancelDeviceFlow: () => {
    if (activePollAbortController) {
      activePollAbortController.abort();
      activePollAbortController = null;
    }
    set({ deviceFlow: null, isConnecting: false });
  },

  pollDeviceFlow: async () => {
    const { deviceFlow } = get();
    if (!deviceFlow) return false;

    set({ isConnecting: true, error: null });
    const { deviceCode, interval } = deviceFlow;
    const controller = activePollAbortController ?? new AbortController();
    activePollAbortController = controller;

    const startTime = Date.now();
    const maxDuration = deviceFlow.expiresIn * 1000;

    while (Date.now() - startTime < maxDuration) {
      if (controller.signal.aborted) {
        set({ isConnecting: false });
        return false;
      }

      try {
        const tokenRes = await desktopFetchViaMain(
          GITHUB_ACCESS_TOKEN_URL,
          {
            method: "POST",
            headers: {
              "Accept": "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              client_id: GITHUB_COPILOT_CLIENT_ID,
              device_code: deviceCode,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            }),
          },
          15000,
        );

        if (tokenRes.ok) {
          const tokenData = (await tokenRes.json()) as {
            access_token?: string;
            error?: string;
            error_description?: string;
            interval?: number;
          };

          if (tokenData.access_token) {
            // Authorized! Upsert account to multi-account list
            await setupCopilotIntegration(tokenData.access_token);
            set({ deviceFlow: null, isConnecting: false, modalOpen: false });
            await get().loadAccounts();
            return true;
          }

          if (tokenData.error === "authorization_pending") {
            // Still waiting for user authorization
          } else if (tokenData.error === "slow_down") {
            await new Promise((r) => setTimeout(r, ((tokenData.interval || interval) + 5) * 1000));
            continue;
          } else if (tokenData.error) {
            throw new Error(tokenData.error_description || tokenData.error);
          }
        }
      } catch (err) {
        if (controller.signal.aborted) {
          set({ isConnecting: false });
          return false;
        }
        if (!(err instanceof Error && err.name === "AbortError")) {
          set({ isConnecting: false, error: err instanceof Error ? err.message : String(err) });
          return false;
        }
      }

      await new Promise((r) => setTimeout(r, interval * 1000));
    }

    set({ isConnecting: false, error: "Authentication timed out. Please try again." });
    return false;
  },

  refreshCopilotToken: async (targetUsername?: string) => {
    const { accounts, activeUsername } = get();
    const username = targetUsername || activeUsername;
    if (!username) return null;
    const account = accounts.find((a) => a.username.toLowerCase() === username.toLowerCase());
    if (!account?.oauthToken) return null;

    try {
      const res = await desktopFetchViaMain(
        COPILOT_TOKEN_URL,
        {
          headers: {
            "Authorization": `token ${account.oauthToken}`,
            "Accept": "application/json",
            "User-Agent": "GithubCopilot/1.155.0",
          },
        },
        15000,
      );

      if (!res.ok) {
        throw new Error(`Copilot token refresh failed: ${res.status}`);
      }

      const data = (await res.json()) as {
        token?: string;
        expires_at?: number;
        sku?: string;
      };

      if (!data.token) {
        throw new Error("Missing token in Copilot token response.");
      }

      const updatedAccount: CopilotAccountInfo = {
        ...account,
        copilotToken: data.token,
        expiresAt: data.expires_at || Math.floor(Date.now() / 1000) + 1800,
        planSku: data.sku || account.planSku || "copilot",
        lastUsed: Date.now(),
      };

      await writeNanamiCopilotMeta(
        (prev) => ({
          ...prev,
          accounts: (prev.accounts ?? []).map((a) =>
            a.username.toLowerCase() === username.toLowerCase()
              ? {
                  ...a,
                  copilotToken: data.token!,
                  expiresAt: updatedAccount.expiresAt,
                  planSku: updatedAccount.planSku,
                  lastUsed: updatedAccount.lastUsed,
                }
              : a,
          ),
        }),
        account.isActive ? updatedAccount : undefined,
      );

      set((state) => ({
        accounts: state.accounts.map((a) =>
          a.username.toLowerCase() === username.toLowerCase() ? updatedAccount : a,
        ),
        account: state.activeUsername?.toLowerCase() === username.toLowerCase() ? updatedAccount : state.account,
      }));

      return data.token;
    } catch (e) {
      console.warn("Could not refresh Copilot token:", e);
      return null;
    }
  },

  disconnect: async () => {
    try {
      set({ loading: true, error: null });
      const configDir = await getNanamiConfigDir();
      const configRes = (await readOpencodeConfig("project", configDir)) as OpencodeConfigFile;
      if (configRes?.content) {
        let raw = configRes.content;
        let edits = modify(raw, ["x_nanami_copilot"], undefined, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        });
        raw = applyEdits(raw, edits);

        edits = modify(raw, ["provider", "github-copilot"], undefined, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        });
        raw = applyEdits(raw, edits);

        await writeOpencodeConfig("project", configDir, raw);
      }
      set({ accounts: [], activeUsername: null, account: null, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));

async function setupCopilotIntegration(oauthToken: string) {
  let username = "GitHub User";
  let avatarUrl: string | undefined;
  let name: string | undefined;

  try {
    const userRes = await desktopFetchViaMain(
      GITHUB_USER_URL,
      {
        headers: {
          "Authorization": `token ${oauthToken}`,
          "Accept": "application/json",
          "User-Agent": "NanamiWork/1.0.0",
        },
      },
      15000,
    );
    if (userRes.ok) {
      const userData = (await userRes.json()) as {
        login?: string;
        name?: string;
        avatar_url?: string;
      };
      if (userData.login) username = userData.login;
      avatarUrl = userData.avatar_url;
      name = userData.name;
    }
  } catch (e) {
    console.warn("Could not fetch GitHub user info:", e);
  }

  const tokenRes = await desktopFetchViaMain(
    COPILOT_TOKEN_URL,
    {
      headers: {
        "Authorization": `token ${oauthToken}`,
        "Accept": "application/json",
        "User-Agent": "GithubCopilot/1.155.0",
      },
    },
    15000,
  );

  if (!tokenRes.ok) {
    throw new Error(
      `Could not verify Copilot subscription (${tokenRes.status}). Ensure your GitHub account has an active Copilot plan or Student Developer Pack.`,
    );
  }

  const tokenData = (await tokenRes.json()) as {
    token?: string;
    expires_at?: number;
    sku?: string;
  };

  if (!tokenData.token) {
    throw new Error("No Copilot session token was returned by GitHub.");
  }

  const account: CopilotAccountInfo = {
    username,
    name,
    avatarUrl,
    planSku: tokenData.sku || "student",
    expiresAt: tokenData.expires_at || Math.floor(Date.now() / 1000) + 1800,
    addedAt: Date.now(),
    lastUsed: Date.now(),
    oauthToken,
    copilotToken: tokenData.token,
    isActive: true,
    models: DEFAULT_COPILOT_MODELS,
  };

  await writeNanamiCopilotMeta(
    (prev) => {
      const list = Array.isArray(prev.accounts) ? [...prev.accounts] : [];
      const idx = list.findIndex((a) => a.username.toLowerCase() === username.toLowerCase());
      const item = {
        username: account.username,
        name: account.name,
        avatarUrl: account.avatarUrl,
        planSku: account.planSku,
        expiresAt: account.expiresAt,
        addedAt: account.addedAt,
        lastUsed: account.lastUsed,
        oauthToken: account.oauthToken,
        copilotToken: account.copilotToken,
      };
      if (idx >= 0) list[idx] = item;
      else list.push(item);
      const del = { ...(prev.deletedAtByUsername ?? {}) };
      delete del[username.toLowerCase()];
      return {
        ...prev,
        activeUsername: username,
        deletedAtByUsername: del,
        accounts: list,
      };
    },
    account,
  );
}
