import assert from "node:assert/strict";
import { test } from "node:test";
import { cronSyncDue, CRON_SYNC_MIN_INTERVAL_MS } from "./cron-sync";

test("cron skips recent successful manual/automatic syncs and includes never-synced and stale sources", () => {
  const now = new Date("2026-10-05T08:00:00Z");
  assert.equal(cronSyncDue(null, now), true);
  assert.equal(cronSyncDue(new Date(now.getTime() - 5 * 60_000), now), false);
  assert.equal(cronSyncDue(new Date(now.getTime() - CRON_SYNC_MIN_INTERVAL_MS + 1), now), false);
  assert.equal(cronSyncDue(new Date(now.getTime() - CRON_SYNC_MIN_INTERVAL_MS), now), true);
  assert.equal(cronSyncDue(new Date("2026-10-04T08:00:00Z"), now), true);
});
