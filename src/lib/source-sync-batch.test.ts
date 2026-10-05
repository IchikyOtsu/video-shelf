import assert from "node:assert/strict";
import { test } from "node:test";
import { SourceSyncDeferredError } from "./sync-control";
import { syncSourceBatch, SOURCE_SYNC_CONCURRENCY } from "./source-sync-batch";

const sources = Array.from({ length: 8 }, (_, i) => ({ id: String(i), kind: i % 2 ? "rss" : "youtube", feedUrl: `https://example.com/${i}` }));

test("batch sync bounds concurrency to three, replenishes workers, and waits for every source", async () => {
  const releases: (() => void)[] = [];
  const started: string[] = [];
  let active = 0;
  let peak = 0;
  let finished = false;
  const pending = syncSourceBatch(sources, async source => {
    started.push(source.id);
    peak = Math.max(peak, ++active);
    await new Promise<void>(resolve => { releases.push(resolve); });
    active--;
    return 2;
  }).then(result => { finished = true; return result; });
  assert.equal(started.length, SOURCE_SYNC_CONCURRENCY);
  releases.shift()!();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(started.length, 4);
  assert.equal(active, 3);
  assert.equal(finished, false);
  while (releases.length) {
    releases.shift()!();
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.deepEqual(await pending, { synced: 8, failed: 0, imported: 16 });
  assert.equal(peak, 3);
  assert.deepEqual(started, sources.map(source => source.id));
});

test("failures do not stop queued sources and only successes contribute imports", async () => {
  const attempted: string[] = [];
  const result = await syncSourceBatch(sources, async source => {
    attempted.push(source.id);
    if (["0", "3", "5"].includes(source.id)) throw new Error("Unavailable");
    return Number(source.id);
  });
  assert.deepEqual(result, { synced: 5, failed: 3, imported: 20 });
  assert.equal(attempted.length, 8);
});

test("empty collections and future provider kinds need no special handling", async () => {
  assert.deepEqual(await syncSourceBatch([], async () => { throw new Error("Must not run"); }), { synced: 0, failed: 0, imported: 0 });
  assert.deepEqual(await syncSourceBatch([{ ...sources[0], kind: "future-provider" }], async source => {
    assert.equal(source.kind, "future-provider");
    return 1;
  }), { synced: 1, failed: 0, imported: 1 });
});

test("budget stops launching sources, waits for workers, and reports exactly the unstarted sources", async () => {
  let now = 0;
  const attempted: string[] = [];
  const result = await syncSourceBatch(sources, async (source, context) => {
    attempted.push(source.id);
    assert.equal(context?.deadlineMs, 60_000);
    now = 100;
    await new Promise<void>(resolve => setImmediate(resolve));
    return 1;
  }, { startBudgetMs: 100, now: () => now });
  assert.deepEqual(result, { synced: 1, failed: 0, imported: 1, remaining: sources.slice(1).map(source => source.id) });
  const remaining = sources.filter(source => result.remaining?.includes(source.id));
  const resumed = await syncSourceBatch(remaining, async source => { attempted.push(source.id); return 1; });
  assert.equal(resumed.synced, 7);
  assert.deepEqual(attempted, sources.map(source => source.id));
});

test("deferred sources are returned for retry and do not count as failures or successes", async () => {
  const result = await syncSourceBatch(sources, async source => {
    if (source.id === "0") throw new SourceSyncDeferredError();
    if (source.id === "1") throw new Error("Unavailable");
    return 1;
  }, { startBudgetMs: 100, now: () => 0 });
  assert.deepEqual(result, { synced: 6, failed: 1, imported: 6, remaining: ["0"] });
});

test("budget expiry drains all three running workers without starting queued sources", async () => {
  let now = 0;
  const releases: (() => void)[] = [];
  let finished = 0;
  const result = syncSourceBatch(sources, async () => {
    await new Promise<void>(resolve => releases.push(resolve));
    finished++;
    return 1;
  }, { startBudgetMs: 100, now: () => now });
  assert.equal(releases.length, 3);
  now = 100;
  releases[0]();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(releases.length, 3);
  assert.equal(finished, 1);
  releases[1](); releases[2]();
  assert.deepEqual(await result, { synced: 3, failed: 0, imported: 3, remaining: sources.slice(3).map(source => source.id) });
});
