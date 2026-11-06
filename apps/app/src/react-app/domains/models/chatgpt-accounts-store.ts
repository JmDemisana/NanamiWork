import { create } from "zustand";
import {
  desktopFetchViaMain,
  readOpencodeConfig,
  writeOpencodeConfig,
  type OpencodeConfigFile,
} from "@/app/lib/desktop";
import { applyEdits, modify, parse } from "jsonc-parser";

export type ChatGptAccountInfo = {
  apiKey: string;
  addedAt: number;
  label?: string;
};

type ChatGptAccountsStore = {
  account: ChatGptAccountInfo | null;
  loading: boolean;
  isConnecting: boolean;
  error: string | null;
  modalOpen: boolean;

  setModalOpen: (open: boolean) => void;
  loadAccount: () => Promise<void>;
  connectApiKey: (apiKey: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
};

export const useChatGptAccountsStore = create<ChatGptAccountsStore>((set, get) => ({
  account: null,
  loading: false,
  isConnecting: false,
  error: null,
  modalOpen: false,

  setModalOpen: (open) => set({ modalOpen: open, error: null }),

  loadAccount: async () => {
    try {
      set({ loading: true, error: null });
      const configRes = (await readOpencodeConfig("global", "")) as OpencodeConfigFile;
      if (!configRes?.content) {
        set({ account: null, loading: false });
        return;
      }

      const parsed = parse(configRes.content) as Record<string, unknown>;
      const openaiProvider = (parsed?.provider as Record<string, unknown> | undefined)?.openai as
        | { options?: { apiKey?: string } }
        | undefined;

      const apiKey = openaiProvider?.options?.apiKey;
      if (apiKey && typeof apiKey === "string") {
        set({
          account: {
            apiKey,
            addedAt: Date.now(),
            label: "OpenAI Account",
          },
          loading: false,
        });
      } else {
        set({ account: null, loading: false });
      }
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
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
          addedAt: Date.now(),
          label: "OpenAI Account",
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
        const edits = modify(raw, ["provider", "openai"], undefined, {
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
