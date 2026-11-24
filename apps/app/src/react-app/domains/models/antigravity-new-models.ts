import type { AntigravityModelItem, ThinkingTier } from "./antigravity-accounts-store";

type CatalogEntry = {
  disabled?: boolean;
  selectable?: boolean;
  quotaInfo?: { remainingFraction?: number; resetTime?: string };
};

export type AntigravityCatalog = {
  models?: Record<string, CatalogEntry>;
  agentModelSorts?: readonly { groups?: readonly { modelIds?: readonly string[] }[] }[];
  tieredModelIds?: Record<string, readonly string[]>;
};

export function selectableAntigravityModelIds(catalog: AntigravityCatalog): ReadonlySet<string> | undefined {
  const visible = (catalog.agentModelSorts ?? []).flatMap((sort) =>
    (sort.groups ?? []).flatMap((group) => group.modelIds ?? []),
  );
  // Older responses only include the model map. When present, use the same
  // selectable inventory as the provider, including its concrete tier IDs.
  return visible.length > 0 ? new Set([...visible, ...Object.values(catalog.tieredModelIds ?? {}).flat()]) : undefined;
}

/** Only offer model IDs that this account's live catalog actually enables. */
export function discoverNewAntigravityModels(
  catalog: Record<string, CatalogEntry>,
  tier: ThinkingTier,
  selectable?: ReadonlySet<string>,
): AntigravityModelItem[] {
  return ([
    ["gemini-4-neon", "Gemini 4 Neon"],
    ["gemini-4-hydrogen", "Gemini 4 Hydrogen"],
    ["gemini-4-carbon", "Gemini 4 Carbon"],
  ] as const).flatMap(([familyKey, displayName]) => {
    const enabled = (rawId: string) => catalog[rawId] && !catalog[rawId].disabled
      && catalog[rawId].selectable !== false && (!selectable || selectable.has(rawId));
    const tierModelIds: Partial<Record<ThinkingTier, string>> = {};
    for (const level of ["low", "medium", "high"] as const) {
      const rawId = [`${familyKey}-${level}`, `${familyKey}-tiered-${level}`].find(enabled);
      if (rawId) tierModelIds[level] = `antigravity-${rawId}`;
    }
    const modelID = tierModelIds[tier] ?? tierModelIds.high ?? tierModelIds.medium ?? tierModelIds.low
      ?? (enabled(familyKey) ? `antigravity-${familyKey}` : undefined);
    if (!modelID) return [];
    const rawId = modelID.slice("antigravity-".length);
    const quota = catalog[rawId].quotaInfo;
    const fraction = quota?.remainingFraction;
    // Google omits remainingFraction when a model is exhausted and only returns resetTime.
    const hasExhaustedResetOnly = Boolean(quota?.resetTime && fraction === undefined);
    const remainingFraction = typeof fraction === "number" && Number.isFinite(fraction)
      ? Math.max(0, Math.min(1, fraction))
      : hasExhaustedResetOnly
        ? 0
        : null;
    return [{
      familyKey, modelID, rawId, displayName,
      remainingFraction,
      resetTime: quota?.resetTime ?? null,
      supportsThinkingTier: Object.keys(tierModelIds).length > 1,
      tierModelIds,
    }];
  });
}
