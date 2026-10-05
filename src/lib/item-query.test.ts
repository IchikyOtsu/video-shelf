import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildItemCondition, itemDateOrder, itemStateJoin } from "./item-query";

const userId = "22222222-2222-4222-8222-222222222222";
const sourceId = "11111111-1111-4111-8111-111111111111";
const compile = (view: "inbox" | "all" | "saved" | "archive", query = "", contentType: "all" | "video" | "article" | "podcast" = "video") => new PgDialect().sqlToQuery(buildItemCondition({ view, sourceId, query, contentType }, userId)!);

test("inbox and seen filters use the compatible read state", () => {
  const inbox = compile("inbox");
  const seen = compile("archive");
  assert.match(inbox.sql, /coalesce\("item_states"\."read", false\) =/);
  assert.ok(inbox.params.includes(false));
  assert.ok(seen.params.includes(true));
});

test("source history with view=all has no seen-state restriction", () => {
  const query = compile("all");
  assert.ok(query.params.includes(userId));
  assert.ok(query.params.includes(sourceId));
  assert.doesNotMatch(query.sql, /item_states"\."read/);
});

test("bulk-compatible filters retain user, source and escaped search scoping", () => {
  const query = compile("inbox", "100% science");
  assert.deepEqual(query.params.slice(0, 4), [userId, "video", sourceId, false]);
  assert.deepEqual(query.params.slice(4), ["%100\\% science%", "%100\\% science%"]);
});

test("content type filtering is independent from the library view", () => {
  const article = compile("saved", "", "article");
  assert.ok(article.params.includes("article"));
  assert.match(article.sql, /"items"\."media_type"/);
  const all = compile("saved", "", "all");
  assert.ok(!all.params.includes("all"));
  assert.doesNotMatch(all.sql, /"items"\."media_type" =/);
});

test("state joins select only the newest legacy state for an item", () => {
  const query = new PgDialect().sqlToQuery(itemStateJoin(userId)!);
  assert.match(query.sql, /not exists/);
  assert.match(query.sql, /newer_item_state/);
  assert.ok(query.params.includes(userId));
});

test("newest sorts YouTube by publication date and always places missing dates last", () => {
  const query = new PgDialect().sqlToQuery(itemDateOrder("newest"));
  assert.match(query.sql, /case when "sources"\."kind" = 'youtube' then "items"\."published_at" else coalesce\("items"\."published_at", "items"\."created_at"\) end desc nulls last/);
});

test("oldest also keeps undated YouTube videos after dated items", () => {
  const query = new PgDialect().sqlToQuery(itemDateOrder("oldest"));
  assert.match(query.sql, /end asc nulls last/);
});
