import { memo, useCallback } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { isDesktopRuntime } from "@/app/lib/runtime-env";

import {
  selectSessionIsStickyBottom,
  selectSessionTopClippedMessageId,
  sessionScrollKey,
  useSessionScrollStore,
} from "./scroll-store";

function useSessionScrollOverlayState(sessionId: string) {
  const isAtBottom = useSessionScrollStore((state) => selectSessionIsStickyBottom(state.sessions, sessionId));
  const topClippedMessageId = useSessionScrollStore((state) => selectSessionTopClippedMessageId(state.sessions, sessionId));

  return { isAtBottom, topClippedMessageId };
}

type SessionScrollOverlayProps = {
  sessionId: string;
  owner?: string;
  isStreaming: boolean;
  mobileTurnFullyVisible?: boolean;
  onJumpToLatest: (behavior?: ScrollBehavior) => void;
  onJumpToStart?: (behavior?: ScrollBehavior) => void;
  onJumpToPreviousPrompt?: (behavior?: ScrollBehavior) => void;
  onJumpToNextPrompt?: (behavior?: ScrollBehavior) => void;
  onJumpToLastPrompt?: (behavior?: ScrollBehavior) => void;
  onJumpToStartOfMessage?: (behavior?: ScrollBehavior) => void;
};

export const SessionScrollOverlay = memo(function SessionScrollOverlay({
  sessionId,
  owner,
  isStreaming,
  mobileTurnFullyVisible = false,
  onJumpToLatest,
  onJumpToStart,
  onJumpToPreviousPrompt,
  onJumpToNextPrompt,
  onJumpToLastPrompt,
  onJumpToStartOfMessage,
}: SessionScrollOverlayProps) {
  const { isAtBottom, topClippedMessageId } = useSessionScrollOverlayState(sessionScrollKey(sessionId, owner));
  const isMobile = useIsMobile();

  const handleTop = useCallback(() => {
    const fn = onJumpToStart ?? onJumpToStartOfMessage;
    fn?.("smooth");
  }, [onJumpToStart, onJumpToStartOfMessage]);

  const handlePreviousPrompt = useCallback(() => {
    const fn = onJumpToPreviousPrompt ?? onJumpToLastPrompt;
    fn?.("smooth");
  }, [onJumpToPreviousPrompt, onJumpToLastPrompt]);

  const handleNextPrompt = useCallback(() => {
    onJumpToNextPrompt?.("smooth");
  }, [onJumpToNextPrompt]);

  const handleLatest = useCallback(() => {
    onJumpToLatest("smooth");
  }, [onJumpToLatest]);

  if (isMobile && !isDesktopRuntime()) {
    if (isAtBottom || mobileTurnFullyVisible) return null;
    return (
      <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 -translate-x-1/2">
        <Button
          variant="outline"
          size="icon"
          className="pointer-events-auto size-11 rounded-full shadow-(--dls-card-shadow) motion-reduce:transition-none"
          onClick={() => onJumpToLatest(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth")}
        >
          <ArrowDown aria-hidden strokeWidth={1.5} />
          <span className="sr-only">Jump to latest</span>
        </Button>
      </div>
    );
  }

  const showJumpToStart = !isStreaming && Boolean(topClippedMessageId);
  const showJumpToLatest = !isAtBottom && !mobileTurnFullyVisible;

  if (!showJumpToStart && !showJumpToLatest) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 flex -translate-x-1/2 justify-center">
      <div className="pointer-events-auto flex items-center rounded-full border border-dls-border bg-dls-surface/95 px-2 py-1 shadow-(--dls-card-shadow) backdrop-blur-md">
        <button
          type="button"
          title="Top (Home)"
          className="rounded-full px-2.5 py-1 text-xs text-dls-text transition-colors hover:bg-dls-hover hover:text-dls-text"
          onClick={handleTop}
        >
          Top
        </button>
        <span className="select-none text-xs text-dls-border" aria-hidden>
          |
        </span>
        <button
          type="button"
          title="Previous Prompt (PgUp)"
          className="rounded-full px-2.5 py-1 text-xs text-dls-text transition-colors hover:bg-dls-hover hover:text-dls-text"
          onClick={handlePreviousPrompt}
        >
          Previous Prompt
        </button>
        <span className="select-none text-xs text-dls-border" aria-hidden>
          |
        </span>
        <button
          type="button"
          title="Next Prompt (PgDn)"
          className="rounded-full px-2.5 py-1 text-xs text-dls-text transition-colors hover:bg-dls-hover hover:text-dls-text"
          onClick={handleNextPrompt}
        >
          Next Prompt
        </button>
        <span className="select-none text-xs text-dls-border" aria-hidden>
          |
        </span>
        <button
          type="button"
          title="Latest (End)"
          className="rounded-full px-2.5 py-1 text-xs text-dls-text transition-colors hover:bg-dls-hover hover:text-dls-text"
          onClick={handleLatest}
        >
          Latest
        </button>
      </div>
    </div>
  );
});
