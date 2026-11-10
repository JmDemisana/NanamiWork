import { expect, test } from "bun:test";
import { ModelAdmissionFence } from "../src/app/lib/model-admission-fence";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("regular admissions can coexist but prevent an account switch", async () => {
  const fence = new ModelAdmissionFence();
  const hold = deferred<void>();
  const first = fence.regular(() => hold.promise);
  const second = fence.regular(async () => "ok");
  expect(await second).toBe("ok");
  await expect(fence.routed(async () => "wrong")).rejects.toThrow("Another message is starting");
  hold.resolve();
  await first;
  expect(await fence.routed(async () => "ok")).toBe("ok");
});

test("a router switch fences regular admission and releases even on failure", async () => {
  const fence = new ModelAdmissionFence();
  const hold = deferred<void>();
  const order: string[] = [];
  const routed = fence.routed(async () => { order.push("switch"); await hold.promise; throw new Error("failed"); });
  const normal = fence.regular(async () => { order.push("normal"); return "ok"; });
  expect(order).toEqual(["switch"]);
  hold.resolve();
  await expect(routed).rejects.toThrow("failed");
  expect(await normal).toBe("ok");
  expect(order).toEqual(["switch", "normal"]);
});
