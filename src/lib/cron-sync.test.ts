import assert from "node:assert/strict";
import { test } from "node:test";
import { prioritizeSyncSources, cronSyncDue, CRON_SYNC_MIN_INTERVAL_MS } from "./cron-sync";

test("cron skips recent successful manual/automatic syncs and includes never-synced and stale sources", () => {
  const now = new Date("2026-10-05T08:00:00Z");
  assert.equal(cronSyncDue(null, now), true);
  assert.equal(cronSyncDue(new Date(now.getTime() - 5 * 60_000), now), false);
  assert.equal(cronSyncDue(new Date(now.getTime() - CRON_SYNC_MIN_INTERVAL_MS + 1), now), false);
  assert.equal(cronSyncDue(new Date(now.getTime() - CRON_SYNC_MIN_INTERVAL_MS), now), true);
  assert.equal(cronSyncDue(new Date("2026-10-04T08:00:00Z"), now), true);
});

test("unfinished sources keep priority on the next invocation using persisted success timestamps", () => {
  const old = new Date("2026-10-01T08:00:00Z");
  const now = new Date("2026-10-05T08:00:00Z");
  const sources = [{ id: "d", lastSyncedAt: old }, { id: "b", lastSyncedAt: null }, { id: "a", lastSyncedAt: null }, { id: "c", lastSyncedAt: now }];
  assert.deepEqual(prioritizeSyncSources(sources).map(source => source.id), ["a", "b", "d", "c"]);
  const resumed = sources.map(source => source.id === "a" ? { ...source, lastSyncedAt: now } : source);
  assert.deepEqual(prioritizeSyncSources(resumed).map(source => source.id), ["b", "d", "a", "c"]);
  assert.deepEqual(sources.map(source => source.id), ["d", "b", "a", "c"]);
});
