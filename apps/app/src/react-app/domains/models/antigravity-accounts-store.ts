import { create } from "zustand";
import type { Client } from "@/app/types";
import {
  desktopFetchViaMain,
  getCachedDesktopHomeDir,
  readOpencodeConfig,
  writeOpencodeConfig,
  type OpencodeConfigFile,
} from "@/app/lib/desktop";
import { applyEdits, modify, parse } from "jsonc-parser";

const ANTIGRAVITY_CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const ANTIGRAVITY_CLIENT_SECRET = "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";
const ANTIGRAVITY_MODELS_ENDPOINT =
  "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
const ANTIGRAVITY_HUB_USER_AGENT =
  "antigravity/hub/2.24.0 (aidev_client; os_type=darwin; arch=arm64; cl=1000335682)";

export type ThinkingTier = "low" | "medium" | "high";

export type AntigravityModelItem = {
  familyKey: string;
  modelID: string;
  rawId: string;
  displayName: string;
  remainingFraction: number | null;
  resetTime: string | null;
  isPlusOnly?: boolean;
  supportsThinkingTier: boolean;
  tierModelIds?: Partial<Record<ThinkingTier, string>>;
};

export type AntigravityFamilyQuota = {
  family: string;
  label: string;
  remainingFraction: number;
  resetTime: string | null;
  period?: "5h" | "weekly";
};

export type AntigravityAccountInfo = {
  email: string;
  refreshToken: string;
  projectId: string;
  managedProjectId: string;
  addedAt: number;
  lastUsed: number;
  isActive: boolean;
  isPlus: boolean;
  models: AntigravityModelItem[];
  quotas: AntigravityFamilyQuota[];
  quotaLoading: boolean;
  quotaError: string | null;
  verificationRequired?: boolean;
  verificationUrl?: string;
  verificationReason?: string;
};

type RawStoredAccount = {
  email?: string;
  refreshToken?: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt?: number;
  lastUsed?: number;
  enabled?: boolean;
  verificationRequired?: boolean;
  verificationUrl?: string;
  verificationReason?: string;
};

type NanamiAntigravityMeta = {
  activeEmail?: string;
  activeIndex?: number;
  thinkingTier?: ThinkingTier;
  deletedAtByEmail?: Record<string, number>;
  accounts?: RawStoredAccount[];
};

export const DEFAULT_ANTIGRAVITY_IDE_MODELS: readonly AntigravityModelItem[] = [
  {
    familyKey: "gemini-3.8-flash",
    modelID: "antigravity-gemini-3.8-flash-high",
    rawId: "gemini-3.8-flash-high",
    displayName: "Gemini 3.8 Flash",
    remainingFraction: null,
    resetTime: null,
    supportsThinkingTier: true,
    tierModelIds: {
      low: "antigravity-gemini-3.8-flash-low",
      medium: "antigravity-gemini-3.8-flash-medium",
      high: "antigravity-gemini-3.8-flash-high",
    },
  },
  {
    familyKey: "claude-sonnet",
    modelID: "antigravity-claude-sonnet-4-6",
    rawId: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    remainingFraction: null,
    resetTime: null,
    supportsThinkingTier: true,
    tierModelIds: {
      low: "antigravity-claude-sonnet-4-6",
      medium: "antigravity-claude-sonnet-4-6",
      high: "antigravity-claude-sonnet-4-6",
    },
  },
  {
    familyKey: "claude-opus",
    modelID: "antigravity-claude-opus-4-6-thinking",
    rawId: "claude-opus-4-6-thinking",
    displayName: "Claude Opus 4.6",
    remainingFraction: null,
    resetTime: null,
    supportsThinkingTier: true,
    tierModelIds: {
      low: "antigravity-claude-opus-4-6-thinking",
      medium: "antigravity-claude-opus-4-6-thinking",
      high: "antigravity-claude-opus-4-6-thinking",
    },
  },
  {
    familyKey: "gpt-oss-120b",
    modelID: "antigravity-gpt-oss-120b-medium",
    rawId: "gpt-oss-120b-medium",
    displayName: "GPT-OSS 120B",
    remainingFraction: null,
    resetTime: null,
    supportsThinkingTier: false,
  },
];

export function resolveAntigravityModelForTier(
  item: AntigravityModelItem,
  tier: ThinkingTier,
): string {
  return item.tierModelIds?.[tier] ?? item.modelID;
}

