/** @jsxImportSource react */
import {
  ArrowLeft,
  Archive,
  BookOpen,
  Brain,
  Check,
  FileText,
  Layers,
  ListChecks,
  Network,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useModelPickerPageHost } from "@/react-app/domains/models/model-picker-page-host";
import { parseStudyArtifact, studyArtifactRequest } from "./study-generation";
import {
  useStudyStore,
  type StudyArtifact,
  type StudyArtifactKind,
  type StudyNotebook,
  type StudyPassage,
  type StudySourceKind,
} from "./study-store";

const ARTIFACT_OPTIONS: Array<{ kind: StudyArtifactKind; label: string; icon: typeof BookOpen }> = [
  { kind: "study-guide", label: "Study guide", icon: BookOpen },
  { kind: "flashcards", label: "Flashcards", icon: Layers },
  { kind: "quiz", label: "Quiz", icon: ListChecks },
  { kind: "mind-map", label: "Mind map", icon: Network },
];

function formatDate(value: number) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sourceKindForFile(file: File): StudySourceKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown") || file.type === "text/markdown") return "markdown";
  if (name.endsWith(".txt") || file.type === "text/plain") return "text";
  return null;
}

/** `/study` and `/study/:notebookId` share one dedicated learning surface. */
type StudyGenerate = (notebook: StudyNotebook, request: string) => Promise<string>;

export function StudySurface({ onChooseModel, onGenerate }: { onChooseModel: (notebookId: string) => void; onGenerate: StudyGenerate }) {
  const pickerHost = useModelPickerPageHost();
  const location = useLocation();
  const pathname = location.pathname;
  const match = pathname.match(/^\/study\/([^/]+)\/?$/);
  const notebookId = match ? decodeURIComponent(match[1]) : null;
  const enabled = useStudyStore((state) => state.enabled);
  const packStatus = useStudyStore((state) => state.packStatus);
  const navigate = useNavigate();

  if (!enabled) {
    return (
      <div className="flex h-full items-center justify-center p-8" data-study-gate>
        <div className="max-w-md text-center">
          <BookOpen className="mx-auto size-8 text-muted-foreground" />
          <h1 className="mt-4 text-lg font-medium">Study is off</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {packStatus === "installed"
              ? "Turn Study on in Settings to open your notebooks. Notebooks stay on this computer while it is off."
              : "Prepare the local Study pack in Settings, then turn it on."}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="outline" onClick={() => navigate("/settings/specialized-tools")}>Open settings</Button>
            <Button variant="ghost" onClick={() => navigate("/session")}>Back to sessions</Button>
          </div>
        </div>
      </div>
    );
  }

  return <div className="flex h-full min-h-0 flex-col">
    <div ref={pickerHost?.setHost} hidden={!pickerHost?.active} className="flex min-h-0 flex-1 flex-col" data-model-picker-page-host />
    <div hidden={pickerHost?.active} inert={pickerHost?.active} className="min-h-0 flex-1">
      {notebookId ? <StudyNotebookView notebookId={notebookId} onChooseModel={onChooseModel} onGenerate={onGenerate} /> : <StudyHome />}
    </div>
  </div>;
}

