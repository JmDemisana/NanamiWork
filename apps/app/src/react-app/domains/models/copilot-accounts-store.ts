import { create } from "zustand";
import {
  desktopFetchViaMain,
  getCachedDesktopHomeDir,
  readOpencodeConfig,
  writeOpencodeConfig,
  type OpencodeConfigFile,
} from "@/app/lib/desktop";
import { applyEdits, modify, parse } from "jsonc-parser";

async function getNanamiConfigDir(): Promise<string> {
  const home = (await getCachedDesktopHomeDir()) || "C:/Users/jmdem";
  return `${home.replace(/\\/g, "/")}/.config/nanamiwork`;
}

const GITHUB_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe81";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const GITHUB_USER_URL = "https://api.github.com/user";

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
};

export type CopilotDeviceFlowState = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

type CopilotAccountsStore = {
  account: CopilotAccountInfo | null;
  loading: boolean;
  error: string | null;
  deviceFlow: CopilotDeviceFlowState | null;
  isConnecting: boolean;
  modalOpen: boolean;

  setModalOpen: (open: boolean) => void;
  loadAccount: () => Promise<void>;
  startDeviceFlow: () => Promise<CopilotDeviceFlowState | null>;
  cancelDeviceFlow: () => void;
  pollDeviceFlow: () => Promise<boolean>;
  refreshCopilotToken: () => Promise<string | null>;
  disconnect: () => Promise<void>;
};

let activePollAbortController: AbortController | null = null;

