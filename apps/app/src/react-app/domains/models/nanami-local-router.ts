import { create } from "zustand";

import type { ModelOption, ModelRef } from "@/app/types";
import { modelRefKey } from "@/react-app/domains/session/models/model-collections-store";

export const LOCAL_ROUTER_PROVIDER_ID = "nanami-local-router";
export const LOCAL_ROUTER_MODEL_ID = "route-local-models";

export type LocalRouterStrategy =
  | "round-robin"
  | "never-used"
  | "nearest-reset"
  | "highest-quota"
  | "lowest-quota"
  | "random";

export const LOCAL_ROUTER_STRATEGIES: readonly {
  value: LocalRouterStrategy;
  label: string;
  description: string;
}[] = [
  {
    value: "round-robin",
    label: "Round robin",
    description: "Take turns across every included account and model.",
  },
  {
    value: "never-used",
    label: "Quota reset (never used)",
    description: "Prefer full quotas, then models this router has not picked yet.",
  },
  {
    value: "nearest-reset",
    label: "Quota about to reset",
    description: "Use whichever account refreshes soonest.",
  },
  {
    value: "highest-quota",
    label: "Highest quota",
    description: "Use the account with the most quota left.",
  },
  {
    value: "lowest-quota",
    label: "Lowest quota",
    description: "Use the account with the least quota left, so nothing goes to waste.",
  },
  {
    value: "random",
    label: "Random",
    description: "Pick any included account and model.",
  },
];

/** Which sort decides the next model: model order, account order, or priorities. */
export type LocalRouterMode = "priority" | "model" | "account";

export type LocalRouterUsage = {
  count: number;
  lastUsedAt: number;
};

export type LocalRouterAccountKind = "antigravity" | "chatgpt" | "copilot" | "local";

export type LocalRouterModel = {
  /** `providerID:modelID`, the same key model checkboxes use. */
  key: string;
  modelID: string;
  label: string;
  remainingFraction: number | null;
  resetTime: string | null;
};

export type LocalRouterAccount = {
  /** Stable account key used by the inclusion checkboxes. */
  key: string;
  kind: LocalRouterAccountKind;
  providerID: string;
  /** Email, username, or provider id for local engines. */
  accountID: string;
  label: string;
  providerLabel: string;
  /** Display connected accounts even when policy or verification blocks routing. */
  unavailableReason?: string;
  models: LocalRouterModel[];
};

export type LocalRouterCandidate = {
  key: string;
  account: LocalRouterAccount;
  model: LocalRouterModel;
  ref: ModelRef;
};

export type LocalRouterSettings = {
  /** `model`/`account` follow those sorted lists; `priority` uses the strategies. */
  mode: LocalRouterMode;
  /** Enabled strategies in priority order; the first one decides ties. */
  strategies: LocalRouterStrategy[];
  /** Routing order for models, edited by the arrows in Model Selection. */
  modelOrder: string[];
  /** Routing order for accounts, shared with the picker's account groups. */
  accountOrder: string[];
  excludedAccounts: string[];
  excludedModels: string[];
  usage: Record<string, LocalRouterUsage>;
};

type LocalRouterStore = LocalRouterSettings & {
  setMode: (mode: LocalRouterMode) => void;
  toggleStrategy: (strategy: LocalRouterStrategy) => void;
  moveStrategy: (strategy: LocalRouterStrategy, direction: -1 | 1) => void;
  toggleAccount: (accountKey: string) => void;
  /** `orderedKeys` is the picker's current display order, so the first move starts from it. */
  moveAccount: (accountKey: string, direction: -1 | 1, orderedKeys: readonly string[]) => void;
  /** `orderedKeys` is the router's current model list order. */
  moveModel: (modelKey: string, direction: -1 | 1, orderedKeys: readonly string[]) => void;
  toggleModel: (modelKey: string) => void;
  resetUsage: () => void;
};

const STORAGE_KEY = "openwork.nanamiLocalRouter.v2";
const DEFAULT_SETTINGS: LocalRouterSettings = {
  mode: "priority",
  strategies: ["round-robin"],
  modelOrder: [],
  accountOrder: [],
  excludedAccounts: [],
  excludedModels: [],
  usage: {},
};

