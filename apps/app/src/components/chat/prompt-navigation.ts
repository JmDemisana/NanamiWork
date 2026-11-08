export const PROMPT_POSITIONS_EVENT = "session-prompt-positions";
export const PROMPT_REVEAL_EVENT = "session-prompt-reveal";

export type PromptPosition = { id: string; top: number };
export type PromptPositionsRequest = { ids: string[]; positions: PromptPosition[] };

export function collectVirtualPromptPositions<T>(
  groups: readonly T[],
  getMessageIds: (group: T) => readonly string[],
  measurements: readonly ({ start: number } | undefined)[],
  promptIds: readonly string[],
  mountedPositions: ReadonlyMap<string, number>,
): PromptPosition[] {
  const wanted = new Set(promptIds);
  const positions: PromptPosition[] = [];
  groups.forEach((group, index) => {
    for (const id of getMessageIds(group)) {
      if (!wanted.has(id)) continue;
      const top = mountedPositions.get(id) ?? measurements[index]?.start;
      if (top !== undefined && Number.isFinite(top)) positions.push({ id, top });
    }
  });
  return positions;
}

/** Move to the nearest prompt in the requested direction, skipping one already aligned. */
export function selectPromptPosition(positions: PromptPosition[], readingLine: number, direction: "previous" | "next") {
  const tolerance = 8;
  const ordered = positions.filter((position) => Number.isFinite(position.top)).sort((a, b) => a.top - b.top);
  return direction === "previous"
    ? ordered.findLast((position) => position.top < readingLine - tolerance)
    : ordered.find((position) => position.top > readingLine + tolerance);
}
