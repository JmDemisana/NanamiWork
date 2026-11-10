/** @jsxImportSource react */
import {
  ArrowLeft,
  Archive,
  BookOpen,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileQuestion,
  FileText,
  Globe,
  HardDrive,
  HelpCircle,
  Layers,
  ListChecks,
  Network,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCw,
  Search,
  Shuffle,
  Sparkles,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { parseStudyArtifact, studyArtifactRequest } from "./study-generation";
import {
  downloadSourceFile,
  getStoredSourceFile,
  removeStoredSourceFile,
  storeSourceFile,
} from "./study-file-storage";
import {
  extractGoogleDriveSource,
  extractPdfText,
  extractWebSource,
  extractYouTubeSource,
  parseGoogleDriveUrl,
  parseYouTubeUrl,
} from "./study-extractors";
import {
  useStudyStore,
  type StudyArtifact,
  type StudyArtifactKind,
  type StudyNotebook,
  type StudyPassage,
  type StudySource,
  type StudySourceKind,
} from "./study-store";

const ARTIFACT_OPTIONS: Array<{ kind: StudyArtifactKind; label: string; icon: typeof BookOpen; description: string }> = [
  { kind: "study-guide", label: "Study Guide", icon: BookOpen, description: "Structured notes and topic summaries" },
  { kind: "briefing", label: "Briefing Doc", icon: FileText, description: "Executive summary and critical facts" },
  { kind: "faq", label: "FAQ", icon: HelpCircle, description: "Frequently asked questions and answers" },
  { kind: "flashcards", label: "Flashcards", icon: Layers, description: "Interactive review cards with flip" },
  { kind: "quiz", label: "Quiz", icon: ListChecks, description: "Knowledge check with revealable answers" },
  { kind: "mind-map", label: "Mind Map", icon: Network, description: "Hierarchical concept outline" },
];

function formatDate(value: number) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sourceIcon(kind: StudySourceKind) {
  switch (kind) {
    case "pdf":
      return <FileText className="size-3.5 text-amber-500 shrink-0" />;
    case "youtube":
      return <Video className="size-3.5 text-red-500 shrink-0" />;
    case "drive":
      return <HardDrive className="size-3.5 text-blue-500 shrink-0" />;
    case "web":
      return <Globe className="size-3.5 text-emerald-500 shrink-0" />;
    default:
      return <FileText className="size-3.5 text-cyan-500 shrink-0" />;
  }
}

type StudyGenerate = (notebook: StudyNotebook, request: string) => Promise<string>;

export function StudySurface({ onChooseModel, onGenerate }: { onChooseModel: (notebookId: string) => void; onGenerate: StudyGenerate }) {
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        {notebookId ? <StudyNotebookView notebookId={notebookId} onChooseModel={onChooseModel} onGenerate={onGenerate} /> : <StudyHome />}
      </div>
    </div>
  );
}

