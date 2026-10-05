import assert from "node:assert/strict";
import { test } from "node:test";
import { articleContent, articlePreview, contentUrl } from "./article-content";

test("article excerpts are decoded plain text with script/style content and tracking pixels removed", () => {
  const result = articleContent('<style>hidden</style><p>Bonjour &amp; bienvenue&nbsp;!</p><script>alert(1)</script><p>Deuxième paragraphe.</p><img width="1" height="1" src="/tracking.gif"><img data-src="/hero.jpg" src="data:image/gif;base64,AA">', "https://journal.test/articles/one");
  assert.equal(result.text, "Bonjour & bienvenue ! Deuxième paragraphe.");
  assert.deepEqual(result.images, ["https://journal.test/hero.jpg"]);
});

test("responsive images choose their largest source and reject unsafe or credential-bearing URLs", () => {
  const result = articleContent('<img src="javascript:alert(1)"><img srcset="/small.jpg 320w, /large.jpg 1200w" src="/small.jpg">', "https://journal.test/one");
  assert.deepEqual(result.images, ["https://journal.test/large.jpg"]);
  assert.equal(contentUrl(undefined, "https://journal.test/feed"), null);
  assert.equal(contentUrl("", "https://journal.test/feed"), null);
  assert.equal(contentUrl("https://user:secret@journal.test/a.jpg", "https://journal.test"), null);
});

test("legacy HTML recovers images while short excerpts omit unreliable reading-time estimates", () => {
  const preview = articlePreview('<p>Un résumé court.</p><img src="/hero.jpg">', "https://journal.test/article", "https://journal.test/rss", "https://journal.test/rss");
  assert.deepEqual(preview, { summary: "Un résumé court.", imageUrl: "https://journal.test/hero.jpg", readingMinutes: null });
});

test("long previews are bounded and reading estimates use the full available text", () => {
  const preview = articlePreview('<p>' + 'bonjour '.repeat(440) + '</p>', "https://journal.test/article", null);
  assert.equal(preview.readingMinutes, 2);
  assert.ok(preview.summary!.length <= 321);
  assert.ok(preview.summary!.endsWith("…"));
  assert.ok(!preview.summary!.includes("<p>"));
});
