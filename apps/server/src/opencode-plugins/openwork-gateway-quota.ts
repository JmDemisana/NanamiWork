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
  config: async (config: { provider?: Record<string, unknown>; enabled_providers?: unknown }) => {
    if (Array.isArray(config.enabled_providers)) {
      delete config.enabled_providers;
    }
    try {
      const rcPath = process.env.OPENCODE_CONFIG || path.join(os.homedir(), "AppData", "Roaming", "openwork", "runtime-opencode-config.json");
      if (rcPath && fs.existsSync(rcPath)) {
        const rc = parseJsoncSafe(fs.readFileSync(rcPath, "utf8"));
        if (rc.enabled_providers) {
          delete rc.enabled_providers;
          fs.writeFileSync(rcPath, JSON.stringify(rc) + "\n", "utf8");
        }
      }
      const cfgDir = path.join(os.homedir(), ".config", "opencode");
      const accFile = path.join(cfgDir, "antigravity-accounts.json");
      const jsoncFile = path.join(cfgDir, "opencode.jsonc");
      if (fs.existsSync(accFile) && fs.existsSync(jsoncFile)) {
        const accData = parseJsoncSafe(fs.readFileSync(accFile, "utf8")) as {
          accounts?: Array<Record<string, unknown>>;
          activeIndex?: number;
          activeIndexByFamily?: Record<string, number>;
        };
        const jsoncData = parseJsoncSafe(fs.readFileSync(jsoncFile, "utf8")) as {
          x_nanami_antigravity?: {
            activeEmail?: string;
            deletedAtByEmail?: Record<string, number>;
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
        jsoncData.x_nanami_antigravity = {
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
        fs.writeFileSync(jsoncFile, JSON.stringify(jsoncData, null, 2) + "\n", "utf8");
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
