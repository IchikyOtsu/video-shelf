import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { youtubeProvider } from "./feed";
import { syncSourceBatch } from "./source-sync-batch";

const channelId = "UCln9P4Qm3-EAY4aiEPmRwEA";
const source = { id: "one", kind: "youtube", feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}` };
const xml = '<feed><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>RSS</title><published>2026-09-01T10:00:00Z</published></entry></feed>';
function videosPage(owner:string, short = false) {
  const contents = [{ richItemRenderer:{ content:{ videoRenderer:{ videoId:"dQw4w9WgXcQ",title:{ simpleText:"Normal" } } } } }, ...(short ? [{ richItemRenderer:{ content:{ videoRenderer:{ videoId:"LFIibTvPW6I",title:{ simpleText:"Short" },navigationEndpoint:{ commandMetadata:{ webCommandMetadata:{ url:"/shorts/LFIibTvPW6I" } } } } } } }] : [])];
  const data = { metadata:{ channelMetadataRenderer:{ externalId:owner } },contents:{ twoColumnBrowseResultsRenderer:{ tabs:[{ tabRenderer:{ selected:true,content:{ richGridRenderer:{ contents } } } }] } } };
  return `<script>var ytInitialData = ${JSON.stringify(data)};</script>`;
}
function apiKey(t: TestContext, value?: string) {
  const previous = process.env.YOUTUBE_API_KEY;
  if (value) process.env.YOUTUBE_API_KEY = value; else delete process.env.YOUTUBE_API_KEY;
  t.after(() => { if (previous === undefined) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = previous; });
}

test("configured API is primary and shared by duplicate channel sources without RSS requests", async t => {
  apiKey(t, "primary-test-key");
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: URL | string) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    if (url.searchParams.get("playlistId")?.startsWith("UUSH")) return new Response(JSON.stringify({ items:[] }));
    return new Response(JSON.stringify(url.pathname.endsWith("/channels") ? { items: [{ id: channelId, contentDetails: { relatedPlaylists: { uploads: "UUln9P4Qm3-EAY4aiEPmRwEA" } } }] } : { items: [{ snippet: { title: "API", videoOwnerChannelId: channelId }, contentDetails: { videoId: "dQw4w9WgXcQ", videoPublishedAt: "2026-10-01T10:00:00Z" } }] }));
  });
  const result = await syncSourceBatch([source, { ...source, id: "two" }], async input => (await youtubeProvider.sync(input)).length);
  assert.deepEqual(result, { synced: 2, failed: 0, imported: 2 });
  assert.deepEqual(calls, ["/youtube/v3/playlistItems","/youtube/v3/playlistItems"]);
  const rows = await youtubeProvider.sync(source);
  assert.equal(rows[0].publishedAt?.toISOString(), "2026-10-01T10:00:00.000Z");
});

test("API quota failure falls back to RSS and later sources bypass the rejected API", async t => {
  apiKey(t, "secret-quota-key");
  let apiCalls = 0; let rssCalls = 0;
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  t.mock.method(globalThis, "fetch", async (input: URL | string) => {
    if (String(input).includes("googleapis.com")) { apiCalls++; return new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }], message: "secret-quota-key" } }), { status: 403 }); }
    rssCalls++; const url = new URL(String(input)); return new Response(url.pathname.includes("/channel/") ? videosPage(url.pathname.split("/")[2]) : xml);
  });
  assert.equal((await youtubeProvider.sync(source))[0].title, "RSS");
  assert.equal((await youtubeProvider.sync(source))[0].title, "RSS");
  assert.equal((await youtubeProvider.sync({ ...source, feedUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCbbbbbbbbbbbbbbbbbbbbbb" }))[0].title, "RSS");
  assert.equal(apiCalls, 1);
  assert.equal(rssCalls, 4);
  assert.equal(warnings.length, 1);
  assert.equal(JSON.stringify(warnings).includes("secret-quota-key"), false);
});

test("API then RSS failure can use the verified page backup", async t => {
  const channelId = "UCcccccccccccccccccccccc";
  const source = { id: "backup", kind: "youtube", feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}` };
  apiKey(t, "page-backup-test-key");
  t.mock.method(console, "warn", () => {});
  const calls: string[] = [];
  const data = { metadata: { channelMetadataRenderer: { externalId: channelId } }, contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { richGridRenderer: { contents: [{ richItemRenderer: { content: { videoRenderer: { videoId: "dQw4w9WgXcQ", title: { simpleText: "Backup" } } } } }] } } } }] } } };
  t.mock.method(globalThis, "fetch", async (input: URL | string) => {
    const url = new URL(String(input)); calls.push(url.hostname);
    if (url.hostname === "www.googleapis.com") return new Response("Unavailable", { status: 500 });
    if (url.pathname === "/feeds/videos.xml") return new Response("Not found", { status: 404 });
    return new Response(`<script>var ytInitialData = ${JSON.stringify(data)};</script>`);
  });
  const rows = await youtubeProvider.sync(source);
  assert.equal(rows[0].title, "Backup");
  assert.equal(rows[0].publishedAt, null);
  assert.deepEqual(calls, ["www.googleapis.com", "www.youtube.com", "www.youtube.com"]);
});

