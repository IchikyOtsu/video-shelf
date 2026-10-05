import assert from "node:assert/strict";
import { test } from "node:test";
import { Response as HttpResponse } from "undici";
import { publicAddress, publicUrl, createPublicFetch } from "./public-fetch";
import { trustedMutation, sessionPurpose } from "./request-security";
import { sourceHealth } from "./source-health";
import { exportCsv, exportOpml } from "./user-export";
import { extractArticle } from "./article-extract";
import { sanitizeArticleHtml } from "./reader-content";
import { parseLibraryQuery } from "./library";
import { syncBatchSources } from "./source-batch";
import { fetchSourceText, SourceFetchError } from "./source-fetch";

test("public fetch rejects private, reserved and mapped addresses and authenticated URLs", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.1.2",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.1.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress("8.8.8.8"), true);
  for (const url of [
    "http://2130706433/",
    "http://[::1]/",
    "http://localhost/",
    "http://private.local/",
    "https://user:password@example.com/",
    "file:///etc/passwd",
    "https://example.com:8443/",
  ])
    assert.throws(() => publicUrl(url));
  assert.equal(
    publicUrl("https://store.steampowered.com/feeds/news.xml").hostname,
    "store.steampowered.com",
  );
});
test("private DNS answers and public-to-private redirects never reach the private network", async () => {
  let sent = 0;
  const send = async () => {
    sent++;
    return new HttpResponse("", {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    });
  };
  const privateDns = createPublicFetch({
    resolve: async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
    send,
  });
  await assert.rejects(privateDns("https://example.com/"));
  assert.equal(sent, 0);
  const redirect = createPublicFetch({
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    send,
  });
  await assert.rejects(redirect("https://example.com/"));
  assert.equal(sent, 1);
});
test("DNS timeouts remain bounded and distinguishable from HTTP failure", async () => {
  const transport = createPublicFetch({
    resolve: async () => new Promise(() => {}),
  });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      fetchSourceText("https://example.com/", {}, 10, 1000, transport),
      (error) => error instanceof SourceFetchError && error.code === "TIMEOUT",
    );
  } finally {
    clearTimeout(keepAlive);
  }
});
test("mutation guard accepts same-origin browser requests and rejects cross-site and missing origin", () => {
  assert.equal(
    trustedMutation(
      new Request("https://shelf.test/api/sources", {
        method: "POST",
        headers: {
          origin: "https://shelf.test",
          "sec-fetch-site": "same-origin",
        },
      }),
    ),
    true,
  );
  for (const headers of [
    { origin: "https://evil.test" },
    {},
    { origin: "https://shelf.test", "sec-fetch-site": "cross-site" },
  ])
    assert.equal(
      trustedMutation(
        new Request("https://shelf.test/api/account", {
          method: "DELETE",
          headers: headers as Record<string, string>,
        }),
      ),
      false,
    );
  assert.equal(
    trustedMutation(new Request("https://shelf.test/api/cron/sync")),
    true,
  );
});
test("temporary double-factor challenges cannot become authenticated sessions", () => {
  assert.equal(sessionPurpose({ purpose: "pending_totp" }), false);
  assert.equal(sessionPurpose({ purpose: "session" }), true);
  assert.equal(sessionPurpose({}), true);
});
test("source health distinguishes baseline, success, temporary errors, persistent errors and pauses", () => {
  const now = Date.now();
  const base = { active: true, lastSyncedAt: null, lastSyncError: null };
  assert.equal(sourceHealth(base, now).state, "never");
  assert.equal(
    sourceHealth({ ...base, lastSyncedAt: new Date(now) }, now).state,
    "ok",
  );
  assert.equal(
    sourceHealth(
      {
        ...base,
        lastSyncError: "Timeout",
        failureCount: 10,
        failureSince: new Date(now - 60_000),
      },
      now,
    ).state,
    "temporary",
  );
  assert.equal(
    sourceHealth(
      {
        ...base,
        lastSyncError: "Timeout",
        failureCount: 3,
        failureSince: new Date(now - 3 * 86_400_000),
      },
      now,
    ).state,
    "persistent",
  );
  assert.equal(sourceHealth({ ...base, active: false }, now).state, "paused");
});
test("OPML groups sources by category and escapes XML; CSV neutralizes formulas", () => {
  const opml = exportOpml([
    {
      name: 'Tech & "news"',
      category: "Tech",
      kind: "rss",
      feedUrl: "https://example.com/feed?a=1&b=2",
      siteUrl: null,
    },
    {
      name: "Video",
      category: "Tech",
      kind: "youtube",
      feedUrl: "https://youtube.com/feeds/videos.xml?channel_id=UCtest",
      siteUrl: "https://youtube.com/channel/UCtest",
    },
  ]);
  assert.match(opml, /Tech &amp; &quot;news&quot;/);
  assert.match(opml, /a=1&amp;b=2/);
  assert.equal((opml.match(/text="Tech"/g) || []).length, 1);
  const csv = exportCsv([
    {
      title: '=HYPERLINK("https://evil.test")',
      url: "https://safe.test/",
      sourceName: "  +CMD",
      read: false,
    },
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'  \+CMD/);
  assert.match(csv, /"false"/);
});
test("rich reader preserves safe tables, captions, nested lists and lazy images while stripping active markup", () => {
  const html = sanitizeArticleHtml(
    '<table><caption>Results</caption><tfoot><tr><td colspan="2" onclick="evil()">Total</td></tr></tfoot></table><figure><img data-src="/photo.jpg"><figcaption>Photo caption</figcaption></figure><ol start="3"><li><ul><li>Nested</li></ul></li></ol><pre><code>let a = 1;</code></pre><script>secret()</script><iframe src="https://evil.test"></iframe><a href="javascript:evil()">Unsafe</a>',
    "https://example.com/article",
  );
  for (const fragment of [
    "<caption>Results</caption>",
    '<td colspan="2">',
    'src="https://example.com/photo.jpg"',
    "<figcaption>Photo caption</figcaption>",
    '<ol start="3">',
    "<code>let a = 1;</code>",
  ])
    assert.ok(html.includes(fragment), fragment);
  assert.doesNotMatch(html, /onclick|javascript:|secret\(|<iframe|<script/);
});
test("explicit article extraction keeps readable prose and safe lazy images without scripts or navigation", () => {
  const prose =
    "A detailed account of the latest scientific findings and their implications for everyone. ".repeat(
      20,
    );
  const html = extractArticle(
    `<html><head><title>A study</title></head><body><nav>Private navigation</nav><main><article><h1>A study</h1><p>${prose}</p><img data-src="/study.jpg"><script>alert(1)</script></article></main></body></html>`,
    "https://example.com/study",
  );
  assert.match(html, /scientific findings/);
  assert.match(html, /https:\/\/example.com\/study.jpg/);
  assert.doesNotMatch(html, /Private navigation|alert\(|<script/);
  assert.throws(() =>
    extractArticle(
      "<html><body>No article</body></html>",
      "https://example.com/",
    ),
  );
});
test("category, saved and unfinished podcast filters combine and reject invalid values", () => {
  const filters = parseLibraryQuery(
    new URLSearchParams({
      view: "all",
      type: "podcast",
      category: "Tech",
      status: "unread",
      saved: "true",
    }),
  );
  assert.equal(filters.category, "Tech");
  assert.equal(filters.savedOnly, true);
  assert.equal(filters.status, "unread");
  assert.equal(filters.contentType, "podcast");
  assert.throws(() =>
    parseLibraryQuery(new URLSearchParams({ category: "x".repeat(81) })),
  );
  assert.throws(() =>
    parseLibraryQuery(new URLSearchParams({ status: "bogus" })),
  );
});
test("adding many sources also bounds sync to three workers and isolates failures", async () => {
  let active = 0,
    maximum = 0;
  const result = await syncBatchSources(
    Array.from({ length: 11 }, (_, id) => ({
      id: String(id),
      name: String(id),
    })),
    async (source) => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      if (source.id === "2") throw new Error("HTTP 404");
      return 1;
    },
  );
  assert.equal(maximum, 3);
  assert.equal(result.added.length, 10);
  assert.equal(result.failed.length, 1);
  assert.equal(result.imported, 10);
});
