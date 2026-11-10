import { create } from "zustand";
import {
  desktopFetchViaMain,
  getCachedDesktopHomeDir,
  readOpencodeConfig,
  writeOpencodeConfig,
  type OpencodeConfigFile,
} from "@/app/lib/desktop";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import type { Client } from "@/app/types";
import { modelAdmissionFence } from "@/app/lib/model-admission-fence";

async function getNanamiConfigDir(): Promise<string> {
  try {
    const config = await readOpencodeConfig("global");
    if (config.path) return config.path.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
  } catch {}
  const home = (await getCachedDesktopHomeDir()) || "";
  return home ? `${home.replace(/\\/g, "/")}/.config/nanamiwork` : ".config/nanamiwork";
}

const GITHUB_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_USER_URL = "https://api.github.com/copilot_internal/user";
const GITHUB_USER_URL = "https://api.github.com/user";

export type CopilotModelItem = {
  modelID: string;
  displayName: string;
  contextLimit: number;
  outputLimit: number;
  supportsReasoning?: boolean;
  remainingFraction: number | null;
  resetTime: string | null;
};

export const DEFAULT_COPILOT_MODELS: CopilotModelItem[] = [
  {
    modelID: "gpt-4.1",
    displayName: "Auto (Copilot)",
    contextLimit: 128000,
    outputLimit: 16384,
    remainingFraction: null,
    resetTime: null,
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
  quotaRemainingPct?: number | null;
  quotaResetTimeIso?: string | null;
  loading?: boolean;
  /** Recovered from this app's configured provider key, not another profile. */
  source?: "configured-provider";
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
    quotaRemainingPct?: number | null;
    quotaResetTimeIso?: string | null;
  }>;
};

type CopilotAccountsStore = {
  accounts: CopilotAccountInfo[];
  activeUsername: string | null;
  account: CopilotAccountInfo | null;
  loading: boolean;
  hasLoadedAccounts: boolean;
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
  refreshCopilotToken: (username?: string, options?: { persist?: boolean }) => Promise<string | null>;
  disconnect: () => Promise<void>;
};

let activePollAbortController: AbortController | null = null;
let latestClient: Client | null = null;
let pendingAccountsLoad: Promise<void> | null = null;

function buildCopilotModelsWithQuota(
  quotaRemainingPct: number | null | undefined,
  quotaResetTimeIso: string | null | undefined,
): CopilotModelItem[] {
  const remainingFraction =
    typeof quotaRemainingPct === "number"
      ? Math.max(0, Math.min(1, quotaRemainingPct / 100))
      : null;
  const resetTime = quotaResetTimeIso ?? null;
  return DEFAULT_COPILOT_MODELS.map((m) => ({
    ...m,
    remainingFraction,
    resetTime,
  }));
}

async function fetchCopilotQuotaInfo(oauthToken: string): Promise<{
  quotaRemainingPct: number | null;
  quotaResetTimeIso: string | null;
  planSku?: string;
}> {
  try {
    const res = await desktopFetchViaMain(
      COPILOT_USER_URL,
      {
        headers: {
          "Authorization": `token ${oauthToken}`,
          "Accept": "application/json",
          "User-Agent": "GithubCopilot/1.155.0",
        },
      },
      15000,
    );
    if (!res.ok) {
      return { quotaRemainingPct: null, quotaResetTimeIso: null };
    }
    const data = (await res.json()) as {
      access_type_sku?: string;
      quota_reset_date?: string;
      quota_reset_date_utc?: string;
      quota_snapshots?: {
        premium_interactions?: {
          percent_remaining?: number;
          unlimited?: boolean;
        };
        chat?: {
          percent_remaining?: number;
          unlimited?: boolean;
        };
      };
    };
    const snap =
      data.quota_snapshots?.premium_interactions ?? data.quota_snapshots?.chat;
    const quotaRemainingPct =
      typeof snap?.percent_remaining === "number"
        ? Math.max(0, Math.min(100, Math.round(snap.percent_remaining)))
        : null;
    const quotaResetTimeIso =
      data.quota_reset_date_utc ||
      (data.quota_reset_date ? `${data.quota_reset_date}T00:00:00.000Z` : null);
    return {
      quotaRemainingPct,
      quotaResetTimeIso,
      planSku: data.access_type_sku,
    };
  } catch {
    return { quotaRemainingPct: null, quotaResetTimeIso: null };
  }
}

