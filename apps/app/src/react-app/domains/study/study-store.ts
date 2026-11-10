// Local Study notebooks. Everything here stays on this computer: no Den
// account, no marketplace, no cloud sync. Notebooks are app-level, so they
// survive workspace changes, and the Study pack is prepared locally before the
// surface can be turned on.
import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ModelRef } from "@/app/types";

export type StudySourceKind = "text" | "markdown" | "pdf" | "youtube" | "web" | "drive" | "audio";

export type StudySource = {
  id: string;
  name: string;
  kind: StudySourceKind;
  mimeType: string | null;
  sizeBytes: number;
  text: string;
  url?: string | null;
  /** Whether this source is currently active/selected for questions */
  selected?: boolean;
  /** Page count for PDFs once text extraction lands; null for other sources. */
  pageCount: number | null;
  addedAt: number;
};

export type StudyCard = { front: string; back: string };
export type StudyQuestion = { question: string; answer: string };

export type StudyArtifactKind = "study-guide" | "flashcards" | "quiz" | "mind-map" | "faq" | "briefing";

export type StudyArtifact = {
  id: string;
  kind: StudyArtifactKind;
  title: string;
  createdAt: number;
  body: string;
  cards?: StudyCard[];
  questions?: StudyQuestion[];
};

export type StudyNotebook = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  pinned?: boolean;
  model: ModelRef | null;
  modelVariant?: string | null;
  sources: StudySource[];
  artifacts: StudyArtifact[];
};

export type StudyPackStatus = "not-installed" | "preparing" | "installed";

export type StudyPackProgress = {
  progress: number;
  step: string;
};

type StudyState = {
  packStatus: StudyPackStatus;
  packVersion: string | null;
  installedAt: number | null;
  enabled: boolean;
  packProgress: StudyPackProgress | null;
  packError: string | null;
  notebooks: StudyNotebook[];

  beginPackInstall: () => void;
  setPackProgress: (progress: StudyPackProgress) => void;
  finishPackInstall: (version: string) => void;
  failPackInstall: (message: string) => void;
  setEnabled: (enabled: boolean) => void;
  removePack: () => void;

  createNotebook: (title?: string) => StudyNotebook;
  renameNotebook: (notebookId: string, title: string) => void;
  togglePinNotebook: (notebookId: string) => void;
  archiveNotebook: (notebookId: string, archived: boolean) => void;
  deleteNotebook: (notebookId: string) => void;
  setNotebookModel: (notebookId: string, model: ModelRef | null, variant?: string | null) => void;
  addSource: (notebookId: string, source: Omit<StudySource, "id" | "addedAt">) => StudySource | null;
  removeSource: (notebookId: string, sourceId: string) => void;
  toggleSourceSelection: (notebookId: string, sourceId: string) => void;
  selectAllSources: (notebookId: string, selected: boolean) => void;
  addArtifact: (notebookId: string, artifact: Omit<StudyArtifact, "id" | "createdAt">) => StudyArtifact | null;
  removeArtifact: (notebookId: string, artifactId: string) => void;
};

export const STUDY_PACK_VERSION = "1.0.0";