test("without a key RSS is verified once per cached channel backup", async t => {
  apiKey(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: URL | string) => { calls++; return new Response(String(input).includes("/channel/") ? videosPage(channelId) : xml); });
  assert.equal((await youtubeProvider.sync(source)).length, 1);
  assert.equal(calls, 2);
});

test("API requests remain bounded to three while a batch processes distinct channels", async t => {
  apiKey(t, "bounded-api-test-key");
  let active = 0; let peak = 0; let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: URL | string) => {
    const url = new URL(String(input));
    calls++; peak = Math.max(peak, ++active);
    await new Promise<void>(resolve => setImmediate(resolve));
    active--;
    const id = url.searchParams.get("id");
    return new Response(JSON.stringify(id ? { items: [{ id, contentDetails: { relatedPlaylists: { uploads: "UU" + id.slice(2) } } }] } : { items: [] }));
  });
  const sources = Array.from({ length: 8 }, (_, i) => ({ id: String(i), kind: "youtube", feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=UC${String(i).repeat(22)}` }));
  const result = await syncSourceBatch(sources, async input => (await youtubeProvider.sync(input)).length);
  assert.deepEqual(result, { synced: 8, failed: 0, imported: 0 });
  assert.equal(calls, 8);
  assert.equal(peak, 3);
});

test("configured catch-up failures never downgrade to a truncated RSS success", async t => {
  apiKey(t, "catchup-error-test-key");
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: URL | string) => {
    calls.push(new URL(String(input)).hostname);
    return new Response("Unavailable", { status: 500 });
  });
  await assert.rejects(youtubeProvider.sync(source, { knownGuids: async () => new Set(["known"]) }));
  assert.deepEqual(calls, ["www.googleapis.com"]);
});

test("RSS backup rejects the reported mobile watch Short while retaining real publication dates", async t => {
  apiKey(t);
  const channel = "UCdddddddddddddddddddddd";
  const calls:string[] = [];
  const mixed = xml.replace('</feed>','<entry><yt:videoId>LFIibTvPW6I</yt:videoId><title>Short</title><published>2026-10-06T10:00:00Z</published><link rel="alternate" href="https://m.youtube.com/watch?v=LFIibTvPW6I"/></entry></feed>');
  t.mock.method(globalThis,"fetch",async (input: URL | string) => { const url = String(input); calls.push(url); return new Response(url.includes("/channel/") ? videosPage(channel,true) : mixed); });
  const input = { ...source,feedUrl:`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}` };
  const rows = await youtubeProvider.sync(input);
  assert.deepEqual(rows.map(item => item.guid),["dQw4w9WgXcQ"]); assert.equal(rows[0].publishedAt?.toISOString(),"2026-09-01T10:00:00.000Z");
  await youtubeProvider.sync(input); assert.equal(calls.length,2);
});
test("successful RSS cannot bypass a blocked or unverifiable Videos tab", async t => {
  apiKey(t);
  const channel = "UCeeeeeeeeeeeeeeeeeeeeee";
  t.mock.method(globalThis,"fetch",async (input: URL | string) => String(input).includes("/channel/") ? new Response("Blocked",{ status:403 }) : new Response(xml));
  await assert.rejects(youtubeProvider.sync({ ...source,feedUrl:`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}` }));
});


test("API sync excludes a Short using a mobile watch URL, with batched classification", async t => {
  apiKey(t, "short-api-integration-key");
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const ids = url.searchParams.get("playlistId")?.startsWith("UUSH") ? ["LFIibTvPW6I"] : ["LFIibTvPW6I", "dQw4w9WgXcQ"];
    return new Response(JSON.stringify({ items: ids.map(videoId => ({ snippet: { title: videoId, videoOwnerChannelId: channelId }, contentDetails: { videoId, videoPublishedAt: "2026-10-06T10:00:00Z" } })) }));
  });
  const rows = await youtubeProvider.sync(source);
  assert.deepEqual(rows.map(item => item.guid), ["dQw4w9WgXcQ"]);
  assert.deepEqual(calls, ["/youtube/v3/playlistItems", "/youtube/v3/playlistItems"]);
});
