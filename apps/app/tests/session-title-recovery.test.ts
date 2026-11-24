import { expect, test } from "bun:test";
import {
  classifySessionTitleRecoveryRead,
  type SessionTitleRecoveryMessage,
} from "../src/react-app/domains/session/sync/session-title-recovery";

const placeholder = "New session - 2026-11-24T00:00:00.000Z";
const user: SessionTitleRecoveryMessage = { role: "user", synthetic: false, completed: false, error: null };
const assistant: SessionTitleRecoveryMessage = { role: "assistant", synthetic: false, completed: true, error: null };

test("a background task wakeup doesn't turn first-title recovery into a multi-user turn", () => {
  const messages = [user, assistant, { ...user, synthetic: true }];
  expect(classifySessionTitleRecoveryRead({ title: placeholder, messages })).toBe("failed");
  expect(classifySessionTitleRecoveryRead({ title: placeholder, messages: [...messages, user] })).toBe("not-applicable");
});

test("unsettled assistant output and missing title metadata are still pending", () => {
  expect(classifySessionTitleRecoveryRead({
    title: placeholder, messages: [user, { ...assistant, completed: false }],
  })).toBe("pending");
  expect(classifySessionTitleRecoveryRead({ title: undefined, messages: [user, assistant] })).toBe("pending");
  expect(classifySessionTitleRecoveryRead({ title: "Project test report", messages: [] })).toBe("resolved");
});