function StudyHome() {
  const allNotebooks = useStudyStore((state) => state.notebooks);
  const notebooks = useMemo(() => allNotebooks.filter((notebook) => notebook.archivedAt === null), [allNotebooks]);
  const createNotebook = useStudyStore((state) => state.createNotebook);
  const navigate = useNavigate();

  const create = () => {
    const notebook = createNotebook();
    navigate(`/study/${notebook.id}`);
  };

  return (
    <div className="h-full overflow-y-auto p-8" data-study-home>
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-medium tracking-[-0.4px]">Notebooks</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Notebooks stay on this computer. Your selected model answers from your sources.
            </p>
          </div>
          <Button onClick={create}>
            <Plus className="size-4" />
            New notebook
          </Button>
        </div>

        {notebooks.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-border p-10 text-center">
            <Sparkles className="mx-auto size-7 text-muted-foreground" />
            <h2 className="mt-3 text-base font-medium">Start with a notebook</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Add notes, lecture text, or a markdown file. Study builds citations and studio artifacts from them.
            </p>
            <Button className="mt-4" variant="outline" onClick={create}>
              <Plus className="size-4" />
              Create notebook
            </Button>
          </div>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {notebooks.map((notebook) => (
              <button
                key={notebook.id}
                type="button"
                onClick={() => navigate(`/study/${notebook.id}`)}
                className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/25"
              >
                <BookOpen className="size-4 text-muted-foreground" />
                <span className="line-clamp-2 text-sm font-medium">{notebook.title}</span>
                <span className="text-xs text-muted-foreground">
                  {notebook.sources.length} source{notebook.sources.length === 1 ? "" : "s"}
                  {notebook.artifacts.length > 0 ? ` · ${notebook.artifacts.length} artifact${notebook.artifacts.length === 1 ? "" : "s"}` : ""}
                </span>
                <span className="text-[11px] text-muted-foreground/70">Updated {formatDate(notebook.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type ChatEntry = { role: "you" | "study"; text: string; passages?: StudyPassage[] };

function StudyNotebookView({ notebookId, onChooseModel, onGenerate }: { notebookId: string; onChooseModel: (notebookId: string) => void; onGenerate: StudyGenerate }) {
  const notebook = useStudyStore((state) => state.notebooks.find((item) => item.id === notebookId) ?? null);
  const renameNotebook = useStudyStore((state) => state.renameNotebook);
  const navigate = useNavigate();

  if (!notebook) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p className="text-sm text-muted-foreground">This notebook is not here anymore.</p>
          <Button className="mt-3" variant="outline" onClick={() => navigate("/study")}>Back to notebooks</Button>
        </div>
      </div>
    );
  }

  return <NotebookWorkspace key={notebook.id} notebook={notebook} onChooseModel={onChooseModel} onGenerate={onGenerate} onRename={(title) => renameNotebook(notebook.id, title)} />;
}

function NotebookWorkspace({ notebook, onRename, onChooseModel, onGenerate }: { notebook: StudyNotebook; onRename: (title: string) => void; onChooseModel: (notebookId: string) => void; onGenerate: StudyGenerate }) {
  const addSource = useStudyStore((state) => state.addSource);
  const removeSource = useStudyStore((state) => state.removeSource);
  const addArtifact = useStudyStore((state) => state.addArtifact);
  const removeArtifact = useStudyStore((state) => state.removeArtifact);
  const archiveNotebook = useStudyStore((state) => state.archiveNotebook);
  const deleteNotebook = useStudyStore((state) => state.deleteNotebook);
  const navigate = useNavigate();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [titleDraft, setTitleDraft] = useState(notebook.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [query, setQuery] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(notebook.sources[0]?.id ?? null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [openArtifact, setOpenArtifact] = useState<StudyArtifact | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedSource = notebook.sources.find((source) => source.id === selectedSourceId) ?? notebook.sources[0] ?? null;

  const ask = useCallback(async () => {
    const question = query.trim();
    if (!question || generating) return;
    setChat((current) => [...current, { role: "you", text: question }]);
    setQuery("");
    setGenerationError("");
    setGenerating(true);
    try {
      const answer = await onGenerate(notebook, question);
      const referenced = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
      const passages = notebook.sources.flatMap((source, index) => referenced.has(index + 1)
        ? [{ sourceId: source.id, sourceName: source.name, citation: index + 1, text: source.text, score: 0 }] : []);
      setChat((current) => [...current, { role: "study", text: answer, passages }]);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Study could not answer. Try again.");
      setQuery(question);
    } finally { setGenerating(false); }
  }, [generating, notebook, onGenerate, query]);

  const createArtifact = async (kind: StudyArtifactKind) => {
    if (generating) return;
    setGenerationError("");
    setGenerating(true);
    try {
      const text = await onGenerate(notebook, studyArtifactRequest(kind));
      const artifact = addArtifact(notebook.id, parseStudyArtifact(kind, text));
      if (artifact) setOpenArtifact(artifact);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Study could not create this. Try again.");
    } finally { setGenerating(false); }
  };

  const addPastedSource = () => {
    const text = sourceText.trim();
    if (!text) {
      setSourceError("Paste some text first.");
      return;
    }
    const added = addSource(notebook.id, {
      name: sourceName.trim() || `Note ${notebook.sources.length + 1}`,
      kind: "text",
      mimeType: "text/plain",
      sizeBytes: new Blob([text]).size,
      text,
      pageCount: null,
    });
    if (added) setSelectedSourceId(added.id);
    setSourceName("");
    setSourceText("");
    setSourceError("");
    setSourceOpen(false);
  };

  const addFile = async (file: File | undefined) => {
    if (!file) return;
    const kind = sourceKindForFile(file);
    if (!kind) {
      setSourceError("This build reads .txt and .md. PDF text extraction lands next.");
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        setSourceError("That file is empty.");
        return;
      }
      const added = addSource(notebook.id, {
        name: file.name,
        kind,
        mimeType: file.type || null,
        sizeBytes: file.size,
        text,
        pageCount: null,
      });
      if (added) setSelectedSourceId(added.id);
      setSourceError("");
      setSourceOpen(false);
    } catch {
      setSourceError("That file could not be read.");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-study-notebook>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Button variant="ghost" size="icon-sm" aria-label="Back to notebooks" onClick={() => navigate("/study")}>
          <ArrowLeft />
        </Button>
        {editingTitle ? (
          <Input
            autoFocus
            className="h-7 max-w-sm"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => { onRename(titleDraft); setEditingTitle(false); }}
            onKeyDown={(event) => {
              if (event.key === "Enter") { onRename(titleDraft); setEditingTitle(false); }
              if (event.key === "Escape") { setTitleDraft(notebook.title); setEditingTitle(false); }
            }}
          />
        ) : (
          <button
            type="button"
            className="group/title flex min-w-0 items-center gap-1.5"
            onClick={() => { setTitleDraft(notebook.title); setEditingTitle(true); }}
            title="Rename notebook"
          >
            <span className="truncate text-sm font-medium">{notebook.title}</span>
            <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100" />
          </button>
        )}
        <Button variant="ghost" size="sm" className="ml-auto max-w-48 truncate" onClick={() => onChooseModel(notebook.id)}>{notebook.model?.modelID || "Choose model"}</Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Archive notebook"
          title="Archive notebook"
          onClick={() => {
            archiveNotebook(notebook.id, true);
            navigate("/study");
          }}
        >
          <Archive />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete notebook"
          title="Delete notebook"
          className="hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 />
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_280px] max-lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Sources */}
        <aside className="flex min-h-0 flex-col border-e border-border" data-study-sources>
          <div className="flex h-10 shrink-0 items-center justify-between px-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Sources</span>
            <Button variant="ghost" size="icon-xs" aria-label="Add source" onClick={() => setSourceOpen(true)}>
              <Plus />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {notebook.sources.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">No sources yet. Add a note or a text file.</p>
            ) : notebook.sources.map((source, index) => (
              <div key={source.id} className={cn(
                "group flex items-start gap-2 rounded-lg px-2 py-2 text-xs",
                selectedSource?.id === source.id ? "bg-muted" : "hover:bg-muted/60",
              )}>
                <button type="button" className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => { setSelectedSourceId(source.id); setHighlight(null); }}>
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded bg-muted-foreground/15 text-[10px]">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{source.name}</span>
                    <span className="block text-[11px] text-muted-foreground">{source.kind} · {Math.max(1, Math.round(source.sizeBytes / 1024))} KB</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${source.name}`}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => removeSource(notebook.id, source.id)}
                >
                  <X className="size-3.5 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-border p-2">
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setSourceOpen(true)}>
              <Plus className="size-3.5" />
              Add source
            </Button>
          </div>
        </aside>

        {/* Chat / reader */}
        <main className="flex min-h-0 flex-col" data-study-chat>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {highlight ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">Cited passage</span>
                  <Button variant="ghost" size="icon-xs" aria-label="Close passage" onClick={() => setHighlight(null)}><X /></Button>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{highlight}</p>
              </div>
            ) : selectedSource ? (
              <div className="mx-auto max-w-2xl">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="size-3.5" />
                  {selectedSource.name}
                </div>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground/90">{selectedSource.text}</div>
              </div>
            ) : (
              <div className="mx-auto mt-10 max-w-md text-center">
                <Search className="mx-auto size-7 text-muted-foreground" />
                <h2 className="mt-3 text-base font-medium">Ask your sources</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add a note or a text file, then ask a question. Answers cite the sources they use.
                </p>
              </div>
            )}

            {chat.length > 0 ? (
              <div className="mx-auto mt-6 flex max-w-2xl flex-col gap-4">
                {chat.map((entry, index) => (
                  <div key={index} className={cn("rounded-xl p-3", entry.role === "you" ? "bg-muted/60" : "border border-border bg-card")}>
                    <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      {entry.role === "you" ? "You" : "Study"}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{entry.text}</p>
                    {entry.passages?.length ? (
                      <div className="mt-3 flex flex-col gap-2">
                        {entry.passages.map((passage, passageIndex) => (
                          <button
                            key={passageIndex}
                            type="button"
                            className="rounded-lg border border-border/70 bg-background/50 p-2 text-left text-xs leading-5 transition-colors hover:border-foreground/25"
                            onClick={() => { setSelectedSourceId(passage.sourceId); setHighlight(null); }}
                          >
                            <span className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span className="flex size-4 items-center justify-center rounded bg-muted-foreground/15 text-[10px]">{passage.citation}</span>
                              {passage.sourceName}
                            </span>
                            <span className="line-clamp-3 whitespace-pre-wrap">{passage.text}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-border p-3">
            <div className="mx-auto flex max-w-2xl items-end gap-2">
              <Textarea
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); }
                }}
                placeholder="Ask about your sources…"
                className="min-h-10 resize-none"
                rows={1}
              />
              <Button onClick={() => void ask()} disabled={!query.trim() || generating || !notebook.sources.length}>{generating ? "Working…" : "Ask"}</Button>
            </div>
            <p className="mx-auto mt-1.5 max-w-2xl text-[11px] text-muted-foreground">
              {generationError || "Your selected model receives your sources when you ask or create materials."}
            </p>
          </div>
        </main>

        {/* Studio */}
        <aside className="flex min-h-0 flex-col border-s border-border max-lg:hidden" data-study-studio>
          <div className="flex h-10 shrink-0 items-center px-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Studio</span>
          </div>
          <div className="flex flex-col gap-1 px-2">
            {ARTIFACT_OPTIONS.map((option) => (
              <Button key={option.kind} variant="ghost" size="sm" className="justify-start" onClick={() => void createArtifact(option.kind)} disabled={notebook.sources.length === 0 || generating}>
                <option.icon className="size-3.5" />
                {option.label}
              </Button>
            ))}
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {notebook.artifacts.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">Create a guide, cards, a quiz, or a map from your sources.</p>
            ) : notebook.artifacts.map((artifact) => (
              <div key={artifact.id} className="group flex items-start gap-1 rounded-lg px-2 py-2 text-xs hover:bg-muted/60">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenArtifact(artifact)}>
                  <span className="block truncate font-medium">{artifact.title}</span>
                  <span className="block text-[11px] text-muted-foreground">{artifact.body}</span>
                </button>
                <button type="button" aria-label={`Delete ${artifact.title}`} className="opacity-0 group-hover:opacity-100" onClick={() => removeArtifact(notebook.id, artifact.id)}>
                  <Trash2 className="size-3.5 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {sourceOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Add source</h2>
              <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={() => setSourceOpen(false)}><X /></Button>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <Input placeholder="Source name (optional)" value={sourceName} onChange={(event) => setSourceName(event.target.value)} />
              <Textarea placeholder="Paste notes, a transcript, or an article…" className="min-h-40" value={sourceText} onChange={(event) => setSourceText(event.target.value)} />
              {sourceError ? <p className="text-xs text-destructive">{sourceError}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                  <FileText className="size-3.5" />
                  Choose .txt or .md
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".txt,.md,.markdown,text/plain,text/markdown"
                  className="hidden"
                  onChange={(event) => void addFile(event.target.files?.[0])}
                />
                <Button size="sm" onClick={addPastedSource}>
                  <Check className="size-3.5" />
                  Add source
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {openArtifact ? (
        <ArtifactDialog artifact={openArtifact} onClose={() => setOpenArtifact(null)} />
      ) : null}

      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-xl">
            <h2 className="text-sm font-medium">Delete this notebook?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              “{notebook.title}” and its {notebook.sources.length} source{notebook.sources.length === 1 ? "" : "s"} and{" "}
              {notebook.artifacts.length} artifact{notebook.artifacts.length === 1 ? "" : "s"} will be removed from this computer.
              This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  deleteNotebook(notebook.id);
                  setConfirmDelete(false);
                  navigate("/study");
                }}
              >
                <Trash2 className="size-3.5" />
                Delete notebook
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactDialog({ artifact, onClose }: { artifact: StudyArtifact; onClose: () => void }) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <Brain className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">{artifact.title}</h2>
          </div>
          <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}><X /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {artifact.cards?.length ? (
            <div className="flex flex-col gap-2">
              {artifact.cards.map((card, index) => (
                <button
                  key={index}
                  type="button"
                  className="rounded-lg border border-border p-3 text-left"
                  onClick={() => setRevealed((current) => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index); else next.add(index);
                    return next;
                  })}
                >
                  <div className="text-sm font-medium">{card.front}</div>
                  {revealed.has(index) ? <div className="mt-2 text-sm text-muted-foreground">{card.back}</div> : <div className="mt-2 text-[11px] text-muted-foreground">Click to reveal</div>}
                </button>
              ))}
            </div>
          ) : artifact.questions?.length ? (
            <div className="flex flex-col gap-2">
              {artifact.questions.map((question, index) => (
                <div key={index} className="rounded-lg border border-border p-3">
                  <p className="text-sm">{question.question}</p>
                  {revealed.has(index)
                    ? <p className="mt-2 text-sm text-muted-foreground">Answer: {question.answer}</p>
                    : <Button className="mt-2" variant="outline" size="sm" onClick={() => setRevealed((current) => new Set(current).add(index))}>Show answer</Button>}
                </div>
              ))}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6">{artifact.body}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
