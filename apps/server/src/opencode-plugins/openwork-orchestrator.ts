import { z } from "zod";
import { appendAgentInstructions, createInstructionSection } from "./agent-instruction-compose.js";

export const ORCHESTRATOR_PLAN_MARKER = "[NANAMI_ORCHESTRATOR_PLAN_PHASE]";

const PLAN_PHASE_INSTRUCTIONS = `You are the Planning Model in NanamiWork Orchestrator mode.
Your job in this phase is strictly read-only investigation and planning:
1. Inspect files, search the codebase, and run read-only commands if needed.
2. NEVER edit, write, patch, or delete files, and NEVER run state-changing commands in this phase.
3. If the user's request is a pure question or explanation that needs no code edits or mutating commands, answer directly and do NOT call exit_plan_mode.
4. Otherwise, design a clear, concrete step-by-step plan listing exact file paths, specific changes, verification commands, and a "Replan if:" checklist, then call the exit_plan_mode tool with that plan and stop your turn.`;

const MUTATING_TOOLS = new Set([
  "edit",
  "write",
  "patch",
  "multiedit",
  "apply_patch",
  "notebookedit",
  "notebook_edit",
]);

const exitPlanArgsSchema = z.object({
  plan: z
    .string()
    .min(1)
    .describe("The complete, actionable implementation plan including file paths, changes, verification steps, and Replan-if conditions."),
});

const contextSchema = z.object({
  sessionID: z.string().min(1),
});

export const OpenWorkOrchestrator = async () => {
  const planPhaseSessions = new Set<string>();

  return {
    "experimental.chat.system.transform": async (
      input: unknown,
      output: { system: string[] },
    ) => {
      const sessionID =
        input && typeof input === "object" && "sessionID" in input && typeof (input as { sessionID?: unknown }).sessionID === "string"
          ? (input as { sessionID: string }).sessionID
          : undefined;
      const inPlanPhase = output.system.some((entry) => typeof entry === "string" && entry.includes(ORCHESTRATOR_PLAN_MARKER));
      if (inPlanPhase) {
        if (sessionID) planPhaseSessions.add(sessionID);
        appendAgentInstructions(
          output.system,
          createInstructionSection("orchestrator-plan-phase", PLAN_PHASE_INSTRUCTIONS),
        );
      } else if (sessionID) {
        planPhaseSessions.delete(sessionID);
      }
    },
    "tool.execute.before": async (
      input: { tool: string; sessionID?: string },
      _output: { args: unknown },
    ) => {
      if (!input.sessionID || !planPhaseSessions.has(input.sessionID)) return;
      if (MUTATING_TOOLS.has(input.tool.toLowerCase())) {
        throw new Error(
          `Tool "${input.tool}" is blocked during Orchestrator Planning Phase. Finish your plan and call exit_plan_mode to hand off to the Execution Model.`,
        );
      }
    },
    tool: {
      exit_plan_mode: {
        description:
          "Submit the finalized implementation plan and hand off execution to the Execution Model. Call this only when file edits or state-changing commands are needed.",
        args: exitPlanArgsSchema.shape,
        async execute(rawArgs: unknown, context: unknown) {
          const parsed = exitPlanArgsSchema.parse(rawArgs);
          const ctx = contextSchema.safeParse(context);
          if (ctx.success) {
            planPhaseSessions.delete(ctx.data.sessionID);
          }
          return JSON.stringify(
            {
              ok: true,
              handoff: "execution",
              plan: parsed.plan,
            },
            null,
            2,
          );
        },
      },
    },
  };
};
