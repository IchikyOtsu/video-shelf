import assert from "node:assert/strict";
import { test } from "node:test";
import { readerContent, sanitizeArticleHtml } from "./reader-content";
import { parseRssOrAtom } from "./rss";
import { itemOpening } from "./item-opening";

test("full RSS content takes precedence and preserves useful reading formatting", () => {
  const [item] = parseRssOrAtom(`<rss><channel><title>Journal</title><item><guid>one</guid><link>https://news.test/a</link><description>Short summary</description><content:encoded><![CDATA[<h2>Chapter</h2><p>Full article</p><ul><li>Detail</li></ul><blockquote>Quote</blockquote><img src="/cover.jpg"><a href="/next">Next</a>]]></content:encoded></item></channel></rss>`, "https://news.test/rss").items;
  const result = readerContent({ ...item, summary: item.summary || null });
  assert.equal(result.kind, "full"); assert.ok(result.html.includes("<h2>Chapter</h2>"));
  for (const tag of ["p", "ul", "li", "blockquote", "img", "a"]) assert.ok(result.html.includes("<" + tag));
  assert.ok(result.html.includes("https://news.test/cover.jpg")); assert.ok(result.html.includes('rel="noopener noreferrer"'));
});
test("Atom XHTML and HTML full content is retained separately from summary", () => {
  for (const content of ['<content type="html">&lt;p&gt;Full&lt;/p&gt;</content>', '<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Full</p></div></content>']) {
    const [item] = parseRssOrAtom(`<feed><title>Atom</title><entry><id>one</id><link href="https://news.test/a"/><summary>Snippet</summary>${content}</entry></feed>`, "https://news.test/rss").items;
    assert.equal(readerContent({ ...item, summary: item.summary || null }).kind, "full");
    assert.ok(item.contentHtml?.includes("Full"));
  }
});
test("summary-only and legacy entries are labelled excerpts; absent content falls back", () => {
  assert.equal(readerContent({ url: "https://news.test/a", summary: "<p>Snippet</p>" }).kind, "summary");
  assert.deepEqual(readerContent({ url: "https://news.test/a", summary: null }), { kind: "missing", html: "" });
});
test("malicious markup, tracking pixels and unsupported embeds are removed", () => {
  const html = sanitizeArticleHtml(`<script>alert(1)</script><iframe src="https://evil.test">hidden frame</iframe><svg onload="alert(1)"></svg><form><input autofocus></form><p onclick="alert(1)" style="color:red">Safe</p><a href="jav&#x61;script:alert(1)">Bad</a><img src="data:image/svg+xml,evil"><img src="https://evil.test/pixel.gif"><img src="/tiny.jpg" width="1"><img src="/hidden.jpg" style="display:none"><img src="/safe.jpg" onerror="alert(1)"><object>unsafe object</object>`, "https://news.test/a");
  for (const value of ["<script", "<iframe", "<svg", "<form", "<input", "javascript:", "data:", "onclick", "onerror", "pixel.gif", "tiny.jpg", "hidden.jpg", "unsafe object", "hidden frame"]) assert.ok(!html.includes(value), value);
  assert.ok(html.includes("<p>Safe</p>")); assert.ok(html.includes("https://news.test/safe.jpg"));
  assert.ok(html.includes('referrerpolicy="no-referrer"'));
});
test("unsafe/authenticated links and malformed HTML cannot escape the sanitizer", () => {
  const html = sanitizeArticleHtml('<a href="https://user:secret@news.test/">x</a><img data-src="javascript:alert(1)"><math><mtext><img src=x onerror=alert(1)></mtext></math><p>OK', "https://news.test/a");
  assert.ok(!html.includes("secret")); assert.ok(!html.includes("onerror")); assert.ok(!html.includes("javascript")); assert.ok(html.includes("OK"));
});
test("media dispatch preserves YouTube and routes RSS content to internal readers or safe fallback", () => {
  assert.deepEqual(itemOpening({ mediaType: "video", url: "https://youtube.com/watch?v=dQw4w9WgXcQ" }), { kind: "youtube", videoId: "dQw4w9WgXcQ" });
  assert.equal(itemOpening({ mediaType: "article", url: "https://news.test/a" }).kind, "article");
  assert.deepEqual(itemOpening({ mediaType: "podcast", url: "https://pod.test/ep", audioUrl: "https://pod.test/ep.mp3" }), { kind: "podcast", audioUrl: "https://pod.test/ep.mp3" });
  for (const audioUrl of [null, "javascript:alert(1)", "https://user:secret@pod.test/ep.mp3"]) assert.equal(itemOpening({ mediaType: "podcast", url: "https://pod.test/ep", audioUrl }).kind, "external");
});

test("xkcd descriptions contain complete comics, including already imported legacy entries", () => {
  const [item] = parseRssOrAtom('<rss><channel><title>xkcd</title><item><guid>https://xkcd.com/3149/</guid><link>https://xkcd.com/3149/</link><description><![CDATA[<img src="https://imgs.xkcd.com/comics/ground_effect.png" title="A comic caption" alt="Ground Effect">]]></description></item></channel></rss>', 'https://xkcd.com/rss.xml').items;
  assert.equal(item.mediaType,"article"); assert.equal(item.contentHtml,null);
  assert.equal(item.imageUrl,"https://imgs.xkcd.com/comics/ground_effect.png");
  const result=readerContent({...item,summary:item.summary || null});
  assert.equal(result.kind,"full"); assert.ok(result.html.includes('title="A comic caption"'));
});
test("HN link roundups and unrelated image descriptions remain excerpts", () => {
  const hn=readerContent({url:"https://blog.example.com/article",summary:'<p>Article URL: <a href="https://blog.example.com/article">Article</a></p><p>Comments URL: <a href="https://news.ycombinator.com/item?id=1">Comments</a></p><p>Points: 5</p>'});
  assert.equal(hn.kind,"summary");
  assert.equal(readerContent({url:"https://news.example.com/article",summary:'<img src="https://imgs.xkcd.com/comics/comic.png">'}).kind,"summary");
  assert.equal(readerContent({url:"https://xkcd.com.evil.example/3149/",summary:'<img src="https://imgs.xkcd.com/comics/comic.png">'}).kind,"summary");
  assert.equal(readerContent({url:"https://xkcd.com/3149/",summary:'<img src="https://other.example/thumb.jpg">'}).kind,"summary");
});
test("Steam full patch notes need no image to be a readable full article", () => {
  const [item]=parseRssOrAtom('<rss><channel><title>Steam</title><item><guid>patch</guid><link>https://store.steampowered.com/news/1</link><content:encoded><![CDATA[<p>Update released.</p><ul><li>Fixed an issue.</li></ul>]]></content:encoded></item></channel></rss>','https://store.steampowered.com/feeds/news.xml').items;
  assert.equal(item.imageUrl,null); assert.equal(readerContent({...item,summary:item.summary || null}).kind,"full");
});
