import type { Client } from "@/app/types";
import { createPromptMessageID, unwrap } from "@/app/lib/opencode";
import type { StudyArtifact, StudyArtifactKind, StudyNotebook } from "./study-store";

const SYSTEM = "You are Study, an intelligent AI research and learning assistant (like NotebookLM). Use ONLY the provided sources as factual evidence. Ground all claims directly in the text and cite source numbers in square brackets like [1], [2]. If the sources do not contain enough information to answer, state clearly that the sources do not provide that information. Do not invent facts outside the sources.";

export function studySourceText(notebook: StudyNotebook): string {
  const activeSources = notebook.sources.filter((s) => s.selected !== false);
  if (!activeSources.length) throw new Error("Select at least one source before asking Study.");
  const text = activeSources.map((source, index) => `[${index + 1}] ${source.name}\n${source.text}`).join("\n\n");
  if (text.length > 200_000) throw new Error("These sources are too large for one request. Deselect or shorten a source and try again.");
  return text;
}

export function studyArtifactRequest(kind: StudyArtifactKind): string {
  if (kind === "flashcards") {
    return 'Create 8-15 comprehensive study flashcards based on the sources. Return JSON only in this exact format: {"cards":[{"front":"Clear question or concept prompt","back":"Detailed, accurate answer with citations like [1]"}]}. Do not include markdown code block wrapper or any surrounding text.';
  }
  if (kind === "quiz") {
    return 'Create a 5-10 question knowledge test based on the sources. Return JSON only in this exact format: {"questions":[{"question":"Question text","answer":"Correct answer with citation like [1]"}]}. Do not include markdown code block wrapper or any surrounding text.';
  }
  if (kind === "faq") {
    return "Create a comprehensive FAQ (Frequently Asked Questions) document addressing the top questions a reader would have about these sources. Provide clear, in-depth answers citing sources like [1], [2].";
  }
  if (kind === "briefing") {
    return "Create a structured Executive Briefing Document based on these sources. Include: 1) Executive Summary, 2) Key Themes & Insights, 3) Critical Facts & Data, 4) Implications/Takeaways. Ground all points with source citations like [1], [2].";
  }
  if (kind === "mind-map") {
    return "Create a clear, hierarchical text mind map or structured outline showing the core concepts and their sub-themes, with source citations like [1].";
  }
  return "Create detailed study notes and a comprehensive guide organized by topic, with key vocabulary, explanations, and source citations like [1], [2].";
}

export function parseStudyArtifact(kind: StudyArtifactKind, text: string): Omit<StudyArtifact, "id" | "createdAt"> {
  const body = text.trim();
  if (!body) throw new Error("The model returned an empty result. Try again.");
  
  if (kind === "study-guide" || kind === "mind-map" || kind === "faq" || kind === "briefing") {
    const titles: Record<StudyArtifactKind, string> = {
      "study-guide": "Study Guide",
      "mind-map": "Mind Map",
      "faq": "Frequently Asked Questions",
      "briefing": "Briefing Document",
      "flashcards": "Flashcards",
      "quiz": "Quiz",
    };
    return { kind, title: titles[kind], body };
  }

  let data: unknown;
  try {
    data = JSON.parse(body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new Error("The model returned an unreadable result. Try again.");
  }

  if (!data || typeof data !== "object") throw new Error("The model returned an unreadable result. Try again.");
  const key = kind === "flashcards" ? "cards" : "questions";
  const raw: unknown = Reflect.get(data, key);
  if (!Array.isArray(raw)) throw new Error("The model did not return any usable items. Try again.");

  if (kind === "flashcards") {
    const cards = raw.flatMap((item: unknown) =>
      item && typeof item === "object" && typeof Reflect.get(item, "front") === "string" && typeof Reflect.get(item, "back") === "string" && Reflect.get(item, "front").trim() && Reflect.get(item, "back").trim()
        ? [{ front: Reflect.get(item, "front").trim(), back: Reflect.get(item, "back").trim() }]
        : []
    ).slice(0, 30);
    if (!cards.length) throw new Error("The model did not return any usable cards. Try again.");
    return { kind, title: "Flashcards", body: `${cards.length} cards`, cards };
  }

  const questions = raw.flatMap((item: unknown) =>
    item && typeof item === "object" && typeof Reflect.get(item, "question") === "string" && typeof Reflect.get(item, "answer") === "string" && Reflect.get(item, "question").trim() && Reflect.get(item, "answer").trim()
      ? [{ question: Reflect.get(item, "question").trim(), answer: Reflect.get(item, "answer").trim() }]
      : []
  ).slice(0, 30);
  if (!questions.length) throw new Error("The model did not return any usable questions. Try again.");
  return { kind, title: "Quiz", body: `${questions.length} questions`, questions };
}

/** Run in a dedicated deny-all session. The caller admits the concrete model through the shared router. */
export async function generateStudyText(input: {
  client: Client;
  notebook: StudyNotebook;
  request: string;
  send: (sessionID: string, messageID: string, tools: Record<string, boolean>, system: string, text: string) => Promise<void>;
}): Promise<string> {
  const sources = studySourceText(input.notebook);
  const ids = unwrap(await input.client.tool.ids());
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new Error("Study could not verify tool restrictions. Nothing was sent.");
  const disabledTools = Object.fromEntries(ids.map((id) => [id, false]));
  const session = unwrap(await input.client.session.create({ title: "Study generation", permission: [{ permission: "*", pattern: "*", action: "deny" }] }));
  if (session.permission?.length !== 1 || !session.permission.some((rule) => rule.permission === "*" && rule.pattern === "*" && rule.action === "deny")) {
    throw new Error("Study could not verify tool restrictions. Nothing was sent.");
  }
  const messageID = createPromptMessageID();
  let terminal = false;
  try {
    await input.send(session.id, messageID, disabledTools, SYSTEM, `Sources:\n${sources}\n\nTask:\n${input.request}`);
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const messages = unwrap(await input.client.session.messages({ sessionID: session.id }));
      const response = messages.find(({ info }) => info.role === "assistant" && info.parentID === messageID && typeof info.time.completed === "number" && info.finish !== "tool-calls");
      if (response && response.info.role === "assistant") {
        terminal = true;
        if (response.info.error) throw new Error("The model could not complete the Study request. Try another model.");
        const text = response.parts.flatMap((part) => part.type === "text" && !part.synthetic ? [part.text] : []).join("\n").trim();
        if (!text) throw new Error("The model returned an empty result. Try again.");
        return text;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("Study took too long. Check the running task before retrying.");
  } finally {
    if (terminal) await input.client.session.update({ sessionID: session.id, time: { archived: Date.now() } }).catch(() => undefined);
  }
}
