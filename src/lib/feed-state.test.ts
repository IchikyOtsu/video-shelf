import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOptimisticItemState, pruneSelection, toggleSelection } from "./feed-state";
import type { FeedItem, LibraryPage } from "./library";

const item = (id: string, overrides: Partial<FeedItem> = {}): FeedItem => ({
  id, title: id, url: "https://example.com/" + id, imageUrl: null, summary: null,
  publishedAt: "2026-10-04T12:00:00Z", sourceName: "Source", sourceId: "11111111-1111-4111-8111-111111111111",
  sourceKind: "youtube", mediaType: "video", read: false, saved: false, ...overrides,
});
const page = (items: FeedItem[], viewTotal = items.length): LibraryPage => ({
  items, total: viewTotal, nextOffset: 24, counts: { inbox: 2, all: 2, saved: 1, archive: 0 },
});

test("optimistic seen updates remove inbox items and preserve saved state", () => {
  const result = applyOptimisticItemState(page([item("one", { saved: true }), item("two")]), ["one"], { read: true }, "inbox");
  assert.deepEqual(result.items.map(value => value.id), ["two"]);
  assert.deepEqual(result.counts, { inbox: 1, all: 2, saved: 1, archive: 1 });
  assert.equal(result.total, 1);
  assert.equal(result.nextOffset, 23);
});

test("optimistic saved updates retain an item in the saved view until it is unsaved", () => {
  const saved = item("one", { read: true, saved: true });
  const result = applyOptimisticItemState(page([saved], 1), [saved.id], { saved: false }, "saved");
  assert.equal(result.items.length, 0);
  assert.equal(result.counts.saved, 0);
  assert.equal(result.counts.archive, 0);
});

test("optimistic save updates do not remove an unseen item from the inbox", () => {
  const result = applyOptimisticItemState(page([item("one"), item("two")]), ["one"], { saved: true }, "inbox");
  assert.deepEqual(result.items.map(value => value.id), ["one", "two"]);
  assert.equal(result.items[0].saved, true);
  assert.equal(result.counts.inbox, 2);
  assert.equal(result.counts.saved, 2);
});

test("selection toggles and is pruned when filters or optimistic state hide items", () => {
  const selected = toggleSelection(toggleSelection(new Set<string>(), "one"), "two");
  assert.deepEqual([...pruneSelection(selected, [item("two")])], ["two"]);
  assert.deepEqual([...toggleSelection(selected, "one")], ["two"]);
});
