import { useCallback, useLayoutEffect, useRef, useState, type RefObject, type UIEventHandler } from "react";

import { flushSessionScrollState, getSessionScrollState, sessionScrollKey, useSessionScrollStore, type SessionScrollAnchor, type SessionHistoryPagePosition } from "./scroll-store";
import { mobileTurnSpace } from "./mobile-turn-space";
import { PROMPT_POSITIONS_EVENT, PROMPT_REVEAL_EVENT, selectPromptPosition, type PromptPositionsRequest } from "@/components/chat/prompt-navigation";

const EXACT_BOTTOM_GAP_PX = 1;
const SCROLL_GESTURE_WINDOW_MS = 600;
export const SESSION_SCROLL_NAVIGATION_EVENT = "session-scroll-navigation";

type SessionScrollControllerOptions = {
  selectedSessionId: string | null;
  geometryOwner?: string;
  viewOwner?: string;
  submittedMessageId: string | null;
  historyReady: boolean;
  windowReady?: boolean;
  historyComplete?: boolean;
  ensureFullHistory?: () => Promise<unknown>;
  pageForAnchor?: (messageId: string) => SessionHistoryPagePosition | undefined;
  historyPages?: {
    version: unknown;
    hasOlder: boolean;
    hasNewer: boolean;
    loading: boolean;
    failed: boolean;
    cancelRestore?: () => void;
    load: (direction: "older" | "newer" | "latest") => Promise<void>;
  };
  renderedMessages: unknown;
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
};

function isExactlyAtBottom(container: HTMLElement) {
  return container.scrollHeight - (container.scrollTop + container.clientHeight) <= EXACT_BOTTOM_GAP_PX;
}

function messageIdForElement(element: HTMLElement) {
  const id = element.getAttribute("data-message-id")?.trim();
  return id && id.length > 0 ? id : null;
}

function messageElementById(container: HTMLElement, messageId: string) {
  for (const element of container.querySelectorAll<HTMLElement>("[data-message-id]")) {
    if (messageIdForElement(element) === messageId) return element;
  }
  return null;
}

function readingAnchor(container: HTMLElement, preferredMessageId?: string): SessionScrollAnchor | undefined {
  const viewport = container.getBoundingClientRect();
  let firstVisible: SessionScrollAnchor | undefined;
  for (const element of container.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const rect = element.getBoundingClientRect();
    const messageId = messageIdForElement(element);
    if (messageId && rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom) {
      const anchor = { messageId, offset: rect.top - viewport.top };
      if (!preferredMessageId || messageId === preferredMessageId) return anchor;
      firstVisible ??= anchor;
    }
  }
  return firstVisible;
}

function latestMessageTopClippedId(container: HTMLElement) {
  const messages = container.querySelectorAll<HTMLElement>("[data-message-id]");
  const latestMessage = messages.item(messages.length - 1);
  if (!latestMessage) return null;

  const containerRect = container.getBoundingClientRect();
  const latestRect = latestMessage.getBoundingClientRect();
  const lastMessageDoesNotFit = latestRect.height > containerRect.height + 1;
  const startVisible = latestRect.top >= containerRect.top - 1 && latestRect.top <= containerRect.bottom + 1;
  return lastMessageDoesNotFit && !startVisible ? messageIdForElement(latestMessage) : null;
}

type ScrollController = {
  sessionId: string | null;
  update: (historyReady: boolean, submittedMessageId: string | null) => void;
  handleScroll: UIEventHandler<HTMLDivElement>;
  markScrollGesture: (target?: EventTarget | null) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  scrollToTop: () => Promise<boolean>;
  jumpToLatest?: (behavior?: ScrollBehavior) => void;
  jumpToStart: (behavior?: ScrollBehavior) => void;
  jumpToPreviousPrompt: (behavior?: ScrollBehavior) => void;
  jumpToNextPrompt: (behavior?: ScrollBehavior) => void;
  jumpToLastPrompt: (behavior?: ScrollBehavior) => void;
  jumpToStartOfMessage: (behavior?: ScrollBehavior) => void;
};

