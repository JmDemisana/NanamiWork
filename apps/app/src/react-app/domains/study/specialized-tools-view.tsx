/** @jsxImportSource react */
import { BookOpen, Check, Download, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemFootnote,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
  LayoutStack,
} from "../settings/settings-layout";
import { STUDY_PACK_VERSION, useStudyStore } from "./study-store";

const PREPARE_STEPS: Array<{ progress: number; step: string }> = [
  { progress: 12, step: "Creating the local notebook store" },
  { progress: 34, step: "Writing the study agent prompt" },
  { progress: 58, step: "Preparing the citation and studio schema" },
  { progress: 78, step: "Checking local storage" },
  { progress: 94, step: "Finishing the pack" },
];

/**
 * Specialized tools are optional surfaces that are not part of coding chat.
 * Study is prepared locally first: nothing is registered until the pack is on
 * disk, and turning it off never deletes notebooks.
 */
export function SpecializedToolsView() {
  const packStatus = useStudyStore((state) => state.packStatus);
  const packVersion = useStudyStore((state) => state.packVersion);
  const installedAt = useStudyStore((state) => state.installedAt);
  const enabled = useStudyStore((state) => state.enabled);
  const progress = useStudyStore((state) => state.packProgress);
  const packError = useStudyStore((state) => state.packError);
  const notebookCount = useStudyStore((state) => state.notebooks.length);
  const beginPackInstall = useStudyStore((state) => state.beginPackInstall);
  const setPackProgress = useStudyStore((state) => state.setPackProgress);
  const finishPackInstall = useStudyStore((state) => state.finishPackInstall);
  const failPackInstall = useStudyStore((state) => state.failPackInstall);
  const setEnabled = useStudyStore((state) => state.setEnabled);
  const removePack = useStudyStore((state) => state.removePack);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  }, []);

  const install = () => {
    beginPackInstall();
    timers.current = PREPARE_STEPS.map((step) => window.setTimeout(() => {
      setPackProgress(step);
    }, step.progress * 18));
    timers.current.push(window.setTimeout(() => {
      try {
        finishPackInstall(STUDY_PACK_VERSION);
        setEnabled(true);
      } catch (cause) {
        failPackInstall(cause instanceof Error ? cause.message : "The Study pack could not be prepared.");
      }
    }, 2100));
  };

  const installed = packStatus === "installed";
  const preparing = packStatus === "preparing";

  return (
    <LayoutStack>
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>
            <Sparkles className="size-4" />
            Specialized tools
          </LayoutSectionTitle>
          <LayoutSectionDescription>
            Optional surfaces that sit beside coding chat. Each one is prepared on this computer first,
            and turning it off keeps your data.
          </LayoutSectionDescription>
        </LayoutSectionHeader>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>
              <BookOpen className="size-4" />
              Study
            </LayoutSectionItemTitle>
            <LayoutSectionItemHeaderActions>
              {installed ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {enabled ? "On" : "Installed"}
                  </span>
                  <Switch
                    aria-label="Turn Study on"
                    checked={enabled}
                    onCheckedChange={(value) => setEnabled(value)}
                  />
                </div>
              ) : preparing ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Preparing
                </span>
              ) : (
                <Button size="sm" onClick={install}>
                  <Download className="size-3.5" />
                  Prepare locally
                </Button>
              )}
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
          <LayoutSectionItemDescription>
            Notebooks stay on this computer. Your selected model receives the source text when
            you ask questions or create study materials.
          </LayoutSectionItemDescription>

          {preparing ? (
            <div className="mt-3 flex flex-col gap-2">
              <Progress value={progress?.progress ?? 0} />
              <p className="text-xs text-muted-foreground">{progress?.step ?? "Preparing"}</p>
            </div>
          ) : null}

          {packError ? (
            <p className="mt-2 text-xs text-destructive">{packError}</p>
          ) : null}

          {installed ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Check className="size-3.5" />
                Study pack {packVersion}
              </span>
              {installedAt ? <span>Prepared {new Date(installedAt).toLocaleDateString()}</span> : null}
              <span>Adds: notebook store, source search, studio artifacts, Study surface</span>
            </div>
          ) : null}

          <LayoutSectionItemFootnote>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={cn(notebookCount > 0 && !enabled && "text-amber-11")}>
                {notebookCount > 0
                  ? `${notebookCount} notebook${notebookCount === 1 ? "" : "s"} stored locally. Turning Study off does not delete them.`
                  : "Notebooks are stored in this app’s local data."}
              </span>
              {installed ? (
                confirmRemove ? (
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Remove the pack? Notebooks stay on this computer.
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        removePack();
                        setConfirmRemove(false);
                      }}
                    >
                      Remove
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmRemove(true)}
                  >
                    <Trash2 className="size-3.5" />
                    Remove pack
                  </Button>
                )
              ) : null}
            </div>
          </LayoutSectionItemFootnote>
        </LayoutSectionItem>
      </LayoutSection>
    </LayoutStack>
  );
}
