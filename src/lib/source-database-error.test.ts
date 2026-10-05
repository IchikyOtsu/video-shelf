import assert from "node:assert/strict";
import { test } from "node:test";
import { safeSourceSyncError, SourceDatabaseError } from "./source-database-error";
import { logSourceSyncFailure, SourceFetchError } from "./source-fetch";
import { runSourceSync } from "./sources";
const failure = (code: string) => Object.assign(new Error("Failed query: insert into items ... secret-token private article body"), { query: "insert into items ...", params: ["secret-token"], cause: { code, message: "private database detail" } });
test("missing column/table errors produce a migration message without SQL or parameters", () => {
  for (const code of ["42703", "42P01"]) {
    const safe = safeSourceSyncError(failure(code)); assert.ok(safe instanceof SourceDatabaseError);
    assert.equal(safe.code, "DATABASE_SCHEMA_ERROR"); assert.equal(safe.databaseCode, code);
    assert.ok(safe.message.includes("migrations")); assert.ok(!safe.message.includes("secret")); assert.equal(safe.cause, undefined);
  }
});
test("other database failures expose a generic storage message and fixed category", () => {
  for (const input of [failure("23505"), Object.assign(new Error("Failed query: secret"), { query: "private query" })]) {
    const safe = safeSourceSyncError(input); assert.ok(safe instanceof SourceDatabaseError);
    assert.equal(safe.code, "DATABASE_ERROR"); assert.ok(!safe.message.includes("secret"));
  }
});
test("upstream errors retain their identity and cyclic causes terminate safely", () => {
  const upstream = new SourceFetchError("HTTP_ERROR", "example.test", 429); assert.equal(safeSourceSyncError(upstream), upstream);
  const cyclic = { query: "private query", cause: null as unknown }; cyclic.cause = cyclic;
  assert.ok(safeSourceSyncError(cyclic) instanceof SourceDatabaseError);
});
test("database logs include safe SQLSTATE diagnostics without query, parameters or body", t => {
  const calls: unknown[][] = []; t.mock.method(console, "error", (...args: unknown[]) => { calls.push(args); });
  logSourceSyncFailure({ kind: "rss", feedUrl: "https://feed.test/rss?token=secret" }, failure("42703"), 10);
  assert.deepEqual(calls, [["Source sync failed", { kind: "rss", hostname: "feed.test", status: null, error: "DATABASE_SCHEMA_ERROR", databaseCode: "42703", durationMs: 10 }]]);
});
test("sync records and throws only the safe error while keeping source failure observable", async t => {
  t.mock.method(console, "error", () => {}); let recorded = "";
  await assert.rejects(runSourceSync({ id: "source", kind: "rss", feedUrl: "https://feed.test/rss" }, { contentType: "article", sync: async () => [{guid:"one",title:"One",url:"https://feed.test/one",mediaType:"article"}] }, async () => { throw failure("42703"); }, async () => {}, async message => { recorded = message; }), error => error instanceof SourceDatabaseError && error.databaseCode === "42703");
  assert.ok(recorded.includes("migrations")); assert.ok(!recorded.includes("Failed query")); assert.ok(!recorded.includes("secret"));
});
