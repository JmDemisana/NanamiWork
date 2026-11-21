import { create } from "zustand";
import type { ModelRef } from "@/app/types";
import {
  resolveAntigravityModelForTier,
  type AntigravityAccountInfo,
  type AntigravityModelItem,
  type ThinkingTier,
} from "./antigravity-accounts-store";
import type { ChatGptAccountInfo, ChatGptModelItem } from "./chatgpt-accounts-store";

export const ORCHESTRATOR_MODEL_ID = "orchestrator";
export const ORCHESTRATOR_PLAN_MARKER = "[NANAMI_ORCHESTRATOR_PLAN_PHASE]";

export const ORCHESTRATOR_PLAN_SYSTEM_PROMPT = `${ORCHESTRATOR_PLAN_MARKER}
You are the Planning Model in NanamiWork Orchestrator mode.
- Investigate using read-only tools only. Do not edit, write, patch, or delete files, and do not run state-changing commands.
- If the user only asked a question that needs no file edits or mutating commands, answer directly and do NOT call exit_plan_mode.
- Otherwise, produce a concrete step-by-step plan (exact file paths, changes, verification commands, and a "Replan if:" checklist), call exit_plan_mode({ plan }), and stop your turn so the Execution Model can carry it out.`;

export const ORCHESTRATOR_EXECUTE_SYSTEM_PROMPT = `[NANAMI_ORCHESTRATOR_EXECUTE_PHASE]
You are the Execution Model in NanamiWork Orchestrator mode.
- Execute the approved plan from the Planning Model above step by step.
- Verify your changes with tests or checks before finishing.
- If you hit a condition in the plan's "Replan if:" checklist or a blocker that requires a design change, stop and explain clearly what needs replanning.`;

export function isOrchestratorModel(model: ModelRef | null | undefined): boolean {
  return (
    model?.modelID === ORCHESTRATOR_MODEL_ID &&
    (model.providerID === "google" || model.providerID === "openai")
  );
}

export function isAntigravityOrchestratorSupported(
  account: Pick<AntigravityAccountInfo, "isPlus"> | null | undefined,
): boolean {
  return Boolean(account?.isPlus);
}

export function isChatGptOrchestratorSupported(
  account: Pick<ChatGptAccountInfo, "planType"> | null | undefined,
): boolean {
  return (
    account?.planType === "plus" ||
    account?.planType === "pro" ||
    account?.planType === "team"
  );
}

const ANTIGRAVITY_ALLOWED_FAMILY_PREFIXES = [
  "gemini-4-neon",
  "gemini-4-carbon",
  "gemini-4-argon",
  "gemini-4-hydrogen",
  "gemini-3.8-flash",
  "claude-sonnet",
  "claude-opus",
];

export type OrchestratorSelectableModel = {
  modelID: string;
  familyKey: string;
  displayName: string;
};

export function getAntigravityOrchestratorModels(
  account: Pick<AntigravityAccountInfo, "models">,
  thinkingTier: ThinkingTier,
): OrchestratorSelectableModel[] {
  return account.models
    .filter((m) =>
      ANTIGRAVITY_ALLOWED_FAMILY_PREFIXES.some(
        (prefix) => m.familyKey.startsWith(prefix) || m.rawId.startsWith(prefix),
      ),
    )
    .map((m) => ({
      modelID: resolveAntigravityModelForTier(m, thinkingTier),
      familyKey: m.familyKey,
      displayName: m.displayName,
    }));
}

export function getChatGptOrchestratorModels(
  account: Pick<ChatGptAccountInfo, "models">,
): OrchestratorSelectableModel[] {
  return account.models.map((m: ChatGptModelItem) => ({
    modelID: m.modelID,
    familyKey: m.modelID,
    displayName: m.displayName,
  }));
}

export type OrchestratorAccountConfig = {
  planningModelId: string;
  executionModelId: string;
};

export type OrchestratorTurnState = {
  phase: "planning" | "executing";
  providerID: "google" | "openai";
  accountEmail: string;
  planningModelId: string;
  executionModelId: string;
  variant: string | null;
  systemPromptBase: string;
  agent?: string;
};

const STORAGE_KEY = "openwork.orchestrator.v1";

function accountConfigKey(providerID: "google" | "openai", email: string): string {
  return `${providerID}:${email.trim().toLowerCase()}`;
}