export function localRouterModelKey(providerID: string, modelID: string) {
  return modelRefKey({ providerID, modelID });
}

export function isLocalRouterModel(model: ModelRef | null | undefined) {
  return model?.providerID === LOCAL_ROUTER_PROVIDER_ID;
}

function isStrategy(value: unknown): value is LocalRouterStrategy {
  return LOCAL_ROUTER_STRATEGIES.some((entry) => entry.value === value);
}

export function isExclusiveFirstStrategy(strategy: LocalRouterStrategy | undefined): boolean {
  return strategy === "round-robin" || strategy === "random";
}

/** Round robin and random settle the choice; neither can have a later priority. */
export function terminalRoutingStrategy(strategies: readonly LocalRouterStrategy[]): LocalRouterStrategy | undefined {
  return strategies.find(isExclusiveFirstStrategy);
}

function readStoredSettings(): LocalRouterSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return DEFAULT_SETTINGS;
    const mode = Reflect.get(parsed, "mode");
    const strategies = Reflect.get(parsed, "strategies");
    const modelOrder = Reflect.get(parsed, "modelOrder");
    const accountOrder = Reflect.get(parsed, "accountOrder");
    const excludedAccounts = Reflect.get(parsed, "excludedAccounts");
    const excludedModels = Reflect.get(parsed, "excludedModels");
    const usage = Reflect.get(parsed, "usage");
    const enabled = Array.isArray(strategies)
      ? strategies.filter(isStrategy).filter((value, index, list) => list.indexOf(value) === index)
      : [];
    const terminalIndex = enabled.findIndex(isExclusiveFirstStrategy);
    return {
      mode: mode === "model" || mode === "account" ? mode : "priority",
      strategies: Array.isArray(strategies)
        ? (terminalIndex >= 0 ? enabled.slice(0, terminalIndex + 1) : enabled)
        : DEFAULT_SETTINGS.strategies,
      modelOrder: Array.isArray(modelOrder)
        ? modelOrder.filter((entry): entry is string => typeof entry === "string")
        : [],
      accountOrder: Array.isArray(accountOrder)
        ? accountOrder.filter((entry): entry is string => typeof entry === "string")
        : [],
      excludedAccounts: Array.isArray(excludedAccounts)
        ? excludedAccounts.filter((entry): entry is string => typeof entry === "string")
        : [],
      excludedModels: Array.isArray(excludedModels)
        ? excludedModels.filter((entry): entry is string => typeof entry === "string")
        : [],
      usage: usage && typeof usage === "object" && !Array.isArray(usage)
        ? Object.fromEntries(
            Object.entries(usage).flatMap(([key, value]) => {
              if (!value || typeof value !== "object" || Array.isArray(value)) return [];
              const count = Reflect.get(value, "count");
              const lastUsedAt = Reflect.get(value, "lastUsedAt");
              return typeof count === "number" && typeof lastUsedAt === "number"
                ? [[key, { count, lastUsedAt }]]
                : [];
            }),
          )
        : {},
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeStoredSettings(settings: LocalRouterSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Router settings are a convenience; a failed write should not block a send.
  }
}

function settingsOf(state: LocalRouterSettings): LocalRouterSettings {
  return {
    mode: state.mode,
    strategies: state.strategies,
    modelOrder: state.modelOrder,
    accountOrder: state.accountOrder,
    excludedAccounts: state.excludedAccounts,
    excludedModels: state.excludedModels,
    usage: state.usage,
  };
}