export function findAntigravityModelItem(
  models: readonly AntigravityModelItem[],
  modelID: string,
): AntigravityModelItem | undefined {
  return models.find(
    (m) =>
      m.modelID === modelID ||
      m.tierModelIds?.low === modelID ||
      m.tierModelIds?.medium === modelID ||
      m.tierModelIds?.high === modelID,
  );
}

export function extractThinkingTierFromModelId(
  modelID: string,
  fallback: ThinkingTier = "high",
): ThinkingTier {
  if (modelID.endsWith("-low")) return "low";
  if (modelID.endsWith("-medium") && !modelID.includes("gpt-oss")) return "medium";
  if (modelID.endsWith("-high")) return "high";
  return fallback;
}

export function formatQuotaResetShort(resetTime: string | null | undefined): string | null {
  if (!resetTime) return null;
  const target = Date.parse(resetTime);
  if (!Number.isFinite(target)) return null;
  const diffMs = target - Date.now();
  if (diffMs <= 0) return "Ready";
  const mins = Math.ceil(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) {
    const remMins = mins % 60;
    return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

async function getNanamiConfigDir(): Promise<string> {
  const home = (await getCachedDesktopHomeDir()) || "";
  return home ? `${home.replace(/\\/g, "/")}/.config/nanamiwork` : ".config/nanamiwork";
}

async function readNanamiMetaAndConfigDir(): Promise<{
  configDir: string;
  meta: NanamiAntigravityMeta;
}> {
  const configDir = await getNanamiConfigDir();
  let meta: NanamiAntigravityMeta = {};
  try {
    const res = (await readOpencodeConfig("project", configDir)) as OpencodeConfigFile;
    if (res?.content?.trim()) {
      const parsed = (parse(res.content) ?? {}) as {
        x_nanami_antigravity?: NanamiAntigravityMeta;
      };
      if (parsed.x_nanami_antigravity && typeof parsed.x_nanami_antigravity === "object") {
        meta = parsed.x_nanami_antigravity;
      }
    }
  } catch {}
  return { configDir, meta };
}

async function writeNanamiMeta(updater: (prev: NanamiAntigravityMeta) => NanamiAntigravityMeta): Promise<void> {
  try {
    const configDir = await getNanamiConfigDir();
    const res = (await readOpencodeConfig("project", configDir)) as OpencodeConfigFile;
    const raw = res?.content?.trim()
      ? res.content
      : "{\n  \"$schema\": \"https://opencode.ai/config.json\"\n}\n";
    const parsed = (parse(raw) ?? {}) as {
      x_nanami_antigravity?: NanamiAntigravityMeta;
    };
    const nextMeta = updater(parsed.x_nanami_antigravity ?? {});
    const edits = modify(raw, ["x_nanami_antigravity"], nextMeta, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    });
    await writeOpencodeConfig("project", configDir, applyEdits(raw, edits));
  } catch (err) {
    console.warn("Could not write x_nanami_antigravity metadata:", err);
  }
}

export async function syncDiskAccountsViaTerminal(
  action?: { type: "select"; email: string } | { type: "delete"; email: string },
): Promise<void> {
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
const accFile = path.join(cfgDir, 'antigravity-accounts.json');
const jsoncFile = path.join(cfgDir, 'opencode.jsonc');
const jsonFile = path.join(cfgDir, 'opencode.json');
const rcFile = path.join(home, 'AppData', 'Roaming', 'openwork', 'runtime-opencode-config.json');
const action = ${JSON.stringify(action ?? null)};

if (fs.existsSync(rcFile)) {
  try {
    const rc = parseJ(fs.readFileSync(rcFile, 'utf8'));
    rc.enabled_providers = ['nanami', 'google', 'openwork-free', 'openwork', 'opencode', 'github-copilot', 'openai'];
    rc.disabled_providers = ['azure', 'anthropic'];
    fs.writeFileSync(rcFile, JSON.stringify(rc) + '\\n', 'utf8');
  } catch {}
}

if (!fs.existsSync(accFile)) {
  fs.writeFileSync(accFile, JSON.stringify({ activeIndex: 0, accounts: [] }, null, 2) + '\n', 'utf8');
}
if (fs.existsSync(accFile)) {
  const data = parseJ(fs.readFileSync(accFile, 'utf8'));
  let meta = {};
  if (fs.existsSync(jsoncFile)) {
    try { meta = parseJ(fs.readFileSync(jsoncFile, 'utf8')).x_nanami_antigravity || {}; } catch {}
  }
  const delMap = { ...(meta.deletedAtByEmail || {}) };
  if (action && action.type === 'delete') {
    delMap[action.email.toLowerCase()] = Date.now();
  }
  if (Array.isArray(data.accounts)) {
    data.accounts = data.accounts.filter(a => {
      if (!a || !a.email || !a.refreshToken) return false;
      const k = String(a.email).toLowerCase();
      if (action && action.type === 'delete' && k === action.email.toLowerCase()) return false;
      const delAt = delMap[k];
      const ts = Math.max(a.addedAt || 0, a.lastUsed || 0);
      if (delAt && ts <= delAt) return false;
      if (delAt && ts > delAt) delete delMap[k];
      return true;
    });
    const targetEmail = (action && action.type === 'select') ? action.email : (meta.activeEmail || '');
    if (targetEmail) {
      const idx = data.accounts.findIndex(a => String(a.email || '').toLowerCase() === String(targetEmail).toLowerCase());
      if (idx >= 0) {
        data.activeIndex = idx;
        data.activeIndexByFamily = { claude: idx, gemini: idx };
        data.accounts.forEach((a) => { a.enabled = true; });
      }
    }
    const activeIdx = Math.min(Math.max(0, data.activeIndex ?? 0), Math.max(0, data.accounts.length - 1));
    data.activeIndex = activeIdx;
    fs.writeFileSync(accFile, JSON.stringify(data, null, 2) + '\\n', 'utf8');
    const activeEmail = data.accounts[activeIdx]?.email || '';
    data.accounts.forEach(a => {
      a.enabled = !a.verificationRequired;
    });
    const sanitized = data.accounts.map(a => ({
      email: a.email,
      refreshToken: a.refreshToken,
      projectId: a.projectId || '',
      managedProjectId: a.managedProjectId || '',
      addedAt: a.addedAt || Date.now(),
      lastUsed: a.lastUsed || 0,
      enabled: !a.verificationRequired,
      verificationRequired: Boolean(a.verificationRequired),
      verificationUrl: a.verificationUrl || '',
      verificationReason: a.verificationReason || '',
    }));
    for (const f of [jsoncFile, jsonFile]) {
      const cfg = fs.existsSync(f) ? parseJ(fs.readFileSync(f, 'utf8')) : { $schema: 'https://opencode.ai/config.json' };
      cfg.x_nanami_antigravity = {
        ...meta,
        activeEmail,
        activeIndex: activeIdx,
        deletedAtByEmail: delMap,
        accounts: sanitized,
      };
      fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\\n', 'utf8');
    }
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
    console.warn("Could not sync antigravity-accounts.json via terminal:", err);
  }
}

async function fetchAccountModelsAndQuota(
  account: AntigravityAccountInfo,
  thinkingTier: ThinkingTier,
): Promise<{
  isPlus: boolean;
  models: AntigravityModelItem[];
  quotas: AntigravityFamilyQuota[];
  verificationRequired?: boolean;
  verificationUrl?: string;
  verificationReason?: string;
}> {
  const tokenBody = new URLSearchParams({
    client_id: ANTIGRAVITY_CLIENT_ID,
    client_secret: ANTIGRAVITY_CLIENT_SECRET,
    refresh_token: account.refreshToken,
    grant_type: "refresh_token",
  }).toString();

  const tokenRes = await desktopFetchViaMain(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    },
    10_000,
  );
  if (!tokenRes.ok) {
    throw new Error(`OAuth token refresh failed (${tokenRes.status})`);
  }
  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) {
    throw new Error("Missing access_token from Google OAuth");
  }

  const project = account.projectId || account.managedProjectId || "aicode-consumers";
  const modelsRes = await desktopFetchViaMain(
    ANTIGRAVITY_MODELS_ENDPOINT,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
        "User-Agent": ANTIGRAVITY_HUB_USER_AGENT,
      },
      body: JSON.stringify({ project }),
    },
    12_000,
  );
  if (!modelsRes.ok) {
    if (modelsRes.status === 403) {
      const errText = await modelsRes.text().catch(() => "");
      const match = errText.match(/https:\/\/accounts\.google\.com\/[^\s"'<>]+/i);
      return {
        isPlus: false,
        models: [],
        quotas: [],
        verificationRequired: true,
        verificationUrl: match?.[0] || undefined,
        verificationReason: "Google requires account verification before this account can be used with Antigravity.",
      };
    }
    throw new Error(`fetchAvailableModels failed (${modelsRes.status})`);
  }
  const payload = (await modelsRes.json()) as {
    models?: Record<
      string,
      {
        displayName?: string;
        disabled?: boolean;
        quotaInfo?: { remainingFraction?: number; resetTime?: string };
      }
    >;
  };

  const modelsMap = payload.models ?? {};

  const parseQuotaAny = (...rawIds: string[]): { remainingFraction: number; resetTime: string | null } => {
    for (const rawId of rawIds) {
      const entry = modelsMap[rawId];
      if (!entry || entry.disabled) continue;
      const info = entry.quotaInfo;
      if (!info) continue;
      const frac =
        typeof info.remainingFraction === "number" && Number.isFinite(info.remainingFraction)
          ? Math.max(0, Math.min(1, info.remainingFraction))
          : 0;
      return { remainingFraction: frac, resetTime: info.resetTime ?? null };
    }
    return { remainingFraction: 0, resetTime: null };
  };

  // Detect Plus plan: Gemini 4 Argon is enabled on Plus/Pro accounts and disabled on Free accounts
  const argonHighEntry = modelsMap["gemini-4-argon-high"] ?? modelsMap["gemini-4-argon-medium"] ?? modelsMap["gemini-4-argon"];
  const isPlus = Boolean(argonHighEntry && !argonHighEntry.disabled);

  const hasClaude55 = Boolean(modelsMap["claude-opus-5-5-high"] || modelsMap["claude-sonnet-5-5-high"]);

  // Fetch official user quota summary from Google's internal quota service
  // to reflect authentic 5h and weekly limit buckets.
  type QuotaSummaryResponse = {
    groups?: Array<{
      displayName?: string;
      buckets?: Array<{
        bucketId?: string;
        window?: string;
        remainingFraction?: number;
        resetTime?: string;
      }>;
    }>;
  };
  let quotaSummary: QuotaSummaryResponse | null = null;

  try {
    const summaryRes = await desktopFetchViaMain(
      "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
          "User-Agent": ANTIGRAVITY_HUB_USER_AGENT,
        },
        body: JSON.stringify({ project }),
      },
      10_000,
    );
    if (summaryRes.ok) {
      quotaSummary = (await summaryRes.json()) as typeof quotaSummary;
    }
  } catch {}

  const findBucket = (bucketId: string) => {
    const summary = quotaSummary as QuotaSummaryResponse | null;
    for (const group of summary?.groups ?? []) {
      for (const bucket of group.buckets ?? []) {
        if (bucket.bucketId === bucketId) {
          const frac =
            typeof bucket.remainingFraction === "number" && Number.isFinite(bucket.remainingFraction)
              ? Math.max(0, Math.min(1, bucket.remainingFraction))
              : null;
          return {
            remainingFraction: frac,
            resetTime: bucket.resetTime ?? null,
          };
        }
      }
    }
    return null;
  };

  const geminiWeeklyBucket = findBucket("gemini-weekly");
  const gemini5hBucket = findBucket("gemini-5h");
  const thirdPartyWeeklyBucket = findBucket("3p-weekly");
  const thirdParty5hBucket = findBucket("3p-5h");
  const argonWeeklyBucket = findBucket("gemini-argon-wtu-weekly");

  const argonQuota = parseQuotaAny(
    "gemini-4-argon-high",
    "gemini-4-argon-medium",
    "gemini-4-argon-low",
    "gemini-4-argon",
  );
  const flashQuota = parseQuotaAny(
    "gemini-3.8-flash-high",
    "gemini-3.8-flash-medium",
    "gemini-3.8-flash-low",
    "gemini-3.8-flash-tiered",
    "gemini-3-flash",
  );
  const claudeQuota = parseQuotaAny(
    "claude-opus-5-5-high",
    "claude-sonnet-5-5-high",
    "claude-opus-4-6-thinking",
    "claude-sonnet-4-6",
    "gpt-oss-120b-medium",
  );

  const resolvedModels: AntigravityModelItem[] = [];

  const effectiveArgonFraction = argonWeeklyBucket?.remainingFraction ?? argonQuota.remainingFraction;
  const effectiveArgonReset = argonWeeklyBucket?.resetTime ?? argonQuota.resetTime;

  const effectiveFlashWeeklyFraction = geminiWeeklyBucket?.remainingFraction ?? flashQuota.remainingFraction;
  const effectiveFlashWeeklyReset = geminiWeeklyBucket?.resetTime ?? argonQuota.resetTime ?? flashQuota.resetTime;

  const effectiveFlash5hFraction = gemini5hBucket?.remainingFraction ?? flashQuota.remainingFraction;
  const effectiveFlash5hReset = gemini5hBucket?.resetTime ?? flashQuota.resetTime;

  const effectiveClaudeWeeklyFraction = thirdPartyWeeklyBucket?.remainingFraction ?? claudeQuota.remainingFraction;
  const effectiveClaudeWeeklyReset = thirdPartyWeeklyBucket?.resetTime ?? claudeQuota.resetTime;

  const effectiveClaude5hFraction = thirdParty5hBucket?.remainingFraction ?? 1.0;
  const effectiveClaude5hReset = thirdParty5hBucket?.resetTime ?? null;

  if (isPlus) {
    const argonTierIds: Record<ThinkingTier, string> = {
      low: "antigravity-gemini-4-argon-low",
      medium: "antigravity-gemini-4-argon-medium",
      high: "antigravity-gemini-4-argon-high",
    };
    resolvedModels.push({
      familyKey: "gemini-4-argon",
      modelID: argonTierIds[thinkingTier],
      rawId: `gemini-4-argon-${thinkingTier}`,
      displayName: "Gemini 4 Argon",
      remainingFraction: effectiveArgonFraction,
      resetTime: effectiveArgonReset,
      isPlusOnly: true,
      supportsThinkingTier: true,
      tierModelIds: argonTierIds,
    });
  }

  const flashTierIds: Record<ThinkingTier, string> = {
    low: "antigravity-gemini-3.8-flash-low",
    medium: "antigravity-gemini-3.8-flash-medium",
    high: "antigravity-gemini-3.8-flash-high",
  };
  resolvedModels.push({
    familyKey: "gemini-3.8-flash",
    modelID: flashTierIds[thinkingTier],
    rawId: `gemini-3.8-flash-${thinkingTier}`,
    displayName: "Gemini 3.8 Flash",
    remainingFraction: effectiveFlashWeeklyFraction,
    resetTime: effectiveFlashWeeklyReset,
    supportsThinkingTier: true,
    tierModelIds: flashTierIds,
  });

  if (hasClaude55) {
    const sonnet55TierIds: Record<ThinkingTier, string> = {
      low: "antigravity-claude-sonnet-5-5-low",
      medium: "antigravity-claude-sonnet-5-5-medium",
      high: "antigravity-claude-sonnet-5-5-high",
    };
    const opus55TierIds: Record<ThinkingTier, string> = {
      low: "antigravity-claude-opus-5-5-low",
      medium: "antigravity-claude-opus-5-5-medium",
      high: "antigravity-claude-opus-5-5-high",
    };
    resolvedModels.push(
      {
        familyKey: "claude-sonnet",
        modelID: sonnet55TierIds[thinkingTier],
        rawId: `claude-sonnet-5-5-${thinkingTier}`,
        displayName: "Claude Sonnet 5.5",
        remainingFraction: effectiveClaudeWeeklyFraction,
        resetTime: effectiveClaudeWeeklyReset,
        supportsThinkingTier: true,
        tierModelIds: sonnet55TierIds,
      },
      {
        familyKey: "claude-opus",
        modelID: opus55TierIds[thinkingTier],
        rawId: `claude-opus-5-5-${thinkingTier}`,
        displayName: "Claude Opus 5.5",
        remainingFraction: effectiveClaudeWeeklyFraction,
        resetTime: effectiveClaudeWeeklyReset,
        supportsThinkingTier: true,
        tierModelIds: opus55TierIds,
      },
    );
  } else {
    resolvedModels.push(
      {
        familyKey: "claude-sonnet",
        modelID: "antigravity-claude-sonnet-4-6",
        rawId: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        remainingFraction: effectiveClaudeWeeklyFraction,
        resetTime: effectiveClaudeWeeklyReset,
        supportsThinkingTier: true,
        tierModelIds: {
          low: "antigravity-claude-sonnet-4-6",
          medium: "antigravity-claude-sonnet-4-6",
          high: "antigravity-claude-sonnet-4-6",
        },
      },
      {
        familyKey: "claude-opus",
        modelID: "antigravity-claude-opus-4-6-thinking",
        rawId: "claude-opus-4-6-thinking",
        displayName: "Claude Opus 4.6",
        remainingFraction: effectiveClaudeWeeklyFraction,
        resetTime: effectiveClaudeWeeklyReset,
        supportsThinkingTier: true,
        tierModelIds: {
          low: "antigravity-claude-opus-4-6-thinking",
          medium: "antigravity-claude-opus-4-6-thinking",
          high: "antigravity-claude-opus-4-6-thinking",
        },
      },
    );
  }

  resolvedModels.push({
    familyKey: "gpt-oss-120b",
    modelID: "antigravity-gpt-oss-120b-medium",
    rawId: "gpt-oss-120b-medium",
    displayName: "GPT-OSS 120B",
    remainingFraction: effectiveClaudeWeeklyFraction,
    resetTime: effectiveClaudeWeeklyReset,
    supportsThinkingTier: false,
  });

  const quotas: AntigravityFamilyQuota[] = [];
  if (isPlus) {
    quotas.push(
      {
        family: "gemini-argon",
        label: "Gemini 4 Argon",
        remainingFraction: effectiveArgonFraction,
        resetTime: effectiveArgonReset,
        period: "weekly",
      },
      {
        family: "gemini-flash-5h",
        label: "Gemini 3.8 Flash (5h)",
        remainingFraction: effectiveFlash5hFraction,
        resetTime: effectiveFlash5hReset,
        period: "5h",
      },
      {
        family: "gemini-flash-weekly",
        label: "Gemini 3.8 Flash (Weekly)",
        remainingFraction: effectiveFlashWeeklyFraction,
        resetTime: effectiveFlashWeeklyReset,
        period: "weekly",
      },
      {
        family: "claude-5h",
        label: "Claude & GPT-OSS (5h)",
        remainingFraction: effectiveClaude5hFraction,
        resetTime: effectiveClaude5hReset,
        period: "5h",
      },
      {
        family: "claude-weekly",
        label: "Claude & GPT-OSS (Weekly)",
        remainingFraction: effectiveClaudeWeeklyFraction,
        resetTime: effectiveClaudeWeeklyReset,
        period: "weekly",
      },
    );
  } else {
    // Free accounts: only weekly limits (no 5h replenish windows)
    quotas.push(
      {
        family: "gemini-flash-weekly",
        label: "Gemini 3.8 Flash (Weekly)",
        remainingFraction: effectiveFlashWeeklyFraction,
        resetTime: effectiveFlashWeeklyReset,
        period: "weekly",
      },
      {
        family: "claude-weekly",
        label: "Claude & GPT-OSS (Weekly)",
        remainingFraction: effectiveClaudeWeeklyFraction,
        resetTime: effectiveClaudeWeeklyReset,
        period: "weekly",
      },
    );
  }

  return { isPlus, models: resolvedModels, quotas, verificationRequired: false };
}

