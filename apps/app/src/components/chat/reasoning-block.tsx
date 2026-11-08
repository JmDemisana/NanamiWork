"use client"

import { useWorkbenchDisclosure } from "@/react-app/domains/session/chat/workbench-ui-state"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { MessageContent } from "@/components/ui/message"
import { TextSentenceLine, TrailingChevron } from "@/components/chat/activity-rail"
import { textThoughtLabel } from "@/lib/text-activity"
import { cn } from "@/lib/utils"

type ReasoningBlockProps = {
  text: string
  isStreaming: boolean
  className?: string
  disclosureKey?: string
  /** How long the model thought; text-first shows "Thought 12s". */
  durationMs?: number | null
}

/**
 * Thinking is collapsed by default — a single "Thinking… / Thought"
 * line with a chevron; the full reasoning renders as markdown only
 * when the user opens it.
 */
export function ReasoningBlock({ text, isStreaming, className, durationMs }: ReasoningBlockProps) {
  return (
    <div className={cn("w-full", className)} data-reasoning-block="">
      <div className="flex min-h-6.5 items-center gap-2 text-sm">
        <TextSentenceLine verb={textThoughtLabel(durationMs, isStreaming)} tone={isStreaming ? "running" : "normal"} />
      </div>
      <div className="mt-1 w-full min-w-0">
        <MessageContent
          markdown
          isStreaming={isStreaming}
          className="text-muted-foreground prose w-full min-w-0 rounded-lg bg-transparent p-0 text-sm"
        >
          {text}
        </MessageContent>
      </div>
    </div>
  )
}
