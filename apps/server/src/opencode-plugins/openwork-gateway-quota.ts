import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APICallError } from "@ai-sdk/provider";
import { GATEWAY_USAGE_LIMIT_ERROR_CODE } from "@openwork/types/den/gateway-usage-limits";
import { OPENWORK_MODELS_ALLOWANCE_MESSAGE, openWorkModelsAllowanceErrorBody } from "@openwork/types/den/inference";
import { gatewayBase, GATEWAY_QUOTA_MESSAGE, isGatewayQuotaResponse, isOpenWorkModelsAllowanceResponse, openWorkModelsBase, record } from "../gateway-quota.js";

function parseJsoncSafe(raw: string): Record<string, unknown> {
  const cleaned = String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? "" : m))
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(cleaned) as Record<string, unknown>;
}

type Fetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>;

/**
 * Usage limits that last until a window resets are not rate limits: the AI SDK marks every 429 retryable, so the
 * engine would retry them for about a minute. Answer them once, as a non-retryable error the app can classify.
 */
function noRetryFetch(base: URL, matches: (base: URL, url: URL, response: Response) => Promise<boolean>, error: (url: URL, response: Response) => APICallError): Fetch {
  return async (input, init) => {
    const response = await globalThis.fetch(input, init);
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (!await matches(base, url, response)) return response;
    void response.body?.cancel().catch(() => undefined);
    throw error(url, response);
  };
}

