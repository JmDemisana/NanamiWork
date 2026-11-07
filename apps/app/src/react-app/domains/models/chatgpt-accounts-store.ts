import { create } from "zustand";
import {
  desktopFetchViaMain,
  getCachedDesktopHomeDir,
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

export type ChatGptModelItem = {
  modelID: string;
  displayName: string;
  contextLimit: number;
  outputLimit: number;
  supportsReasoning?: boolean;
};

export const DEFAULT_CHATGPT_MODELS: readonly ChatGptModelItem[] = [
  {
    modelID: "o3-mini",
    displayName: "o3-mini",
    contextLimit: 200000,
    outputLimit: 100000,
    supportsReasoning: true,
  },
  {
    modelID: "gpt-4o",
    displayName: "GPT-4o",
    contextLimit: 128000,
    outputLimit: 4096,
  },
  {
    modelID: "gpt-4o-mini",
    displayName: "GPT-4o mini",
    contextLimit: 128000,
    outputLimit: 4096,
  },
  {
    modelID: "o1",
    displayName: "o1",
    contextLimit: 200000,
    outputLimit: 100000,
    supportsReasoning: true,
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
  primaryWindow?: QuotaWindow; // 5-hour rolling limit
  secondaryWindow?: QuotaWindow; // Weekly / 7-day limit
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
  account: ChatGptAccountInfo | null; // For backwards compatibility
  loading: boolean;
  isConnecting: boolean;
  error: string | null;
  modalOpen: boolean;

  setModalOpen: (open: boolean) => void;
  loadAccounts: () => Promise<void>;
  selectAccount: (email: string) => Promise<void>;
  deleteAccount: (email: string) => Promise<void>;
  refreshQuotas: (email?: string) => Promise<void>;
  confirmAndRefresh: () => Promise<boolean>;
  connectApiKey: (apiKey: string) => Promise<boolean>;
  startBrowserLogin: () => Promise<void>;
  disconnect: () => Promise<void>;
};

export const useChatGptAccountsStore = create<ChatGptAccountsStore>((set, get) => ({
  accounts: [],
  activeEmail: null,
  account: null,
  loading: false,
  isConnecting: false,
  error: null,
  modalOpen: false,

  setModalOpen: (open) =>
    set({
      modalOpen: open,
      error: null,
    }),

  loadAccounts: async () => {
    try {
      set({ loading: true, error: null });
      const configRes = (await readOpencodeConfig("global", "")) as OpencodeConfigFile;
      let rawAccounts: StoredCodexAccount[] = [];
      let activeEmail: string | null = null;

      if (configRes?.content) {
        const parsed = parse(configRes.content) as Record<string, unknown>;
        const codexMeta = parsed?.x_nanami_codex as NanamiCodexMeta | undefined;

        if (Array.isArray(codexMeta?.accounts) && codexMeta.accounts.length > 0) {
          rawAccounts = [...codexMeta.accounts];
          activeEmail = codexMeta.activeEmail || rawAccounts[0]?.email || null;
        } else if (codexMeta?.accessToken || codexMeta?.apiKey) {
          // Legacy single-account migration
          rawAccounts = [
            {
              email: codexMeta.email || (codexMeta.apiKey ? "API Key Account" : "ChatGPT User"),
              planType: (codexMeta.planType as "free" | "plus" | "pro") || (codexMeta.apiKey ? "api" : "free"),
              accessToken: codexMeta.accessToken,
              accountId: codexMeta.accountId,
              apiKey: codexMeta.apiKey,
              addedAt: Date.now(),
              lastLoadedAt: Date.now(),
            },
          ];
          activeEmail = rawAccounts[0].email;
        }

        const openaiProvider = (parsed?.provider as Record<string, unknown> | undefined)?.openai as
          | { options?: { apiKey?: string } }
          | undefined;

        if (openaiProvider?.options?.apiKey && !rawAccounts.some((a) => a.apiKey === openaiProvider.options?.apiKey)) {
          rawAccounts.push({
            email: "API Key Account",
            planType: "api",
            apiKey: openaiProvider.options.apiKey,
            addedAt: Date.now(),
            lastLoadedAt: Date.now(),
          });
          if (!activeEmail) activeEmail = "API Key Account";
        }
      }

      if (rawAccounts.length === 0) {
        set({ accounts: [], activeEmail: null, account: null, loading: false });
        return;
      }

      const activeLower = (activeEmail || rawAccounts[0]?.email || "").toLowerCase();
      const accounts: ChatGptAccountInfo[] = rawAccounts.map((raw) => ({
        email: raw.email,
        planType: raw.planType || (raw.apiKey ? "api" : "free"),
        accessToken: raw.accessToken,
        refreshToken: raw.refreshToken,
        idToken: raw.idToken,
        accountId: raw.accountId,
        apiKey: raw.apiKey,
        isActive: raw.email.toLowerCase() === activeLower,
        models: [...DEFAULT_CHATGPT_MODELS],
        addedAt: raw.addedAt || Date.now(),
        lastLoadedAt: raw.lastLoadedAt || Date.now(),
      }));

      const activeAcc = accounts.find((a) => a.isActive) || accounts[0] || null;

      set({
        accounts,
        activeEmail: activeAcc?.email || null,
        account: activeAcc,
        loading: false,
      });

      // Fetch live limits for all accounts independently
      void get().refreshQuotas();
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  selectAccount: async (email: string) => {
    const lower = email.toLowerCase();
    const current = get().accounts;
    const target = current.find((a) => a.email.toLowerCase() === lower);
    if (!target) return;

    const updatedAccounts = current.map((a) => ({
      ...a,
      isActive: a.email.toLowerCase() === lower,
    }));

    set({
      accounts: updatedAccounts,
      activeEmail: target.email,
      account: target,
    });

    // Update opencode.json metadata & sync active account credentials to ~/.codex/auth.json
    try {
      await syncCodexDiskAccountsViaTerminal({ type: "select", email: target.email });
      const configRes = (await readOpencodeConfig("global", "")) as OpencodeConfigFile;
      if (configRes?.content) {
        let raw = configRes.content;
        const edits = modify(raw, ["x_nanami_codex", "activeEmail"], target.email, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        });
        raw = applyEdits(raw, edits);
        await writeOpencodeConfig("global", "", raw);
      }
    } catch (e) {
      console.warn("Could not persist selected Codex account:", e);
    }
  },

  deleteAccount: async (email: string) => {
    try {
      set({ loading: true });
      await syncCodexDiskAccountsViaTerminal({ type: "delete", email });

      const current = get().accounts.filter((a) => a.email.toLowerCase() !== email.toLowerCase());
      const nextActive = current[0]?.email || null;
      const updatedAccounts = current.map((a, i) => ({
        ...a,
        isActive: i === 0,
      }));

      const activeAcc = updatedAccounts[0] || null;
      set({
        accounts: updatedAccounts,
        activeEmail: nextActive,
        account: activeAcc,
        loading: false,
      });

      // Update opencode.json
      const configRes = (await readOpencodeConfig("global", "")) as OpencodeConfigFile;
      if (configRes?.content) {
        let raw = configRes.content;
        let edits = modify(
          raw,
          ["x_nanami_codex", "accounts"],
          updatedAccounts.map((a) => ({
            email: a.email,
            planType: a.planType,
            accessToken: a.accessToken,
            refreshToken: a.refreshToken,
            idToken: a.idToken,
            accountId: a.accountId,
            apiKey: a.apiKey,
            addedAt: a.addedAt,
            lastLoadedAt: a.lastLoadedAt,
          })),
          { formattingOptions: { insertSpaces: true, tabSize: 2 } },
        );
        raw = applyEdits(raw, edits);
        edits = modify(raw, ["x_nanami_codex", "activeEmail"], nextActive, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        });
        raw = applyEdits(raw, edits);
        await writeOpencodeConfig("global", "", raw);
      }
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  refreshQuotas: async (targetEmail?: string) => {
    const { accounts } = get();
    if (accounts.length === 0) return;

    const targets = targetEmail
      ? accounts.filter((a) => a.email.toLowerCase() === targetEmail.toLowerCase())
      : accounts;

    for (const acc of targets) {
      if (!acc.accessToken) continue;

      set((state) => ({
        accounts: state.accounts.map((a) =>
          a.email.toLowerCase() === acc.email.toLowerCase() ? { ...a, quotaLoading: true, quotaError: null } : a,
        ),
      }));

      try {
        const res = await desktopFetchViaMain(
          "https://chatgpt.com/backend-api/wham/usage",
          {
            headers: {
              Authorization: `Bearer ${acc.accessToken}`,
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              ...(acc.accountId ? { "Chatgpt-Account-Id": acc.accountId } : {}),
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

          set((state) => {
            const nextAccounts = state.accounts.map((item) => {
              if (item.email.toLowerCase() !== acc.email.toLowerCase()) return item;
              return {
                ...item,
                email: data.email || item.email,
                planType: (data.plan_type as "free" | "plus" | "pro") || item.planType,
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
                quotaLoading: false,
                quotaError: null,
                lastLoadedAt: Date.now(),
              };
            });
            const activeAcc = nextAccounts.find((a) => a.isActive) || nextAccounts[0] || null;
            return { accounts: nextAccounts, account: activeAcc };
          });
        } else {
          set((state) => ({
            accounts: state.accounts.map((item) =>
              item.email.toLowerCase() === acc.email.toLowerCase()
                ? { ...item, quotaLoading: false, quotaError: `Quota HTTP ${res.status}` }
                : item,
            ),
          }));
        }
      } catch (err) {
        set((state) => ({
          accounts: state.accounts.map((item) =>
            item.email.toLowerCase() === acc.email.toLowerCase()
              ? { ...item, quotaLoading: false, quotaError: err instanceof Error ? err.message : String(err) }
              : item,
          ),
        }));
      }
    }
  },

  startBrowserLogin: async () => {
    try {
      set({ isConnecting: true, error: null });
      // Launch codex login in background terminal to start loopback server and open browser
      const terminal = typeof window !== "undefined" ? window.__OPENWORK_ELECTRON__?.terminal : undefined;
      const home = (await getCachedDesktopHomeDir()) || "";
      if (terminal?.create && terminal?.write) {
        const { terminalId } = await terminal.create({ cwd: home, cols: 80, rows: 10 });
        const codexBin = `${home}\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.exe`;
        const cmd = `& "${codexBin}" login\r\n`;
        await terminal.write(terminalId, cmd);
      }
    } catch (e) {
      console.warn("Could not spawn codex login in terminal:", e);
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
      set({ loading: false, isConnecting: false, error: e instanceof Error ? e.message : String(e) });
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

        edits = modify(raw, ["provider", "openai"], undefined, {
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

export async function syncCodexDiskAccountsViaTerminal(action?: {
  type: "select" | "delete" | "confirm";
  email?: string;
}): Promise<void> {
  const terminal = typeof window !== "undefined" ? window.__OPENWORK_ELECTRON__?.terminal : undefined;
  if (!terminal?.create || !terminal?.write) return;

  try {
    const home = (await getCachedDesktopHomeDir()) || "";
    if (!home) return;

    const script = `
const fs = require('fs');
const path = require('path');
const parseJ = (raw) => JSON.parse(String(raw || '').replace(/^\\uFEFF/, '').replace(/\\\\"|"(?:\\\\"|[^"])*"|(\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\/)/g, (m, g) => (g ? '' : m)).replace(/,(\\s*[}\\]])/g, '$1'));
const home = ${JSON.stringify(home)};
const cfgDir = path.join(home, '.config', 'nanamiwork');
fs.mkdirSync(cfgDir, { recursive: true });
const jsoncFile = path.join(cfgDir, 'opencode.jsonc');
const jsonFile = path.join(cfgDir, 'opencode.json');
const opencodeDir = path.join(home, '.config', 'opencode');
const opencodeJsonFile = path.join(opencodeDir, 'opencode.json');
const codexAuthFile = path.join(home, '.codex', 'auth.json');
const action = ${JSON.stringify(action ?? null)};

let meta = { activeEmail: '', accounts: [] };

for (const f of [jsoncFile, jsonFile, opencodeJsonFile]) {
  if (fs.existsSync(f)) {
    try {
      const parsed = parseJ(fs.readFileSync(f, 'utf8'));
      if (parsed && parsed.x_nanami_codex) {
        if (Array.isArray(parsed.x_nanami_codex.accounts) && parsed.x_nanami_codex.accounts.length > 0) {
          meta.accounts = parsed.x_nanami_codex.accounts;
        }
        if (parsed.x_nanami_codex.activeEmail) {
          meta.activeEmail = parsed.x_nanami_codex.activeEmail;
        }
      }
    } catch {}
  }
}

if (fs.existsSync(codexAuthFile)) {
  try {
    const cData = parseJ(fs.readFileSync(codexAuthFile, 'utf8'));
    if (cData && cData.tokens && cData.tokens.access_token) {
      let email = '';
      let plan = 'free';
      if (cData.tokens.id_token) {
        try {
          const payload = JSON.parse(Buffer.from(cData.tokens.id_token.split('.')[1], 'base64').toString('utf8'));
          email = payload.email || '';
          if (payload['https://api.openai.com/auth'] && payload['https://api.openai.com/auth'].chatgpt_plan_type) {
            plan = payload['https://api.openai.com/auth'].chatgpt_plan_type;
          }
        } catch {}
      }
      email = email || cData.email || 'chatgpt-user';
      const existingIdx = meta.accounts.findIndex(a => String(a.email || '').toLowerCase() === email.toLowerCase());
      const accObj = {
        email,
        planType: plan,
        accessToken: cData.tokens.access_token,
        refreshToken: cData.tokens.refresh_token || '',
        idToken: cData.tokens.id_token || '',
        accountId: cData.tokens.account_id || '',
        addedAt: Date.now(),
        lastLoadedAt: Date.now(),
      };
      if (existingIdx >= 0) {
        meta.accounts[existingIdx] = { ...meta.accounts[existingIdx], ...accObj };
      } else {
        meta.accounts.push(accObj);
      }
      if (!meta.activeEmail || (action && action.type === 'confirm')) {
        meta.activeEmail = email;
      }
    }
  } catch {}
}

if (action && action.type === 'select' && action.email) {
  meta.activeEmail = action.email;
  const target = meta.accounts.find(a => String(a.email || '').toLowerCase() === action.email.toLowerCase());
  if (target && target.accessToken) {
    const authObj = {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: target.idToken || '',
        access_token: target.accessToken,
        refresh_token: target.refreshToken || '',
        account_id: target.accountId || '',
      },
      last_refresh: new Date().toISOString(),
    };
    try {
      fs.writeFileSync(codexAuthFile, JSON.stringify(authObj, null, 2), 'utf8');
    } catch {}
  }
} else if (action && action.type === 'delete' && action.email) {
  meta.accounts = meta.accounts.filter(a => String(a.email || '').toLowerCase() !== action.email.toLowerCase());
  if (String(meta.activeEmail || '').toLowerCase() === action.email.toLowerCase()) {
    meta.activeEmail = meta.accounts[0]?.email || '';
  }
}

const defaultModels = {
  "o3-mini": {
    name: "o3-mini",
    limit: { context: 200000, output: 100000 },
    capabilities: { tools: true, reasoning: true, input: ["text"], output: ["text"] }
  },
  "gpt-4o": {
    name: "GPT-4o",
    limit: { context: 128000, output: 4096 },
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] }
  },
  "gpt-4o-mini": {
    name: "GPT-4o mini",
    limit: { context: 128000, output: 4096 },
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] }
  },
  "o1": {
    name: "o1",
    limit: { context: 200000, output: 100000 },
    capabilities: { tools: true, reasoning: true, input: ["text", "image"], output: ["text"] }
  }
};

for (const f of [jsoncFile, jsonFile, opencodeJsonFile]) {
  if (fs.existsSync(f)) {
    try {
      const cfg = parseJ(fs.readFileSync(f, 'utf8'));
      cfg.x_nanami_codex = meta;
      if (!cfg.provider) cfg.provider = {};
      if (!cfg.provider.openai) {
        cfg.provider.openai = {
          name: "OpenAI / ChatGPT",
          models: defaultModels
        };
      } else {
        cfg.provider.openai.models = { ...defaultModels, ...(cfg.provider.openai.models || {}) };
      }
      fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\\n', 'utf8');
    } catch {}
  }
}
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
  const configRes = (await readOpencodeConfig("global", "")) as OpencodeConfigFile;
  let raw = configRes?.content?.trim()
    ? configRes.content
    : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';

  const parsed = parse(raw) as Record<string, unknown>;
  const enabled = Array.isArray(parsed?.enabled_providers) ? (parsed.enabled_providers as string[]) : [];
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
      "o1": {
        name: "o1",
        limit: { context: 200000, output: 100000 },
        capabilities: { tools: true, reasoning: true, input: ["text", "image"], output: ["text"] },
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

  await writeOpencodeConfig("global", "", raw);
}
