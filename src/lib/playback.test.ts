import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, parseProgressUpdate, playbackIsComplete, processProgressUpdate, ProgressAccessError, ProgressSaveQueue, resumePosition } from "./playback";

const itemId = "11111111-1111-4111-8111-111111111111";

test("progress validation rejects negative progress, invalid UUIDs and invalid durations", () => {
  assert.throws(() => parseProgressUpdate({ itemId, progressSeconds: -1 }), /invalide/);
  assert.throws(() => parseProgressUpdate({ itemId: "bad", progressSeconds: 10 }), /invalide/);
  assert.throws(() => parseProgressUpdate({ itemId, progressSeconds: 10, durationSeconds: 0 }), /invalide/);
  assert.throws(() => parseProgressUpdate({ itemId, progressSeconds: 500, durationSeconds: 100 }), /invalide/);
});

test("progress validation accepts optional duration and converts values to integer seconds", () => {
  assert.deepEqual(parseProgressUpdate({ itemId, progressSeconds: 12.9, observedAt: 1000 }, 1000), { itemId, progressSeconds: 12, durationSeconds: null, observedAt: 1000 });
  assert.deepEqual(parseProgressUpdate({ itemId, progressSeconds: 12.9, durationSeconds: 40.8, observedAt: 1000 }, 1000), { itemId, progressSeconds: 12, durationSeconds: 40, observedAt: 1000 });
});

test("progress processing rejects inaccessible items and persists valid owned items", async () => {
  await assert.rejects(processProgressUpdate({ itemId, progressSeconds: 10 }, async () => false, async () => {}), ProgressAccessError);
  let persisted = 0;
  const result = await processProgressUpdate({ itemId, progressSeconds: 10, durationSeconds: 100 }, async () => true, async update => { persisted = update.progressSeconds; });
  assert.equal(result.durationSeconds, 100);
  assert.equal(persisted, 10);
});

test("resume starts at zero, resumes partial playback and restarts completed media", () => {
  assert.equal(resumePosition(0, 100), 0);
  assert.equal(resumePosition(754, 2000), 754);
  assert.equal(resumePosition(95, 100), 0);
  assert.equal(resumePosition(91, 100), 0);
});

test("completion uses actual progress, ended state and a session manual-new override", () => {
  assert.equal(playbackIsComplete(89, 100), false);
  assert.equal(playbackIsComplete(90, 100), true);
  assert.equal(playbackIsComplete(10, 100, true), true);
  assert.equal(playbackIsComplete(100, 100, true, true), false);
});

test("duration formatting supports minutes and hours", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(42), "0:42");
  assert.equal(formatDuration(754), "12:34");
  assert.equal(formatDuration(5410), "1:30:10");
});

test("progress persistence is throttled and lifecycle flushes force a final ordered save", async () => {
  const writes: number[] = [];
  const queue = new ProgressSaveQueue(async sample => { writes.push(sample.progressSeconds); }, 0, 10_000, 3);
  queue.observe(4, 100, 1_000); await queue.persist();
  queue.observe(5, 100, 2_000); await queue.persist();
  queue.observe(14, 100, 11_100); await queue.persist();
  queue.observe(15, 100, 12_000); await queue.persist(true, true);
  assert.deepEqual(writes, [4, 14, 15]);
});

test("progress requests never overlap, preventing ordinary network reordering", async () => {
  let active = 0; let maximum = 0; const releases: Array<() => void> = [];
  const queue = new ProgressSaveQueue(() => new Promise<void>(resolve => { active++; maximum = Math.max(maximum, active); releases.push(() => { active--; resolve(); }); }), 0, 0, 0);
  queue.observe(10, 100, 1); const first = queue.persist(true);
  queue.observe(5, 100, 2); const second = queue.persist(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  releases.shift()?.(); await first;
  await new Promise(resolve => setTimeout(resolve, 0));
  releases.shift()?.(); await second;
  assert.equal(maximum, 1);
});