async function readNanamiCopilotMeta(strict = false): Promise<{
  configDir: string;
  meta: StoredCopilotMeta;
  configuredToken: string | null;
}> {
  const configDir = await getNanamiConfigDir();
  let meta: StoredCopilotMeta = {};
  let configuredToken: string | null = null;
  try {
    const res = (await readOpencodeConfig("project", configDir)) as OpencodeConfigFile;
    if (strict && res?.exists && !res.content?.trim()) throw new Error("Account settings are empty.");
    if (res?.content?.trim()) {
      const errors: ParseError[] = [];
      const parsed = (parse(res.content, errors) ?? {}) as {
        x_nanami_copilot?: StoredCopilotMeta | CopilotAccountInfo;
        provider?: Record<string, { options?: { apiKey?: unknown } }>;
      };
      if (strict && errors.length) throw new Error("Account settings are invalid.");
      const key = parsed.provider?.["github-copilot"]?.options?.apiKey;
      if (typeof key === "string" && /^(gho_|ghu_|github_pat_)/.test(key.trim())) configuredToken = key.trim();
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
                quotaRemainingPct: single.quotaRemainingPct ?? null,
                quotaResetTimeIso: single.quotaResetTimeIso ?? null,
              },
            ],
          };
        } else {
          meta = raw as StoredCopilotMeta;
        }
      }
    }
  } catch (error) {
    if (strict) throw new Error("Could not read Copilot account settings.", { cause: error });
  }
  return { configDir, meta, configuredToken };
}

