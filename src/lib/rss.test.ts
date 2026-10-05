import assert from "node:assert/strict";
import { test } from "node:test";
import { deduplicateNormalizedItems, initialImportStates } from "./sources";
import { parseRssOrAtom } from "./rss";
import { deterministicItemStateId } from "./item-state";

test("RSS feeds map article metadata and derive their site", () => {
  const result = parseRssOrAtom(`<?xml version="1.0"?><rss><channel><title>Journal</title><link>https://journal.test</link><item><guid>article-1</guid><title>Bonjour</title><link>/bonjour</link><dc:creator xmlns:dc="x">Ada</dc:creator><description>Résumé</description><pubDate>Tue, 01 Oct 2026 10:00:00 GMT</pubDate><media:thumbnail xmlns:media="x" url="https://journal.test/image.jpg"/></item></channel></rss>`, "https://journal.test/feed.xml");
  assert.equal(result.name, "Journal");
  assert.equal(result.siteUrl, "https://journal.test/");
  assert.equal(result.contentType, "article");
  assert.deepEqual(result.items[0], { guid: "article-1", title: "Bonjour", url: "https://journal.test/bonjour", audioUrl: null, summary: "Résumé", author: "Ada", mediaType: "article", duration: null, imageUrl: "https://journal.test/image.jpg", publishedAt: new Date("2026-10-01T10:00:00.000Z") });
});

test("Atom feeds map ids, alternate links and authors", () => {
  const result = parseRssOrAtom(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atomique</title><link rel="alternate" href="https://atom.test"/><entry><id>tag:atom.test,2026:one</id><title>Entrée</title><link href="/one"/><author><name>Lin</name></author><summary>Texte</summary><updated>2026-10-02T12:00:00Z</updated></entry></feed>`, "https://atom.test/feed");
  assert.equal(result.name, "Atomique");
  assert.equal(result.siteUrl, "https://atom.test/");
  assert.equal(result.items[0]?.url, "https://atom.test/one");
  assert.equal(result.items[0]?.author, "Lin");
});

test("podcast enclosures retain audio URLs and duration", () => {
  const result = parseRssOrAtom(`<rss><channel><title>Podcast</title><item><guid>episode-1</guid><title>Épisode</title><link>https://pod.test/episode</link><enclosure url="https://cdn.test/episode.mp3" type="audio/mpeg"/><itunes:duration xmlns:itunes="x">01:02:03</itunes:duration></item></channel></rss>`, "https://pod.test/feed");
  assert.equal(result.contentType, "podcast");
  assert.equal(result.items[0]?.mediaType, "podcast");
  assert.equal(result.items[0]?.audioUrl, "https://cdn.test/episode.mp3");
  assert.equal(result.items[0]?.duration, "01:02:03");
});

test("duplicate RSS entries are removed before persistence", () => {
  const result = parseRssOrAtom(`<rss><channel><title>Dupes</title><item><guid>same</guid><title>One</title><link>https://feed.test/one</link></item><item><guid>same</guid><title>Two</title><link>https://feed.test/two</link></item></channel></rss>`, "https://feed.test/rss");
  assert.equal(result.items.length, 2);
  assert.equal(deduplicateNormalizedItems(result.items).length, 1);
});

test("initial RSS imports are seen while later RSS sync items remain unseen", () => {
  assert.deepEqual(initialImportStates("user-1", ["initial-item"], true), [{ id: deterministicItemStateId("user-1", "initial-item"), userId: "user-1", itemId: "initial-item", read: true }]);
  assert.deepEqual(initialImportStates("user-1", ["later-item"], false), []);
});

test("RSS content images, lazy images and feed artwork are imported without per-article requests", () => {
  const result = parseRssOrAtom(`<rss><channel><title>Magazine</title><image><url>/logo.png</url></image><item><guid>one</guid><title>Un &amp; deux</title><link>https://journal.test/articles/one</link><description><![CDATA[<p>Résumé.</p>]]></description><content:encoded><![CDATA[<p>Le contenu.</p><img src="/hero.jpg"/>]]></content:encoded></item><item><guid>two</guid><title>Deux</title><link>https://journal.test/two</link></item></channel></rss>`, "https://journal.test/feed");
  assert.equal(result.imageUrl, "https://journal.test/logo.png");
  assert.equal(result.items[0].imageUrl, "https://journal.test/hero.jpg");
  assert.equal(result.items[0].title, "Un & deux");
  assert.equal(result.items[1].imageUrl, "https://journal.test/logo.png");
});

test("image enclosures do not turn articles into podcasts and video media is not treated as artwork", () => {
  const result = parseRssOrAtom(`<feed><title>Journal</title><entry><id>one</id><title>One</title><link rel="alternate" href="https://journal.test/one"/><link rel="enclosure" type="image/jpeg" href="https://cdn.test/hero.jpg"/><media:content type="video/mp4" url="https://cdn.test/video.mp4"/></entry></feed>`, "https://journal.test/feed");
  assert.equal(result.contentType, "article");
  assert.equal(result.items[0].audioUrl, null);
  assert.equal(result.items[0].imageUrl, "https://cdn.test/hero.jpg");
});

test("Atom XHTML, nested media groups and xml:base preserve publication dates and resolve images", () => {
  const result = parseRssOrAtom(`<feed xml:base="https://journal.test/assets/"><title>Journal</title><entry><id>one</id><title>One</title><link href="https://journal.test/article"/><published>2026-10-01T10:00:00Z</published><updated>2026-10-05T10:00:00Z</updated><content type="xhtml"><div><p>Bonjour.</p><img src="/hero.jpg"/></div></content><media:group><media:content type="audio/mpeg" url="episode.mp3"/><media:thumbnail url="cover.jpg"/></media:group></entry></feed>`, "https://journal.test/feed");
  assert.equal(result.items[0].publishedAt?.toISOString(), "2026-10-01T10:00:00.000Z");
  assert.equal(result.items[0].imageUrl, "https://journal.test/assets/cover.jpg");
  assert.equal(result.items[0].audioUrl, "https://journal.test/assets/episode.mp3");
  assert.ok(result.items[0].summary?.includes("<p>Bonjour.</p>"));
});

test("missing article images remain null and unsafe media URLs are rejected", () => {
  const result = parseRssOrAtom(`<rss><channel><title>Journal</title><item><title>One</title><link>https://journal.test/one</link><media:thumbnail url="javascript:alert(1)"/></item><item><title>Two</title></item></channel></rss>`, "https://journal.test/feed");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].imageUrl, null);
});

test("HTML Atom content preserves embedded images after XML entity decoding", () => {
  const result = parseRssOrAtom(`<feed><title>Journal</title><entry><id>one</id><title>One</title><link href="https://journal.test/one"/><content type="html">&lt;p&gt;Bonjour &amp;amp; bienvenue.&lt;/p&gt;&lt;img src=&quot;/hero.jpg&quot;&gt;</content></entry></feed>`, "https://journal.test/feed");
  assert.equal(result.items[0].imageUrl, "https://journal.test/hero.jpg");
});