export const useLocalRouterStore = create<LocalRouterStore>((set, get) => ({
  ...readStoredSettings(),
  setMode: (mode) => set((state) => {
    if (mode !== "model" && mode !== "account" && mode !== "priority") return state;
    writeStoredSettings({ ...settingsOf(state), mode });
    return { mode };
  }),
  toggleStrategy: (strategy) => set((state) => {
    if (!isStrategy(strategy)) return state;
    const enabled = state.strategies.includes(strategy);
    const terminal = terminalRoutingStrategy(state.strategies);
    if (!enabled && terminal) return state;
    const strategies = enabled ? state.strategies.filter((entry) => entry !== strategy)
      : [...state.strategies, strategy];
    writeStoredSettings({ ...settingsOf(state), strategies });
    return { strategies };
  }),
  moveStrategy: (strategy, direction) => set((state) => {
    const index = state.strategies.indexOf(strategy);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= state.strategies.length) return state;
    const strategies = [...state.strategies];
    [strategies[index], strategies[target]] = [strategies[target]!, strategies[index]!];
    const terminalIndex = strategies.findIndex(isExclusiveFirstStrategy);
    if (terminalIndex >= 0 && terminalIndex !== strategies.length - 1) return state;
    writeStoredSettings({ ...settingsOf(state), strategies });
    return { strategies };
  }),
  toggleAccount: (accountKey) => set((state) => {
    const excluded = state.excludedAccounts.includes(accountKey);
    const excludedAccounts = excluded
      ? state.excludedAccounts.filter((key) => key !== accountKey)
      : [...state.excludedAccounts, accountKey];
    writeStoredSettings({ ...settingsOf(state), excludedAccounts });
    return { excludedAccounts };
  }),
  moveAccount: (accountKey, direction, orderedKeys) => set((state) => {
    const visible = [...orderedKeys];
    const index = visible.indexOf(accountKey);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= visible.length) return state;
    const otherKey = visible[target]!;
    const order = [...new Set([...state.accountOrder, ...visible])];
    const left = order.indexOf(accountKey);
    const right = order.indexOf(otherKey);
    [order[left], order[right]] = [order[right]!, order[left]!];
    writeStoredSettings({ ...settingsOf(state), accountOrder: order });
    return { accountOrder: order };
  }),
  moveModel: (modelKey, direction, orderedKeys) => set((state) => {
    const order = orderedKeys.length > 0
      ? [...orderedKeys]
      : (state.modelOrder.length > 0 ? [...state.modelOrder] : []);
    const index = order.indexOf(modelKey);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return state;
    [order[index], order[target]] = [order[target]!, order[index]!];
    writeStoredSettings({ ...settingsOf(state), modelOrder: order });
    return { modelOrder: order };
  }),
  toggleModel: (modelKey) => set((state) => {
    const excluded = state.excludedModels.includes(modelKey);
    const excludedModels = excluded
      ? state.excludedModels.filter((key) => key !== modelKey)
      : [...state.excludedModels, modelKey];
    writeStoredSettings({ ...settingsOf(state), excludedModels });
    return { excludedModels };
  }),
  resetUsage: () => {
    writeStoredSettings({ ...settingsOf(get()), usage: {} });
    set({ usage: {} });
  },
}));

export function recordLocalRouterUse(candidateKey: string) {
  const state = useLocalRouterStore.getState();
  const previous = state.usage[candidateKey];
  const usage = {
    ...state.usage,
    [candidateKey]: { count: (previous?.count ?? 0) + 1, lastUsedAt: Date.now() },
  };
  writeStoredSettings({ ...settingsOf(state), usage });
  useLocalRouterStore.setState({ usage });
}

export function localRouterAccountKey(providerID: string, accountID: string) {
  return `${providerID}:${accountID}`;
}

