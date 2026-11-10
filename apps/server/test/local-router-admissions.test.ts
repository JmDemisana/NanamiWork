import { expect, test } from "bun:test";
import { assessRouterAdmissions, beginRouterAdmission, routerAdmissionHasTerminalReply } from "../src/local-router-admissions.js";

test("an acknowledged asynchronous prompt is not considered idle until its own reply is terminal", async () => {
  const config = {};
  const finish = beginRouterAdmission(config, { workspaceId: "workspace", sessionId: "ses_fixture", messageId: "msg_1" });
  expect(await assessRouterAdmissions(config, async () => false)).toBe("busy");
  finish(204);
  expect(await assessRouterAdmissions(config, async () => false)).toBe("unknown");
  const messages = [{ info: { role: "assistant", sessionID: "ses_fixture", parentID: "msg_1", time: { completed: 123 }, finish: "stop" }, parts: [] }];
  expect(await assessRouterAdmissions(config, async (entry) => routerAdmissionHasTerminalReply(messages, entry))).toBe("idle");
  expect(await assessRouterAdmissions(config, async () => false)).toBe("idle");
});

test("earlier, unfinished, and delegated replies do not prove the submitted turn finished", async () => {
  const entry = { workspaceId: "workspace", sessionId: "ses_fixture", messageId: "msg_1", startedAt: 100, phase: "accepted" } as const;
  const response = (parentID: string, finish: string, parts: unknown[] = []) => [{
    info: { role: "assistant", sessionID: "ses_fixture", parentID, time: { completed: 200 }, finish }, parts,
  }];
  expect(routerAdmissionHasTerminalReply(response("old", "stop"), entry)).toBe(false);
  expect(routerAdmissionHasTerminalReply(response("msg_1", "tool-calls"), entry)).toBe(false);
  expect(routerAdmissionHasTerminalReply(response("msg_1", "stop", [{ type: "tool", state: { status: "running" } }]), entry)).toBe(false);
  expect(routerAdmissionHasTerminalReply(response("msg_1", "stop"), entry)).toBe(true);
});

test("client rejection clears the reservation, but network failure and unreadable history fail closed", async () => {
  const config = {};
  beginRouterAdmission(config, { workspaceId: "workspace", sessionId: "ses_first", messageId: "msg_1" })(400);
  expect(await assessRouterAdmissions(config, async () => false)).toBe("idle");
  beginRouterAdmission(config, { workspaceId: "workspace", sessionId: "ses_second", messageId: "msg_2" })();
  expect(await assessRouterAdmissions(config, async () => { throw new Error("unavailable"); })).toBe("unknown");
  expect(await assessRouterAdmissions(config, async () => true)).toBe("idle");
});

test("a completed later turn covers earlier accepted steering in that conversation", async () => {
  const config = {};
  beginRouterAdmission(config, { workspaceId: "workspace", sessionId: "ses_fixture", messageId: "old" })(204);
  beginRouterAdmission(config, { workspaceId: "workspace", sessionId: "ses_fixture", messageId: "latest" })(204);
  const messages = [{ info: { role: "assistant", sessionID: "ses_fixture", parentID: "latest", time: { completed: 123 }, finish: "stop" }, parts: [] }];
  expect(await assessRouterAdmissions(config, async (entry) => routerAdmissionHasTerminalReply(messages, entry))).toBe("idle");
});
