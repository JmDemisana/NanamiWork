/**
 * Nanami Gateway default provider integration.
 *
 * This fork routes every model through `https://nanami-ai.pages.dev/api/v1`,
 * an OpenAI-compatible router. The gateway exposes exactly two model ids
 * (`gemini-router` and `openrouter`) and rejects a `nanami/` prefix, so those
 * ids are also the ids the engine must send upstream.
 *
 * Local providers remain available by default. Set `OPENWORK_NANAMI_ONLY=1`
 * only when a gateway-only runtime is explicitly wanted.
 */
import type { OpencodeV2ProviderSpec } from "./managed-opencode-v2.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const NANAMI_PROVIDER_ID = "nanami";
export const NANAMI_GATEWAY_BASE_URL = "https://nanami-ai.pages.dev/api/v1";
export const NANAMI_API_KEY_ENV = "NANAMI_API_KEY";
/** Overrides the gateway base URL, e.g. a local proxy while developing. */
export const NANAMI_GATEWAY_URL_ENV = "NANAMI_GATEWAY_BASE_URL";
/** Enable gateway-only mode explicitly. The default keeps local provider routes available. */
export const NANAMI_ONLY_ENV = "OPENWORK_NANAMI_ONLY";

/** Both gateway models accept images, tools, and reasoning, and cap at 128k/16k. */
function nanamiModelConfig(): Record<string, unknown> {
  return {
    tool_call: true,
    reasoning: true,
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    capabilities: {
      tools: true,
      attachment: true,
      reasoning: true,
      input: { text: true, image: true },
      output: { text: true },
    },
    limit: { context: 128_000, output: 16_384 },
  };
}

export function nanamiOnlyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[NANAMI_ONLY_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

export function nanamiGatewayBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[NANAMI_GATEWAY_URL_ENV]?.trim();
  return override ? override.replace(/\/+$/, "") : NANAMI_GATEWAY_BASE_URL;
}

export function nanamiApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[NANAMI_API_KEY_ENV]?.trim();
  return fromEnv || configuredGatewayKey(env);
}

/**
 * Personal-fork convenience: reuse the Nanami key the person already has in the
 * OpenCode CLI config, so the desktop app works without a second copy of the
 * secret. The repo never contains a key.
 */
function configuredGatewayKey(env: NodeJS.ProcessEnv): string {
  const home = env.USERPROFILE?.trim() || env.HOME?.trim();
  if (!home) return "";
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const path = join(home, ".config", "opencode", name);
    const parsed = readJsonc(path);
    const provider = parsed?.provider;
    if (!isRecord(provider)) continue;
    const nanami = provider[NANAMI_PROVIDER_ID];
    if (!isRecord(nanami) || !isRecord(nanami.options)) continue;
    const apiKey = nanami.options.apiKey;
    if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonc(path: string): Record<string, unknown> | null {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(stripJsonComments(source));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Remove `//` and `/* *\/` comments outside string literals. */
function stripJsonComments(source: string): string {
  let out = "";
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

export function nanamiProviderSpec(apiKey: string, baseUrl = nanamiGatewayBaseUrl()): OpencodeV2ProviderSpec {
  return {
    id: NANAMI_PROVIDER_ID,
    name: "Nanami Gateway",
    baseUrl,
    apiKey,
    models: [
      { id: "gemini-router", name: "Gemini", config: nanamiModelConfig() },
      { id: "openrouter", name: "OpenRouter", config: nanamiModelConfig() },
    ],
  };
}

/**
 * Keep one Nanami provider spec and drop every other provider.
 *
 * An already-configured Nanami provider wins, so a key or base URL the person
 * set through Settings survives; a missing key falls back to `NANAMI_API_KEY`.
 */
export function enforceNanamiGateway(specs: readonly OpencodeV2ProviderSpec[], apiKey = nanamiApiKey()): OpencodeV2ProviderSpec[] {
  const configured = specs.find((spec) => spec.id === NANAMI_PROVIDER_ID);
  if (!configured) return [nanamiProviderSpec(apiKey)];
  return [{
    ...configured,
    name: configured.name || "Nanami Gateway",
    baseUrl: configured.baseUrl || nanamiGatewayBaseUrl(),
    apiKey: configured.apiKey || apiKey,
  }];
}

/** Add the local default gateway without hiding any independently configured provider. */
export function withNanamiGateway(specs: readonly OpencodeV2ProviderSpec[], apiKey = nanamiApiKey()): OpencodeV2ProviderSpec[] {
  const configured = specs.find((spec) => spec.id === NANAMI_PROVIDER_ID);
  const gateway = configured
    ? { ...configured, name: configured.name || "Nanami Gateway", baseUrl: configured.baseUrl || nanamiGatewayBaseUrl(), apiKey: configured.apiKey || apiKey }
    : nanamiProviderSpec(apiKey);
  return [...specs.filter((spec) => spec.id !== NANAMI_PROVIDER_ID), gateway];
}

/**
 * The same provider in the v1 (pre-v2 engine) config shape, which the runtime
 * config file and `opencode.jsonc` both use.
 */
export function nanamiLegacyProviderConfig(apiKey = nanamiApiKey(), baseUrl = nanamiGatewayBaseUrl()): Record<string, unknown> {
  const model = () => ({
    attachment: true,
    limit: { context: 128_000, output: 16_384 },
    modalities: {
      input: ["text", "image"],
      output: ["text"],
    },
    capabilities: {
      tools: true,
      attachment: true,
      reasoning: true,
      input: { text: true, image: true },
      output: { text: true },
    },
  });
  return {
    npm: "@ai-sdk/openai-compatible",
    name: "Nanami Gateway",
    options: { baseURL: baseUrl, apiKey },
    models: {
      "gemini-router": { name: "Gemini", ...model() },
      openrouter: { name: "OpenRouter", ...model() },
    },
  };
}
