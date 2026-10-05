import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectRssFeed, parseRssOrAtom, RssParseError } from "./rss";
import { SourceFetchError } from "./source-fetch";
const rss = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Steam Community</title><link>https://store.steampowered.com/news/app/730</link><description>Latest News</description><item><title>Update</title><link>https://store.steampowered.com/news/app/730/view/1</link><guid>1</guid><description><![CDATA[<p>Steam update</p>]]></description></item></channel></rss>';
const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title><entry><id>1</id><title>Entry</title><link href="https://news.test/a"/></entry></feed>';
for (const [type, body] of [["text/xml", rss], ["application/xml", atom], ["text/plain", rss], ["application/rss+xml", rss], ["application/atom+xml", atom]]) {
  test(`feed structure is accepted with ${type}`, async t => {
    t.mock.method(globalThis, "fetch", async () => new Response(body, { headers: { "Content-Type": type } }));
    const result = await inspectRssFeed("https://feed.test/rss", globalThis.fetch); assert.equal(result.items.length, 1);
  });
}
test("Steam-style generic XML response is accepted without MIME sniffing", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(rss, { headers: { "Content-Type": "text/xml; charset=UTF-8" } }));
  assert.equal((await inspectRssFeed("https://store.steampowered.com/feeds/news/app/730", globalThis.fetch)).name, "Steam Community");
});
test("RSS 1.0 RDF entries are read from the RDF root", () => {
  const result = parseRssOrAtom('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"><channel rdf:about="https://news.test/rss"><title>RDF News</title><link>https://news.test</link></channel><item rdf:about="https://news.test/a"><title>RDF entry</title><link>https://news.test/a</link><description>Story</description></item></rdf:RDF>', "https://news.test/rss");
  assert.equal(result.items.length, 1); assert.equal(result.items[0].title, "RDF entry");
});
test("prefixed Atom entries preserve full HTML and author metadata", () => {
  const result = parseRssOrAtom('<a:feed xmlns:a="http://www.w3.org/2005/Atom"><a:title>Atom</a:title><a:entry><a:id>1</a:id><a:link href="https://news.test/a"/><a:author><a:name>Ada</a:name></a:author><a:content type="html">&lt;p&gt;Full&lt;/p&gt;</a:content></a:entry></a:feed>', "https://news.test/rss");
  assert.equal(result.items[0].author, "Ada"); assert.ok(result.items[0].contentHtml?.includes("<p>Full</p>"));
});
test("malformed XML is distinct from valid XML that is not a feed", () => {
  for (const xml of ['<rss><channel></rss>', '<rss><channel>', 'not XML']) assert.throws(() => parseRssOrAtom(xml, "https://news.test/rss"), error => error instanceof RssParseError && error.code === "INVALID_XML");
  for (const xml of ['<document><title>Generic</title></document>', '<feed><something>Generic</something></feed>', '<html><body>No feed</body></html>']) assert.throws(() => parseRssOrAtom(xml, "https://news.test/rss"), error => error instanceof RssParseError && error.code === "NOT_FEED");
});
test("fetch failures retain HTTP/network/timeout categories instead of becoming not-a-feed", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 404 }));
  await assert.rejects(inspectRssFeed("https://news.test/rss", globalThis.fetch), error => error instanceof SourceFetchError && error.status === 404);
  t.mock.restoreAll(); t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await assert.rejects(inspectRssFeed("https://news.test/rss", globalThis.fetch), error => error instanceof SourceFetchError && error.code === "NETWORK_ERROR");
  t.mock.restoreAll(); t.mock.method(globalThis, "fetch", async () => { throw new DOMException("timeout", "TimeoutError"); });
  await assert.rejects(inspectRssFeed("https://news.test/rss", globalThis.fetch), error => error instanceof SourceFetchError && error.code === "TIMEOUT");
});
test("invalid protocols, malformed and authenticated URLs never trigger a fetch", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(rss));
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "bad url", "https://user:secret@news.test/rss"]) await assert.rejects(inspectRssFeed(url, globalThis.fetch));
  assert.equal(fetch.mock.callCount(), 0);
});
