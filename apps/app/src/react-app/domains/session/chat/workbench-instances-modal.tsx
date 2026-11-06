/** @jsxImportSource react */
import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Laptop,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { applyEdits, modify, parse } from "jsonc-parser";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readOpencodeConfig, writeOpencodeConfig, type OpencodeConfigFile } from "@/app/lib/desktop";
import { dispatchNewProviders, dispatchProviderCatalogChanged } from "@/app/lib/provider-events";

type StandardPreset = {
  id: string;
  title: string;
  model: string;
  detail: string;
  providerId: string;
  icon: typeof Bot;
};

const STANDARD_PRESETS: readonly StandardPreset[] = [
  {
    id: "google",
    title: "Google AI Studio API (Free API)",
    model: "Gemini 3.6 Flash Medium",
    detail: "Connect a personal Google AI Studio API key. Lists available models for your account.",
    providerId: "google",
    icon: KeyRound,
  },
  {
    id: "github-copilot",
    title: "GitHub Copilot",
    model: "Copilot models",
    detail: "Authenticate with your GitHub browser flow or token. Uses student, individual, or business plan.",
    providerId: "github-copilot",
    icon: Bot,
  },
  {
    id: "opencode",
    title: "OpenCode Zen",
    model: "Zen models",
    detail: "Connect an OpenCode Zen key with native local authentication.",
    providerId: "opencode",
    icon: Sparkles,
  },
];

type ProviderEntry = {
  name?: string;
  npm?: string;
  options?: {
    baseURL?: string;
    apiKey?: string;
    [key: string]: unknown;
  };
  models?: Record<
    string,
    {
      name?: string;
      limit?: { context?: number; output?: number };
      capabilities?: Record<string, unknown>;
    }
  >;
  [key: string]: unknown;
};

