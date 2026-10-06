import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchShortsTab, parseShortsPage } from "./youtube-shorts-page";
import { confirmedShortItemIds } from "./youtube-shorts";
import { SourceFetchError } from "./source-fetch";
const channel = "UCln9P4Qm3-EAY4aiEPmRwEA";
const short = { richItemRenderer: { content: { shortsLockupViewModel: { onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: "LFIibTvPW6I" } } } } } } };
const next = { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "second-page" } } } };
function page(contents: unknown[], owner = channel, selected = true) {
  const root = { metadata: { channelMetadataRenderer: { externalId: owner } }, contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { title: "Shorts", selected, endpoint: { commandMetadata: { webCommandMetadata: { url: `/channel/${owner}/shorts` } } }, content: { richGridRenderer: { contents } } } }] } } };
  return `<script>var ytInitialData = ${JSON.stringify(root)};</script><script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"2.20261006.00.00"});</script>`;
}
test("cleanup detects the reported mobile watch Short from the real Shorts tab, independent of UUSH", async t => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: URL | string) => { urls.push(String(input)); return new Response(page([short])); });
  const result = await fetchShortsTab(channel);
  assert.deepEqual(confirmedShortItemIds([{ id: "remove", url: "https://m.youtube.com/watch?v=LFIibTvPW6I" }, { id: "keep", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }], result.ids), ["remove"]);
  assert.deepEqual(urls, [`https://www.youtube.com/channel/${channel}/shorts`]);
});
test("cleanup paginates actual Shorts without per-video or Data API requests", async t => {
  const calls: { url: string; method?: string; body?: string }[] = [];
  t.mock.method(globalThis, "fetch", async (input: URL | string, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method, body: init?.body as string | undefined });
    return new Response(calls.length === 1 ? page([{ reelItemRenderer: { videoId: "aaaaaaaaaaa" } }, next]) : JSON.stringify({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [short] } }] }));
  });
  const first = await fetchShortsTab(channel);
  assert.deepEqual(first.ids, ["aaaaaaaaaaa"]); assert.ok(first.nextPageToken);
  const second = await fetchShortsTab(channel, first.nextPageToken);
  assert.deepEqual(second.ids, ["LFIibTvPW6I"]); assert.equal(second.nextPageToken, undefined);
  assert.equal(calls.length, 2); assert.equal(calls[1].method, "POST");
  assert.equal(JSON.parse(calls[1].body!).continuation, "second-page");
  assert.equal(calls.some(call => call.url.includes("googleapis")), false);
});
test("unverified channels, wrong tabs, changed markup and blocked pages fail safely", async t => {
  assert.throws(() => parseShortsPage(page([short], "UCbbbbbbbbbbbbbbbbbbbbbb"), channel), SourceFetchError);
  assert.throws(() => parseShortsPage(page([short], channel, false), channel), SourceFetchError);
  assert.throws(() => parseShortsPage(page([{ videoRenderer: { videoId: "dQw4w9WgXcQ" } }]), channel), SourceFetchError);
  t.mock.method(globalThis, "fetch", async () => new Response("Blocked", { status: 403 }));
  await assert.rejects(fetchShortsTab(channel), error => error instanceof SourceFetchError && error.status === 403);
});
test("empty verified Shorts grid is empty and malformed continuation is rejected before fetching", async t => {
  assert.deepEqual(parseShortsPage(page([]), channel).ids, []);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response(page([])); });
  await assert.rejects(fetchShortsTab(channel, "shorts-tab:{}"), SourceFetchError);
  assert.equal(calls, 0);
  assert.deepEqual(await fetchShortsTab(channel, "old-api-cursor"), { ids: [] });
});
test("failed continuations and repeated tokens never report successful completion", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(page([short, next])));
  const first = await fetchShortsTab(channel);
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [short, next] } }] })));
  await assert.rejects(fetchShortsTab(channel, first.nextPageToken), SourceFetchError);
});


test("legacy reel navigation confirms Shorts but ordinary watch navigation does not", () => {
  const legacy = { richItemRenderer: { content: { videoRenderer: { navigationEndpoint: { reelWatchEndpoint: { videoId: "LFIibTvPW6I" } } } } } };
  const regular = { richItemRenderer: { content: { videoRenderer: { navigationEndpoint: { watchEndpoint: { videoId: "dQw4w9WgXcQ" } } } } } };
  assert.deepEqual(parseShortsPage(page([legacy, regular]), channel).ids, ["LFIibTvPW6I"]);
});