function newId(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

function touch(notebook: StudyNotebook): StudyNotebook {
  return { ...notebook, updatedAt: Date.now() };
}

export const useStudyStore = create<StudyState>()(
  persist(
    (set, get) => ({
      packStatus: "not-installed",
      packVersion: null,
      installedAt: null,
      enabled: false,
      packProgress: null,
      packError: null,
      notebooks: [],

      beginPackInstall: () => set({
        packStatus: "preparing",
        packProgress: { progress: 0, step: "Checking local storage" },
        packError: null,
      }),
      setPackProgress: (packProgress) => set({ packProgress }),
      finishPackInstall: (version) => set({
        packStatus: "installed",
        packVersion: version,
        installedAt: Date.now(),
        packProgress: null,
        packError: null,
      }),
      failPackInstall: (message) => set({
        packStatus: "not-installed",
        packProgress: null,
        packError: message,
      }),
      setEnabled: (enabled) => {
        if (enabled && get().packStatus !== "installed") return;
        set({ enabled });
      },
      removePack: () => set({
        packStatus: "not-installed",
        packVersion: null,
        installedAt: null,
        enabled: false,
        packProgress: null,
        packError: null,
      }),

      createNotebook: (title) => {
        const now = Date.now();
        const notebook: StudyNotebook = {
          id: newId("nb"),
          title: title?.trim() || "Untitled notebook",
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          pinned: false,
          model: null,
          sources: [],
          artifacts: [],
        };
        set((state) => ({ notebooks: [notebook, ...state.notebooks] }));
        return notebook;
      },
      renameNotebook: (notebookId, title) => set((state) => ({
        notebooks: state.notebooks.map((notebook) => notebook.id === notebookId
          ? touch({ ...notebook, title: title.trim() || notebook.title })
          : notebook),
      })),
      togglePinNotebook: (notebookId) => set((state) => ({
        notebooks: state.notebooks.map((notebook) => notebook.id === notebookId
          ? touch({ ...notebook, pinned: !notebook.pinned })
          : notebook),
      })),
      archiveNotebook: (notebookId, archived) => set((state) => ({
        notebooks: state.notebooks.map((notebook) => notebook.id === notebookId
          ? touch({ ...notebook, archivedAt: archived ? Date.now() : null })
          : notebook),
      })),
      deleteNotebook: (notebookId) => set((state) => ({
        notebooks: state.notebooks.filter((notebook) => notebook.id !== notebookId),
      })),
      setNotebookModel: (notebookId, model, variant = null) => set((state) => ({
        notebooks: state.notebooks.map((notebook) => notebook.id === notebookId
          ? touch({ ...notebook, model, modelVariant: variant })
          : notebook),
      })),
      addSource: (notebookId, source) => {
        const notebook = get().notebooks.find((item) => item.id === notebookId);
        if (!notebook) return null;
        const added: StudySource = { ...source, selected: true, id: newId("src"), addedAt: Date.now() };
        set((state) => ({
          notebooks: state.notebooks.map((item) => item.id === notebookId
            ? touch({ ...item, sources: [...item.sources, added] })
            : item),
        }));
        return added;
      },
      removeSource: (notebookId, sourceId) => set((state) => ({
        notebooks: state.notebooks.map((notebook) => notebook.id === notebookId
          ? touch({ ...notebook, sources: notebook.sources.filter((source) => source.id !== sourceId) })
          : notebook),
      })),
      toggleSourceSelection: (notebookId, sourceId) => set((state) => ({
        notebooks: state.notebooks.map((notebook) => notebook.id === notebookId
          ? touch({
              ...notebook,
              sources: notebook.sources.map((source) => source.id === sourceId
                ? { ...source, selected: source.selected === false ? true : false }
                : source),
            })
          : notebook),
      })),
      selectAllSources: (notebookId, selected) => set((state) => ({
        notebooks: state.notebooks.map((notebook) => notebook.id === notebookId
          ? touch({
              ...notebook,
              sources: notebook.sources.map((source) => ({ ...source, selected })),
            })
          : notebook),
      })),
      addArtifact: (notebookId, artifact) => {
        const notebook = get().notebooks.find((item) => item.id === notebookId);
        if (!notebook) return null;
        const added: StudyArtifact = { ...artifact, id: newId("art"), createdAt: Date.now() };
        set((state) => ({
          notebooks: state.notebooks.map((item) => item.id === notebookId
            ? touch({ ...item, artifacts: [added, ...item.artifacts] })
            : item),
        }));
        return added;
      },
      removeArtifact: (notebookId, artifactId) => set((state) => ({
        notebooks: state.notebooks.map((notebook) => notebook.id === notebookId
          ? touch({ ...notebook, artifacts: notebook.artifacts.filter((artifact) => artifact.id !== artifactId) })
          : notebook),
      })),
    }),
    {
      name: "openwork.study.v1",
      // A half-finished prepare must not survive a restart as a stuck state.
      partialize: (state) => ({
        packStatus: state.packStatus === "preparing" ? "not-installed" : state.packStatus,
        packVersion: state.packVersion,
        installedAt: state.installedAt,
        enabled: state.enabled,
        notebooks: state.notebooks,
      }),
    },
  ),
);

export function selectActiveNotebooks(state: StudyState) {
  return state.notebooks.filter((notebook) => notebook.archivedAt === null);
}

export function selectArchivedNotebooks(state: StudyState) {
  return state.notebooks.filter((notebook) => notebook.archivedAt !== null);
}

/* ------------------------------- retrieval ------------------------------- */

export type StudyPassage = {
  sourceId: string;
  sourceName: string;
  citation: number;
  text: string;
  score: number;
};

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "is", "are", "was", "were", "be", "been", "being", "of", "to", "in", "on", "at", "for", "with",
  "by", "from", "as", "it", "its", "into", "about", "what", "which", "who", "how", "why", "when",
  "where", "do", "does", "did", "can", "could", "should", "would", "will", "you", "your", "we",
  "our", "they", "their", "i", "me", "my", "not", "no", "yes", "also", "there", "here",
]);

function terms(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function splitPassages(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const passages: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= 900) {
      passages.push(paragraph);
      continue;
    }
    const sentences = paragraph.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [paragraph];
    let current = "";
    for (const sentence of sentences) {
      if ((current + sentence).length > 900 && current) {
        passages.push(current.trim());
        current = "";
      }
      current += sentence;
    }
    if (current.trim()) passages.push(current.trim());
  }
  return passages;
}

/**
 * Local BM25-flavoured keyword search over a notebook's sources.
 */
