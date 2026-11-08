import { expect, test } from "bun:test";
import { collectVirtualPromptPositions, selectPromptPosition } from "../src/components/chat/prompt-navigation";
import { resolvePromptNavigationVisibility } from "../src/react-app/kernel/local-preferences-storage";

test("prompt navigation uses direction rather than the nearest prompt", () => {
  const prompts = [{ id: "first", top: 100 }, { id: "second", top: 1_000 }, { id: "third", top: 2_000 }];
  expect(selectPromptPosition(prompts, 500, "previous")?.id).toBe("first");
  expect(selectPromptPosition(prompts, 500, "next")?.id).toBe("second");
  expect(selectPromptPosition(prompts, 1_000, "previous")?.id).toBe("first");
  expect(selectPromptPosition(prompts, 1_000, "next")?.id).toBe("third");
  expect(selectPromptPosition(prompts, 50, "previous")).toBeUndefined();
});

test("virtualized prompt positions include unmounted groups and prefer measured DOM positions", () => {
  const groups = [{ ids: ["first"] }, { ids: ["answer"] }, { ids: ["second"] }];
  const positions = collectVirtualPromptPositions(groups, (group) => group.ids,
    [{ start: 100 }, { start: 200 }, { start: 1_000 }], ["first", "second"], new Map([["second", 1_050]]));
  expect(positions).toEqual([{ id: "first", top: 100 }, { id: "second", top: 1_050 }]);
  expect(selectPromptPosition(positions, 500, "previous")?.id).toBe("first");
});

test("individual preferences migrate the previous master switch", () => {
  expect(resolvePromptNavigationVisibility(undefined, false)).toEqual({ top: false, previous: false, next: false, latest: false });
  expect(resolvePromptNavigationVisibility({ previous: true }, false)).toEqual({ top: false, previous: true, next: false, latest: false });
  expect(resolvePromptNavigationVisibility(undefined)).toEqual({ top: true, previous: true, next: true, latest: true });
});
