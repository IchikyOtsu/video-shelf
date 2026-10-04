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
