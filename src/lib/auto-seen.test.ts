import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleAutoSeen, type TimerScheduler } from "./auto-seen";

function fakeTimer() {
  let callback: (() => void) | undefined;
  let cleared = false;
  let delay = 0;
  const scheduler: TimerScheduler = {
    set(next, wait) { callback = next; delay = wait; return 1 as unknown as ReturnType<typeof setTimeout>; },
    clear() { cleared = true; },
  };
  return { scheduler, fire: () => { if (!cleared) callback?.(); }, wasCleared: () => cleared, delay: () => delay };
}

test("auto-seen waits for the full 30-second threshold", () => {
  const timer = fakeTimer();
  let seen = false;
  scheduleAutoSeen(() => { seen = true; }, timer.scheduler);
  assert.equal(timer.delay(), 30_000);
  assert.equal(seen, false);
  timer.fire();
  assert.equal(seen, true);
});

test("closing or switching videos cancels the pending auto-seen action", () => {
  const timer = fakeTimer();
  let calls = 0;
  const cancel = scheduleAutoSeen(() => { calls++; }, timer.scheduler);
  cancel();
  timer.fire();
  assert.equal(timer.wasCleared(), true);
  assert.equal(calls, 0);
});