function readStoredConfigs(): Record<string, OrchestratorAccountConfig> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, OrchestratorAccountConfig> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const p = Reflect.get(v, "planningModelId");
      const e = Reflect.get(v, "executionModelId");
      if (typeof p === "string" && typeof e === "string") {
        out[k] = { planningModelId: p, executionModelId: e };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeStoredConfigs(configs: Record<string, OrchestratorAccountConfig>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  } catch {}
}

function findMatchingModel(
  models: readonly OrchestratorSelectableModel[],
  savedId: string | undefined,
  preferredPrefixes: readonly string[],
): OrchestratorSelectableModel | undefined {
  if (savedId) {
    const exact = models.find((m) => m.modelID === savedId || m.familyKey === savedId);
    if (exact) return exact;
    const base = savedId.replace(/-(low|medium|high)$/, "");
    const byBase = models.find((m) => m.familyKey === base || m.modelID.startsWith(base));
    if (byBase) return byBase;
  }
  for (const prefix of preferredPrefixes) {
    const found = models.find((m) => m.familyKey.startsWith(prefix) || m.modelID.includes(prefix));
    if (found) return found;
  }
  return models[0];
}

export function resolveOrchestratorPair(
  providerID: "google" | "openai",
  email: string,
  models: readonly OrchestratorSelectableModel[],
  saved?: OrchestratorAccountConfig,
): OrchestratorAccountConfig | null {
  if (models.length === 0) return null;
  const planPrefs =
    providerID === "google"
      ? ["gemini-4-argon", "gemini-4-neon", "gemini-4-carbon", "claude-opus", "claude-sonnet", "gemini-4-hydrogen", "gemini-3.8-flash"]
      : ["gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-sol"];
  const execPrefs =
    providerID === "google"
      ? ["gemini-4-neon", "gemini-4-hydrogen", "gemini-3.8-flash", "claude-sonnet", "gemini-4-argon", "gemini-4-carbon"]
      : ["gpt-6-luna", "gpt-5.6-luna", "gpt-6.1-terra", "gpt-5.6-terra"];

  const plan = findMatchingModel(models, saved?.planningModelId, planPrefs);
  const exec = findMatchingModel(models, saved?.executionModelId, execPrefs) ?? models[models.length - 1];
  if (!plan || !exec) return null;
  return {
    planningModelId: plan.modelID,
    executionModelId: exec.modelID,
  };
}

type OrchestratorStore = {
  configs: Record<string, OrchestratorAccountConfig>;
  activeTurnsBySession: Record<string, OrchestratorTurnState>;
  getAccountConfig: (
    providerID: "google" | "openai",
    email: string,
    models: readonly OrchestratorSelectableModel[],
  ) => OrchestratorAccountConfig | null;
  setAccountConfig: (
    providerID: "google" | "openai",
    email: string,
    patch: Partial<OrchestratorAccountConfig>,
    models: readonly OrchestratorSelectableModel[],
  ) => void;
  setSessionTurn: (sessionId: string, turn: OrchestratorTurnState | null) => void;
  getSessionTurn: (sessionId: string) => OrchestratorTurnState | undefined;
};

export const useOrchestratorStore = create<OrchestratorStore>((set, get) => ({
  configs: readStoredConfigs(),
  activeTurnsBySession: {},

  getAccountConfig: (providerID, email, models) => {
    const key = accountConfigKey(providerID, email);
    return resolveOrchestratorPair(providerID, email, models, get().configs[key]);
  },

  setAccountConfig: (providerID, email, patch, models) => {
    const key = accountConfigKey(providerID, email);
    const current = resolveOrchestratorPair(providerID, email, models, get().configs[key]) ?? {
      planningModelId: models[0]?.modelID ?? "",
      executionModelId: models[0]?.modelID ?? "",
    };
    const next: OrchestratorAccountConfig = {
      planningModelId: patch.planningModelId ?? current.planningModelId,
      executionModelId: patch.executionModelId ?? current.executionModelId,
    };
    const nextConfigs = { ...get().configs, [key]: next };
    writeStoredConfigs(nextConfigs);
    set({ configs: nextConfigs });
  },

  setSessionTurn: (sessionId, turn) => {
    set((state) => {
      const next = { ...state.activeTurnsBySession };
      if (turn) next[sessionId] = turn;
      else delete next[sessionId];
      return { activeTurnsBySession: next };
    });
  },

  getSessionTurn: (sessionId) => get().activeTurnsBySession[sessionId],
}));
