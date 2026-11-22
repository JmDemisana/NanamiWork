import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appendAgentInstructions, createInstructionSection } from "./agent-instruction-compose.js";

const MAX_OUTPUT_CHARS = 12_000;
const MAX_TASKS = 64;
const WAKEUP_TAIL_CHARS = 3_500;

const BACKGROUND_TASK_INSTRUCTIONS = `## Reactive background tasks
- Waiting for a long command (builds, test suites, installers, downloads, CI watchers, or scripts taking more than a few seconds) is NOT AI work. Use \`run_background_task\` instead of blocking the turn with \`bash\`.
- \`run_background_task\` waits briefly (\`wait_ms\`, default 2000ms). If the command finishes quickly, it returns the full result right away. If it is still running, it returns \`{ status: "running", taskId }\`.
- When \`run_background_task\` returns \`status: "running"\`, NEVER poll, sleep, or loop waiting for it. Briefly tell the user it is running and END YOUR TURN so the chat goes idle and stays responsive.
- You will be woken up automatically with the exit code and output tail as soon as the background task finishes.
- Use \`list_background_tasks\` to inspect tasks or \`stop_background_task\` to cancel one if the user asks.`;

type TaskStatus = "running" | "completed" | "failed" | "stopped";

type BackgroundTask = {
  id: string;
  label: string;
  command: string;
  cwd: string;
  sessionID: string;
  directory?: string;
  status: TaskStatus;
  startedAt: number;
  finishedAt?: number;
  exitCode: number | null;
  output: string;
  returnedAsRunning: boolean;
  notified: boolean;
  child: ChildProcess | null;
};

type PluginClient = {
  session?: {
    promptAsync?: (input: {
      path: { id: string };
      query?: { directory?: string };
      body: { parts: Array<{ type: "text"; text: string }> };
    }) => Promise<unknown>;
  };
};

type PluginFactoryInput = {
  client?: PluginClient;
  directory?: string;
};

function appendTail(current: string, chunk: string): string {
  const combined = current + chunk;
  if (combined.length <= MAX_OUTPUT_CHARS) return combined;
  return combined.slice(combined.length - MAX_OUTPUT_CHARS);
}

function killProcessTree(child: ChildProcess | null) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32" && typeof child.pid === "number") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else if (typeof child.pid === "number") {
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    try {
      if (process.platform !== "win32" && typeof child.pid === "number") {
        process.kill(-child.pid, "SIGKILL");
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  }
}

const runArgsSchema = z.object({
  command: z.string().min(1).describe("Shell command to run in the background."),
  label: z.string().optional().describe("Short human-readable label for this task (e.g. 'Build Windows installer')."),
  cwd: z.string().optional().describe("Optional working directory. Defaults to the current workspace directory."),
  wait_ms: z
    .number()
    .int()
    .min(0)
    .max(10_000)
    .optional()
    .describe("Milliseconds to wait before returning as a background task (default 2000)."),
});

const stopArgsSchema = z.object({
  task_id: z.string().min(1).describe("The taskId returned by run_background_task."),
});

const listArgsSchema = z.object({});

const contextSchema = z.object({
  sessionID: z.string().min(1),
  directory: z.string().optional(),
});

