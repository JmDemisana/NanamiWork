/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState } from "react";

import { useIsMobile } from "@/hooks/use-mobile";
import type { ComposerAttachment } from "@/app/types";
import { persistableComposerDraftText, useComposerStateStore } from "@/react-app/domains/session/surface/composer-state-store";
import { useNewTaskDraftState } from "@/react-app/domains/session/sync/draft-store";
import {
  NewTaskComposer,
  type NewTaskComposerContext,
  type NewTaskComposerHandoff,
} from "./new-task-composer";
import { consumePendingChatSeed, pendingChatSeedEvent } from "./pending-chat-seed";
import { hideEmptyHeroIntroduction } from "./empty-hero-introduction";

export type SessionEmptyHeroProps = {
  providerCount: number;
  /** Disable submission while a default workspace is being prepared. */
  busy?: boolean;
  /** Called with the task prompt and attachments; the caller creates the session (and workspace if needed). */
  onRunTask: (
    prompt: string,
    attachments: ComposerAttachment[],
    handoff?: NewTaskComposerHandoff,
  ) => void | Promise<void>;
  onOpenProviderAuth?: () => void;
  /** Workspace-scoped wiring for the full composer (skills, agents, models). */
  composer?: NewTaskComposerContext | null;
};

/**
 * Paper "first chat" empty state: the real session composer front and center,
 * with nothing else competing for attention.
 */
export function SessionEmptyHero(props: SessionEmptyHeroProps) {
  // The session is created on submit, so until then the prompt has no
  // conversation to live in. Persist it under the workspace's reserved slot so
  // opening another session (or restarting) does not lose it; the sidebar
  // offers a Draft row for the same slot. The parent keys this component by
  // draft owner, so the initial read is the only hydration needed.
  const persistedDraft = useNewTaskDraftState(props.composer?.draftScope, props.composer?.workspaceId, props.composer?.draftSessionId);
  const [prompt, setPromptState] = useState(() => (
    props.composer?.draftOwnerKey ? useComposerStateStore.getState().sessions[props.composer.draftOwnerKey]?.draft : undefined
  ) ?? persistedDraft.snapshot?.text ?? "");
  const promptRef = useRef(prompt);
  // Once a send is in flight the composer has cleared the slot, and anything
  // typed until its route lands is carried into the created session as the
  // continuation. Persisting it here would pre-fill the next new task. On
  // success this hero unmounts, so the flag only resets when the send fails.
  const sendInFlightRef = useRef(false);
  const [sendInFlight, setSendInFlight] = useState(false);
  const [composing, setComposing] = useState(false);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const hideIntroduction = hideEmptyHeroIntroduction(isMobile, composing, prompt, sendInFlight || Boolean(props.busy));

  useEffect(() => {
    // A null blur target can be keyboard dismissal or a touch send. Only a
    // deliberate interaction outside the dock ends composition, never blur.
    const leaveComposer = (event: Event) => {
      if (event.target instanceof Node && !composerDockRef.current?.contains(event.target)) {
        setComposing(false);
      }
    };
    document.addEventListener("pointerdown", leaveComposer);
    document.addEventListener("focusin", leaveComposer);
    return () => {
      document.removeEventListener("pointerdown", leaveComposer);
      document.removeEventListener("focusin", leaveComposer);
    };
  }, []);
  const persistPrompt = persistedDraft.save;
  const setPrompt = useCallback((value: string) => {
    setPromptState(value);
    promptRef.current = value;
    if (sendInFlightRef.current) return;
    // Attachment chips only exist in memory (File objects); the stored text drops their tokens.
    persistPrompt({ text: persistableComposerDraftText(value), mode: "prompt" });
  }, [persistPrompt]);

  // A chat deep link (Den's connector "Chat" action) seeds the composer with
  // the connector chip and its starter prompt; the person reviews and sends.
  useEffect(() => {
    const seed = () => {
      const draft = consumePendingChatSeed();
      if (draft === null) return;
      setPrompt(draft);
      window.dispatchEvent(new Event("openwork:focusPrompt"));
    };
    seed();
    window.addEventListener(pendingChatSeedEvent, seed);
    return () => window.removeEventListener(pendingChatSeedEvent, seed);
  }, []);

  const submit = async (
    resolvedPrompt: string,
    attachments: ComposerAttachment[],
    handoff?: NewTaskComposerHandoff,
  ) => {
    const trimmedPrompt = resolvedPrompt.trim();
    if ((!trimmedPrompt && !attachments.length) || props.busy) return;
    sendInFlightRef.current = true;
    setSendInFlight(true);
    // Legacy callers may not establish a pending conversation. Clear only after
    // their submit starts; the synchronous consume callback owns the new pipeline.
    try {
      const work = props.onRunTask(trimmedPrompt, attachments, handoff);
      persistedDraft.clear();
      await work;
    } catch (error) {
      // The composer stays on this route, so whatever it holds now is once
      // again the unsent new-task prompt and must stay reachable.
      sendInFlightRef.current = false;
      setSendInFlight(false);
      persistPrompt({ text: persistableComposerDraftText(promptRef.current), mode: "prompt" });
      throw error;
    }
  };

  return (
    <div data-chat-empty-hero className="flex h-full min-h-0 w-full flex-1 flex-col justify-between">
      <div data-empty-greeting hidden={hideIntroduction} className="nanami-rise my-auto text-center pt-8 px-4 lg:px-8 max-w-[800px] mx-auto w-full">
        <h2 className="text-lg font-medium tracking-tight text-foreground">
          What do you need done?
        </h2>
      </div>

      <div ref={composerDockRef} onFocusCapture={() => setComposing(true)} data-empty-composer-dock style={{ animationDelay: "90ms" }} className="nanami-rise shrink-0 px-0 pb-2 pt-2 max-lg:pb-0">
        <NewTaskComposer
          flush={false}
          draft={prompt}
          onDraftChange={setPrompt}
          onRunTask={submit}
          busy={props.busy ?? false}
          context={props.composer ?? null}
        />
      </div>
    </div>
  );
}