export function WorkbenchInstancesModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectedProviderIds: readonly string[];
  onOpenProviderAuth: (providerId?: string) => void;
  onRefreshProviders?: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<"list" | "form">("list");
  const [customProviders, setCustomProviders] = useState<Record<string, ProviderEntry>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formModelId, setFormModelId] = useState("gemini-3.8-flash");
  const [formModelName, setFormModelName] = useState("Gemini 3.8 Flash");

  const connected = new Set(props.connectedProviderIds.map((id) => id.toLowerCase()));

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = (await readOpencodeConfig("global", "")) as OpencodeConfigFile;
      if (res && res.content) {
        const parsed = parse(res.content) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && parsed.provider && typeof parsed.provider === "object") {
          setCustomProviders(parsed.provider as Record<string, ProviderEntry>);
          return;
        }
      }
      setCustomProviders({});
    } catch (e) {
      console.warn("Could not load global opencode config:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (props.open) {
      setMode("list");
      setError(null);
      setSuccess(null);
      void loadConfig();
    }
  }, [props.open]);

  const openAddForm = (preset?: "antigravity" | "custom") => {
    setError(null);
    setSuccess(null);
    setEditingSlug(null);

    if (preset === "antigravity") {
      // Find an available slug like antigravity-work or antigravity-2 if antigravity-personal exists
      const existingSlugs = Object.keys(customProviders);
      let candidate = "antigravity-work";
      let count = 2;
      if (existingSlugs.includes("antigravity-personal") && !existingSlugs.includes("antigravity-work")) {
        candidate = "antigravity-work";
      } else {
        while (existingSlugs.includes(candidate)) {
          candidate = `antigravity-account-${count}`;
          count++;
        }
      }

      setFormName(candidate === "antigravity-work" ? "Google Antigravity (Work)" : "Google Antigravity");
      setFormSlug(candidate);
      setFormBaseUrl("http://127.0.0.1:8080/v1");
      setFormApiKey("");
      setFormModelId("gemini-3.8-flash");
      setFormModelName("Gemini 3.8 Flash");
    } else {
      setFormName("");
      setFormSlug("");
      setFormBaseUrl("http://localhost:11434/v1");
      setFormApiKey("");
      setFormModelId("default");
      setFormModelName("Default Model");
    }

    setMode("form");
  };

  const openEditForm = (slug: string, entry: ProviderEntry) => {
    setError(null);
    setSuccess(null);
    setEditingSlug(slug);
    setFormName(entry.name || slug);
    setFormSlug(slug);
    setFormBaseUrl(entry.options?.baseURL || "");
    setFormApiKey(typeof entry.options?.apiKey === "string" ? entry.options.apiKey : "");

    const firstModelKey = entry.models ? Object.keys(entry.models)[0] : "gemini-3.8-flash";
    const firstModel = firstModelKey && entry.models ? entry.models[firstModelKey] : undefined;
    setFormModelId(firstModelKey || "gemini-3.8-flash");
    setFormModelName(firstModel?.name || firstModelKey || "Gemini 3.8 Flash");

    setMode("form");
  };

  const handleSave = async () => {
    const cleanName = formName.trim();
    const cleanSlug = formSlug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const cleanBaseUrl = formBaseUrl.trim().replace(/\/+$/, "");
    const cleanApiKey = formApiKey.trim();
    const cleanModelId = formModelId.trim() || "gemini-3.8-flash";
    const cleanModelName = formModelName.trim() || cleanModelId;

    if (!cleanName) {
      setError("Please provide an instance display name.");
      return;
    }
    if (!cleanSlug) {
      setError("Please provide a valid slug (letters, numbers, hyphens).");
      return;
    }
    if (!cleanBaseUrl) {
      setError("Please enter a valid Base URL.");
      return;
    }

    try {
      setBusy(true);
      setError(null);

      const configRes = (await readOpencodeConfig("global", "")) as OpencodeConfigFile;
      const raw = configRes?.content ?? "{\n  \"$schema\": \"https://opencode.ai/config.json\"\n}\n";

      const newEntry: ProviderEntry = {
        npm: "@ai-sdk/openai-compatible",
        name: cleanName,
        options: {
          baseURL: cleanBaseUrl,
          apiKey: cleanApiKey || "local",
        },
        models: {
          [cleanModelId]: {
            name: cleanModelName,
            limit: {
              context: 128000,
              output: 16384,
            },
            capabilities: {
              tools: true,
              reasoning: true,
              input: ["text", "image"],
              output: ["text"],
            },
          },
        },
      };

      const edits = modify(raw, ["provider", cleanSlug], newEntry, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      });
      const updated = applyEdits(raw, edits);

      const writeResult = (await writeOpencodeConfig("global", "", updated)) as { ok?: boolean; stderr?: string };
      if (writeResult && writeResult.ok === false) {
        throw new Error(writeResult.stderr || "Failed to update opencode config file");
      }

      // Signal providers update
      dispatchNewProviders({
        providers: [
          {
            id: cleanSlug,
            name: cleanName,
            providerId: cleanSlug,
            firstModelId: cleanModelId,
            firstModelName: cleanModelName,
          },
        ],
        source: "local_config",
      });
      dispatchProviderCatalogChanged({ baseUrl: cleanBaseUrl });
      props.onRefreshProviders?.();

      setSuccess(`Instance "${cleanName}" (${cleanSlug}) saved!`);
      await loadConfig();
      setTimeout(() => {
        setSuccess(null);
        setMode("list");
      }, 900);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save instance");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (slug: string, instanceName: string) => {
    if (slug === "nanami") {
      setError("Cannot remove the default Nanami Gateway instance.");
      return;
    }
    if (!window.confirm(`Remove instance "${instanceName}" (${slug})?`)) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const configRes = (await readOpencodeConfig("global", "")) as OpencodeConfigFile;
      const raw = configRes?.content ?? "";
      if (!raw) return;

      const edits = modify(raw, ["provider", slug], undefined, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      });
      const updated = applyEdits(raw, edits);

      await writeOpencodeConfig("global", "", updated);
      dispatchProviderCatalogChanged({ baseUrl: "" });
      props.onRefreshProviders?.();

      await loadConfig();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove instance");
    } finally {
      setBusy(false);
    }
  };

  const customSlugs = Object.keys(customProviders);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[min(calc(100vw-2rem),46rem)] max-w-[46rem] max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b border-dls-border shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-lg font-semibold text-dls-text">
                Nanami Workbench Instances
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs text-dls-secondary">
                Configure your Antigravity accounts, local routes, and custom OpenAI-compatible providers.
              </DialogDescription>
            </div>
            {mode === "list" ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => openAddForm("antigravity")}
                >
                  <Plus size={14} /> Add Antigravity
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  className="h-8 gap-1.5 text-xs bg-dls-accent text-white hover:opacity-90"
                  onClick={() => openAddForm("custom")}
                >
                  <Plus size={14} /> Custom
                </Button>
              </div>
            ) : null}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error ? (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-500">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {success ? (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-500">
              <CheckCircle2 size={16} className="shrink-0" />
              <span>{success}</span>
            </div>
          ) : null}

          {mode === "form" ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-dls-border">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-dls-secondary hover:text-dls-text -ml-2"
                  onClick={() => setMode("list")}
                >
                  <ArrowLeft size={14} /> Back to Instances
                </Button>
                <span className="text-xs font-medium text-dls-secondary">
                  {editingSlug ? `Editing: ${editingSlug}` : "New Instance Setup"}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-dls-text">Instance Display Name</Label>
                  <Input
                    placeholder="e.g. Google Antigravity (Work)"
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      if (!editingSlug) {
                        setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"));
                      }
                    }}
                    className="h-9 text-xs"
                  />
                  <p className="text-[11px] text-dls-secondary">Friendly name shown in model and instance selectors.</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-dls-text">Identifier Slug</Label>
                  <Input
                    placeholder="e.g. antigravity-work"
                    value={formSlug}
                    disabled={Boolean(editingSlug)}
                    onChange={(e) => setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))}
                    className="h-9 text-xs font-mono"
                  />
                  <p className="text-[11px] text-dls-secondary">Unique provider key stored in opencode.json.</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-dls-text">Base URL (OpenAI-compatible Endpoint)</Label>
                <Input
                  placeholder="e.g. http://127.0.0.1:8080/v1 or http://localhost:11434/v1"
                  value={formBaseUrl}
                  onChange={(e) => setFormBaseUrl(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
                <p className="text-[11px] text-dls-secondary">
                  Loopback address of your Antigravity language server or OpenAI-compatible backend.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-dls-text">API Key / Bridge Token (Optional)</Label>
                <Input
                  type="password"
                  placeholder="Leave empty if local bridge does not require authentication"
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-dls-text">Model ID</Label>
                  <Input
                    placeholder="e.g. gemini-3.8-flash"
                    value={formModelId}
                    onChange={(e) => setFormModelId(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-dls-text">Model Display Name</Label>
                  <Input
                    placeholder="e.g. Gemini 3.8 Flash"
                    value={formModelName}
                    onChange={(e) => setFormModelName(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-dls-border">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setMode("list")}
                  className="h-9 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleSave()}
                  className="h-9 text-xs bg-dls-accent text-white hover:opacity-90 gap-1.5"
                >
                  {busy ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                  {editingSlug ? "Save Changes" : "Save Instance"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Configured Custom / Multi-Instance Providers */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-dls-text uppercase tracking-wider">
                    Configured Instances ({customSlugs.length})
                  </h3>
                  {loading ? <RefreshCw size={12} className="animate-spin text-dls-secondary" /> : null}
                </div>

                <div className="grid gap-2.5">
                  {customSlugs.map((slug) => {
                    const entry = customProviders[slug] || {};
                    const isDefault = slug === "nanami";
                    const isAntigravity = slug.includes("antigravity");
                    const Icon = isDefault ? Check : isAntigravity ? Laptop : Bot;
                    const modelKeys = Object.keys(entry.models || {});
                    const firstModel = modelKeys[0] ? entry.models?.[modelKeys[0]]?.name || modelKeys[0] : "Default";

                    return (
                      <div
                        key={slug}
                        className="flex items-center justify-between gap-3 rounded-xl border border-dls-border bg-dls-hover/30 p-3.5 transition-colors hover:bg-dls-hover/60"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-dls-surface text-dls-accent">
                            <Icon size={18} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-xs text-dls-text truncate">
                                {entry.name || slug}
                              </span>
                              <span
                                className={
                                  isDefault
                                    ? "rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-500"
                                    : "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500"
                                }
                              >
                                {isDefault ? "Default" : "Active"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-dls-secondary font-mono truncate">
                              <span>slug: {slug}</span>
                              <span>•</span>
                              <span className="truncate">{entry.options?.baseURL || "local"}</span>
                              <span>•</span>
                              <span className="text-dls-accent font-sans">{firstModel}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isDefault ? (
                            <span className="text-[11px] text-dls-secondary px-2">Primary Route</span>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-dls-secondary hover:text-dls-text gap-1"
                                onClick={() => openEditForm(slug, entry)}
                              >
                                <Settings2 size={13} /> Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-red-400 hover:text-red-500 hover:bg-red-500/10"
                                onClick={() => void handleRemove(slug, entry.name || slug)}
                              >
                                <Trash2 size={13} />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Standard Provider Templates */}
              <div className="space-y-2.5 pt-2 border-t border-dls-border">
                <h3 className="text-xs font-semibold text-dls-text uppercase tracking-wider">
                  Cloud & Native Providers
                </h3>
                <div className="grid gap-2.5">
                  {STANDARD_PRESETS.map((preset) => {
                    const Icon = preset.icon;
                    const isConnected =
                      connected.has(preset.id) ||
                      (preset.id === "github-copilot" && connected.has("github"));

                    return (
                      <div
                        key={preset.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-dls-border bg-dls-hover/20 p-3.5"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-dls-surface text-dls-accent">
                            <Icon size={18} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-xs text-dls-text truncate">{preset.title}</h4>
                              <span
                                className={
                                  isConnected
                                    ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500"
                                    : "rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                                }
                              >
                                {isConnected ? "Connected" : "Setup needed"}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-dls-secondary leading-snug">
                              {preset.detail}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            size="sm"
                            variant={isConnected ? "outline" : "default"}
                            className="h-7 px-2.5 text-xs"
                            onClick={() => props.onOpenProviderAuth(preset.providerId)}
                          >
                            {isConnected ? "Configure" : "Connect"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-3 px-6 border-t border-dls-border bg-dls-surface/50 flex items-center justify-between shrink-0">
          <Button
            variant="link"
            size="sm"
            className="h-8 text-xs text-dls-secondary hover:text-dls-text p-0 gap-1"
            onClick={() => props.onOpenProviderAuth()}
          >
            <ExternalLink size={12} /> Other OpenCode providers
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 text-xs"
            onClick={() => props.onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