/** Recover a verified, already-configured credential without writing or importing another profile. */
async function configuredCopilotAccount(token: string, deletedMap: Record<string, number>): Promise<CopilotAccountInfo | null> {
  const headers = { Authorization: `token ${token}`, Accept: "application/json", "User-Agent": "NanamiWork/1.0.0" };
  const [userResponse, tokenResponse, quota] = await Promise.all([
    desktopFetchViaMain(GITHUB_USER_URL, { headers }, 15000),
    desktopFetchViaMain(COPILOT_TOKEN_URL, { headers }, 15000),
    fetchCopilotQuotaInfo(token),
  ]);
  if (!userResponse.ok || !tokenResponse.ok) return null;
  const user: unknown = await userResponse.json();
  const session: unknown = await tokenResponse.json();
  if (!user || typeof user !== "object" || !session || typeof session !== "object") return null;
  const username = Reflect.get(user, "login");
  const sessionToken = Reflect.get(session, "token");
  if (typeof username !== "string" || !username.trim() || deletedMap[username.toLowerCase()]) return null;
  if (typeof sessionToken !== "string" || !sessionToken) return null;
  const expiresAt = Reflect.get(session, "expires_at");
  const sku = Reflect.get(session, "sku");
  return {
    username,
    planSku: typeof sku === "string" ? sku : quota.planSku || "copilot",
    expiresAt: typeof expiresAt === "number" ? expiresAt : Math.floor(Date.now() / 1000) + 1800,
    addedAt: Date.now(), lastUsed: 0, oauthToken: token, copilotToken: sessionToken, isActive: true,
    quotaRemainingPct: quota.quotaRemainingPct,
    quotaResetTimeIso: quota.quotaResetTimeIso,
    models: buildCopilotModelsWithQuota(quota.quotaRemainingPct, quota.quotaResetTimeIso),
    loading: false, source: "configured-provider",
  };
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

    if (activeAccount && (activeAccount.oauthToken || activeAccount.copilotToken)) {
      const configuredModels: Record<string, unknown> = {};
      for (const m of activeAccount.models || DEFAULT_COPILOT_MODELS) {
        configuredModels[m.modelID] = {
          id: m.modelID,
          name: m.displayName,
          tool_call: true,
          attachment: true,
          limit: { context: m.contextLimit, output: m.outputLimit },
          modalities: {
            input: ["text", "image"],
            output: ["text"],
          },
          capabilities: {
            tools: true,
            attachment: true,
            ...(m.supportsReasoning ? { reasoning: true } : {}),
            input: {
              text: true,
              image: true,
            },
            output: {
              text: true,
            },
          },
        };
      }
      const copilotProviderConfig = {
        npm: "@ai-sdk/openai-compatible",
        name: "GitHub Copilot",
        options: {
          baseURL: "https://api.githubcopilot.com",
          apiKey: activeAccount.copilotToken || activeAccount.oauthToken,
          headers: {
            "User-Agent": "opencode/1.0.0",
            "X-GitHub-Api-Version": "2026-06-01",
            "Editor-Version": "vscode/1.96.2",
            "Editor-Plugin-Version": "copilot-chat/0.22.4",
            "Copilot-Integration-Id": "vscode-chat",
            "Openai-Organization": "github-copilot",
            "Openai-Intent": "conversation-edits",
            "x-initiator": "user",
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
  hasLoadedAccounts: false,
  error: null,
  deviceFlow: null,
  isConnecting: false,
  modalOpen: false,

  setModalOpen: (open) => set({ modalOpen: open }),

  loadAccounts: (client) => {
    if (client) latestClient = client;
    if (pendingAccountsLoad) return pendingAccountsLoad;
    const operation = (async () => {
    try {
      set({ loading: true, hasLoadedAccounts: false, error: null });
      const { meta, configuredToken } = await readNanamiCopilotMeta(true);
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
        const previous = get().account;
        const restored = previous?.source === "configured-provider" && previous.oauthToken === configuredToken && !deletedMap[previous.username.toLowerCase()]
          && previous.expiresAt > Math.floor(Date.now() / 1000) + 60
          ? previous
          : configuredToken ? await configuredCopilotAccount(configuredToken, deletedMap).catch(() => null) : null;
        set({ accounts: restored ? [restored] : [], activeUsername: restored?.username ?? null, account: restored, loading: false, hasLoadedAccounts: true });
        return;
      }

      const activeLower = (activeUsername || rawAccounts[0]?.username || "").toLowerCase();
      const prevAccounts = get().accounts;

      const accounts: CopilotAccountInfo[] = rawAccounts.map((raw) => {
        const existing = prevAccounts.find(
          (p) => p.username.toLowerCase() === raw.username.toLowerCase(),
        );
        const isActive = raw.username.toLowerCase() === activeLower;
        const quotaRemainingPct =
          raw.quotaRemainingPct ?? existing?.quotaRemainingPct ?? null;
        const quotaResetTimeIso =
          raw.quotaResetTimeIso ?? existing?.quotaResetTimeIso ?? null;
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
          quotaRemainingPct,
          quotaResetTimeIso,
          models: buildCopilotModelsWithQuota(quotaRemainingPct, quotaResetTimeIso),
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

      if (activeAcc) {
        await get().refreshCopilotToken(activeAcc.username, { persist: false });
      }
      set({ hasLoadedAccounts: true });
    } catch (e) {
      set({ loading: false, hasLoadedAccounts: false, error: e instanceof Error ? e.message : String(e) });
    }
    })();
    pendingAccountsLoad = operation;
    void operation.finally(() => { if (pendingAccountsLoad === operation) pendingAccountsLoad = null; });
    return operation;
  },

  selectAccount: (username: string, client) => modelAdmissionFence.regular(async () => {
    if (client) latestClient = client;
    const activeClient = client ?? latestClient;
    const lower = username.toLowerCase();
    const current = get().accounts;
    const target = current.find((a) => a.username.toLowerCase() === lower);
    if (!target) return;
    const wasAlreadyActive = target.isActive;
    if (target.source === "configured-provider" && wasAlreadyActive) return;

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
  }),

  deleteAccount: (username: string, client) => modelAdmissionFence.regular(async () => {
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
  }),

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

  refreshCopilotToken: async (targetUsername?: string, options?: { persist?: boolean }) => {
    const { accounts, activeUsername } = get();
    const username = targetUsername || activeUsername;
    if (!username) return null;
    const account = accounts.find((a) => a.username.toLowerCase() === username.toLowerCase());
    if (!account?.oauthToken) return null;

    set((state) => ({
      accounts: state.accounts.map((a) =>
        a.username.toLowerCase() === username.toLowerCase() ? { ...a, loading: true } : a,
      ),
    }));

    try {
      const [res, quotaInfo] = await Promise.all([
        desktopFetchViaMain(
          COPILOT_TOKEN_URL,
          {
            headers: {
              "Authorization": `token ${account.oauthToken}`,
              "Accept": "application/json",
              "User-Agent": "GithubCopilot/1.155.0",
            },
          },
          15000,
        ),
        fetchCopilotQuotaInfo(account.oauthToken),
      ]);

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

      const nextPct = quotaInfo.quotaRemainingPct ?? account.quotaRemainingPct ?? null;
      const nextReset = quotaInfo.quotaResetTimeIso ?? account.quotaResetTimeIso ?? null;

      const updatedAccount: CopilotAccountInfo = {
        ...account,
        copilotToken: data.token,
        expiresAt: data.expires_at || Math.floor(Date.now() / 1000) + 1800,
        planSku: data.sku || quotaInfo.planSku || account.planSku || "copilot",
        lastUsed: Date.now(),
        quotaRemainingPct: nextPct,
        quotaResetTimeIso: nextReset,
        models: buildCopilotModelsWithQuota(nextPct, nextReset),
        loading: false,
      };

      if (options?.persist !== false && account.source !== "configured-provider") await modelAdmissionFence.regular(() => writeNanamiCopilotMeta(
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
                  quotaRemainingPct: updatedAccount.quotaRemainingPct,
                  quotaResetTimeIso: updatedAccount.quotaResetTimeIso,
                }
              : a,
          ),
        }),
        account.isActive ? updatedAccount : undefined,
      ));

      set((state) => {
        const accounts = state.accounts.map((item) => item.username.toLowerCase() === username.toLowerCase()
          ? { ...updatedAccount, isActive: item.isActive } : item);
        return { accounts, account: accounts.find((item) => item.isActive) ?? null };
      });

      return data.token;
    } catch (e) {
      set((state) => ({
        accounts: state.accounts.map((a) =>
          a.username.toLowerCase() === username.toLowerCase() ? { ...a, loading: false } : a,
        ),
      }));
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

/** Called only after the router has confirmed that the local engine is idle. */
export async function activateCopilotRouterAccount(username: string, modelID: string, client: Client): Promise<void> {
  let state = useCopilotAccountsStore.getState();
  let target = state.accounts.find((account) => account.username.toLowerCase() === username.toLowerCase());
  if (!target || !target.models.some((model) => model.modelID === modelID)) {
    throw new Error("The selected Copilot account or model is no longer available.");
  }
  const refreshed = await state.refreshCopilotToken(target.username, { persist: false });
  if (!refreshed) throw new Error("The selected Copilot account needs to sign in again.");
  state = useCopilotAccountsStore.getState();
  target = state.accounts.find((account) => account.username.toLowerCase() === username.toLowerCase());
  if (!target) throw new Error("The selected Copilot account is no longer available.");
  // Verify the recovered provider has not been changed since discovery. It
  // needs no synthetic account record, but its cached provider still needs a
  // refresh before this turn uses it.
  if (target.source === "configured-provider") {
    const saved = await readNanamiCopilotMeta(true);
    if (saved.configuredToken !== target.oauthToken || (saved.meta.accounts?.length ?? 0) > 0
      || saved.meta.deletedAtByUsername?.[target.username.toLowerCase()]) {
      throw new Error("The configured Copilot account changed. Refresh the model picker and try again.");
    }
    const disposed = await client.instance.dispose();
    if (disposed.error || disposed.data !== true) throw new Error("Could not refresh the Copilot provider.");
    return;
  }

  const configDir = await getNanamiConfigDir();
  const config = (await readOpencodeConfig("project", configDir)) as OpencodeConfigFile;
  if (!config.content) throw new Error("Copilot account storage is unavailable.");
  const errors: ParseError[] = [];
  const parsed: unknown = parse(config.content, errors);
  if (errors.length || !parsed || typeof parsed !== "object") throw new Error("Copilot account storage could not be read safely.");
  const meta = Reflect.get(parsed, "x_nanami_copilot");
  const accounts = meta && typeof meta === "object" ? Reflect.get(meta, "accounts") : null;
  if (!Array.isArray(accounts) || !accounts.some((account) => {
    const savedUsername: unknown = account && typeof account === "object" ? Reflect.get(account, "username") : null;
    const savedToken: unknown = account && typeof account === "object" ? Reflect.get(account, "oauthToken") : null;
    return typeof savedUsername === "string" && savedUsername.toLowerCase() === username.toLowerCase() && savedToken === target.oauthToken;
  })) throw new Error("The selected Copilot account is missing from local storage.");
  const edits = modify(config.content, ["x_nanami_copilot", "activeUsername"], target.username, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
  const written: unknown = await writeOpencodeConfig("project", configDir, applyEdits(config.content, edits));
  if (!written || typeof written !== "object" || Reflect.get(written, "ok") !== true) throw new Error("Could not save the Copilot account selection.");
  const disposed = await client.instance.dispose();
  if (disposed.error || disposed.data !== true) throw new Error("Could not refresh the Copilot provider.");
  const selectedUsername = target.username;
  useCopilotAccountsStore.setState((current) => {
    const accounts = current.accounts.map((account) => ({ ...account, isActive: account.username.toLowerCase() === username.toLowerCase() }));
    return { accounts, activeUsername: selectedUsername, account: accounts.find((account) => account.isActive) ?? null };
  });
}

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

  const [tokenRes, quotaInfo] = await Promise.all([
    desktopFetchViaMain(
      COPILOT_TOKEN_URL,
      {
        headers: {
          "Authorization": `token ${oauthToken}`,
          "Accept": "application/json",
          "User-Agent": "GithubCopilot/1.155.0",
        },
      },
      15000,
    ),
    fetchCopilotQuotaInfo(oauthToken),
  ]);

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
    planSku: tokenData.sku || quotaInfo.planSku || "student",
    expiresAt: tokenData.expires_at || Math.floor(Date.now() / 1000) + 1800,
    addedAt: Date.now(),
    lastUsed: Date.now(),
    oauthToken,
    copilotToken: tokenData.token,
    isActive: true,
    quotaRemainingPct: quotaInfo.quotaRemainingPct,
    quotaResetTimeIso: quotaInfo.quotaResetTimeIso,
    models: buildCopilotModelsWithQuota(
      quotaInfo.quotaRemainingPct,
      quotaInfo.quotaResetTimeIso,
    ),
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
        quotaRemainingPct: account.quotaRemainingPct,
        quotaResetTimeIso: account.quotaResetTimeIso,
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
