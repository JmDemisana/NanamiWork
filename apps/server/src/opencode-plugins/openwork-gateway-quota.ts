import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APICallError } from "@ai-sdk/provider";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { GATEWAY_USAGE_LIMIT_ERROR_CODE } from "@openwork/types/den/gateway-usage-limits";
import { OPENWORK_MODELS_ALLOWANCE_MESSAGE, openWorkModelsAllowanceErrorBody } from "@openwork/types/den/inference";
import { gatewayBase, GATEWAY_QUOTA_MESSAGE, isGatewayQuotaResponse, isOpenWorkModelsAllowanceResponse, openWorkModelsBase, record } from "../gateway-quota.js";
import { codexAccessTokenExpiry, reconcileLocalRouterCodexAuth } from "../local-router-codex-auth.js";
import { localRouterProfilePaths } from "../local-router-profile.js";
import { createCopilotOAuthFetch } from "../copilot-oauth-fetch.js";

function parseJsoncSafe(raw: string): Record<string, unknown> {
  const cleaned = String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? "" : m))
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(cleaned) as Record<string, unknown>;
}

function writeConfigSection(file: string, key: string, value: unknown): void {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
  const errors: ParseError[] = [];
  const parsed: unknown = parse(raw, errors);
  if (errors.length || !record(parsed)) throw new Error("Cannot safely update invalid account settings.");
  const next = applyEdits(raw, modify(raw, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  if (next !== raw) fs.writeFileSync(file, next.endsWith("\n") ? next : `${next}\n`, "utf8");
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
      const nanamiCfgDir = process.env.OPENCODE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".config", "nanamiwork");
      fs.mkdirSync(nanamiCfgDir, { recursive: true });

      config.enabled_providers ??= ["nanami", "google", "openai", "github-copilot"];
      config.disabled_providers ??= ["opencode", "azure", "openwork-free", "anthropic"];

      const nanamiMod = (name: string) => ({
        name,
        tool_call: true,
        attachment: true,
        limit: { context: 128000, output: 16384 },
        modalities: { input: ["text", "image"], output: ["text"] },
        capabilities: {
          tools: true,
          attachment: true,
          reasoning: true,
          input: { text: true, image: true },
          output: { text: true },
        },
      });
      const nanamiUncensoredMod = {
        name: "Uncensored Models",
        tool_call: true,
        reasoning: false,
        attachment: false,
        limit: { context: 48000, input: 44000, output: 4096 },
        modalities: { input: ["text"], output: ["text"] },
        capabilities: { tools: true, attachment: false, input: { text: true }, output: { text: true } },
      };
      const nanamiProv = (record(config.provider) && record(config.provider.nanami) ? config.provider.nanami : {}) as Record<string, unknown>;
      nanamiProv.name ??= "Nanami Router Models";
      const existingNanamiModels = record(nanamiProv.models) ? { ...nanamiProv.models } : {};
      delete existingNanamiModels.openrouter;
      nanamiProv.models = {
        "gemini-router": nanamiMod("Gemini"),
        uncensored: nanamiUncensoredMod,
        ...existingNanamiModels,
      };
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
        capabilities: {
          tools: true,
          attachment: true,
          input: { text: true, image: true, pdf: true },
          output: { text: true },
        },
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
      const existingOpenai = record(existingProviders.openai) ? existingProviders.openai : {};
      config.provider = {
        ...existingProviders,
        nanami: nanamiProv,
        openai: {
          ...existingOpenai,
          name: existingOpenai.name ?? "OpenAI / ChatGPT",
          models: { ...codexModels, ...(record(existingOpenai.models) ? existingOpenai.models : {}) },
        },
        ...(copilotProv ? { "github-copilot": copilotProv } : {}),
      };

      for (const [pId, pObj] of Object.entries(config.provider ?? {})) {
        if (!record(pObj) || !record(pObj.models)) continue;
        for (const [mId, mObj] of Object.entries(pObj.models as Record<string, unknown>)) {
          if (!record(mObj)) continue;
          mObj.attachment = true;
          const mods = record(mObj.modalities) ? mObj.modalities : {};
          const inMods = Array.isArray(mods.input) ? [...mods.input] : ["text"];
          if (!inMods.includes("image")) inMods.push("image");
          mods.input = inMods;
          mods.output = mods.output ?? ["text"];
          mObj.modalities = mods;

          const caps = record(mObj.capabilities) ? mObj.capabilities : {};
          caps.tools = caps.tools ?? true;
          caps.attachment = true;
          const capIn = record(caps.input) ? caps.input : {};
          capIn.text = true;
          capIn.image = true;
          caps.input = capIn;
          caps.output = caps.output ?? { text: true };
          mObj.capabilities = caps;
        }
      }

      (config as Record<string, unknown>).permission ??= {
        "*": "allow",
        bash: "allow",
        shell: "allow",
        edit: "allow",
        read: "allow",
        external_directory: "allow",
        webfetch: "allow",
        websearch: "allow",
        doom_loop: "allow",
      };

      const codexAccFile = path.join(nanamiCfgDir, "codex-accounts.json");
      const jsoncFile = path.join(nanamiCfgDir, "opencode.jsonc");
      const jsonFile = path.join(nanamiCfgDir, "opencode.json");
      const nanamiDataDir = path.join(process.env.XDG_DATA_HOME?.trim() || path.join(nanamiCfgDir, "data"), "opencode");
      let maySyncCodexAuth = true;
      try {
        const privateProfile = localRouterProfilePaths(process.env);
        if (privateProfile) await reconcileLocalRouterCodexAuth(privateProfile);
        else if (process.env.NANAMIWORK_ISOLATED === "1") maySyncCodexAuth = false;
      } catch {
        // An ambiguous identity is not permission to overwrite a credential.
        maySyncCodexAuth = false;
      }
      try {
        let codexMeta: { activeEmail?: string; accounts?: Array<Record<string, unknown>> } = {};
        let copilotMeta: { activeUsername?: string; accounts?: Array<Record<string, unknown>> } = {};
        if (fs.existsSync(jsoncFile)) {
          try {
            const jd = parseJsoncSafe(fs.readFileSync(jsoncFile, "utf8"));
            if (record(jd.x_nanami_codex)) {
              codexMeta = jd.x_nanami_codex as { activeEmail?: string; accounts?: Array<Record<string, unknown>> };
            }
            if (record(jd.x_nanami_copilot)) {
              copilotMeta = jd.x_nanami_copilot as { activeUsername?: string; accounts?: Array<Record<string, unknown>> };
            }
          } catch {}
        }
        const copilotList = Array.isArray(copilotMeta.accounts) ? copilotMeta.accounts : [];
        const activeCopilot =
          copilotList.find((a) => String(a.username ?? "").toLowerCase() === String(copilotMeta.activeUsername ?? "").toLowerCase()) ??
          copilotList[0];
        if (activeCopilot && (activeCopilot.oauthToken || activeCopilot.copilotToken)) {
          const oauth = typeof activeCopilot.oauthToken === "string" ? activeCopilot.oauthToken : "";
          const copilotToken = typeof activeCopilot.copilotToken === "string" ? activeCopilot.copilotToken : "";
          config.provider = {
            ...(record(config.provider) ? config.provider : {}),
            "github-copilot": {
              npm: "@ai-sdk/openai-compatible",
              name: "GitHub Copilot",
              options: {
                baseURL: "https://api.githubcopilot.com",
                apiKey: copilotToken || oauth,
                ...(oauth ? { fetch: createCopilotOAuthFetch(oauth, { token: copilotToken, expiresAt: typeof activeCopilot.expiresAt === "number" ? activeCopilot.expiresAt : undefined }) } : {}),
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
              models: {
                "gpt-4.1": {
                  id: "gpt-4.1",
                  name: "Auto (Copilot)",
                  tool_call: true,
                  attachment: true,
                  limit: { context: 128000, output: 16384 },
                  modalities: {
                    input: ["text", "image"],
                    output: ["text"],
                  },
                  capabilities: {
                    tools: true,
                    attachment: true,
                    input: {
                      text: true,
                      image: true,
                    },
                    output: {
                      text: true,
                    },
                  },
                },
              },
            },
          };
        } else if (record(copilotProv) && record(copilotProv.options)) {
          const key = copilotProv.options.apiKey;
          if (typeof key === "string" && /^(gho_|ghu_|github_pat_)/.test(key.trim()) && copilotProv.options.fetch === undefined) {
            copilotProv.options.fetch = createCopilotOAuthFetch(key.trim());
          }
        }
        if ((!codexMeta.accounts || codexMeta.accounts.length === 0) && fs.existsSync(codexAccFile)) {
          try {
            codexMeta = parseJsoncSafe(fs.readFileSync(codexAccFile, "utf8")) as {
              activeEmail?: string;
              accounts?: Array<Record<string, unknown>>;
            };
            for (const f of [jsoncFile, jsonFile]) {
              writeConfigSection(f, "x_nanami_codex", codexMeta);
            }
          } catch {}
        } else if (codexMeta.accounts && codexMeta.accounts.length > 0) {
          try {
            fs.writeFileSync(codexAccFile, JSON.stringify(codexMeta, null, 2) + "\n", "utf8");
          } catch {}
        }
        const codexList = Array.isArray(codexMeta.accounts) ? codexMeta.accounts : [];
        const activeCodex =
          codexList.find((a) => String(a.email ?? "").toLowerCase() === String(codexMeta.activeEmail ?? "").toLowerCase()) ??
          codexList[0];
        if (maySyncCodexAuth && activeCodex && activeCodex.accessToken) {
          fs.mkdirSync(nanamiDataDir, { recursive: true });
          const nanamiAuthFile = path.join(nanamiDataDir, "auth.json");
          const nanamiRootAuthFile = path.join(nanamiCfgDir, "auth.json");
          let ocAuth: Record<string, unknown> = {};
          if (fs.existsSync(nanamiAuthFile)) {
            try {
              ocAuth = parseJsoncSafe(fs.readFileSync(nanamiAuthFile, "utf8"));
            } catch {}
          }
          ocAuth.openai = {
            type: "oauth",
            refresh: String(activeCodex.refreshToken ?? ""),
            access: String(activeCodex.accessToken),
            expires: codexAccessTokenExpiry(activeCodex.accessToken) ?? Date.now() + 60_000,
            ...(activeCodex.accountId ? { accountId: String(activeCodex.accountId) } : {}),
          };
          const authContent = JSON.stringify(ocAuth, null, 2) + "\n";
          fs.writeFileSync(nanamiAuthFile, authContent, "utf8");
          try {
            fs.writeFileSync(nanamiRootAuthFile, authContent, "utf8");
          } catch {}
        }
      } catch {}

      const antigravityJsonFile = path.join(nanamiCfgDir, "antigravity.json");
      try {
        const agCfg = fs.existsSync(antigravityJsonFile) ? parseJsoncSafe(fs.readFileSync(antigravityJsonFile, "utf8")) : {};
        agCfg.account_selection_strategy = "sticky";
        agCfg.soft_quota_threshold_percent = 100;
        fs.writeFileSync(antigravityJsonFile, JSON.stringify(agCfg, null, 2) + "\n", "utf8");
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
            accChanged = true;
          }
        }
        if (accChanged) {
          accData.accounts = list;
          fs.writeFileSync(accFile, JSON.stringify(accData, null, 2) + "\n", "utf8");
        }
        const activeIdx = Math.min(Math.max(0, accData.activeIndex ?? 0), Math.max(0, list.length - 1));
        const previousAccounts = Array.isArray(meta.accounts) ? meta.accounts.filter(record) : [];
        const listEmails = new Set(list.map((account) => String(account.email ?? "").toLowerCase()));
        const nextMeta = {
          ...meta,
          activeEmail: String(list[activeIdx]?.email ?? meta.activeEmail ?? ""),
          activeIndex: activeIdx,
          deletedAtByEmail: delMap,
          accounts: [...list.map((a) => ({
            ...(previousAccounts.find((previous) => String(previous.email ?? "").toLowerCase() === String(a.email ?? "").toLowerCase()) ?? {}),
            email: a.email,
            refreshToken: a.refreshToken,
            projectId: a.projectId ?? "",
            managedProjectId: a.managedProjectId ?? "",
            addedAt: a.addedAt ?? Date.now(),
            lastUsed: a.lastUsed ?? 0,
            enabled: a.enabled !== false,
            ...(a.verificationRequired !== undefined ? { verificationRequired: a.verificationRequired } : {}),
            ...(a.verificationUrl !== undefined ? { verificationUrl: a.verificationUrl } : {}),
            ...(a.verificationReason !== undefined ? { verificationReason: a.verificationReason } : {}),
          })), ...previousAccounts.filter((account) => {
            const email = String(account.email ?? "").toLowerCase();
            return Boolean(email && !listEmails.has(email) && !delMap[email]);
          })],
        };
        for (const f of [jsoncFile, jsonFile]) {
          writeConfigSection(f, "x_nanami_antigravity", nextMeta);
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
