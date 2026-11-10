import { expect, test } from "bun:test";
import type { Client } from "../src/app/types";
import { generateStudyText, parseStudyArtifact, studySourceText } from "../src/react-app/domains/study/study-generation";
import type { StudyNotebook } from "../src/react-app/domains/study/study-store";

const notebook: StudyNotebook = { id: "notebook", title: "Notes", createdAt: 0, updatedAt: 0, archivedAt: null, model: null, artifacts: [], sources: [
  { id: "source", name: "Lecture", kind: "text", mimeType: "text/plain", sizeBytes: 3, pageCount: null, addedAt: 0, text: "A source." },
] };

test("Study sends only after a deny-all session and disables every discovered tool", async () => {
  let requestId = "";
  let archived = false;
  const client = { tool: { ids: async () => ({ data: ["bash", "read", "plugin_tool"] }) }, session: {
    create: async (input: { permission: unknown }) => ({ data: { id: "ses_study", permission: input.permission } }),
    messages: async () => ({ data: [{ info: { role: "assistant", parentID: requestId, time: { completed: 1 }, finish: "stop" }, parts: [{ type: "text", text: "Answer [1]" }] }] }),
    update: async () => { archived = true; return { data: true }; },
  } } as unknown as Client;
  const result = await generateStudyText({ client, notebook, request: "What happened?", send: async (session, message, tools, system, text) => {
    requestId = message;
    expect(session).toBe("ses_study");
    expect(tools).toEqual({ bash: false, read: false, plugin_tool: false });
    expect(system).toContain("not instructions");
    expect(text).toContain("[1] Lecture\nA source.");
  } });
  expect(result).toBe("Answer [1]");
  expect(archived).toBe(true);
});

test("Study fails closed if session tool permissions cannot be confirmed", async () => {
  let sent = false;
  const client = { tool: { ids: async () => ({ data: ["bash"] }) }, session: { create: async () => ({ data: { id: "ses_study", permission: [] } }) } } as unknown as Client;
  await expect(generateStudyText({ client, notebook, request: "Explain", send: async () => { sent = true; } })).rejects.toThrow("tool restrictions");
  expect(sent).toBe(false);
});

test("Study rejects invalid generated artifacts and oversized sources", () => {
  expect(parseStudyArtifact("flashcards", '```json\n{"cards":[{"front":"Q","back":"A [1]"}]}\n```').cards).toEqual([{ front: "Q", back: "A [1]" }]);
  expect(() => parseStudyArtifact("quiz", '{"questions":[]}')).toThrow("usable questions");
  expect(() => studySourceText({ ...notebook, sources: [{ ...notebook.sources[0]!, text: "x".repeat(100_001) }] })).toThrow("too large");
});