export function useSessionScrollController(options: SessionScrollControllerOptions) {
  const { selectedSessionId, geometryOwner, viewOwner, containerRef, contentRef } = options;
  const scrollKey = selectedSessionId ? sessionScrollKey(selectedSessionId, geometryOwner) : null;
  const controllerRef = useRef<ScrollController | null>(null);
  const [mobileTurnFullyVisible, setMobileTurnFullyVisible] = useState(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // Consumed (including cancelled) submissions survive session effect recreation.
  const submittedMessagesRef = useRef(new Set<string>());

  // Every observer, frame and DOM reference belongs to this committed session.
  // Cleanup never saves from the DOM: React may already have replaced its history.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const store = useSessionScrollStore.getState();
    if (selectedSessionId && geometryOwner) store.claimOwner(selectedSessionId, geometryOwner);
    const readState = () => getSessionScrollState(useSessionScrollStore.getState().sessions, scrollKey);
    let active = true;
    let historyReady = false;
    let pendingRestore = true;
    let pendingReadingAnchor = false;
    let pendingSubmittedMessageId: string | null = null;
    let mobileTurnId: string | null = null;
    let mobileTurnPinned = false;
    // User turns already on screen when the latest message was submitted; any other is that message.
    let userTurnIdsAtSubmit = new Set<string>();
    let turnSpace = 0;
    const previousPaddingBottom = content.style.paddingBottom;
    let cancelledWhileLoading = false;
    let smoothJump = false;
    let activePointerId: number | null = null;
    let pointerScrolled = false;
    let gestureBeforePointer = -Infinity;
    let lastGestureAt = -Infinity;
    let lastKnownScrollTop = container.scrollTop;
    let pageVersion: unknown;
    let pageAnchor: SessionScrollAnchor | undefined;
    let restoredPageAnchorId: string | undefined;
    let pagePending = false;
    let viewportFillVersion: { version: unknown } | null = null;
    let pendingHistoryDemand: "older" | "newer" | null = null;
    let pendingTop: ((completed: boolean) => void) | null = null;
    let topLoadReady = false;
    let pendingPromptPage: { direction: "previous" | "next"; behavior: ScrollBehavior; version: unknown } | null = null;
    let virtualPromptObserver: MutationObserver | null = null;
    let virtualPromptTimeout: number | null = null;
    const cancelVirtualPrompt = () => {
      const wasSeeking = Boolean(virtualPromptObserver || virtualPromptTimeout !== null);
      virtualPromptObserver?.disconnect();
      virtualPromptObserver = null;
      if (virtualPromptTimeout !== null) window.clearTimeout(virtualPromptTimeout);
      virtualPromptTimeout = null;
      if (wasSeeking) container.dispatchEvent(new CustomEvent(PROMPT_REVEAL_EVENT, { detail: null }));
    };
    const cancelTop = () => { pendingTop?.(false); pendingTop = null; };
    const cancelRestoration = () => {
      cancelVirtualPrompt();
      pendingPromptPage = null;
      cancelTop();
      optionsRef.current.historyPages?.cancelRestore?.();
      pageAnchor = undefined;
      pendingHistoryDemand = null;
      pendingReadingAnchor = false;
    };
    const frames = new Set<number>();
    const hasScrollGesture = () => activePointerId !== null || Date.now() - lastGestureAt < SCROLL_GESTURE_WINDOW_MS;
    const scheduleFrame = (callback: () => void) => {
      const id = window.requestAnimationFrame(() => {
        if (!frames.delete(id) || !active) return;
        callback();
      });
      frames.add(id);
    };
    const cancelFrames = () => {
      for (const id of frames) window.cancelAnimationFrame(id);
      frames.clear();
    };
    const hasPendingPlaceholders = () => {
      const viewport = container.getBoundingClientRect();
      return [...content.querySelectorAll<HTMLElement>('[data-thread-placeholder]:not([data-thread-placeholder="history-prefix"]):not([data-thread-placeholder="history-suffix"])')].some((placeholder) => {
        if (!placeholder.closest('[data-thread-virtualized="true"]')) return true;
        const rect = placeholder.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
      });
    };
    const transcriptMeasurable = () => {
      if (container.clientHeight <= 0 || container.getBoundingClientRect().width <= 0 || content.querySelector("[data-thread-loading]")) return false;
      const transcript = content.querySelector("[data-thread-history-complete], [data-message-id]");
      return transcript ? transcript.getBoundingClientRect().width > 0
        : Array.isArray(optionsRef.current.renderedMessages) && optionsRef.current.renderedMessages.length === 0;
    };
    const reserveLoadingGeometry = () => {
      const saved = readState();
      if (pendingRestore && saved.geometry && saved.geometry.owner === geometryOwner && content.querySelector("[data-thread-loading]")) {
        container.scrollTop = saved.mode === "manual" ? saved.scrollTop : container.scrollHeight;
        lastKnownScrollTop = container.scrollTop;
      }
    };
    const currentReadingAnchor = () => {
      const anchor = readingAnchor(container, restoredPageAnchorId);
      if (anchor?.messageId !== restoredPageAnchorId) restoredPageAnchorId = undefined;
      return anchor;
    };
    const rememberGeometry = () => {
      if (!geometryOwner || !scrollKey || !historyReady || !transcriptMeasurable() || pendingRestore || cancelledWhileLoading
        || container.clientWidth <= 0 || container.clientHeight <= 0 || hasPendingPlaceholders()
        || !content.querySelector('[data-thread-history-complete="true"]') && !optionsRef.current.windowReady) return;
      const viewport = container.getBoundingClientRect();
      const messages = [...container.querySelectorAll<HTMLElement>("[data-message-id]")];
      const anchor = currentReadingAnchor();
      const firstVisible = anchor ? messages.findIndex((message) => messageIdForElement(message) === anchor.messageId) : -1;
      if (firstVisible < 0) return;
      const id = messageIdForElement(messages[firstVisible]);
      const page = id ? optionsRef.current.pageForAnchor?.(id) : undefined;
      const readingGroup = messages[firstVisible].closest('[data-thread-virtualized="true"] [data-thread-group]');
      const contiguous = new Set<Element>();
      if (readingGroup) {
        contiguous.add(readingGroup);
        for (const direction of ["previousElementSibling", "nextElementSibling"] as const) {
          let sibling = readingGroup[direction];
          while (sibling?.hasAttribute("data-thread-group")) {
            contiguous.add(sibling);
            sibling = sibling[direction];
          }
        }
      }
      const candidates = readingGroup ? messages.filter((message) => {
        const group = message.closest("[data-thread-group]");
        return group && contiguous.has(group);
      }) : messages;
      const nearby = page ? candidates.filter((message) => {
        const messageId = messageIdForElement(message);
        return messageId && optionsRef.current.pageForAnchor?.(messageId)?.before === page.before;
      }) : readingGroup ? candidates : messages.slice(Math.max(0, firstVisible - 4), firstVisible + 20);
      const first = nearby[0];
      const last = nearby.at(-1);
      if (!first || !last) return;
      store.setGeometry(scrollKey, {
        owner: geometryOwner,
        scrollHeight: container.scrollHeight,
        viewportWidth: container.clientWidth,
        before: Math.max(0, container.scrollTop + first.getBoundingClientRect().top - viewport.top),
        after: Math.max(0, container.scrollHeight - container.scrollTop - last.getBoundingClientRect().bottom + viewport.top),
        messageIds: nearby.flatMap((message) => { const id = messageIdForElement(message); return id ? [id] : []; }),
        ...(page ? { page } : {}),
      });
    };
    const refreshTopClippedMessage = () => {
      const measurable = active && historyReady && transcriptMeasurable();
      if (measurable) store.setTopClippedMessageId(scrollKey, latestMessageTopClippedId(container));
      // Manual mode also represents our mobile turn anchor, not just a reader
      // who scrolled away. Ignore reserved blank space only for that anchor.
      const viewport = container.getBoundingClientRect();
      const turn = mobileTurnId ? messageElementById(container, mobileTurnId) : null;
      setMobileTurnFullyVisible(Boolean(measurable && mobileTurnPinned && turn
        && window.matchMedia("(max-width: 1023px)").matches
        && !optionsRef.current.historyPages?.hasNewer && !hasPendingPlaceholders()
        && turn.getBoundingClientRect().top >= viewport.top - EXACT_BOTTOM_GAP_PX
        && content.getBoundingClientRect().bottom - turnSpace <= viewport.bottom + EXACT_BOTTOM_GAP_PX));
    };
    const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
      if (!active) return;
      mobileTurnPinned = false;
      setMobileTurnFullyVisible(false);
      mobileTurnId = null;
      turnSpace = 0;
      content.style.paddingBottom = previousPaddingBottom;
      restoredPageAnchorId = undefined;
      cancelTop();
      cancelFrames();
      pendingRestore = false;
      pendingSubmittedMessageId = null;
      cancelledWhileLoading = false;
      lastGestureAt = -Infinity;
      store.setStickyBottom(scrollKey, null);
      smoothJump = behavior === "smooth";
      container.scrollTo({ top: container.scrollHeight, behavior });
      lastKnownScrollTop = container.scrollTop;
      if (behavior === "auto") scheduleFrame(() => {
        if (!transcriptMeasurable()) { reconcile(); return; }
        container.scrollTop = container.scrollHeight;
        lastKnownScrollTop = container.scrollTop;
        refreshTopClippedMessage();
      });
    };
    const anchorTop = (anchor: SessionScrollAnchor) => {
      const message = messageElementById(container, anchor.messageId);
      const rect = message?.getBoundingClientRect();
      return rect && rect.height > 0 ? container.scrollTop + rect.top
        - container.getBoundingClientRect().top - anchor.offset : null;
    };
    const demandHistory = (direction?: "older" | "newer") => {
      const pages = optionsRef.current.historyPages;
      if (!active || !historyReady || !transcriptMeasurable() || !pages || pages.loading || pages.failed || pagePending || pendingRestore) return;
      const messages = [...content.querySelectorAll<HTMLElement>("[data-message-id]")];
      const first = messages[0];
      const last = messages.at(-1);
      const viewport = container.getBoundingClientRect();
      const prefix = content.querySelector<HTMLElement>('[data-thread-placeholder="history-prefix"]');
      const skipped = first?.closest("[data-thread-group]")?.previousElementSibling;
      const olderBoundary = prefix ? prefix.getBoundingClientRect().bottom
        : skipped?.hasAttribute("data-thread-placeholder") ? skipped.getBoundingClientRect().top
        : first?.getBoundingClientRect().top;
      const older = pages.hasOlder && (olderBoundary === undefined || olderBoundary >= viewport.top - 240);
      const newer = pages.hasNewer && (!last || last.getBoundingClientRect().bottom <= viewport.bottom + 240);
      const next = direction === "newer" ? newer ? "newer" : undefined : older ? "older" : newer ? "newer" : undefined;
      if (!next) return;
      if (hasPendingPlaceholders()) {
        pendingHistoryDemand = next;
        return;
      }
      pendingHistoryDemand = null;
      pageAnchor = currentReadingAnchor();
      pagePending = true;
      void pages.load(next).catch(() => undefined).finally(() => {
        pagePending = false;
        if (active) scheduleFrame(reconcile);
      });
    };
    const reconcile = () => {
      if (!active) return;
      if (!transcriptMeasurable()) {
        pendingRestore ||= !cancelledWhileLoading;
        cancelFrames();
        reserveLoadingGeometry();
        return;
      }
      const mobile = false; // Disabled mobile turn pinning so narrow views never scroll to top or create empty padding
      if (pendingSubmittedMessageId && mobile) {
        mobileTurnId = pendingSubmittedMessageId;
        mobileTurnPinned = true;
      }
      let turn = mobileTurnId ? messageElementById(container, mobileTurnId) : null;
      if (mobile && mobileTurnId && !turn) {
        // OpenCode v2 gives the sent message its own ID: the submitted ID never renders, or its optimistic row
        // is replaced. Follow the newest user turn that was not already on screen when it was sent.
        const users = [...container.querySelectorAll<HTMLElement>('[data-message-role="user"][data-message-id]')];
        const latest = users.at(-1);
        const latestId = latest ? messageIdForElement(latest) : null;
        if (latest && latestId && !userTurnIdsAtSubmit.has(latestId)) {
          turn = latest;
          mobileTurnId = latestId;
          if (pendingSubmittedMessageId) pendingSubmittedMessageId = latestId;
        }
      }
      // Reserve only the unfilled part of this turn. The same observer that
      // handles transcript growth also consumes this space and follows keyboard
      // resize; no second scrolling owner or timeout is needed.
      const nextSpace = mobile && turn
        ? mobileTurnSpace(container.clientHeight, content.getBoundingClientRect().bottom - turnSpace - turn.getBoundingClientRect().top)
        : 0;
      if (nextSpace !== turnSpace) {
        turnSpace = nextSpace;
        content.style.paddingBottom = `${turnSpace}px`;
      }
      if (mobile && mobileTurnPinned && mobileTurnId && !pendingSubmittedMessageId && !hasScrollGesture()) {
        const top = anchorTop({ messageId: mobileTurnId, offset: 0 });
        if (top !== null) {
          container.scrollTop = top;
          lastKnownScrollTop = container.scrollTop;
        }
      }
      if (pendingTop) {
        if (!topLoadReady || !optionsRef.current.historyComplete) return;
        container.scrollTo({ top: 0, behavior: "instant" });
        lastKnownScrollTop = container.scrollTop;
        store.setManualScroll(scrollKey, container.scrollTop, latestMessageTopClippedId(container), readingAnchor(container));
        container.dispatchEvent(new Event("scroll"));
        if (hasPendingPlaceholders()) return;
        const finish = pendingTop;
        pendingTop = null;
        finish(true);
        return;
      }
      const version = optionsRef.current.historyPages?.version;
      if (version !== pageVersion) {
        pageVersion = version;
        if (pageAnchor && readState().mode === "manual") {
          const top = anchorTop(pageAnchor);
          if (top !== null) {
            container.scrollTop = top;
            lastKnownScrollTop = container.scrollTop;
            store.setManualScroll(scrollKey, container.scrollTop, latestMessageTopClippedId(container), pageAnchor);
            restoredPageAnchorId = pageAnchor.messageId;
            pendingReadingAnchor = false;
          }
        }
        pageAnchor = undefined;
      }
      if (activePointerId !== null) {
        refreshTopClippedMessage();
        return;
      }
      if (pendingSubmittedMessageId) {
        pendingSubmittedMessageId = null;
        restoredPageAnchorId = undefined;
        pendingRestore = false;
        cancelledWhileLoading = false;
        cancelFrames();
        if (smoothJump) container.scrollTo({ top: container.scrollTop, behavior: "instant" });
        smoothJump = false;
        lastGestureAt = -Infinity;
        scrollToBottom("instant");
        return;
      }
      if (!historyReady) return;
      const saved = readState();
      if (pendingRestore) {
        if (saved.mode === "manual") {
          const top = saved.anchor ? anchorTop(saved.anchor) : null;
          // A live tail/partial preview is not proof the old anchor is gone.
          const partial = content.querySelector('[data-thread-history-complete="false"]');
          const stableWindow = optionsRef.current.windowReady && !hasPendingPlaceholders();
          if (partial && !stableWindow && (top === null || top < 0 || top > container.scrollHeight - container.clientHeight + EXACT_BOTTOM_GAP_PX)) return;
          pendingRestore = false;
          container.scrollTop = top ?? saved.scrollTop;
          lastKnownScrollTop = container.scrollTop;
          if (stableWindow && (top === null || top !== container.scrollTop)) {
            store.setManualScroll(scrollKey, container.scrollTop, latestMessageTopClippedId(container), readingAnchor(container));
          }
        } else {
          scrollToBottom();
        }
      } else if (!cancelledWhileLoading) {
        if (saved.mode === "stickyBottom" && !hasScrollGesture()) {
          if (!isExactlyAtBottom(container)) scrollToBottom();
          // The transcript shrank and the browser already clamped the view to its end. That
          // clamp's scroll event can arrive after a card grew again (a computer step swapping
          // its picture or prompt), and must not read as the reader leaving the latest message.
          else lastKnownScrollTop = container.scrollTop;
        }
      }
      refreshTopClippedMessage();
      if (pendingReadingAnchor && !cancelledWhileLoading && readState().mode === "manual" && !hasPendingPlaceholders()) {
        const anchor = readingAnchor(container);
        if (anchor) {
          pendingReadingAnchor = false;
          store.setManualScroll(scrollKey, container.scrollTop, latestMessageTopClippedId(container), anchor);
        }
      }
      rememberGeometry();
      const pages = optionsRef.current.historyPages;
      if (pages?.hasOlder && !pages.hasNewer && !pages.loading && !pages.failed && !pagePending
        && !pendingRestore && optionsRef.current.windowReady && readState().mode === "stickyBottom"
        && !hasScrollGesture() && container.clientWidth > 0 && container.scrollHeight <= container.clientHeight
        && !hasPendingPlaceholders() && (viewportFillVersion === null || viewportFillVersion.version !== pages.version)) {
        viewportFillVersion = { version: pages.version };
        demandHistory("older");
      }
      if (pendingHistoryDemand) {
        const direction = pendingHistoryDemand;
        pendingHistoryDemand = null;
        if (hasScrollGesture()) demandHistory(direction);
      }
    };
    const scrollToTop = async () => {
      if (!active) return false;
      mobileTurnPinned = false;
      setMobileTurnFullyVisible(false);
      restoredPageAnchorId = undefined;
      cancelRestoration();
      cancelFrames();
      container.dispatchEvent(new Event(SESSION_SCROLL_NAVIGATION_EVENT));
      pendingRestore = false;
      pendingSubmittedMessageId = null;
      lastGestureAt = -Infinity;
      topLoadReady = false;
      let finish = (_completed: boolean) => {};
      const position = new Promise<boolean>((resolve) => { finish = resolve; pendingTop = resolve; });
      try {
        await optionsRef.current.ensureFullHistory?.();
        if (!active || pendingTop !== finish) return false;
        topLoadReady = true;
        reconcile();
        return await position;
      } catch (error) {
        if (!active || pendingTop !== finish) return false;
        cancelTop();
        throw error;
      }
    };
    const markScrollGesture = (target?: EventTarget | null) => {
      if (!active) return;
      const nested = target instanceof Element ? target.closest("[data-scrollable]") : null;
      if (nested && nested !== container) return;
      mobileTurnPinned = false;
      cancelVirtualPrompt();
      pendingPromptPage = null;
      cancelTop();
      setMobileTurnFullyVisible(false);
      container.dispatchEvent(new Event(SESSION_SCROLL_NAVIGATION_EVENT));
      // Pointer presses may just be clicks. Defer cancelling restoration until
      // they actually scroll; release without scrolling resumes pending follow.
      if (activePointerId === null) {
        optionsRef.current.historyPages?.cancelRestore?.();
        restoredPageAnchorId = undefined;
        cancelledWhileLoading ||= pendingRestore;
        pendingRestore = false;
        pendingSubmittedMessageId = null;
      }
      cancelFrames();
      // Stop an in-flight smooth jump too, before the wheel/key moves the view.
      if (smoothJump) container.scrollTo({ top: container.scrollTop, behavior: "instant" });
      smoothJump = false;
      lastGestureAt = Date.now();
      const gestureAt = lastGestureAt;
      scheduleFrame(() => {
        if (activePointerId === null && lastGestureAt === gestureAt && hasScrollGesture()) demandHistory();
      });
    };
    const handleScroll: UIEventHandler<HTMLDivElement> = () => {
      if (!active) return;
      const measurable = transcriptMeasurable();
      // Layout clamping and our own anchoring also dispatch scroll events. Only
      // actual input may replace the saved reading position or change its mode.
      if (hasScrollGesture() && container.scrollTop !== lastKnownScrollTop) {
        mobileTurnPinned = false;
        setMobileTurnFullyVisible(false);
        // Trackpad momentum can outlast the original wheel/touch event.
        lastGestureAt = Date.now();
        if (activePointerId !== null) {
          if (!pointerScrolled) {
            cancelTop();
            optionsRef.current.historyPages?.cancelRestore?.();
            container.dispatchEvent(new Event(SESSION_SCROLL_NAVIGATION_EVENT));
          }
          pointerScrolled = true;
          restoredPageAnchorId = undefined;
        }
        pendingRestore = false;
        pendingSubmittedMessageId = null;
        if (!historyReady || !measurable) {
          cancelledWhileLoading = true;
          cancelFrames();
          lastKnownScrollTop = container.scrollTop;
          return;
        }
        cancelledWhileLoading = false;
        const clipped = latestMessageTopClippedId(container);
        if (isExactlyAtBottom(container) && !optionsRef.current.historyPages?.hasNewer) {
          store.setStickyBottom(scrollKey, clipped);
        } else {
          const anchor = currentReadingAnchor();
          pendingReadingAnchor = !anchor || !restoredPageAnchorId && hasPendingPlaceholders();
          store.setManualScroll(scrollKey, container.scrollTop, clipped, anchor);
        }
        if (pagePending || pageAnchor) pageAnchor = currentReadingAnchor();
        demandHistory(container.scrollTop > lastKnownScrollTop ? "newer" : "older");
      } else {
        if (!measurable) {
          pendingRestore ||= !cancelledWhileLoading;
          cancelFrames();
          lastKnownScrollTop = container.scrollTop;
          return;
        }
        const saved = readState();
        if (!pendingRestore && historyReady && container.scrollTop !== lastKnownScrollTop) {
          // Native anchoring can move scrollTop when a diagram/image expands
          // inside the reading message. Remember that adjustment for the next
          // visit, but never persist the initial restore's clamp or missing anchor.
          if (saved.mode === "manual") {
            if (saved.anchor && messageElementById(container, saved.anchor.messageId)) {
              store.setManualScroll(scrollKey, container.scrollTop, latestMessageTopClippedId(container), currentReadingAnchor());
            }
          } else if (!smoothJump && !isExactlyAtBottom(container)) {
            // Keyboard focus and other reveals scroll an older message into view
            // without wheel or key input. The person is reading it now: follow
            // must not pull the view back on the next click or streamed chunk.
            cancelFrames();
            store.setManualScroll(scrollKey, container.scrollTop, latestMessageTopClippedId(container), readingAnchor(container));
          }
        }
        refreshTopClippedMessage();
      }
      lastKnownScrollTop = container.scrollTop;
      rememberGeometry();
    };
    const jumpToStart = (behavior: ScrollBehavior = "smooth") => {
      if (!active) return;
      cancelRestoration();
      cancelFrames();
      pendingRestore = false;
      pendingSubmittedMessageId = null;
      cancelledWhileLoading = false;
      lastGestureAt = -Infinity;
      store.setManualScroll(scrollKey, 0, null, undefined);
      smoothJump = behavior === "smooth";
      container.scrollTo({ top: 0, behavior });
      lastKnownScrollTop = container.scrollTop;
    };
    const PROMPT_SCROLL_OFFSET = 72;

    const jumpToLastPrompt = (behavior: ScrollBehavior = "smooth") => {
      if (!active) return;
      const users = [...container.querySelectorAll<HTMLElement>('[data-message-role="user"][data-message-id]')];
      const latestUser = users.at(-1);
      if (!latestUser) return;
      const messageId = messageIdForElement(latestUser);
      const anchor = messageId ? { messageId, offset: PROMPT_SCROLL_OFFSET } : undefined;
      const top = anchor ? anchorTop(anchor) : null;
      cancelRestoration();
      cancelFrames();
      pendingRestore = false;
      pendingSubmittedMessageId = null;
      cancelledWhileLoading = false;
      lastGestureAt = -Infinity;
      if (top !== null && messageId && anchor) {
        const targetTop = Math.max(0, top);
        store.setManualScroll(scrollKey, targetTop, messageId, anchor);
        smoothJump = behavior === "smooth";
        container.scrollTo({ top: targetTop, behavior });
      } else {
        smoothJump = behavior === "smooth";
        latestUser.scrollIntoView({ behavior, block: "center" });
      }
      lastKnownScrollTop = container.scrollTop;
    };
    const promptElements = () =>
      [...container.querySelectorAll<HTMLElement>('[data-message-role="user"][data-message-id]')];
    const promptPositions = () => {
      const ids = Array.isArray(optionsRef.current.renderedMessages)
        ? optionsRef.current.renderedMessages.flatMap((message: unknown) => {
          if (!message || typeof message !== "object") return [];
          const id = Reflect.get(message, "id");
          return Reflect.get(message, "role") === "user" && typeof id === "string" ? [id] : [];
        }) : [];
      const request: PromptPositionsRequest = { ids, positions: [] };
      container.dispatchEvent(new CustomEvent(PROMPT_POSITIONS_EVENT, { detail: request }));
      const found = new Set(request.positions.map((position) => position.id));
      const viewportTop = container.getBoundingClientRect().top;
      for (const element of promptElements()) {
        const id = messageIdForElement(element);
        const rect = element.getBoundingClientRect();
        if (id && rect.height > 0 && !found.has(id)) request.positions.push({ id, top: container.scrollTop + rect.top - viewportTop });
      }
      return request.positions;
    };
    const scrollToPrompt = (targetUser: HTMLElement, behavior: ScrollBehavior) => {
      const messageId = messageIdForElement(targetUser);
      const anchor = messageId ? { messageId, offset: PROMPT_SCROLL_OFFSET } : undefined;
      const top = anchor ? anchorTop(anchor) : null;
      cancelRestoration();
      cancelFrames();
      pendingRestore = false;
      pendingSubmittedMessageId = null;
      cancelledWhileLoading = false;
      lastGestureAt = -Infinity;
      if (top !== null && messageId && anchor) {
        const targetTop = Math.max(0, top);
        store.setManualScroll(scrollKey, targetTop, messageId, anchor);
        smoothJump = behavior === "smooth";
        container.scrollTo({ top: targetTop, behavior });
      } else {
        smoothJump = behavior === "smooth";
        targetUser.scrollIntoView({ behavior, block: "center" });
      }
      lastKnownScrollTop = container.scrollTop;
    };
    const jumpToPrompt = (direction: "previous" | "next", behavior: ScrollBehavior) => {
      if (!active) return;
      const target = selectPromptPosition(promptPositions(), container.scrollTop + PROMPT_SCROLL_OFFSET, direction);
      if (!target) {
        const pages = optionsRef.current.historyPages;
        const hasMore = direction === "previous" ? pages?.hasOlder : pages?.hasNewer;
        if (pages && hasMore) {
          if (pages.loading || pages.failed || pagePending) return;
          cancelRestoration();
          cancelFrames();
          pendingRestore = false;
          pendingSubmittedMessageId = null;
          cancelledWhileLoading = false;
          lastGestureAt = -Infinity;
          pageAnchor = currentReadingAnchor();
          store.setManualScroll(scrollKey, container.scrollTop, latestMessageTopClippedId(container), pageAnchor);
          pendingPromptPage = { direction, behavior, version: pages.version };
          const pending = pendingPromptPage;
          pagePending = true;
          void pages.load(direction === "previous" ? "older" : "newer")
            .catch(() => { if (pendingPromptPage === pending) pendingPromptPage = null; })
            .finally(() => { pagePending = false; if (active) scheduleFrame(reconcile); });
          return;
        }
        if (direction === "previous") jumpToStart(behavior);
        else scrollToBottom(behavior);
        return;
      }
      const element = messageElementById(container, target.id);
      if (element && element.getBoundingClientRect().height > 0) {
        scrollToPrompt(element, behavior);
        return;
      }
      // Off-screen groups are virtualized. Jump to the estimated group first,
      // then align the real message as soon as React mounts it.
      cancelRestoration();
      cancelFrames();
      pendingRestore = false;
      pendingSubmittedMessageId = null;
      cancelledWhileLoading = false;
      lastGestureAt = -Infinity;
      const top = Math.max(0, target.top - PROMPT_SCROLL_OFFSET);
      store.setManualScroll(scrollKey, top, target.id, { messageId: target.id, offset: PROMPT_SCROLL_OFFSET });
      const align = () => {
        const mounted = messageElementById(container, target.id);
        if (!mounted || mounted.getBoundingClientRect().height <= 0) return;
        cancelVirtualPrompt();
        scrollToPrompt(mounted, "auto");
      };
      virtualPromptObserver = new MutationObserver(align);
      virtualPromptObserver.observe(content, { childList: true, subtree: true });
      virtualPromptTimeout = window.setTimeout(cancelVirtualPrompt, 3000);
      container.dispatchEvent(new CustomEvent(PROMPT_REVEAL_EVENT, { detail: target.id }));
      smoothJump = false;
      container.scrollTo({ top, behavior: "auto" });
      lastKnownScrollTop = container.scrollTop;
      align();
    };
    const jumpToPreviousPrompt = (behavior: ScrollBehavior = "smooth") => jumpToPrompt("previous", behavior);
    const jumpToNextPrompt = (behavior: ScrollBehavior = "smooth") => jumpToPrompt("next", behavior);
    const jumpToStartOfMessage = (behavior: ScrollBehavior = "smooth") => {
      if (!active) return;
      const messageId = readState().topClippedMessageId;
      if (!messageId) return;
      const anchor = { messageId, offset: 0 };
      restoredPageAnchorId = undefined;
      const top = anchorTop(anchor);
      if (top === null) return;
      cancelRestoration();
      cancelFrames();
      pendingRestore = false;
      pendingSubmittedMessageId = null;
      cancelledWhileLoading = false;
      lastGestureAt = -Infinity;
      store.setManualScroll(scrollKey, top, messageId, anchor);
      smoothJump = behavior === "smooth";
      container.scrollTo({ top, behavior });
      lastKnownScrollTop = container.scrollTop;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (!active || !container.isConnected || container.clientHeight <= 0) return;
      const target = event.target instanceof Element ? event.target : null;
      // Only the pane that owns focus (or the sole visible pane) answers the
      // shortcuts, so split view never scrolls both transcripts at once.
      const pane = container.closest("[data-workbench-pane]") ?? container.closest("[data-session-pane]");
      const focusedElement = document.activeElement instanceof Element ? document.activeElement : null;
      const focusedPane = focusedElement?.closest("[data-workbench-pane]") ?? focusedElement?.closest("[data-session-pane]") ?? null;
      if (focusedPane && focusedPane !== pane) return;
      const activePane = document.querySelector('[data-workbench-pane-focused="true"]');
      if (!focusedPane && activePane && activePane !== pane) return;
      if (!focusedPane && !activePane && (document.querySelectorAll("[data-workbench-pane]").length > 1
        || document.querySelectorAll("[data-session-pane]").length > 1)) return;
      // Leave dialogs, menus, the sidebar, and other scroll regions alone.
      if (target?.closest("[role=dialog], [role=menu], [role=listbox], [data-sidebar]")) return;
      const nestedScroll = target?.closest("[data-scrollable]");
      if (nestedScroll && nestedScroll !== container) return;

      const editable = target?.closest("input, textarea, select, [contenteditable=true]") as HTMLElement | null;
      const isComposerEditor = Boolean(target?.closest("[data-composer-editor]"));

      if (event.key === "PageUp" || event.key === "PageDown") {
        // Prompt navigation also works from the composer, unless the editor
        // itself can scroll or the person is selecting text.
        if (editable && (!isComposerEditor || event.shiftKey
          || editable.scrollHeight > editable.clientHeight + 1)) return;
        event.preventDefault();
        if (event.key === "PageUp") jumpToPreviousPrompt("smooth");
        else jumpToNextPrompt("smooth");
        return;
      }
      if (editable) return;
      if (event.key === "Home") {
        event.preventDefault();
        jumpToStart("smooth");
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        scrollToBottom("smooth");
        return;
      }
      if (["ArrowUp", "ArrowDown", " "].includes(event.key)
        && (!target || target === document.body || container.contains(target))) {
        markScrollGesture(event.target);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || activePointerId !== null) return;
      const nested = event.target instanceof Element ? event.target.closest("[data-scrollable], input, textarea, select, [contenteditable=true]") : null;
      if (nested && nested !== container) return;
      cancelVirtualPrompt();
      pendingPromptPage = null;
      activePointerId = event.pointerId;
      pointerScrolled = false;
      gestureBeforePointer = lastGestureAt;
      cancelFrames();
      if (smoothJump) container.scrollTo({ top: container.scrollTop, behavior: "instant" });
      smoothJump = false;
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId) return;
      activePointerId = null;
      lastGestureAt = pointerScrolled ? Date.now() : gestureBeforePointer;
      if (!pointerScrolled) reconcile();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") flushSessionScrollState();
    };

    // The browser owns manual reflow, including changes inside a long message.
    // Message-root offsets are only used when restoring a session.
    const previousOverflowAnchor = container.style.overflowAnchor;
    const updateOverflowAnchor = () => {
      const next = readState().mode === "manual" ? "auto" : "none";
      if (container.style.overflowAnchor !== next) container.style.overflowAnchor = next;
    };
    updateOverflowAnchor();
    const unsubscribeScrollState = useSessionScrollStore.subscribe(updateOverflowAnchor);
    const observer = new ResizeObserver(reconcile);
    observer.observe(content);
    observer.observe(container);
    window.addEventListener("keydown", handleKeyDown, true);
    container.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("pagehide", flushSessionScrollState);
    document.addEventListener("visibilitychange", handleVisibility);
    controllerRef.current = {
      sessionId: scrollKey,
      update: (ready, messageId) => {
        historyReady = ready;
        if (!messageId) pendingSubmittedMessageId = null;
        else {
          const key = JSON.stringify([scrollKey, messageId]);
          if (!submittedMessagesRef.current.has(key)) {
            submittedMessagesRef.current.add(key);
            cancelRestoration();
            pendingSubmittedMessageId = messageId;
            userTurnIdsAtSubmit = new Set([...container.querySelectorAll<HTMLElement>('[data-message-role="user"][data-message-id]')]
              .flatMap((element) => { const id = messageIdForElement(element); return id && id !== messageId ? [id] : []; }));
            cancelFrames();
          }
        }
        reconcile();
        const pending = pendingPromptPage;
        const pages = optionsRef.current.historyPages;
        if (pending && (pages ? pages.version !== pending.version && !pages.loading : optionsRef.current.historyComplete)) {
          pendingPromptPage = null;
          scheduleFrame(() => jumpToPrompt(pending.direction, pending.behavior));
        }
      },
      handleScroll,
      markScrollGesture,
      scrollToBottom: (behavior) => {
        if (!active) return;
        cancelRestoration();
        const pages = optionsRef.current.historyPages;
        if (pages?.hasNewer) void pages.load("latest").catch(() => undefined);
        scrollToBottom(behavior);
      },
      scrollToTop,
      jumpToLatest: (behavior) => scrollToBottom(behavior),
      jumpToStart,
      jumpToPreviousPrompt,
      jumpToNextPrompt,
      jumpToLastPrompt,
      jumpToStartOfMessage,
    };

    return () => {
      active = false;
      cancelVirtualPrompt();
      pendingPromptPage = null;
      setMobileTurnFullyVisible(false);
      cancelTop();
      cancelFrames();
      if (smoothJump) container.scrollTo({ top: container.scrollTop, behavior: "instant" });
      observer.disconnect();
      unsubscribeScrollState();
      window.removeEventListener("keydown", handleKeyDown, true);
      container.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("pagehide", flushSessionScrollState);
      document.removeEventListener("visibilitychange", handleVisibility);
      container.style.overflowAnchor = previousOverflowAnchor;
      content.style.paddingBottom = previousPaddingBottom;
      controllerRef.current = null;
      flushSessionScrollState();
    };
  }, [selectedSessionId, geometryOwner, viewOwner, scrollKey, containerRef, contentRef]);

  useLayoutEffect(() => {
    controllerRef.current?.update(options.historyReady, options.submittedMessageId);
  }, [scrollKey, viewOwner, containerRef, contentRef, options.historyReady, options.submittedMessageId, options.renderedMessages, options.historyComplete, options.historyPages?.version]);

  const handleScroll = useCallback<UIEventHandler<HTMLDivElement>>((event) => {
    if (controllerRef.current?.sessionId === scrollKey) controllerRef.current.handleScroll(event);
  }, [scrollKey]);
  const markScrollGesture = useCallback((target?: EventTarget | null) => {
    if (controllerRef.current?.sessionId === scrollKey) controllerRef.current.markScrollGesture(target);
  }, [scrollKey]);
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    if (controllerRef.current?.sessionId === scrollKey) {
      containerRef.current?.dispatchEvent(new Event(SESSION_SCROLL_NAVIGATION_EVENT));
      controllerRef.current.scrollToBottom(behavior);
    }
  }, [scrollKey, containerRef]);
  const scrollToTop = useCallback(() => controllerRef.current?.sessionId === scrollKey
    ? controllerRef.current.scrollToTop() : Promise.resolve(false), [scrollKey]);
  const jumpToLatest = useCallback((behavior: ScrollBehavior = "smooth") => scrollToBottom(behavior), [scrollToBottom]);
  const jumpToStart = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (controllerRef.current?.sessionId === scrollKey) {
      containerRef.current?.dispatchEvent(new Event(SESSION_SCROLL_NAVIGATION_EVENT));
      controllerRef.current.jumpToStart(behavior);
    }
  }, [scrollKey, containerRef]);
  const jumpToPreviousPrompt = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (controllerRef.current?.sessionId === scrollKey) {
      containerRef.current?.dispatchEvent(new Event(SESSION_SCROLL_NAVIGATION_EVENT));
      controllerRef.current.jumpToPreviousPrompt(behavior);
    }
  }, [scrollKey, containerRef]);
  const jumpToNextPrompt = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (controllerRef.current?.sessionId === scrollKey) {
      containerRef.current?.dispatchEvent(new Event(SESSION_SCROLL_NAVIGATION_EVENT));
      controllerRef.current.jumpToNextPrompt(behavior);
    }
  }, [scrollKey, containerRef]);
  const jumpToLastPrompt = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (controllerRef.current?.sessionId === scrollKey) {
      containerRef.current?.dispatchEvent(new Event(SESSION_SCROLL_NAVIGATION_EVENT));
      controllerRef.current.jumpToLastPrompt(behavior);
    }
  }, [scrollKey, containerRef]);
  const jumpToStartOfMessage = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (controllerRef.current?.sessionId === scrollKey) {
      containerRef.current?.dispatchEvent(new Event(SESSION_SCROLL_NAVIGATION_EVENT));
      controllerRef.current.jumpToStartOfMessage(behavior);
    }
  }, [scrollKey, containerRef]);

  const refresh = useCallback(() => {
    if (controllerRef.current?.sessionId === scrollKey) {
      controllerRef.current.update(options.historyReady, options.submittedMessageId);
    }
  }, [scrollKey, options.historyReady, options.submittedMessageId]);

  return { handleScroll, markScrollGesture, scrollToBottom, scrollToTop, jumpToLatest, jumpToStart, jumpToPreviousPrompt, jumpToNextPrompt, jumpToLastPrompt, jumpToStartOfMessage, refresh, mobileTurnFullyVisible };
}