// Only export the factory: OpenCode treats every export as a plugin.
export const OpenWorkBackgroundTasks = async (factoryInput?: PluginFactoryInput) => {
  const tasks = new Map<string, BackgroundTask>();
  const client = factoryInput?.client;
  const defaultDirectory = factoryInput?.directory;

  const pruneFinishedTasks = () => {
    if (tasks.size <= MAX_TASKS) return;
    for (const [id, task] of tasks) {
      if (task.status !== "running") {
        tasks.delete(id);
        if (tasks.size <= MAX_TASKS) break;
      }
    }
  };

  const notifyCompletion = async (task: BackgroundTask) => {
    if (task.notified || task.status === "stopped") return;
    if (!task.returnedAsRunning) return;
    if (!client?.session?.promptAsync) return;
    task.notified = true;

    const durationSec = Math.max(
      0,
      Math.round(((task.finishedAt ?? Date.now()) - task.startedAt) / 100) / 10,
    );
    const tail = task.output.trim().slice(-WAKEUP_TAIL_CHARS);
    const wakeupText = [
      `[BACKGROUND TASK ${task.status.toUpperCase()}]`,
      `Task: ${task.label} (${task.id})`,
      `Command: ${task.command}`,
      `Exit code: ${task.exitCode ?? "unknown"} (${durationSec}s)`,
      tail ? `\nRecent output:\n\`\`\`\n${tail}\n\`\`\`` : "\n(No output captured.)",
      `\nSummarize the outcome clearly for the user and continue any next steps if needed.`,
    ].join("\n");

    try {
      await client.session.promptAsync({
        path: { id: task.sessionID },
        ...(task.directory ? { query: { directory: task.directory } } : {}),
        body: {
          parts: [{ type: "text", text: wakeupText }],
        },
      });
    } catch {
      // Best-effort wakeup; task output remains inspectable via list_background_tasks.
    }
  };

  return {
    "experimental.chat.system.transform": async (
      _input: unknown,
      output: { system: string[] },
    ) => {
      appendAgentInstructions(
        output.system,
        createInstructionSection("background-tasks", BACKGROUND_TASK_INSTRUCTIONS),
      );
    },
    tool: {
      run_background_task: {
        description:
          "Run a shell command that may take more than a few seconds. Waits briefly (default 2s); if still running, moves to the background and returns immediately so you can end your turn and go idle. Automatically wakes you up with the exit code and output when the command finishes.",
        args: runArgsSchema.shape,
        async execute(rawArgs: unknown, rawContext: unknown) {
          const parsed = runArgsSchema.parse(rawArgs);
          const ctx = contextSchema.safeParse(rawContext);
          const sessionID = ctx.success ? ctx.data.sessionID : "";
          const directory = ctx.success && ctx.data.directory ? ctx.data.directory : defaultDirectory;
          const cwd = parsed.cwd?.trim() || directory || process.cwd();
          const waitMs = parsed.wait_ms ?? 2000;
          const id = `bg_${randomUUID().slice(0, 8)}`;
          const label = parsed.label?.trim() || parsed.command.slice(0, 60);

          const child = spawn(parsed.command, {
            cwd,
            shell: true,
            detached: process.platform !== "win32",
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          });

          const task: BackgroundTask = {
            id,
            label,
            command: parsed.command,
            cwd,
            sessionID,
            directory,
            status: "running",
            startedAt: Date.now(),
            exitCode: null,
            output: "",
            returnedAsRunning: false,
            notified: false,
            child,
          };

          tasks.set(id, task);
          pruneFinishedTasks();

          child.stdout?.on("data", (chunk: Buffer | string) => {
            task.output = appendTail(task.output, String(chunk));
          });
          child.stderr?.on("data", (chunk: Buffer | string) => {
            task.output = appendTail(task.output, String(chunk));
          });

          const exitPromise = new Promise<void>((resolve) => {
            const finalize = (code: number | null) => {
              if (task.status === "running") {
                task.status = code === 0 ? "completed" : "failed";
                task.exitCode = code;
                task.finishedAt = Date.now();
              }
              task.child = null;
              resolve();
              if (task.returnedAsRunning && task.sessionID) {
                void notifyCompletion(task);
              }
            };
            child.once("error", (err) => {
              task.output = appendTail(task.output, `\nProcess error: ${err.message}\n`);
              finalize(1);
            });
            child.once("close", (code) => {
              finalize(typeof code === "number" ? code : 1);
            });
          });

          if (waitMs > 0) {
            await Promise.race([
              exitPromise,
              new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
            ]);
          }

          if (task.status === "running") {
            task.returnedAsRunning = true;
            return JSON.stringify(
              {
                taskId: task.id,
                label: task.label,
                status: "running",
                message:
                  "Command is running in the background. End your turn now without polling; you will be woken up automatically when it finishes.",
                recentOutput: task.output.slice(-1000),
              },
              null,
              2,
            );
          }

          const durationMs = (task.finishedAt ?? Date.now()) - task.startedAt;
          return JSON.stringify(
            {
              taskId: task.id,
              label: task.label,
              status: task.status,
              exitCode: task.exitCode,
              durationMs,
              output: task.output.slice(-WAKEUP_TAIL_CHARS),
            },
            null,
            2,
          );
        },
      },
      list_background_tasks: {
        description: "List running and recently finished background tasks for this session.",
        args: listArgsSchema.shape,
        async execute(_rawArgs: unknown, rawContext: unknown) {
          const ctx = contextSchema.safeParse(rawContext);
          const sessionID = ctx.success ? ctx.data.sessionID : "";
          const items = [...tasks.values()]
            .filter((t) => !sessionID || t.sessionID === sessionID)
            .map((t) => ({
              taskId: t.id,
              label: t.label,
              command: t.command,
              status: t.status,
              exitCode: t.exitCode,
              elapsedMs: (t.finishedAt ?? Date.now()) - t.startedAt,
              recentOutput: t.output.slice(-1500),
            }));
          return JSON.stringify({ tasks: items }, null, 2);
        },
      },
      stop_background_task: {
        description: "Stop a running background task by task_id.",
        args: stopArgsSchema.shape,
        async execute(rawArgs: unknown) {
          const parsed = stopArgsSchema.parse(rawArgs);
          const task = tasks.get(parsed.task_id);
          if (!task) {
            return JSON.stringify({ ok: false, error: `Unknown task_id: ${parsed.task_id}` });
          }
          if (task.status !== "running") {
            return JSON.stringify({ ok: true, taskId: task.id, status: task.status, message: "Task already finished." });
          }
          task.status = "stopped";
          task.finishedAt = Date.now();
          task.notified = true;
          killProcessTree(task.child);
          task.child = null;
          return JSON.stringify({ ok: true, taskId: task.id, status: "stopped" });
        },
      },
    },
  };
};