export function buildLocalRouterAccounts(input: {
  antigravity?: readonly {
    email: string;
    verificationRequired?: boolean;
    models: readonly {
      modelID: string;
      displayName: string;
      remainingFraction: number | null;
      resetTime: string | null;
    }[];
  }[];
  chatgpt?: readonly {
    email: string;
    primaryWindow?: { remainingFraction: number; resetTimeIso: string | null };
    secondaryWindow?: { remainingFraction: number; resetTimeIso: string | null };
    models: readonly {
      modelID: string;
      displayName: string;
      remainingFraction: number | null;
      resetTime: string | null;
    }[];
  }[];
  copilot?: readonly {
    username: string;
    quotaRemainingPct?: number | null;
    quotaResetTimeIso?: string | null;
    models: readonly {
      modelID: string;
      displayName: string;
      remainingFraction: number | null;
      resetTime: string | null;
    }[];
  }[];
  /** The selectable provider models shown by the model picker. */
  options?: readonly ModelOption[];
  disabledProviders?: readonly string[];
  restrictToCloud?: boolean;
}): LocalRouterAccount[] {
  const accounts: LocalRouterAccount[] = [];
  const unavailableReason = (providerID: string, verificationRequired = false) => {
    if (input.restrictToCloud) return "Blocked by your organization's provider policy.";
    if (input.disabledProviders?.includes(providerID)) return "Provider is disabled in AI providers.";
    if (verificationRequired) return "Complete account verification before routing.";
    return undefined;
  };
  const strictestQuota = (quotas: readonly { remainingFraction: number | null | undefined; resetTime: string | null | undefined }[]) => {
    const known = quotas.filter((quota): quota is { remainingFraction: number; resetTime: string | null | undefined } =>
      typeof quota.remainingFraction === "number" && Number.isFinite(quota.remainingFraction));
    if (known.length === 0) return { remainingFraction: null, resetTime: null };
    const strictest = known.reduce((left, right) => left.remainingFraction <= right.remainingFraction ? left : right);
    return { remainingFraction: strictest.remainingFraction, resetTime: strictest.resetTime ?? null };
  };

  for (const account of input.antigravity ?? []) {
    accounts.push({
      key: localRouterAccountKey("google", account.email),
      kind: "antigravity",
      providerID: "google",
      accountID: account.email,
      label: account.email,
      providerLabel: "Antigravity",
      unavailableReason: unavailableReason("google", account.verificationRequired),
      models: account.models.map((model) => ({
        key: localRouterModelKey("google", model.modelID),
        modelID: model.modelID,
        label: model.displayName,
        remainingFraction: model.remainingFraction,
        resetTime: model.resetTime,
      })),
    });
  }

  for (const account of input.chatgpt ?? []) {
    accounts.push({
      key: localRouterAccountKey("openai", account.email),
      kind: "chatgpt",
      providerID: "openai",
      accountID: account.email,
      label: account.email,
      providerLabel: "ChatGPT",
      unavailableReason: unavailableReason("openai"),
      models: account.models.map((model) => ({
        key: localRouterModelKey("openai", model.modelID),
        modelID: model.modelID,
        label: model.displayName,
        ...strictestQuota([
          model,
          { remainingFraction: account.primaryWindow?.remainingFraction, resetTime: account.primaryWindow?.resetTimeIso },
          { remainingFraction: account.secondaryWindow?.remainingFraction, resetTime: account.secondaryWindow?.resetTimeIso },
        ]),
      })),
    });
  }

  for (const account of input.copilot ?? []) {
    accounts.push({
      key: localRouterAccountKey("github-copilot", account.username),
      kind: "copilot",
      providerID: "github-copilot",
      accountID: account.username,
      label: `@${account.username}`,
      providerLabel: "Copilot",
      unavailableReason: unavailableReason("github-copilot"),
      models: account.models.map((model) => ({
        key: localRouterModelKey("github-copilot", model.modelID),
        modelID: model.modelID,
        label: model.displayName,
        ...strictestQuota([
          model,
          { remainingFraction: account.quotaRemainingPct == null ? null : account.quotaRemainingPct / 100, resetTime: account.quotaResetTimeIso },
        ]),
      })),
    });
  }

  const localProviders = new Map<string, { label: string; models: LocalRouterModel[] }>();
  for (const option of input.options ?? []) {
    if (option.disabled || option.providerID === LOCAL_ROUTER_PROVIDER_ID) continue;
    // The picker shows these providers through account rows instead of raw
    // catalog rows. Match that presentation, including when an account has no
    // quota or needs verification, rather than reintroducing hidden variants.
    if (option.providerID === "google") continue;
    if (option.providerID === "openai" && (input.chatgpt?.length ?? 0) > 0) continue;
    if (option.providerID === "github-copilot" && (input.copilot?.length ?? 0) > 0) continue;
    const group = localProviders.get(option.providerID) ?? {
      label: option.description?.trim() || option.providerID,
      models: [],
    };
    const key = localRouterModelKey(option.providerID, option.modelID);
    if (!group.models.some((model) => model.key === key)) {
      group.models.push({
        key,
        modelID: option.modelID,
        label: option.title || option.modelID,
        remainingFraction: null,
        resetTime: null,
      });
    }
    localProviders.set(option.providerID, group);
  }
  for (const [providerID, group] of localProviders) {
    accounts.push({
      key: providerID,
      kind: "local",
      providerID,
      accountID: providerID,
      label: group.label,
      providerLabel: group.label,
      models: group.models,
    });
  }

  return accounts;
}

