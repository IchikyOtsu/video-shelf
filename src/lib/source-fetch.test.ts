import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchSourceText, logSourceSyncFailure, SourceFetchError } from "./source-fetch";

for (const status of [429, 403, 404]) {
  test(`feed fetch preserves HTTP ${status} without leaking the URL or body`, async t => {
    t.mock.method(globalThis, "fetch", async () => new Response("private response body", { status }));
    await assert.rejects(fetchSourceText("https://example.com/private?token=secret"), error => {
      assert.ok(error instanceof SourceFetchError);
      assert.equal(error.status, status);
      assert.equal(error.code, "HTTP_ERROR");
      assert.equal(error.hostname, "example.com");
      assert.equal(error.message.includes("secret"), false);
      assert.equal(error.message.includes("private"), false);
      return true;
    });
  });
}

test("network errors remain distinct from timeouts", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("private network error"); });
  await assert.rejects(fetchSourceText("https://example.com/feed"), error => error instanceof SourceFetchError && error.code === "NETWORK_ERROR" && error.status === undefined);
});

test("a timeout during response body reading is classified and settles the sync", async t => {
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => ({
    ok: true,
    url: "https://example.com/feed",
    text: () => new Promise<string>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }),
  }));
  // AbortSignal.timeout uses an unref timer; keep this test alive until it fires.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(fetchSourceText("https://example.com/feed", {}, 5), error => error instanceof SourceFetchError && error.code === "TIMEOUT" && error.status === undefined);
  } finally { clearInterval(keepAlive); }
});

test("failure logs include safe diagnostics and exclude sensitive data", t => {
  const calls: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { calls.push(args); });
  const source = { kind: "rss", feedUrl: "https://user:password@example.com/private?token=secret" };
  logSourceSyncFailure(source, new SourceFetchError("HTTP_ERROR", "example.com", 429), 123);
  logSourceSyncFailure(source, new Error("credentials=secret"), 456);
  assert.deepEqual(calls, [
    ["Source sync failed", { kind: "rss", hostname: "example.com", status: 429, error: "HTTP_ERROR", durationMs: 123 }],
    ["Source sync failed", { kind: "rss", hostname: "example.com", status: null, error: "SYNC_ERROR", durationMs: 456 }],
  ]);
});


test("bounded feed reads reject oversized streams without weakening HTTP diagnostics", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("123456789"));
  await assert.rejects(fetchSourceText("https://example.com/feed", {}, 10_000, 5), error => error instanceof SourceFetchError && error.code === "INVALID_RESPONSE");
});