export function searchNotebook(notebook: StudyNotebook, query: string, limit = 5): StudyPassage[] {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return [];
  const scored: StudyPassage[] = [];
  const activeSources = notebook.sources.filter((s) => s.selected !== false);
  activeSources.forEach((source, sourceIndex) => {
    const passages = splitPassages(source.text);
    passages.forEach((passage) => {
      const passageTerms = terms(passage);
      if (passageTerms.length === 0) return;
      const counts = new Map<string, number>();
      for (const term of passageTerms) counts.set(term, (counts.get(term) ?? 0) + 1);
      let score = 0;
      for (const term of queryTerms) {
        const count = counts.get(term) ?? 0;
        if (count === 0) continue;
        score += (count * 2.2) / (count + 1.2);
      }
      if (score === 0) return;
      scored.push({
        sourceId: source.id,
        sourceName: source.name,
        citation: sourceIndex + 1,
        text: passage,
        score,
      });
    });
  });
  return scored.sort((left, right) => right.score - left.score).slice(0, limit);
}

/** Split a source into sentence-ish units for local artifact generation. */
function sourceSentences(notebook: StudyNotebook): { sentence: string; citation: number }[] {
  const sentences: { sentence: string; citation: number }[] = [];
  const activeSources = notebook.sources.filter((s) => s.selected !== false);
  activeSources.forEach((source, sourceIndex) => {
    const parts = source.text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 30 && part.length <= 320);
    for (const sentence of parts) sentences.push({ sentence, citation: sourceIndex + 1 });
  });
  return sentences;
}

export function buildStudyGuide(notebook: StudyNotebook): Omit<StudyArtifact, "id" | "createdAt"> {
  const sentences = sourceSentences(notebook);
  const chosen = sentences.filter((_, index) => index % Math.max(1, Math.ceil(sentences.length / 12)) === 0).slice(0, 12);
  const body = chosen.length === 0
    ? "Add a source, then create the guide again."
    : chosen.map((item) => `- ${item.sentence} [${item.citation}]`).join("\n");
  return { kind: "study-guide", title: "Study guide", body };
}

export function buildFlashcards(notebook: StudyNotebook): Omit<StudyArtifact, "id" | "createdAt"> {
  const sentences = sourceSentences(notebook);
  const cards: StudyCard[] = [];
  for (const { sentence } of sentences) {
    const match = sentence.match(/^(.{3,120}?)\s+(?:is|are|was|were|means|refers to|describes)\s+(.{10,220})$/i);
    if (!match) continue;
    cards.push({
      front: `What ${match[1].trim().replace(/^(the|a|an)\s+/i, "")}?`,
      back: `${match[2].trim().replace(/[.!?]$/, "")}.`,
    });
    if (cards.length >= 12) break;
  }
  if (cards.length === 0) {
    for (const { sentence } of sentences.slice(0, 8)) {
      const [first, ...rest] = sentence.split(/[:,]\s+/);
      if (rest.length > 0 && first.length < 90) cards.push({ front: `Explain: ${first}`, back: rest.join(", ") });
    }
  }
  return {
    kind: "flashcards",
    title: "Flashcards",
    body: `${cards.length} cards`,
    cards,
  };
}

export function buildQuiz(notebook: StudyNotebook): Omit<StudyArtifact, "id" | "createdAt"> {
  const sentences = sourceSentences(notebook);
  const questions: StudyQuestion[] = [];
  for (const { sentence } of sentences) {
    const words = sentence.split(/\s+/).filter((word) => word.length > 4);
    if (words.length < 6) continue;
    const target = words[Math.floor(words.length / 2)].replace(/[^\p{L}\p{N}-]/gu, "");
    if (target.length < 5) continue;
    questions.push({
      question: sentence.replace(target, "_____"),
      answer: target,
    });
    if (questions.length >= 10) break;
  }
  return {
    kind: "quiz",
    title: "Quiz",
    body: `${questions.length} questions`,
    questions,
  };
}

export function buildMindMap(notebook: StudyNotebook): Omit<StudyArtifact, "id" | "createdAt"> {
  const counts = new Map<string, number>();
  for (const { sentence } of sourceSentences(notebook)) {
    for (const term of new Set(terms(sentence))) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 14);
  const body = top.length === 0
    ? "Add a source, then create the map again."
    : top.map(([term, count]) => `${term} (${count})`).join("\n");
  return { kind: "mind-map", title: "Mind map", body };
}

export function buildArtifact(notebook: StudyNotebook, kind: StudyArtifactKind) {
  switch (kind) {
    case "study-guide": return buildStudyGuide(notebook);
    case "flashcards": return buildFlashcards(notebook);
    case "quiz": return buildQuiz(notebook);
    case "mind-map": return buildMindMap(notebook);
    case "faq": return { kind: "faq", title: "Frequently Asked Questions", body: "Add sources to generate FAQs." };
    case "briefing": return { kind: "briefing", title: "Briefing Document", body: "Add sources to generate an executive briefing." };
  }
}
