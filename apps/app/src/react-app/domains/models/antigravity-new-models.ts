import type { AntigravityModelItem, ThinkingTier } from "./antigravity-accounts-store";

type CatalogEntry = {
  disabled?: boolean;
  selectable?: boolean;
  quotaInfo?: { remainingFraction?: number; resetTime?: string };
};

/** Only offer model IDs that this account's live catalog actually enables. */
export function discoverNewAntigravityModels(
  catalog: Record<string, CatalogEntry>,
  tier: ThinkingTier,
): AntigravityModelItem[] {
  return ([
    ["gemini-4-hydrogen", "Gemini 4 Hydrogen"],
    ["gemini-4-carbon", "Gemini 4 Carbon"],
  ] as const).flatMap(([familyKey, displayName]) => {
    const tierModelIds: Partial<Record<ThinkingTier, string>> = {};
    for (const level of ["low", "medium", "high"] as const) {
      const rawId = `${familyKey}-${level}`;
      if (catalog[rawId] && !catalog[rawId].disabled && catalog[rawId].selectable !== false) tierModelIds[level] = `antigravity-${rawId}`;
    }
    const modelID = tierModelIds[tier] ?? tierModelIds.high ?? tierModelIds.medium ?? tierModelIds.low;
    if (!modelID) return [];
    const rawId = modelID.slice("antigravity-".length);
    const quota = catalog[rawId].quotaInfo;
    const fraction = quota?.remainingFraction;
    return [{
      familyKey, modelID, rawId, displayName,
      remainingFraction: typeof fraction === "number" && Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : null,
      resetTime: quota?.resetTime ?? null,
      supportsThinkingTier: true,
      tierModelIds,
    }];
  });
}
