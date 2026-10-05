import assert from "node:assert/strict";
import { test } from "node:test";
import { renderDigest, DigestDeliveryError, type DigestMessage } from "./daily-digest";
import { digestEmailConfig, sendDigestEmail } from "./mail";
import { parseDigestPreference } from "./digest-preference";

const message: DigestMessage = { from: "Shelf <updates@example.test>", to: "reader@example.test", subject: "Shelf", html: "<p>News</p>", text: "News" };
const digest = { recipient: message.to, itemCount: 2, payload: [
  { id: "1", sourceId: "s", sourceName: "A <script>alert(1)</script>", title: 'Title <img src=x onerror="alert(1)">', url: "javascript:alert(1)", mediaType: "article", publishedAt: null },
  { id: "2", sourceId: "s", sourceName: "A", title: "Podcast", url: "https://publisher.test/episode?x=1&y=2", mediaType: "podcast", publishedAt: "invalid" },
] };
test("digest escapes publisher HTML, rejects unsafe links, handles missing dates and includes plain text", () => {
  const result = renderDigest(digest, "https://shelf.test", message.from);
  assert.ok(!result.html.includes("<script>")); assert.ok(!result.html.includes("<img"));
  assert.ok(!result.html.includes("javascript:")); assert.ok(!result.html.includes("Invalid Date"));
  assert.ok(result.html.includes("x=1&amp;y=2")); assert.ok(result.html.includes("Podcast"));
  assert.ok(result.text.includes("https://publisher.test/episode")); assert.equal(result.to, message.to);
  assert.throws(() => renderDigest(digest, "javascript:alert(1)", message.from), DigestDeliveryError);
});
test("digest preferences accept only boolean values", () => {
  assert.equal(parseDigestPreference({ enabled: true }), true); assert.equal(parseDigestPreference({ enabled: false }), false);
  for (const value of [null, {}, { enabled: "false" }, { enabled: 0 }, true]) assert.throws(() => parseDigestPreference(value));
});
test("Resend digest uses existing configuration, frozen message and stable idempotency header", async t => {
  const oldKey = process.env.RESEND_API_KEY; const oldFrom = process.env.EMAIL_FROM; const oldUrl = process.env.APP_URL;
  process.env.RESEND_API_KEY = "test-not-a-real-key"; process.env.EMAIL_FROM = message.from; process.env.APP_URL = "https://shelf.test/";
  t.after(() => { for (const [key, value] of Object.entries({ RESEND_API_KEY: oldKey, EMAIL_FROM: oldFrom, APP_URL: oldUrl })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  assert.deepEqual(digestEmailConfig(), { appUrl: "https://shelf.test", from: message.from });
  const mock = t.mock.method(globalThis, "fetch", async (_input: unknown, options?: RequestInit) => {
    assert.equal(_input, "https://api.resend.com/emails");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("Idempotency-Key"), "shelf-digest-stable");
    assert.equal(headers.get("Authorization"), "Bearer test-not-a-real-key");
    assert.deepEqual(JSON.parse(options?.body as string), message);
    assert.ok(options?.signal); return new Response("{}", { status: 200 });
  });
  assert.equal(await sendDigestEmail(message, "shelf-digest-stable"), 200); assert.equal(mock.mock.callCount(), 1);
  delete process.env.EMAIL_FROM; assert.throws(digestEmailConfig, DigestDeliveryError);
});
test("Resend errors distinguish HTTP status and network category without reading response bodies", async t => {
  const oldKey = process.env.RESEND_API_KEY; process.env.RESEND_API_KEY = "test-not-a-real-key";
  t.after(() => { if (oldKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey; });
  let status = 429;
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status, text: () => { throw new Error("must not read sensitive provider body"); } } as unknown as Response));
  for (const [code, category] of [[429, "RATE_LIMIT"], [403, "EMAIL_CONFIGURATION"], [404, "PROVIDER_REJECTED"], [503, "PROVIDER_ERROR"]] as const) {
    status = code; await assert.rejects(sendDigestEmail(message, "stable"), error => error instanceof DigestDeliveryError && error.category === category && error.status === code);
  }
  t.mock.restoreAll(); t.mock.method(globalThis, "fetch", async () => { throw new Error("secret provider URL"); });
  await assert.rejects(sendDigestEmail(message, "stable"), error => error instanceof DigestDeliveryError && error.category === "NETWORK_ERROR" && !error.message.includes("secret"));
});
