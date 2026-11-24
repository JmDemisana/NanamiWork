import { expect, test } from "bun:test";
import { setTimeout } from "node:timers/promises";
import { OpenWorkBackgroundTasks } from "../src/opencode-plugins/openwork-background-tasks.js";

type PluginInput = NonNullable<Parameters<typeof OpenWorkBackgroundTasks>[0]>;
type PluginSession = NonNullable<NonNullable<PluginInput["client"]>["session"]>;
type Wakeup = Parameters<NonNullable<PluginSession["promptAsync"]>>[0];

const command = (body: string) => `"${process.execPath}" -e "${body}"`;
const context = (sessionID: string) => ({
  sessionID,
  directory: process.cwd(),
  worktree: process.cwd(),
  ask: async () => {},
});
const idle = (sessionID: string) => ({
  event: { type: "session.status", properties: { sessionID, status: { type: "idle" } } },
});

test("a quick command reports its result within the tool call and does not wake the chat", async () => {
  const requests: Wakeup[] = [];
  const plugin = await OpenWorkBackgroundTasks({ client: {
    session: { promptAsync: async (request) => { requests.push(request); } },
  } });
  try {
    const result = await plugin.tool.run_background_task.execute({
      command: command("console.log('ready')"),
      label: "Check output",
    }, context("ses_quick"));
    expect(result.metadata.openworkBackgroundTask).toMatchObject({
      status: "completed",
      label: "Check output",
      exitCode: 0,
    });
    expect(JSON.parse(result.output).output).toContain("ready");
    await plugin.event(idle("ses_quick"));
    expect(requests).toEqual([]);
  } finally {
    await plugin.dispose();
  }
});

test("a background task is visible immediately and wakes the idle chat once with synthetic metadata", async () => {
  const requests: Wakeup[] = [];
  const plugin = await OpenWorkBackgroundTasks({ client: {
    session: {
      promptAsync: async (request) => { requests.push(request); },
      messages: async () => ({ data: [
        { info: { role: "user", agent: "build", model: { providerID: "example", modelID: "chosen", variant: "high" }, system: "Keep your current context." } },
        { info: { role: "assistant" } },
      ] }),
    },
  } });
  try {
    const session = context("ses_background");
    const result = await plugin.tool.run_background_task.execute({
      command: command("setTimeout(() => console.log('ready'), 70)"),
      label: "Check output",
      wait_ms: 0,
    }, session);
    const task = result.metadata.openworkBackgroundTask;
    expect(task.status).toBe("running");
    expect(task.startedAt).toBeGreaterThan(0);

    const deadline = Date.now() + 3_000;
    let status = "running";
    while (status === "running" && Date.now() < deadline) {
      await setTimeout(20);
      const list = await plugin.tool.list_background_tasks.execute({}, session);
      status = JSON.parse(list).tasks[0].status;
    }
    expect(status).toBe("completed");
    expect(requests).toEqual([]);
    await plugin.event(idle(session.sessionID));
    await plugin.event(idle(session.sessionID));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      path: { id: session.sessionID },
      body: {
        agent: "build",
        model: { providerID: "example", modelID: "chosen" },
        variant: "high",
        system: "Keep your current context.",
        parts: [{
          type: "text",
          synthetic: true,
          metadata: { openworkBackgroundShell: { shellId: task.taskId, command: task.label, outcome: "finished", exit: 0 } },
        }],
      },
    });
    expect(requests[0].body.parts[0].text).toContain("ready");
    expect(requests[0].body.noReply).toBeUndefined();
  } finally {
    await plugin.dispose();
  }
});

test("only the owning chat can stop a task and its stopped notice cannot wake the model", async () => {
  const notices: Wakeup[] = [];
  const wakes: Wakeup[] = [];
  const plugin = await OpenWorkBackgroundTasks({ client: {
    session: {
      prompt: async (request) => { notices.push(request); },
      promptAsync: async (request) => { wakes.push(request); },
    },
  } });
  try {
    const session = context("ses_owner");
    const result = await plugin.tool.run_background_task.execute({
      command: command("setTimeout(() => {}, 60000)"),
      label: "Check cancellation",
      wait_ms: 0,
    }, session);
    const task = result.metadata.openworkBackgroundTask;
    const other = context("ses_other");
    const foreignStop = await plugin.tool.stop_background_task.execute({ task_id: task.taskId }, other);
    expect(typeof foreignStop).toBe("string");
    expect(JSON.parse(await plugin.tool.list_background_tasks.execute({}, other)).tasks).toEqual([]);

    const ownerStop = await plugin.tool.stop_background_task.execute({ task_id: task.taskId }, session);
    if (typeof ownerStop === "string") throw new Error(ownerStop);
    expect(ownerStop.metadata.openworkBackgroundTask.status).toBe("stopped");
    await plugin.event(idle(session.sessionID));
    expect(wakes).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0].body.noReply).toBe(true);
    expect(notices[0].body.parts[0].metadata.openworkBackgroundShell.outcome).toBe("stopped");
  } finally {
    await plugin.dispose();
  }
});

test("the background tool requests existing shell permission before starting", async () => {
  const plugin = await OpenWorkBackgroundTasks();
  const session = context("ses_permission");
  const cmd = command("console.log('blocked')");
  try {
    await expect(plugin.tool.run_background_task.execute({ command: cmd }, {
      ...session,
      ask: async (request: unknown) => {
        expect(request).toMatchObject({ permission: "bash", patterns: [cmd] });
        throw new Error("Permission denied");
      },
    })).rejects.toThrow("Permission denied");
    expect(JSON.parse(await plugin.tool.list_background_tasks.execute({}, session)).tasks).toEqual([]);
  } finally {
    await plugin.dispose();
  }
});
