export type ComposerSubmitAction = "send" | "queue" | "steer" | null;

/**
 * What an editor submit does with the draft.
 * Always steer, never queue: while busy Enter sends immediately (steer)
 * mid-task without leaving messages in a pending queue.
 */
export function resolveComposerSubmit(input: {
  hasContent: boolean;
  disabled: boolean;
  busy: boolean;
  editing: boolean;
  stopping: boolean;
  submissionPreparing: boolean;
  steer: boolean;
}): ComposerSubmitAction {
  if (!input.hasContent || input.disabled) return null;
  // A new Enter after Stop is fresh work, not a follow-up to the interrupted
  // turn. The immediate send path fences admission on the shared interruption
  // promise; dropping Enter here silently leaves the person's draft unsent.
  if (input.stopping) return input.submissionPreparing ? null : "send";
  if (input.busy && !input.editing) return "steer";
  return input.submissionPreparing ? null : "send";
}