type AntigravityAccountsState = {
  accounts: AntigravityAccountInfo[];
  selectedModel: { providerID: string; modelID: string } | null;
  thinkingTier: ThinkingTier;
  loading: boolean;
  lastLoadedAt: number | null;
  setSelectedModel: (model: { providerID: string; modelID: string } | null) => void;
  setThinkingTier: (tier: ThinkingTier) => Promise<void>;
  loadAccounts: (client?: Client | null) => Promise<AntigravityAccountInfo[]>;
  refreshQuotas: () => Promise<void>;
  selectAccount: (email: string, client?: Client | null) => Promise<void>;
  deleteAccount: (email: string, client?: Client | null) => Promise<void>;
  modalOpen: boolean;
  authUrl: string | null;
  isConnecting: boolean;
  error: string | null;
  setModalOpen: (open: boolean) => void;
  setAuthUrl: (url: string | null) => void;
  setIsConnecting: (connecting: boolean) => void;
  setError: (error: string | null) => void;
};

let latestClient: Client | null = null;

export const useAntigravityAccountsStore = create<AntigravityAccountsState>((set, get) => ({
  accounts: [],
  selectedModel: null,
  thinkingTier: "high",
  loading: false,
  lastLoadedAt: null,
  modalOpen: false,
  authUrl: null,
  isConnecting: false,
  error: null,

  setModalOpen: (open) => set({ modalOpen: open }),
  setAuthUrl: (url) => set({ authUrl: url }),
  setIsConnecting: (connecting) => set({ isConnecting: connecting }),
  setError: (error) => set({ error }),

  setSelectedModel: (model) => set({ selectedModel: model }),

  setThinkingTier: async (tier) => {
    set((state) => ({
      thinkingTier: tier,
      accounts: state.accounts.map((acc) => ({
        ...acc,
        models: acc.models.map((m) => ({
          ...m,
          modelID: resolveAntigravityModelForTier(m, tier),
        })),
      })),
    }));
    await writeNanamiMeta((prev) => ({
      ...prev,
      thinkingTier: tier,
    }));
  },

  loadAccounts: async (client) => {
    if (client) latestClient = client;
    set({ loading: true });

    try {
      let { meta } = await readNanamiMetaAndConfigDir();

      const savedTier: ThinkingTier =
        meta.thinkingTier === "low" || meta.thinkingTier === "medium" || meta.thinkingTier === "high"
          ? meta.thinkingTier
          : get().thinkingTier;

      const deletedMap = meta.deletedAtByEmail ?? {};
      const rawList = (meta.accounts ?? []).filter((acc) => {
        if (!acc?.refreshToken || !acc?.email) return false;
        const emailKey = acc.email.toLowerCase();
        const deletedAt = deletedMap[emailKey];
        const latestTs = Math.max(acc.addedAt ?? 0, acc.lastUsed ?? 0);
        if (deletedAt && latestTs <= deletedAt) {
          return false;
        }
        return true;
      });

      const prevByEmail = new Map(
        get().accounts.map((a) => [a.email.toLowerCase(), a]),
      );

      const preferredEmail =
        meta.activeEmail?.toLowerCase() ||
        rawList[meta.activeIndex ?? 0]?.email?.toLowerCase() ||
        rawList.find((a) => a.enabled !== false)?.email?.toLowerCase() ||
        rawList[0]?.email?.toLowerCase();

      const nextAccounts: AntigravityAccountInfo[] = rawList.map((raw) => {
        const email = raw.email!;
        const lower = email.toLowerCase();
        const existing = prevByEmail.get(lower);
        return {
          email,
          refreshToken: raw.refreshToken!,
          projectId: raw.projectId ?? "",
          managedProjectId: raw.managedProjectId ?? "",
          addedAt: raw.addedAt ?? Date.now(),
          lastUsed: raw.lastUsed ?? 0,
          isActive: lower === preferredEmail,
          isPlus: existing?.isPlus ?? false,
          models: existing?.models?.length
            ? existing.models.map((m) => ({
                ...m,
                modelID: resolveAntigravityModelForTier(m, savedTier),
              }))
            : DEFAULT_ANTIGRAVITY_IDE_MODELS.map((m) => ({
                ...m,
                modelID: resolveAntigravityModelForTier(m, savedTier),
              })),
          quotas: existing?.quotas ?? [],
          quotaLoading: existing ? existing.quotaLoading : true,
          quotaError: null,
          verificationRequired: Boolean(raw.verificationRequired ?? existing?.verificationRequired),
          verificationUrl: raw.verificationUrl || existing?.verificationUrl,
          verificationReason: raw.verificationReason || existing?.verificationReason,
        };
      });

      if (nextAccounts.length > 0 && !nextAccounts.some((a) => a.isActive)) {
        nextAccounts[0].isActive = true;
      }

      set({
        accounts: nextAccounts,
        thinkingTier: savedTier,
        loading: false,
        lastLoadedAt: Date.now(),
      });

      void get().refreshQuotas();
      return nextAccounts;
    } catch (err) {
      console.warn("Could not load Antigravity accounts:", err);
      set({ loading: false });
      return get().accounts;
    }
  },

  refreshQuotas: async () => {
    const current = get().accounts;
    const tier = get().thinkingTier;
    if (current.length === 0) return;

    set({
      accounts: current.map((a) => ({ ...a, quotaLoading: true, quotaError: null })),
    });

    await Promise.all(
      current.map(async (account) => {
        try {
          const result = await fetchAccountModelsAndQuota(account, tier);
          set((state) => ({
            accounts: state.accounts.map((item) =>
              item.email.toLowerCase() === account.email.toLowerCase()
                ? {
                    ...item,
                    isPlus: result.isPlus,
                    models: result.models.map((m) => ({
                      ...m,
                      modelID: resolveAntigravityModelForTier(m, state.thinkingTier),
                    })),
                    quotas: result.quotas,
                    quotaLoading: false,
                    quotaError: null,
                  }
                : item,
            ),
          }));
        } catch (err) {
          set((state) => ({
            accounts: state.accounts.map((item) =>
              item.email.toLowerCase() === account.email.toLowerCase()
                ? {
                    ...item,
                    quotaLoading: false,
                    quotaError: err instanceof Error ? err.message : String(err),
                  }
                : item,
            ),
          }));
        }
      }),
    );
  },

  selectAccount: async (email, client) => {
    if (client) latestClient = client;
    const activeClient = client ?? latestClient;
    const lower = email.toLowerCase();
    const currentAccounts = get().accounts;
    const target = currentAccounts.find((a) => a.email.toLowerCase() === lower);
    if (!target) return;
    const wasAlreadyActive = target.isActive;

    set({
      selectedModel: {
        providerID: "google",
        modelID: target.models[0]?.modelID || "antigravity-gemini-3.8-flash-high",
      },
      accounts: currentAccounts.map((a) => {
        const isThis = a.email.toLowerCase() === lower;
        return {
          ...a,
          isActive: isThis,
          quotas: isThis && a.quotas.length > 0 ? a.quotas : a.quotas,
          quotaLoading: isThis && a.quotas.length === 0,
        };
      }),
    });

    const activeIndex = Math.max(
      0,
      currentAccounts.findIndex((a) => a.email.toLowerCase() === lower),
    );
    await writeNanamiMeta((prev) => ({
      ...prev,
      activeEmail: target.email,
      activeIndex,
      accounts: (prev.accounts ?? []).map((a, i) => ({
        ...a,
        enabled: true,
      })),
    }));

    if (!wasAlreadyActive) {
      try {
        await activeClient?.auth.set({
          providerID: "google",
          auth: {
            type: "oauth",
            refresh: `${target.refreshToken}|${target.projectId || ""}|${target.managedProjectId || ""}`,
            access: "",
            expires: 0,
          },
        });
      } catch {}
      try {
        await activeClient?.instance.dispose();
      } catch {}
    }

    const tier = get().thinkingTier;
    void fetchAccountModelsAndQuota(target, tier)
      .then((result) => {
        set((state) => ({
          accounts: state.accounts.map((item) =>
            item.email.toLowerCase() === lower
              ? {
                  ...item,
                  isPlus: result.isPlus,
                  models: result.models.map((m) => ({
                    ...m,
                    modelID: resolveAntigravityModelForTier(m, state.thinkingTier),
                  })),
                  quotas: result.quotas,
                  quotaLoading: false,
                  quotaError: null,
                }
              : item,
          ),
        }));
      })
      .catch((err) => {
        set((state) => ({
          accounts: state.accounts.map((item) =>
            item.email.toLowerCase() === lower
              ? {
                  ...item,
                  quotaLoading: false,
                  quotaError: err instanceof Error ? err.message : String(err),
                }
              : item,
          ),
        }));
      });
  },

  deleteAccount: async (email, client) => {
    if (client) latestClient = client;
    const activeClient = client ?? latestClient;
    const lower = email.toLowerCase();
    const remaining = get().accounts.filter((a) => a.email.toLowerCase() !== lower);
    if (remaining.length > 0 && !remaining.some((a) => a.isActive)) {
      remaining[0] = { ...remaining[0], isActive: true };
    }
    const nextActive = remaining.find((a) => a.isActive);

    set({ accounts: remaining });

    await writeNanamiMeta((prev) => ({
      ...prev,
      activeEmail: nextActive?.email ?? "",
      activeIndex: 0,
      deletedAtByEmail: {
        ...(prev.deletedAtByEmail ?? {}),
        [lower]: Date.now(),
      },
      accounts: (prev.accounts ?? []).filter(
        (a) => String(a.email ?? "").toLowerCase() !== lower,
      ),
    }));

    try {
      if (nextActive) {
        await activeClient?.auth.set({
          providerID: "google",
          auth: {
            type: "oauth",
            refresh: `${nextActive.refreshToken}|${nextActive.projectId || ""}|${nextActive.managedProjectId || ""}`,
            access: "",
            expires: 0,
          },
        });
      } else {
        await activeClient?.auth.remove({ providerID: "google" });
      }
    } catch {}

    try {
      await activeClient?.instance.dispose();
    } catch {}
  },
}));
