import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/neon-http";
import { items } from "../db/schema";
import { metadataUpdateSet } from "./item-sync-update";

test("conflict updates refresh metadata, preserve sparse values and leave identity/user state unchanged", () => {
  const database = drizzle.mock();
  const statement = database.insert(items).values({ sourceId: "11111111-1111-4111-8111-111111111111", guid: "known-video", title: "Renamed", url: "https://youtube.com/watch?v=aaaaaaaaaaa", imageUrl: "https://i.ytimg.com/new.jpg", summary: "Updated description", author: "New author" }).onConflictDoUpdate({ target: [items.sourceId, items.guid], set: metadataUpdateSet() }).toSQL();
  const update = statement.sql.split("do update set ")[1];
  assert.ok(update);
  for (const field of ["title", "image_url", "author", "summary", "duration"]) {
    assert.ok(update.includes(`"${field}" = coalesce(nullif(excluded."${field}", ''),`));
  }
  assert.ok(update.includes('"published_at" = coalesce(excluded."published_at",'));
  for (const field of ["id", "guid", "source_id", "created_at", "read", "saved", "read_later", "progress_seconds", "duration_seconds", "last_played_at"]) {
    assert.ok(!update.includes(`"${field}" =`), field);
  }
  assert.equal(statement.params.includes("Renamed"), true);
});