function StudyHome() {
  const allNotebooks = useStudyStore((state) => state.notebooks);
  const notebooks = useMemo(() => {
    const list = allNotebooks.filter((notebook) => notebook.archivedAt === null);
    return list.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [allNotebooks]);

  const createNotebook = useStudyStore((state) => state.createNotebook);
  const togglePin = useStudyStore((state) => state.togglePinNotebook);
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
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" />
              <h1 className="text-2xl font-medium tracking-[-0.4px]">Study Notebooks</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Your personalized research & notebook assistant. Ground answers in PDFs, YouTube videos, web links, and documents.
            </p>
          </div>
          <Button onClick={create}>
            <Plus className="size-4" />
            New notebook
          </Button>
        </div>

        {notebooks.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-border p-10 text-center">
            <Sparkles className="mx-auto size-8 text-primary" />
            <h2 className="mt-3 text-base font-medium">Start with a notebook</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Add PDFs, notes, YouTube lectures, or articles. Study preserves sources internally and builds citations, quizzes, and flashcards.
            </p>
            <Button className="mt-4" variant="outline" onClick={create}>
              <Plus className="size-4" />
              Create notebook
            </Button>
          </div>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {notebooks.map((notebook) => (
              <div
                key={notebook.id}
                className="group relative flex flex-col justify-between rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/25"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/study/${notebook.id}`)}
                  className="flex flex-col items-start gap-2 w-full text-left"
                >
                  <div className="flex items-center gap-2 w-full">
                    <BookOpen className="size-4 text-muted-foreground shrink-0" />
                    <span className="line-clamp-1 text-sm font-medium flex-1">{notebook.title}</span>
                    {notebook.pinned ? <Pin className="size-3 text-primary shrink-0" /> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {notebook.sources.length} source{notebook.sources.length === 1 ? "" : "s"}
                    {notebook.artifacts.length > 0 ? ` · ${notebook.artifacts.length} studio artifact${notebook.artifacts.length === 1 ? "" : "s"}` : ""}
                  </span>
                  <span className="text-[11px] text-muted-foreground/70">Updated {formatDate(notebook.updatedAt)}</span>
                </button>
                <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={notebook.pinned ? "Unpin" : "Pin"}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(notebook.id);
                    }}
                  >
                    {notebook.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                  </Button>
                </div>
              </div>
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
  const toggleSourceSelection = useStudyStore((state) => state.toggleSourceSelection);
  const selectAllSources = useStudyStore((state) => state.selectAllSources);
  const togglePin = useStudyStore((state) => state.togglePinNotebook);
  const addArtifact = useStudyStore((state) => state.addArtifact);
  const removeArtifact = useStudyStore((state) => state.removeArtifact);
  const archiveNotebook = useStudyStore((state) => state.archiveNotebook);
  const deleteNotebook = useStudyStore((state) => state.deleteNotebook);
  const navigate = useNavigate();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [titleDraft, setTitleDraft] = useState(notebook.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [viewingSource, setViewingSource] = useState<StudySource | null>(null);
  const [query, setQuery] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [activeCitationPassage, setActiveCitationPassage] = useState<{ sourceName: string; citation: number; text: string } | null>(null);
  const [openArtifact, setOpenArtifact] = useState<StudyArtifact | null>(null);

  const activeSources = useMemo(() => notebook.sources.filter((s) => s.selected !== false), [notebook.sources]);
  const allSelected = notebook.sources.length > 0 && activeSources.length === notebook.sources.length;

  const ask = useCallback(async (customQuery?: string) => {
    const question = (customQuery ?? query).trim();
    if (!question || generating) return;
    if (activeSources.length === 0) {
      setGenerationError("Select at least one source on the left to ask questions.");
      return;
    }
    setChat((current) => [...current, { role: "you", text: question }]);
    if (!customQuery) setQuery("");
    setGenerationError("");
    setGenerating(true);
    try {
      const answer = await onGenerate(notebook, question);
      const referenced = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
      const passages = activeSources.flatMap((source, index) =>
        referenced.has(index + 1)
          ? [{ sourceId: source.id, sourceName: source.name, citation: index + 1, text: source.text.slice(0, 400), score: 0 }]
          : []
      );
      setChat((current) => [...current, { role: "study", text: answer, passages }]);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Study could not answer. Try again.");
      if (!customQuery) setQuery(question);
    } finally {
      setGenerating(false);
    }
  }, [activeSources, generating, notebook, onGenerate, query]);

  const createArtifact = async (kind: StudyArtifactKind) => {
    if (generating || activeSources.length === 0) return;
    setGenerationError("");
    setGenerating(true);
    try {
      const text = await onGenerate(notebook, studyArtifactRequest(kind));
      const artifact = addArtifact(notebook.id, parseStudyArtifact(kind, text));
      if (artifact) setOpenArtifact(artifact);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Study could not generate this artifact. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-study-notebook>
      {/* Top Header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 bg-card/40">
        <Button variant="ghost" size="icon-sm" aria-label="Back to notebooks" onClick={() => navigate("/study")}>
          <ArrowLeft className="size-4" />
        </Button>

        {editingTitle ? (
          <Input
            autoFocus
            className="h-7 max-w-sm text-sm"
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
            title="Click to rename notebook"
          >
            <span className="truncate text-sm font-medium">{notebook.title}</span>
            <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100" />
          </button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            title={notebook.pinned ? "Unpin notebook" : "Pin notebook"}
            onClick={() => togglePin(notebook.id)}
            className={notebook.pinned ? "text-primary" : "text-muted-foreground"}
          >
            {notebook.pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
          </Button>

          {/* Model badge */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5 border-border/80 bg-background/50 hover:bg-accent"
            onClick={() => onChooseModel(notebook.id)}
            title="Select AI Model for this notebook"
          >
            <Sparkles className="size-3 text-primary" />
            <span className="max-w-40 truncate">{notebook.model?.modelID || "Choose model"}</span>
            {notebook.modelVariant ? <span className="text-[10px] text-muted-foreground">({notebook.modelVariant})</span> : null}
          </Button>

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
            <Archive className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete notebook"
            title="Delete notebook"
            className="hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </header>

      {/* Main 3-column NotebookLM Layout */}
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_300px] max-lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* LEFT COLUMN: Sources */}
        <aside className="flex min-h-0 flex-col border-e border-border bg-card/20" data-study-sources>
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 px-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Sources</span>
              <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
                {notebook.sources.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {notebook.sources.length > 0 ? (
                <button
                  type="button"
                  onClick={() => selectAllSources(notebook.id, !allSelected)}
                  className="text-[11px] text-muted-foreground hover:text-foreground px-1 py-0.5"
                  title={allSelected ? "Deselect all" : "Select all"}
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              ) : null}
              <Button
                variant="outline"
                size="icon-xs"
                className="size-6 rounded-md"
                aria-label="Add source"
                title="Add source (PDF, YouTube, Web, Drive, Text)"
                onClick={() => setSourceModalOpen(true)}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
            {notebook.sources.length === 0 ? (
              <div className="p-4 text-center">
                <BookOpen className="mx-auto size-6 text-muted-foreground/60" />
                <p className="mt-2 text-xs font-medium text-foreground">No sources yet</p>
                <p className="mt-1 text-[11px] text-muted-foreground">Add PDFs, web links, YouTube videos, or notes to get started.</p>
                <Button variant="outline" size="sm" className="mt-3 w-full text-xs" onClick={() => setSourceModalOpen(true)}>
                  <Plus className="size-3.5" /> Add source
                </Button>
              </div>
            ) : (
              notebook.sources.map((source, index) => {
                const isSelected = source.selected !== false;
                return (
                  <div
                    key={source.id}
                    className={cn(
                      "group flex items-center gap-2 rounded-lg p-2 text-xs transition-colors",
                      isSelected ? "bg-muted/60 hover:bg-muted" : "opacity-50 hover:opacity-80 hover:bg-muted/30"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSourceSelection(notebook.id, source.id)}
                      className="size-3.5 rounded border-border accent-primary cursor-pointer shrink-0"
                      title={isSelected ? "Included in Study answers" : "Excluded from Study answers"}
                    />
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => setViewingSource(source)}
                      title="Click to view full source and export"
                    >
                      {sourceIcon(source.kind)}
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground/90">{source.name}</span>
                        <span className="block text-[10px] text-muted-foreground truncate">
                          [{index + 1}] · {source.pageCount ? `${source.pageCount} pgs · ` : ""}{Math.max(1, Math.round(source.sizeBytes / 1024))} KB
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${source.name}`}
                      className="opacity-0 transition-opacity group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        removeSource(notebook.id, source.id);
                        void removeStoredSourceFile(source.id);
                      }}
                      title="Remove source"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-border p-2">
            <Button variant="outline" size="sm" className="w-full justify-center text-xs" onClick={() => setSourceModalOpen(true)}>
              <Plus className="size-3.5 mr-1" />
              Add source
            </Button>
          </div>
        </aside>

        {/* CENTER COLUMN: Chat & NotebookLM Guide */}
        <main className="flex min-h-0 flex-1 flex-col bg-background" data-study-chat>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
            {/* Citation passage preview banner if clicked */}
            {activeCitationPassage ? (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 animate-in fade-in">
                <div className="flex items-center justify-between gap-2 border-b border-primary/20 pb-1.5 mb-2">
                  <span className="text-xs font-medium text-primary flex items-center gap-1.5">
                    <span className="flex size-4 items-center justify-center rounded bg-primary/20 text-[10px]">
                      {activeCitationPassage.citation}
                    </span>
                    Cited from: {activeCitationPassage.sourceName}
                  </span>
                  <Button variant="ghost" size="icon-xs" onClick={() => setActiveCitationPassage(null)}>
                    <X className="size-3" />
                  </Button>
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90 font-mono bg-card/60 p-2.5 rounded-lg border border-border/50">
                  {activeCitationPassage.text}
                </p>
              </div>
            ) : null}

            {/* NotebookLM Guide Card (Shown if sources exist and chat is short) */}
            {notebook.sources.length > 0 && chat.length <= 1 ? (
              <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-card/70 p-5 shadow-sm">
                <div className="flex items-center gap-2 text-primary">
                  <Sparkles className="size-4" />
                  <h2 className="text-sm font-semibold tracking-tight">Notebook Guide</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Study is grounded in your {activeSources.length} active source{activeSources.length === 1 ? "" : "s"}. Every answer includes citations pointing directly to passages in your files.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void ask("Summarize the main themes, key concepts, and insights from these sources.")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background px-3 py-1.5 text-xs text-foreground/90 transition-colors hover:border-primary/50 hover:bg-muted"
                  >
                    <span>✨ Summarize sources</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void ask("What are the most important takeaways and conclusions across all sources?")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background px-3 py-1.5 text-xs text-foreground/90 transition-colors hover:border-primary/50 hover:bg-muted"
                  >
                    <span>💡 Key takeaways</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void ask("Create a comprehensive FAQ (Frequently Asked Questions) with answers based on the sources.")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background px-3 py-1.5 text-xs text-foreground/90 transition-colors hover:border-primary/50 hover:bg-muted"
                  >
                    <span>❓ Generate FAQ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void createArtifact("study-guide")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background px-3 py-1.5 text-xs text-foreground/90 transition-colors hover:border-primary/50 hover:bg-muted"
                  >
                    <span>📖 Make Study Guide</span>
                  </button>
                </div>
              </div>
            ) : null}

            {/* Zero sources empty state */}
            {notebook.sources.length === 0 && chat.length === 0 ? (
              <div className="mx-auto mt-16 max-w-md text-center">
                <Search className="mx-auto size-8 text-muted-foreground/60" />
                <h2 className="mt-3 text-base font-medium">Add sources to get started</h2>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Upload PDF documents, add YouTube lecture links, Google Docs, or paste lecture notes. Study answers questions and builds learning materials exclusively from your materials.
                </p>
                <Button className="mt-4 text-xs" onClick={() => setSourceModalOpen(true)}>
                  <Plus className="size-3.5 mr-1" /> Add your first source
                </Button>
              </div>
            ) : null}

            {/* Chat Messages */}
            {chat.map((entry, index) => (
              <div key={index} className={cn("mx-auto max-w-2xl rounded-xl p-4", entry.role === "you" ? "bg-muted/50 border border-border/40" : "bg-card border border-border")}>
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {entry.role === "you" ? (
                    <span>You</span>
                  ) : (
                    <span className="flex items-center gap-1 text-primary">
                      <Sparkles className="size-3" /> Study
                    </span>
                  )}
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/95">
                  {entry.text}
                </div>

                {/* Cited Passages */}
                {entry.passages?.length ? (
                  <div className="mt-4 border-t border-border/50 pt-3">
                    <span className="text-[11px] font-medium text-muted-foreground block mb-2">Sources Cited:</span>
                    <div className="flex flex-wrap gap-2">
                      {entry.passages.map((passage, pIndex) => (
                        <button
                          key={pIndex}
                          type="button"
                          onClick={() => setActiveCitationPassage(passage)}
                          className="flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/60 px-2 py-1 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted"
                        >
                          <span className="flex size-4 items-center justify-center rounded bg-primary/15 text-[10px] text-primary font-bold">
                            {passage.citation}
                          </span>
                          <span className="truncate max-w-48 font-medium">{passage.sourceName}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {/* Bottom Chat Prompt Input */}
          <div className="shrink-0 border-t border-border p-3 bg-card/30">
            <div className="mx-auto max-w-2xl">
              <div className="flex items-end gap-2">
                <Textarea
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void ask();
                    }
                  }}
                  placeholder={
                    activeSources.length === 0
                      ? "Select at least one source to ask questions…"
                      : `Ask about your ${activeSources.length} source${activeSources.length === 1 ? "" : "s"}…`
                  }
                  className="min-h-11 resize-none text-sm"
                  rows={1}
                />
                <Button
                  onClick={() => void ask()}
                  disabled={!query.trim() || generating || activeSources.length === 0}
                  className="h-11 px-4 text-xs"
                >
                  {generating ? "Thinking…" : "Ask"}
                </Button>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {activeSources.length} of {notebook.sources.length} source{notebook.sources.length === 1 ? "" : "s"} active
                </span>
                {generationError ? <span className="text-destructive font-medium">{generationError}</span> : null}
              </div>
            </div>
          </div>
        </main>

        {/* RIGHT COLUMN: Studio Panel */}
        <aside className="flex min-h-0 flex-col border-s border-border bg-card/20 max-lg:hidden" data-study-studio>
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 px-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Studio</span>
            <span className="text-[11px] text-muted-foreground">{notebook.artifacts.length} saved</span>
          </div>

          <div className="p-3 border-b border-border/60">
            <span className="text-[11px] font-medium text-muted-foreground block mb-2">Create Learning Materials:</span>
            <div className="grid grid-cols-2 gap-1.5">
              {ARTIFACT_OPTIONS.map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  onClick={() => void createArtifact(option.kind)}
                  disabled={activeSources.length === 0 || generating}
                  className="flex flex-col items-start gap-1 rounded-lg border border-border/70 bg-card p-2 text-left transition-colors hover:border-primary/50 hover:bg-muted/60 disabled:opacity-50"
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <option.icon className="size-3.5 text-primary" />
                    {option.label}
                  </div>
                  <span className="text-[10px] text-muted-foreground line-clamp-1">{option.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground px-2 pt-1 block">
              Artifacts & Notes
            </span>
            {notebook.artifacts.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground text-center">
                Create a Study Guide, Flashcards, or Quiz to populate your studio.
              </p>
            ) : (
              notebook.artifacts.map((artifact) => (
                <div key={artifact.id} className="group flex items-center justify-between rounded-lg p-2 text-xs hover:bg-muted/60 transition-colors">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenArtifact(artifact)}>
                    <span className="block truncate font-medium text-foreground">{artifact.title}</span>
                    <span className="block text-[10px] text-muted-foreground">{artifact.body.slice(0, 50)}...</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete ${artifact.title}`}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    onClick={() => removeArtifact(notebook.id, artifact.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      {/* ADD SOURCE MODAL (Files, YouTube, Web, Drive, Notes) */}
      {sourceModalOpen ? (
        <AddSourceModal
          onClose={() => setSourceModalOpen(false)}
          onAdd={async (source, fileBlob) => {
            const added = addSource(notebook.id, source);
            if (added && fileBlob) {
              await storeSourceFile(added.id, added.name, added.mimeType || "application/octet-stream", fileBlob);
            }
            setSourceModalOpen(false);
          }}
        />
      ) : null}

      {/* VIEW SOURCE MODAL / EXPORT */}
      {viewingSource ? (
        <ViewSourceModal source={viewingSource} onClose={() => setViewingSource(null)} />
      ) : null}

      {/* ARTIFACT MODAL (Interactive Flashcards, Quiz, Guide) */}
      {openArtifact ? (
        <ArtifactDialog artifact={openArtifact} onClose={() => setOpenArtifact(null)} />
      ) : null}

      {/* DELETE CONFIRM DIALOG */}
      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-xl">
            <h2 className="text-sm font-medium">Delete this notebook?</h2>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              “{notebook.title}” and its {notebook.sources.length} sources and {notebook.artifacts.length} artifacts will be permanently deleted from this computer.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  notebook.sources.forEach((s) => void removeStoredSourceFile(s.id));
                  deleteNotebook(notebook.id);
                  setConfirmDelete(false);
                  navigate("/study");
                }}
              >
                <Trash2 className="size-3.5 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** MODAL: Add Sources (File upload with PDF text extraction, YouTube, Google Drive, Web, Text) */
function AddSourceModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (source: Omit<StudySource, "id" | "addedAt">, originalBlob?: Blob) => Promise<void>;
}) {
  const [tab, setTab] = useState<"file" | "youtube" | "drive" | "web" | "text">("file");
  const [urlInput, setUrlInput] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const name = file.name;
      const lower = name.toLowerCase();

      if (lower.endsWith(".pdf") || file.type === "application/pdf") {
        const { text, pageCount } = await extractPdfText(file);
        await onAdd({
          name,
          kind: "pdf",
          mimeType: "application/pdf",
          sizeBytes: file.size,
          text,
          pageCount,
        }, file);
        return;
      }

      // Plain text, markdown, json, csv
      const text = await file.text();
      if (!text.trim()) throw new Error("The selected file is empty.");
      const kind: StudySourceKind = lower.endsWith(".md") || lower.endsWith(".markdown") ? "markdown" : "text";

      await onAdd({
        name,
        kind,
        mimeType: file.type || "text/plain",
        sizeBytes: file.size,
        text,
        pageCount: null,
      }, file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read this file.");
    } finally {
      setLoading(false);
    }
  };

  const handleYouTube = async () => {
    if (!urlInput.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await extractYouTubeSource(urlInput);
      await onAdd({
        name: res.name,
        kind: "youtube",
        mimeType: "text/plain",
        sizeBytes: new Blob([res.text]).size,
        text: res.text,
        url: urlInput,
        pageCount: null,
      }, new Blob([res.text], { type: "text/plain" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract YouTube content.");
    } finally {
      setLoading(false);
    }
  };

  const handleDrive = async () => {
    if (!urlInput.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await extractGoogleDriveSource(urlInput);
      await onAdd({
        name: res.name,
        kind: "drive",
        mimeType: "text/plain",
        sizeBytes: new Blob([res.text]).size,
        text: res.text,
        url: urlInput,
        pageCount: null,
      }, new Blob([res.text], { type: "text/plain" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract Google Doc/Sheet.");
    } finally {
      setLoading(false);
    }
  };

  const handleWeb = async () => {
    if (!urlInput.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await extractWebSource(urlInput);
      await onAdd({
        name: res.name,
        kind: "web",
        mimeType: "text/html",
        sizeBytes: new Blob([res.text]).size,
        text: res.text,
        url: urlInput,
        pageCount: null,
      }, new Blob([res.text], { type: "text/plain" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch webpage content.");
    } finally {
      setLoading(false);
    }
  };

  const handleText = async () => {
    const text = textContent.trim();
    if (!text) {
      setError("Please paste some text first.");
      return;
    }
    const name = textTitle.trim() || `Copied Text (${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`;
    await onAdd({
      name,
      kind: "text",
      mimeType: "text/plain",
      sizeBytes: new Blob([text]).size,
      text,
      pageCount: null,
    }, new Blob([text], { type: "text/plain" }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Plus className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Add Sources</h2>
          </div>
          <Button variant="ghost" size="icon-xs" onClick={onClose}><X className="size-4" /></Button>
        </div>

        {/* Source Kind Tabs */}
        <div className="mt-3 flex rounded-lg bg-muted/60 p-1 gap-1 text-xs">
          <button
            type="button"
            onClick={() => { setTab("file"); setError(""); }}
            className={cn("flex-1 rounded-md py-1.5 font-medium transition-colors flex items-center justify-center gap-1.5", tab === "file" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
          >
            <FileText className="size-3.5" /> File (.pdf, .md, .txt)
          </button>
          <button
            type="button"
            onClick={() => { setTab("youtube"); setError(""); }}
            className={cn("flex-1 rounded-md py-1.5 font-medium transition-colors flex items-center justify-center gap-1.5", tab === "youtube" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
          >
            <Video className="size-3.5" /> YouTube
          </button>
          <button
            type="button"
            onClick={() => { setTab("drive"); setError(""); }}
            className={cn("flex-1 rounded-md py-1.5 font-medium transition-colors flex items-center justify-center gap-1.5", tab === "drive" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
          >
            <HardDrive className="size-3.5" /> Google Drive
          </button>
          <button
            type="button"
            onClick={() => { setTab("web"); setError(""); }}
            className={cn("flex-1 rounded-md py-1.5 font-medium transition-colors flex items-center justify-center gap-1.5", tab === "web" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
          >
            <Globe className="size-3.5" /> Website
          </button>
          <button
            type="button"
            onClick={() => { setTab("text"); setError(""); }}
            className={cn("flex-1 rounded-md py-1.5 font-medium transition-colors flex items-center justify-center gap-1.5", tab === "text" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
          >
            <Pencil className="size-3.5" /> Paste Text
          </button>
        </div>

        <div className="mt-4">
          {tab === "file" && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer rounded-xl border border-dashed border-border p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
            >
              <FileText className="mx-auto size-8 text-primary" />
              <h3 className="mt-2 text-sm font-medium">Upload PDF, Markdown, or Text files</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Supports PDF (with text extraction), Markdown (.md), Plain Text (.txt), JSON, and CSV.
              </p>
              <div className="mt-4">
                <Button size="sm" variant="outline" disabled={loading} type="button">
                  {loading ? "Reading & Extracting..." : "Choose File"}
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,.markdown,.json,.csv,application/pdf,text/plain,text/markdown"
                className="hidden"
                onChange={(e) => void handleFileUpload(e.target.files?.[0])}
              />
              <p className="mt-3 text-[11px] text-muted-foreground/80">
                🔒 Files are saved internally to NanamiWork. You can delete the file from your disk afterwards.
              </p>
            </div>
          )}

          {tab === "youtube" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Paste any YouTube video link. Study will extract the video details and transcript.
              </p>
              <Input
                placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleYouTube(); }}
              />
              <Button onClick={() => void handleYouTube()} disabled={!urlInput.trim() || loading} className="w-full text-xs">
                {loading ? "Fetching video & transcript…" : "Add YouTube Video"}
              </Button>
            </div>
          )}

          {tab === "drive" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Paste a Google Docs or Google Sheets link with sharing set to &ldquo;Anyone with the link can view&rdquo;.
              </p>
              <Input
                placeholder="https://docs.google.com/document/d/... or spreadsheets/d/..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleDrive(); }}
              />
              <Button onClick={() => void handleDrive()} disabled={!urlInput.trim() || loading} className="w-full text-xs">
                {loading ? "Exporting Google Doc…" : "Import Google Doc / Sheet"}
              </Button>
            </div>
          )}

          {tab === "web" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Enter any public webpage or article URL to extract its main readable text.
              </p>
              <Input
                placeholder="https://example.com/article"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleWeb(); }}
              />
              <Button onClick={() => void handleWeb()} disabled={!urlInput.trim() || loading} className="w-full text-xs">
                {loading ? "Fetching article content…" : "Import Webpage"}
              </Button>
            </div>
          )}

          {tab === "text" && (
            <div className="space-y-3">
              <Input
                placeholder="Source title (optional)"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
              />
              <Textarea
                placeholder="Paste lecture notes, interview transcripts, research notes, or copied text…"
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                className="min-h-36 text-xs"
              />
              <Button onClick={() => void handleText()} disabled={!textContent.trim() || loading} className="w-full text-xs">
                Add Pasted Text Source
              </Button>
            </div>
          )}

          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

/** MODAL: View full source details and export/download stored file */
function ViewSourceModal({ source, onClose }: { source: StudySource; onClose: () => void }) {
  const [downloading, setDownloading] = useState(false);

  const handleExport = async () => {
    setDownloading(true);
    try {
      const stored = await getStoredSourceFile(source.id);
      if (stored) {
        downloadSourceFile(stored.name, stored.blob, stored.mimeType);
      } else {
        // Fallback to text
        const extension = source.kind === "markdown" ? ".md" : source.kind === "pdf" ? ".txt" : ".txt";
        const name = source.name.includes(".") ? source.name : `${source.name}${extension}`;
        downloadSourceFile(name, source.text, source.mimeType || "text/plain");
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs" role="dialog" aria-modal="true">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2 min-w-0">
            {sourceIcon(source.kind)}
            <h2 className="text-sm font-semibold truncate">{source.name}</h2>
            <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground uppercase">{source.kind}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="xs" onClick={() => void handleExport()} disabled={downloading}>
              <Download className="size-3 mr-1" />
              {downloading ? "Exporting…" : "Download File"}
            </Button>
            {source.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Open original link"
              >
                <ExternalLink className="size-3.5" />
              </a>
            ) : null}
            <Button variant="ghost" size="icon-xs" onClick={onClose}><X className="size-4" /></Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground pb-2 border-b border-border/40">
            <span>Size: {Math.max(1, Math.round(source.sizeBytes / 1024))} KB</span>
            {source.pageCount ? <span>Pages: {source.pageCount}</span> : null}
            <span>Added: {new Date(source.addedAt).toLocaleDateString()}</span>
          </div>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground/90">
            {source.text}
          </pre>
        </div>
      </div>
    </div>
  );
}

/** MODAL: Interactive Artifact Dialog (Flashcards with 3D Flip, Quiz Runner, Guide Document) */
function ArtifactDialog({ artifact, onClose }: { artifact: StudyArtifact; onClose: () => void }) {
  const [cardIndex, setCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [shuffledCards, setShuffledCards] = useState(artifact.cards ?? []);
  const [revealedQuestions, setRevealedQuestions] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    void navigator.clipboard.writeText(artifact.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shuffle = () => {
    if (!artifact.cards) return;
    const shuffled = [...artifact.cards].sort(() => Math.random() - 0.5);
    setShuffledCards(shuffled);
    setCardIndex(0);
    setIsFlipped(false);
  };

  const nextCard = () => {
    if (cardIndex < shuffledCards.length - 1) {
      setCardIndex(cardIndex + 1);
      setIsFlipped(false);
    }
  };

  const prevCard = () => {
    if (cardIndex > 0) {
      setCardIndex(cardIndex - 1);
      setIsFlipped(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs" role="dialog" aria-modal="true">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <Brain className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">{artifact.title}</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="xs" onClick={copyToClipboard}>
              {copied ? <Check className="size-3 mr-1 text-emerald-500" /> : <Copy className="size-3 mr-1" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="ghost" size="icon-xs" onClick={onClose}><X className="size-4" /></Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* FLASHCARD INTERACTIVE VIEWER */}
          {shuffledCards.length > 0 ? (
            <div className="flex flex-col items-center justify-center py-4">
              <div className="w-full flex items-center justify-between text-xs text-muted-foreground mb-3 px-2">
                <span>Card {cardIndex + 1} of {shuffledCards.length}</span>
                <Button variant="ghost" size="xs" onClick={shuffle}>
                  <Shuffle className="size-3 mr-1" /> Shuffle
                </Button>
              </div>

              {/* Card Container with Flip */}
              <div
                onClick={() => setIsFlipped(!isFlipped)}
                className="w-full min-h-56 cursor-pointer rounded-2xl border border-border bg-muted/40 p-6 shadow-sm flex flex-col justify-between transition-all hover:border-primary/40 text-center select-none"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {isFlipped ? "Answer" : "Question"} · (Click to flip)
                </div>
                <div className="my-auto py-4 text-base font-medium text-foreground leading-relaxed">
                  {isFlipped ? shuffledCards[cardIndex]?.back : shuffledCards[cardIndex]?.front}
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                  <RotateCw className="size-3" /> Tap space or card to flip
                </div>
              </div>

              {/* Card Controls */}
              <div className="mt-4 flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={prevCard} disabled={cardIndex === 0}>
                  <ChevronLeft className="size-4 mr-1" /> Previous
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIsFlipped(!isFlipped)}>
                  Flip Card
                </Button>
                <Button variant="outline" size="sm" onClick={nextCard} disabled={cardIndex === shuffledCards.length - 1}>
                  Next <ChevronRight className="size-4 ml-1" />
                </Button>
              </div>
            </div>
          ) : artifact.questions?.length ? (
            /* QUIZ VIEWER */
            <div className="space-y-4">
              <span className="text-xs text-muted-foreground block">
                {artifact.questions.length} Question Knowledge Check:
              </span>
              {artifact.questions.map((q, idx) => {
                const isRevealed = revealedQuestions.has(idx);
                return (
                  <div key={idx} className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                    <p className="text-sm font-medium text-foreground">
                      {idx + 1}. {q.question}
                    </p>
                    {isRevealed ? (
                      <div className="rounded-lg bg-card p-3 border border-border text-xs text-foreground/90 leading-relaxed animate-in fade-in">
                        <span className="font-semibold text-emerald-500 block mb-1">Answer:</span>
                        {q.answer}
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => setRevealedQuestions((prev) => new Set(prev).add(idx))}
                      >
                        Show Answer
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* GUIDE / FAQ / BRIEFING / MIND MAP VIEWER */
            <div className="space-y-4">
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground/90">
                {artifact.body}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
