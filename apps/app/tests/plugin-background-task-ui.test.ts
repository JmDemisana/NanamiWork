import { expect, test } from "bun:test";
import type { TextPart, ToolPart } from "@opencode-ai/sdk/v2/client";
import type { UIMessage } from "ai";
import {
  BACKGROUND_SHELL_NOTICE_KEY,
  projectBackgroundTaskMessage,
} from "../src/app/lib/background-shell-tasks";
import {
  applyPluginBackgroundPart,
  emptyBackgroundShellBook,
  sessionBackgroundShells,
} from "../src/react-app/domains/session/status/background-shell-store";
import { snapshotToUIMessages, textPartToUIPart } from "../src/react-app/domains/session/sync/usechat-adapter";

const basePart = { id: "prt_task", sessionID: "ses_parent", messageID: "msg_task" };
const taskId = "bg_test";
const tool: ToolPart = {
  ...basePart,
  type: "tool",
  callID: "call_task",
  tool: "run_background_task",
  state: {
    status: "completed",
    input: { command: "test command" },
    title: "Check the project",
    output: "{}",
    metadata: {
      openworkBackgroundTask: { taskId, label: "Check the project", status: "running", startedAt: 100, exitCode: null },
    },
    time: { start: 100, end: 150 },
  },
};
const notice: TextPart = {
  ...basePart,
  id: "prt_completion",
  messageID: "msg_completion",
  type: "text",
  synthetic: true,
  text: "[BACKGROUND TASK COMPLETED]\nInternal command output",
  metadata: {
    [BACKGROUND_SHELL_NOTICE_KEY]: { shellId: taskId, command: "Check the project", outcome: "finished", exit: 0 },
  },
};

test("tracks a v1 task in its own conversation and removes it on a stable completion", () => {
  const running = applyPluginBackgroundPart(emptyBackgroundShellBook, tool, 200, true);
  expect(sessionBackgroundShells(running.running, "ses_parent")).toEqual([
    { id: taskId, command: "Check the project", sessionId: "ses_parent", startedAt: 100, observedAt: 200 },
  ]);
  expect(sessionBackgroundShells(running.running, "ses_other")).toEqual([]);
  const settled = applyPluginBackgroundPart(running, notice, 300, false);
  expect(settled.running).toEqual({});
  expect(applyPluginBackgroundPart(settled, tool, 301, true)).toBe(settled);
  expect(applyPluginBackgroundPart(emptyBackgroundShellBook, tool, 300, false)).toBe(emptyBackgroundShellBook);
});

test("a plugin completion projects as a neutral historical row with no raw output", () => {
  const [message] = snapshotToUIMessages({
    messages: [{
      info: {
        role: "user",
        id: notice.messageID,
        sessionID: notice.sessionID,
        time: { created: 300 },
        agent: "build",
        model: { providerID: "example", modelID: "test" },
      },
      parts: [notice],
    }],
  });
  expect(message?.role).toBe("system");
  expect(message?.parts).toEqual([{
    type: "text",
    text: "Background task finished",
    state: "done",
    providerMetadata: { opencode: { partId: notice.id, backgroundShell: notice.metadata?.[BACKGROUND_SHELL_NOTICE_KEY] } },
  }]);
});

test("ordinary user text stays a user message even if it looks like an old wakeup", () => {
  const part = textPartToUIPart({ ...notice, synthetic: false });
  if (!part) throw new Error("Expected visible user text");
  const input: UIMessage = { role: "user", id: notice.messageID, parts: [part] };
  expect(projectBackgroundTaskMessage(input)).toBe(input);
});