export const useCopilotAccountsStore = create<CopilotAccountsStore>((set, get) => ({
  account: null,
  loading: false,
  error: null,
  deviceFlow: null,
  isConnecting: false,
  modalOpen: false,

  setModalOpen: (open) => set({ modalOpen: open }),

  loadAccount: async () => {
    try {
      set({ loading: true, error: null });
      const configDir = await getNanamiConfigDir();
      const configRes = (await readOpencodeConfig("project", configDir)) as OpencodeConfigFile;
      if (!configRes?.content) {
        set({ account: null, loading: false });
        return;
      }

      const parsed = parse(configRes.content) as Record<string, unknown>;
      const copilotMeta = parsed?.x_nanami_copilot as CopilotAccountInfo | undefined;

      if (!copilotMeta?.oauthToken) {
        set({ account: null, loading: false });
        return;
      }

      set({ account: copilotMeta, loading: false });

      // If token is expired or expiring within 5 minutes, refresh it automatically
      const now = Math.floor(Date.now() / 1000);
      if (!copilotMeta.copilotToken || copilotMeta.expiresAt <= now + 300) {
        void get().refreshCopilotToken();
      }
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
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
            // Success! Save OAuth token and mint Copilot session token
            await setupCopilotIntegration(tokenData.access_token);
            set({ deviceFlow: null, isConnecting: false, modalOpen: false });
            await get().loadAccount();
            return true;
          }

          if (tokenData.error === "authorization_pending") {
            // User hasn't finished typing the code yet, keep waiting
          } else if (tokenData.error === "slow_down") {
            // Server requested slower polling
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

  refreshCopilotToken: async () => {
    const { account } = get();
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

      await updateOpencodeConfigWithCopilot(updatedAccount);
      set({ account: updatedAccount });
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

        // Remove provider github-copilot
        edits = modify(raw, ["provider", "github-copilot"], undefined, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        });
        raw = applyEdits(raw, edits);

        await writeOpencodeConfig("project", configDir, raw);
      }
      set({ account: null, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));

async function setupCopilotIntegration(oauthToken: string) {
  // 1. Fetch user profile
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

  // 2. Mint initial Copilot session token
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
  };

  await updateOpencodeConfigWithCopilot(account);
}

async function fetchCopilotModels(copilotToken: string): Promise<string[]> {
  try {
    const res = await desktopFetchViaMain(
      "https://api.githubcopilot.com/models",
      {
        headers: {
          "Authorization": `Bearer ${copilotToken}`,
          "Copilot-Integration-Id": "vscode-chat",
          "Editor-Version": "vscode/1.96.2",
          "Editor-Plugin-Version": "copilot-chat/0.22.4",
          "Accept": "application/json",
        },
      },
      10000,
    );
    if (res.ok) {
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      if (Array.isArray(data?.data)) {
        return data.data.map((m) => m.id).filter(Boolean);
      }
    }
  } catch (e) {
    console.warn("Could not fetch Copilot models list:", e);
  }
  return [];
}

async function updateOpencodeConfigWithCopilot(account: CopilotAccountInfo) {
  const configDir = await getNanamiConfigDir();
  const configRes = (await readOpencodeConfig("project", configDir)) as OpencodeConfigFile;
  let raw = configRes?.content?.trim()
    ? configRes.content
    : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';

  // 1. Update enabled_providers
  const parsed = parse(raw) as Record<string, unknown>;
  const enabled = Array.isArray(parsed?.enabled_providers) ? (parsed.enabled_providers as string[]) : [];
  if (!enabled.includes("github-copilot")) {
    const edits = modify(raw, ["enabled_providers"], [...enabled, "github-copilot"], {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    raw = applyEdits(raw, edits);
  }

  // 2. Fetch accessible models dynamically from GitHub Copilot backend
  const liveModelIds = await fetchCopilotModels(account.copilotToken);

  const defaultKnownModels: Record<string, { name: string; limit: { context: number; output: number }; capabilities: Record<string, unknown> }> = {
    "auto": {
      name: "Auto (Copilot Fusion)",
      limit: { context: 128000, output: 8192 },
      capabilities: {
        tools: true,
        input: ["text", "image"],
        output: ["text"],
      },
    },
    "gpt-4o": {
      name: "GPT-4o (Copilot Fusion)",
      limit: { context: 128000, output: 4096 },
      capabilities: {
        tools: true,
        input: ["text", "image"],
        output: ["text"],
      },
    },
    "gpt-4o-mini": {
      name: "GPT-4o mini (Copilot Fusion)",
      limit: { context: 128000, output: 4096 },
      capabilities: {
        tools: true,
        input: ["text", "image"],
        output: ["text"],
      },
    },
    "claude-3.5-sonnet": {
      name: "Claude 3.5 Sonnet (Copilot Fusion)",
      limit: { context: 200000, output: 8192 },
      capabilities: {
        tools: true,
        input: ["text", "image"],
        output: ["text"],
      },
    },
    "o1-mini": {
      name: "o1-mini (Copilot Fusion)",
      limit: { context: 128000, output: 65536 },
      capabilities: {
        tools: true,
        reasoning: true,
        input: ["text"],
        output: ["text"],
      },
    },
    "o1-preview": {
      name: "o1-preview (Copilot Fusion)",
      limit: { context: 128000, output: 32768 },
      capabilities: {
        tools: true,
        reasoning: true,
        input: ["text"],
        output: ["text"],
      },
    },
  };

  const configuredModels: Record<string, unknown> = {
    "auto": defaultKnownModels["auto"],
  };

  if (liveModelIds.length > 0) {
    for (const id of liveModelIds) {
      if (defaultKnownModels[id]) {
        configuredModels[id] = defaultKnownModels[id];
      } else {
        configuredModels[id] = {
          name: `${id} (Copilot Fusion)`,
          limit: { context: 128000, output: 8192 },
          capabilities: {
            tools: true,
            input: ["text"],
            output: ["text"],
          },
        };
      }
    }
  } else {
    // If /models query returned empty, fall back to known models
    Object.assign(configuredModels, defaultKnownModels);
  }

  // 3. Configure github-copilot provider with VS Code Copilot Fusion headers
  const copilotProviderConfig = {
    npm: "@ai-sdk/openai-compatible",
    name: "GitHub Copilot (Fusion)",
    options: {
      baseURL: "https://api.githubcopilot.com",
      apiKey: account.copilotToken,
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

  let edits = modify(raw, ["provider", "github-copilot"], copilotProviderConfig, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  raw = applyEdits(raw, edits);

  // 3. Store metadata under x_nanami_copilot
  edits = modify(raw, ["x_nanami_copilot"], account, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  raw = applyEdits(raw, edits);

  await writeOpencodeConfig("project", configDir, raw);
}
