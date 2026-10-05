import assert from "node:assert/strict";
import { test } from "node:test";
import { deduplicateNormalizedItems, getSourceProvider, initialImportStates, runSourceSync, type NormalizedItem } from "./sources";
import { deterministicItemStateId } from "./item-state";
import { syncSourceBatch } from "./source-sync-batch";
import { SourceSyncDeferredError } from "./sync-control";
import { SourceFetchError } from "./source-fetch";

const source = { id: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", kind: "youtube", feedUrl: "https://example.com/feed" };
const item: NormalizedItem = { guid: "video-1", title: "One", url: "https://example.com/one", mediaType: "video" };

test("provider normalization does not persist duplicate source GUIDs", () => {
  assert.deepEqual(deduplicateNormalizedItems([item, { ...item, title: "Duplicate" }]), [item]);
});

test("initial source import creates seen states while preserving items for Library and source history", () => {
  const states = initialImportStates(source.userId, ["item-1", "item-2"], true);
  assert.deepEqual(states, [
    { id: deterministicItemStateId(source.userId, "item-1"), userId: source.userId, itemId: "item-1", read: true },
    { id: deterministicItemStateId(source.userId, "item-2"), userId: source.userId, itemId: "item-2", read: true },
  ]);
  assert.equal(states.every(state => state.read), true);
});

test("later sync items remain unseen and existing source sync behavior is unchanged", () => {
  assert.deepEqual(initialImportStates(source.userId, ["new-item"], false), []);
});

test("a successful sync persists normalized items, records success and clears the error path", async () => {
  let lastSyncError: string | null = "Ancienne erreur"; let lastSyncedAt: Date | null = null; let persisted: NormalizedItem[] = [];
  const imported = await runSourceSync(source, { contentType: "video", sync: async () => [item, item] }, async rows => { persisted = rows; return rows.length; }, async () => { lastSyncedAt = new Date(); lastSyncError = null; }, async message => { lastSyncError = message; });
  assert.equal(imported, 1);
  assert.deepEqual(persisted, [item]);
  assert.ok(lastSyncedAt);
  assert.equal(lastSyncError, null);
});

test("a failed sync records a short error and keeps the failure observable", async () => {
  let recorded = "";
  await assert.rejects(runSourceSync(source, { contentType: "video", sync: async () => { throw new Error("Flux indisponible"); } }, async () => 0, async () => {}, async message => { recorded = message; }), /Flux indisponible/);
  assert.equal(recorded, "Flux indisponible");
});

test("provider metadata derives the persisted source content type", () => {
  assert.equal(getSourceProvider("youtube")?.contentType, "video");
  assert.equal(getSourceProvider("unknown"), undefined);
});

test("mixed YouTube and RSS batch imports both providers and isolates an HTTP failure", async t => {
  t.mock.method(console, "error", () => {});
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requests.push(url);
    if (url.includes("blocked")) return new Response("Forbidden", { status: 403 });
    if (url.includes("youtube")) return new Response('<feed><entry><yt:videoId>video-1</yt:videoId><title>Video</title><link rel="alternate" href="https://www.youtube.com/watch?v=video-1"/></entry></feed>');
    return new Response('<rss><channel><title>Articles</title><item><guid>article-1</guid><title>Article</title><link>https://example.com/article</link></item></channel></rss>');
  });
  const mixed = [
    { ...source, id: "youtube", feedUrl: "https://www.youtube.com/feeds/videos.xml" },
    { ...source, id: "blocked", feedUrl: "https://www.youtube.com/blocked" },
    { ...source, id: "rss", kind: "rss", feedUrl: "https://example.com/rss" },
    { ...source, id: "rss-later", kind: "rss", feedUrl: "https://example.com/rss-later" },
  ];
  const persisted: Record<string, NormalizedItem[]> = {};
  const succeeded: string[] = [];
  const failed: string[] = [];
  const result = await syncSourceBatch(mixed, input => runSourceSync(input, getSourceProvider(input.kind), async rows => {
    persisted[input.id] = rows;
    return rows.length;
  }, async () => { succeeded.push(input.id); }, async message => { failed.push(message); }));
  assert.deepEqual(result, { synced: 3, failed: 1, imported: 3 });
  assert.equal(requests.length, 4);
  assert.equal(persisted.youtube[0].mediaType, "video");
  assert.equal(persisted.rss[0].mediaType, "article");
  assert.equal(persisted["rss-later"][0].mediaType, "article");
  assert.deepEqual(succeeded.sort(), ["rss", "rss-later", "youtube"]);
  assert.deepEqual(failed, ["Flux inaccessible (HTTP 403)."]);
});

test("failure recording cannot mask the original upstream error", async t => {
  t.mock.method(console, "error", () => {});
  const upstream = new SourceFetchError("HTTP_ERROR", "example.com", 429);
  await assert.rejects(runSourceSync(source, { contentType: "video", sync: async () => { throw upstream; } }, async () => 0, async () => {}, async () => { throw new Error("Database unavailable"); }), error => error === upstream);
});

test("deadline expiration after fetching defers a source without persisting or recording success/failure", async () => {
  const actions: string[] = [];
  await assert.rejects(runSourceSync(source, { contentType: "video", sync: async (_source, context) => {
    assert.ok(context);
    context.deadlineMs = 0;
    return [item];
  } }, async () => { actions.push("persist"); return 1; }, async () => { actions.push("success"); }, async () => { actions.push("failure"); }, { deadlineMs: Date.now() + 60_000 }), SourceSyncDeferredError);
  assert.deepEqual(actions, []);
});
