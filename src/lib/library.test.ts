import assert from "node:assert/strict";
import { test } from "node:test";
import { groupInboxItems, parseLibraryQuery, parseStateChange, type FeedItem } from "./library";
const id = "11111111-1111-4111-8111-111111111111";
test("the inbox is the default, with server-side history pagination", () => {
  const defaults = parseLibraryQuery(new URLSearchParams());
  assert.equal(defaults.view, "inbox");
  assert.equal(defaults.contentType, "all");
  const query = parseLibraryQuery(new URLSearchParams({ view: "archive", source: id, offset: "108", sort: "oldest", q: " science ", type: "article" }));
  assert.equal(query.offset, 108);
  assert.equal(query.query, "science");
  assert.equal(query.sourceId, id);
  assert.equal(query.contentType, "article");
});
test("invalid filters cannot reach the database", () => {
  const invalid: Record<string, string>[] = [{ view: "constructor" }, { offset: "-1" }, { offset: "NaN" }, { source: "invalid" }, { sort: "random" }, { type: "book" }];
  for (const params of invalid) {
    assert.throws(() => parseLibraryQuery(new URLSearchParams(params)), /invalides/);
  }
});
test("seen and saved changes are independent and deduplicate targets", () => {
  assert.deepEqual(parseStateChange({ ids: [id, id], read: false }), { ids: [id], read: false });
  assert.deepEqual(parseStateChange({ ids: [id], saved: true }), { ids: [id], saved: true });
  assert.deepEqual({ saved: true, ...parseStateChange({ ids: [id], read: true }) }, { saved: true, ids: [id], read: true });
});
test("state changes reject empty, malformed or unbounded payloads", () => {
  for (const body of [null, {}, { ids: [], read: true }, { ids: [id] }, { ids: ["bad"], saved: true }, { ids: [id], read: "true" }, { ids: Array(101).fill(id), saved: true }]) assert.throws(() => parseStateChange(body), /invalide/);
});

test("the inbox groups rendered items by the browser-local publication day", () => {
  const item = (id: string, publishedAt: string): FeedItem => ({ id, publishedAt, title: id, url: "https://example.com", imageUrl: null, summary: null, sourceName: "Source", sourceId: id, sourceKind: "youtube", mediaType: "video", read: false, saved: false });
  const groups = groupInboxItems([
    item("today", "2026-10-04T15:00:00+02:00"),
    item("yesterday", "2026-10-03T11:00:00+02:00"),
    item("older", "2026-09-01T11:00:00+02:00"),
  ], new Date("2026-10-04T18:00:00+02:00"));
  assert.deepEqual(groups.map(group => [group.label, group.items.map(value => value.id)]), [
    ["Aujourd’hui", ["today"]], ["Hier", ["yesterday"]], ["Plus ancien", ["older"]],
  ]);
});