function compareQuota(left: LocalRouterModel, right: LocalRouterModel, highest: boolean) {
  if (left.remainingFraction === null) return right.remainingFraction === null ? 0 : 1;
  if (right.remainingFraction === null) return -1;
  return highest
    ? compareRanks(right.remainingFraction, left.remainingFraction)
    : compareRanks(left.remainingFraction, right.remainingFraction);
}

function resetValue(model: LocalRouterModel) {
  if (!model.resetTime) return Number.POSITIVE_INFINITY;
  const value = Date.parse(model.resetTime);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function compareByStrategy(
  strategy: LocalRouterStrategy,
  left: LocalRouterCandidate,
  right: LocalRouterCandidate,
  context: {
    mode: LocalRouterMode;
    randomScores: Map<string, number>;
    usage: Record<string, LocalRouterUsage>;
    modelOrder: Map<string, number>;
    accountOrder: Map<string, number>;
  },
): number {
  const leftUsage = context.usage[left.key];
  const rightUsage = context.usage[right.key];
  switch (strategy) {
    case "lowest-quota":
      return compareQuota(left.model, right.model, false);
    case "highest-quota":
      return compareQuota(left.model, right.model, true);
    case "nearest-reset":
      return compareRanks(resetValue(left.model), resetValue(right.model));
    case "never-used":
      return Number(right.model.remainingFraction !== null && right.model.remainingFraction >= 1)
        - Number(left.model.remainingFraction !== null && left.model.remainingFraction >= 1)
        || (leftUsage?.count ?? 0) - (rightUsage?.count ?? 0)
        || (leftUsage?.lastUsedAt ?? 0) - (rightUsage?.lastUsedAt ?? 0);
    case "random":
      return (context.randomScores.get(left.key) ?? 0) - (context.randomScores.get(right.key) ?? 0);
    case "round-robin":
    default:
      return (leftUsage?.lastUsedAt ?? 0) - (rightUsage?.lastUsedAt ?? 0)
        || (leftUsage?.count ?? 0) - (rightUsage?.count ?? 0);
  }
}

function rankOf(rank: Map<string, number>, key: string) {
  return rank.get(key) ?? Number.POSITIVE_INFINITY;
}

function compareRanks(left: number, right: number) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareCandidates(
  left: LocalRouterCandidate,
  right: LocalRouterCandidate,
  strategies: readonly LocalRouterStrategy[],
  context: Parameters<typeof compareByStrategy>[3],
) {
  for (const strategy of strategies) {
    const result = compareByStrategy(strategy, left, right, context);
    if (result !== 0) return result;
  }
  const byModel = () => compareRanks(rankOf(context.modelOrder, left.model.key), rankOf(context.modelOrder, right.model.key));
  const byAccount = () => compareRanks(rankOf(context.accountOrder, left.account.key), rankOf(context.accountOrder, right.account.key));
  // The chosen sortable list breaks ties first, the other one settles the rest.
  return (context.mode === "account" ? byAccount() || byModel() : byModel() || byAccount())
    || left.key.localeCompare(right.key);
}

/**
 * The next account and model the local router should use. Candidates without
 * quota are skipped entirely; when every included candidate is empty the router
 * returns `null` so the caller can explain the wait instead of burning a send.
 */
export function resolveLocalRouterChoice(
  accounts: readonly LocalRouterAccount[],
  settings: Pick<LocalRouterSettings, "mode" | "strategies" | "modelOrder" | "accountOrder" | "excludedAccounts" | "excludedModels" | "usage">,
): LocalRouterCandidate | null {
  const excludedAccounts = new Set(settings.excludedAccounts);
  const excludedModels = new Set(settings.excludedModels);
  const orderedAccounts = orderLocalRouterAccounts(accounts, settings.accountOrder);
  const models = localRouterModels(accounts).flatMap((group) => group.models);
  const orderedModels = orderByLocalRouterOrder(models, (model) => model.key, settings.modelOrder);
  const modelOrder = new Map(orderedModels.map((model, index) => [model.key, index]));
  const accountOrder = new Map(orderedAccounts.map((account, index) => [account.key, index]));
  const candidates: LocalRouterCandidate[] = [];
  for (const account of accounts) {
    if (excludedAccounts.has(account.key) || account.unavailableReason) continue;
    for (const model of account.models) {
      if (excludedModels.has(model.key)) continue;
      candidates.push({
        key: `${account.key}|${model.key}`,
        account,
        model,
        ref: { providerID: account.providerID, modelID: model.modelID },
      });
    }
  }
  if (candidates.length === 0) return null;

  const usable = candidates.filter((candidate) =>
    candidate.model.remainingFraction === null || candidate.model.remainingFraction > 0);
  if (usable.length === 0) return null;
  if (settings.mode === "priority" && settings.strategies.length === 0) return null;
  const pool = usable;
  const strategies: readonly LocalRouterStrategy[] = settings.mode !== "priority"
    ? []
    : (() => {
        const terminalIndex = settings.strategies.findIndex(isExclusiveFirstStrategy);
        return terminalIndex >= 0 ? settings.strategies.slice(0, terminalIndex + 1) : settings.strategies;
      })();
  const context = {
    mode: settings.mode,
    randomScores: new Map(pool.map((candidate) => [candidate.key, Math.random()])),
    usage: settings.usage,
    modelOrder,
    accountOrder,
  };
  return [...pool].sort((left, right) => compareCandidates(left, right, strategies, context))[0] ?? null;
}

export function localRouterSummary(
  accounts: readonly LocalRouterAccount[],
  settings: Pick<LocalRouterSettings, "excludedAccounts" | "excludedModels">,
) {
  const excludedAccounts = new Set(settings.excludedAccounts);
  const excludedModels = new Set(settings.excludedModels);
  let modelCount = 0;
  let accountCount = 0;
  for (const account of accounts) {
    if (excludedAccounts.has(account.key)) continue;
    const models = account.models.filter((model) => !excludedModels.has(model.key));
    if (models.length === 0) continue;
    accountCount += 1;
    modelCount += models.length;
  }
  return { accountCount, modelCount };
}

/**
 * Sort anything account-shaped by the shared custom order. Accounts that are not
 * ranked yet keep their incoming order, so the picker and settings agree before
 * the first move seeds `accountOrder`.
 */
export function orderByLocalRouterOrder<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  accountOrder: readonly string[],
) {
  const rank = new Map(accountOrder.map((key, index) => [key, index]));
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftRank = rank.get(keyOf(left.item)) ?? Number.POSITIVE_INFINITY;
      const rightRank = rank.get(keyOf(right.item)) ?? Number.POSITIVE_INFINITY;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

/** The included accounts in the person's custom order, then the rest. */
export function orderLocalRouterAccounts(
  accounts: readonly LocalRouterAccount[],
  accountOrder: readonly string[],
) {
  return orderByLocalRouterOrder(accounts, (account) => account.key, accountOrder);
}

/** Unique model definitions across accounts, for the Model Selection checklist. */
export function localRouterModels(accounts: readonly LocalRouterAccount[]) {
  const groups = new Map<string, { providerID: string; label: string; models: LocalRouterModel[] }>();
  for (const account of accounts) {
    const group = groups.get(account.providerID) ?? {
      providerID: account.providerID,
      label: account.providerLabel,
      models: [],
    };
    for (const model of account.models) {
      if (!group.models.some((entry) => entry.key === model.key)) group.models.push(model);
    }
    groups.set(account.providerID, group);
  }
  return [...groups.values()];
}
