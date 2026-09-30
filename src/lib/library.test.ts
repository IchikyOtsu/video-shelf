import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLibraryQuery, parseStateChange } from "./library";
const id = "11111111-1111-4111-8111-111111111111";
test("the inbox is the default, with server-side history pagination", () => {
  assert.equal(parseLibraryQuery(new URLSearchParams()).view, "inbox");
  const query = parseLibraryQuery(new URLSearchParams({ view: "archive", source: id, offset: "108", sort: "oldest", q: " science " }));
  assert.equal(query.offset, 108);
  assert.equal(query.query, "science");
  assert.equal(query.sourceId, id);
});
test("invalid filters cannot reach the database", () => {
  const invalid: Record<string, string>[] = [{ view: "constructor" }, { offset: "-1" }, { offset: "NaN" }, { source: "invalid" }, { sort: "random" }, { type: "article" }];
  for (const params of invalid) {
    assert.throws(() => parseLibraryQuery(new URLSearchParams(params)), /invalides/);
  }
});
test("archive and save changes are independent and deduplicate targets", () => {
  assert.deepEqual(parseStateChange({ ids: [id, id], read: false }), { ids: [id], read: false });
  assert.deepEqual(parseStateChange({ ids: [id], saved: true }), { ids: [id], saved: true });
});
test("state changes reject empty, malformed or unbounded payloads", () => {
  for (const body of [null, {}, { ids: [], read: true }, { ids: [id] }, { ids: ["bad"], saved: true }, { ids: [id], read: "true" }, { ids: Array(101).fill(id), saved: true }]) assert.throws(() => parseStateChange(body), /invalide/);
});
