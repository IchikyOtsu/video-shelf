import assert from "node:assert/strict";
import { test } from "node:test";
import { deduplicateNormalizedItems, getSourceProvider, initialImportStates, runSourceSync, type NormalizedItem } from "./sources";
import { deterministicItemStateId } from "./item-state";

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