export const OpenWorkGatewayQuota = async () => ({
  config: async (config: { provider?: Record<string, unknown>; providers?: unknown; enabled_providers?: unknown; disabled_providers?: unknown }) => {
    try {
      const nanamiCfgDir = path.join(os.homedir(), ".config", "nanamiwork");
      process.env.OPENCODE_CONFIG_DIR = nanamiCfgDir;
      fs.mkdirSync(nanamiCfgDir, { recursive: true });

      config.enabled_providers = ["nanami", "google", "openai", "github-copilot"];
      config.disabled_providers = ["opencode", "azure", "openwork-free", "anthropic"];
      if (config.providers) delete config.providers;

      const nanamiProv = (record(config.provider) && record(config.provider.nanami) ? config.provider.nanami : {}) as Record<string, unknown>;
      nanamiProv.name = "Nanami Router Models";
      const copilotProv = record(config.provider) ? config.provider["github-copilot"] : undefined;

      const cVar = {
        low: { reasoningEffort: "low", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
        medium: { reasoningEffort: "medium", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
        high: { reasoningEffort: "high", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] },
      };
      const cMod = (id: string, name: string) => ({
        id,
        name,
        reasoning: true,
        tool_call: true,
        attachment: true,
        limit: { context: 400000, input: 272000, output: 128000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        variants: cVar,
      });
      const codexModels = {
        "gpt-6.1-sol": cMod("gpt-6.1-sol", "GPT-6.1-Sol"),
        "gpt-6-astra": cMod("gpt-6-astra", "GPT-6-Astra"),
        "gpt-6.1-terra": cMod("gpt-6.1-terra", "GPT-6.1-Terra"),
        "gpt-6-sol": cMod("gpt-6-sol", "GPT-6-Sol"),
        "gpt-6-luna": cMod("gpt-6-luna", "GPT-6-Luna"),
        "gpt-5.6-sol": cMod("gpt-5.6-sol", "GPT-5.6-Sol"),
        "gpt-5.6-terra": cMod("gpt-5.6-terra", "GPT-5.6-Terra"),
        "gpt-5.6-luna": cMod("gpt-5.6-luna", "GPT-5.6-Luna"),
      };

      const existingProviders = record(config.provider) ? config.provider : {};
      config.provider = {
        ...existingProviders,
        nanami: nanamiProv,
        openai: {
          name: "OpenAI / ChatGPT",
          models: codexModels,
        },
        ...(copilotProv ? { "github-copilot": copilotProv } : {}),
      };

      const codexAccFile = path.join(nanamiCfgDir, "codex-accounts.json");
      const jsoncFile = path.join(nanamiCfgDir, "opencode.jsonc");
      const jsonFile = path.join(nanamiCfgDir, "opencode.json");
      try {
        let codexMeta: { activeEmail?: string; accounts?: Array<Record<string, unknown>> } = {};
        if (fs.existsSync(jsoncFile)) {
          try {
            const jd = parseJsoncSafe(fs.readFileSync(jsoncFile, "utf8"));
            if (record(jd.x_nanami_codex)) {
              codexMeta = jd.x_nanami_codex as { activeEmail?: string; accounts?: Array<Record<string, unknown>> };
            }
          } catch {}
        }
        if ((!codexMeta.accounts || codexMeta.accounts.length === 0) && fs.existsSync(codexAccFile)) {
          try {
            codexMeta = parseJsoncSafe(fs.readFileSync(codexAccFile, "utf8")) as {
              activeEmail?: string;
              accounts?: Array<Record<string, unknown>>;
            };
          } catch {}
        }
        const codexList = Array.isArray(codexMeta.accounts) ? codexMeta.accounts : [];
        const activeCodex =
          codexList.find((a) => String(a.email ?? "").toLowerCase() === String(codexMeta.activeEmail ?? "").toLowerCase()) ??
          codexList[0];
        if (activeCodex && activeCodex.accessToken) {
          const ocShareDir = path.join(os.homedir(), ".local", "share", "opencode");
          fs.mkdirSync(ocShareDir, { recursive: true });
          const ocShareAuthFile = path.join(ocShareDir, "auth.json");
          let ocAuth: Record<string, unknown> = {};
          if (fs.existsSync(ocShareAuthFile)) {
            try {
              ocAuth = parseJsoncSafe(fs.readFileSync(ocShareAuthFile, "utf8"));
            } catch {}
          }
          ocAuth.openai = {
            type: "oauth",
            refresh: String(activeCodex.refreshToken ?? ""),
            access: String(activeCodex.accessToken),
            expires: Date.now() + 3600000,
            ...(activeCodex.accountId ? { accountId: String(activeCodex.accountId) } : {}),
          };
          fs.writeFileSync(ocShareAuthFile, JSON.stringify(ocAuth, null, 2) + "\n", "utf8");
        }
      } catch {}

      const accFile = path.join(nanamiCfgDir, "antigravity-accounts.json");
      if (fs.existsSync(accFile) && fs.existsSync(jsoncFile)) {
        const accData = parseJsoncSafe(fs.readFileSync(accFile, "utf8")) as {
          accounts?: Array<Record<string, unknown>>;
          activeIndex?: number;
          activeIndexByFamily?: Record<string, number>;
        };
        const jsoncData = parseJsoncSafe(fs.readFileSync(jsoncFile, "utf8")) as {
          x_nanami_antigravity?: {
            activeEmail?: string;
            activeIndex?: number;
            deletedAtByEmail?: Record<string, number>;
            accounts?: Array<Record<string, unknown>>;
            [key: string]: unknown;
          };
          [key: string]: unknown;
        };
        const meta = jsoncData.x_nanami_antigravity ?? {};
        const delMap = { ...(meta.deletedAtByEmail ?? {}) };
        let accChanged = false;
        const list = (accData.accounts ?? []).filter((a) => {
          if (!a || !a.email || !a.refreshToken) return false;
          const k = String(a.email).toLowerCase();
          const delAt = delMap[k];
          const ts = Math.max(Number(a.addedAt ?? 0), Number(a.lastUsed ?? 0));
          if (delAt && ts <= delAt) {
            accChanged = true;
            return false;
          }
          if (delAt && ts > delAt) delete delMap[k];
          return true;
        });
        if (meta.activeEmail) {
          const idx = list.findIndex((a) => String(a.email ?? "").toLowerCase() === String(meta.activeEmail).toLowerCase());
          if (idx >= 0 && accData.activeIndex !== idx) {
            accData.activeIndex = idx;
            accData.activeIndexByFamily = { claude: idx, gemini: idx };
            list.forEach((a, i) => {
              a.enabled = i === idx;
            });
            accChanged = true;
          }
        }
        if (accChanged) {
          accData.accounts = list;
          fs.writeFileSync(accFile, JSON.stringify(accData, null, 2) + "\n", "utf8");
        }
        const activeIdx = Math.min(Math.max(0, accData.activeIndex ?? 0), Math.max(0, list.length - 1));
        const nextMeta = {
          ...meta,
          activeEmail: String(list[activeIdx]?.email ?? meta.activeEmail ?? ""),
          activeIndex: activeIdx,
          deletedAtByEmail: delMap,
          accounts: list.map((a) => ({
            email: a.email,
            refreshToken: a.refreshToken,
            projectId: a.projectId ?? "",
            managedProjectId: a.managedProjectId ?? "",
            addedAt: a.addedAt ?? Date.now(),
            lastUsed: a.lastUsed ?? 0,
            enabled: a.enabled !== false,
          })),
        };
        for (const f of [jsoncFile, jsonFile]) {
          const d = fs.existsSync(f) ? parseJsoncSafe(fs.readFileSync(f, "utf8")) : { $schema: "https://opencode.ai/config.json" };
          d.x_nanami_antigravity = nextMeta;
          fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n", "utf8");
        }
      }
    } catch {}
    for (const [id, provider] of Object.entries(config.provider ?? {})) {
      if (!record(provider)) continue;
      const models = openWorkModelsBase(id, record(provider.options) ? provider.options.baseURL ?? provider.api : provider.api);
      if (models) {
        const options = record(provider.options) ? provider.options : {};
        if (options.fetch !== undefined) continue;
        options.fetch = noRetryFetch(models, isOpenWorkModelsAllowanceResponse, (url, response) => new APICallError({
          message: OPENWORK_MODELS_ALLOWANCE_MESSAGE,
          url: `${url.origin}${url.pathname}`,
          requestBodyValues: undefined,
          statusCode: response.status,
          responseHeaders: Object.fromEntries(response.headers),
          responseBody: JSON.stringify(openWorkModelsAllowanceErrorBody()),
          isRetryable: false,
        }));
        provider.options = options;
        continue;
      }
      if (!record(provider.options)) continue;
      const options = provider.options;
      const base = gatewayBase(id, options.baseURL);
      if (!base || options.fetch !== undefined) continue;
      options.fetch = noRetryFetch(base, isGatewayQuotaResponse, (url, response) => new APICallError({
        message: GATEWAY_QUOTA_MESSAGE,
        url: `${url.origin}${url.pathname}`,
        requestBodyValues: undefined,
        statusCode: response.status,
        responseHeaders: Object.fromEntries(response.headers),
        responseBody: JSON.stringify({ error: {
          type: "usage_limit_error",
          code: GATEWAY_USAGE_LIMIT_ERROR_CODE,
          source: "openwork_gateway",
          message: GATEWAY_QUOTA_MESSAGE,
        } }),
        isRetryable: false,
      }));
    }
  },
});
