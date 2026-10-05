import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchYouTubeFeedWithFallback, parseYouTubeVideosPage, youtubeFeedChannelId } from "./youtube-fallback";
import { SourceFetchError } from "./source-fetch";

const channelId = "UCln9P4Qm3-EAY4aiEPmRwEA";
const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
const video = { videoRenderer: { videoId: "dQw4w9WgXcQ", title: { runs: [{ text: "Video" }] }, lengthText: { simpleText: "3:12" }, thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }] } } };
function page(contents: unknown[], owner = channelId) {
  const data = {
    metadata: { channelMetadataRenderer: { externalId: owner, title: "Ado" } },
    contents: { twoColumnBrowseResultsRenderer: { tabs: [
      { tabRenderer: { selected: false, content: { richGridRenderer: { contents: [{ richItemRenderer: { content: { videoRenderer: { videoId: "aaaaaaaaaaa", title: { simpleText: "Other tab" } } } } }] } } } },
      { tabRenderer: { selected: true, content: { richGridRenderer: { contents: contents.map(content => ({ richItemRenderer: { content } })) } } } },
    ] } },
  };
  return `<script>var ytInitialData = ${JSON.stringify(data)};</script>`;
}

test("feed channel ID is extracted only from valid YouTube channel feeds", () => {
  assert.equal(youtubeFeedChannelId(feedUrl), channelId);
  assert.equal(youtubeFeedChannelId(feedUrl.replace("www.youtube.com", "evil.test")), null);
  assert.equal(youtubeFeedChannelId("https://www.youtube.com/feeds/videos.xml?channel_id=@ado"), null);
});

test("channel page imports selected-tab videos with stable GUIDs and skips Shorts and duplicates", () => {
  const shorts = { videoRenderer: { videoId: "bbbbbbbbbbb", title: { simpleText: "Short" }, navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: "/shorts/bbbbbbbbbbb" } } } } };
  const items = parseYouTubeVideosPage(page([video, video, shorts, { reelItemRenderer: { videoId: "ccccccccccc" } }]), channelId);
  assert.equal(items.length, 1);
  assert.equal(items[0].guid, "dQw4w9WgXcQ");
  assert.equal(items[0].author, "Ado");
  assert.equal(items[0].duration, "3:12");
  assert.equal(items[0].publishedAt, null);
});

test("modern video lockups are supported without importing playlists", () => {
  const lockup = { lockupViewModel: { contentType: "LOCKUP_CONTENT_TYPE_VIDEO", contentId: "dQw4w9WgXcQ", metadata: { lockupMetadataViewModel: { title: { content: "Modern video" } } }, contentImage: { thumbnailViewModel: { image: { sources: [{ url: "https://i.ytimg.com/image.jpg" }] } } } } };
  const playlist = { lockupViewModel: { contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST", contentId: "PLplaylist" } };
  const items = parseYouTubeVideosPage(page([lockup, playlist]), channelId);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Modern video");
  assert.equal(items[0].imageUrl, "https://i.ytimg.com/image.jpg");
});

test("consent pages, other channel owners and unrecognized markup remain failures", () => {
  assert.throws(() => parseYouTubeVideosPage("<html>Consent</html>", channelId), /inaccessible/);
  assert.throws(() => parseYouTubeVideosPage(page([video], "UCaaaaaaaaaaaaaaaaaaaaaa"), channelId), /correspond/);
  assert.throws(() => parseYouTubeVideosPage(page([]), channelId), /Aucune vidéo/);
});

test("RSS remains the primary fetch with no second request on success", async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => { calls.push(url); return new Response("<feed/>"); });
  assert.deepEqual(await fetchYouTubeFeedWithFallback(feedUrl), { xml: "<feed/>" });
  assert.deepEqual(calls, [feedUrl]);
});

test("a YouTube RSS 404 falls back to the same channel's public video page", async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    return url === feedUrl ? new Response("Not found", { status: 404 }) : new Response(page([video]));
  });
  const result = await fetchYouTubeFeedWithFallback(feedUrl);
  assert.ok("items" in result);
  assert.equal(result.items[0].guid, "dQw4w9WgXcQ");
  assert.deepEqual(calls, [feedUrl, `https://www.youtube.com/channel/${channelId}/videos`]);
});

for (const status of [403, 429]) {
  test(`HTTP ${status} does not trigger another request`, async t => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("Blocked", { status }); });
    await assert.rejects(fetchYouTubeFeedWithFallback(feedUrl), error => error instanceof SourceFetchError && error.status === status);
    assert.equal(calls, 1);
  });
}

test("the fallback HTTP error remains observable", async t => {
  t.mock.method(globalThis, "fetch", async (url: string) => new Response("Unavailable", { status: url === feedUrl ? 404 : 403 }));
  await assert.rejects(fetchYouTubeFeedWithFallback(feedUrl), error => error instanceof SourceFetchError && error.status === 403);
});
