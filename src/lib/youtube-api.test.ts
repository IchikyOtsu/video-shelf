import assert from "node:assert/strict";
import { test } from "node:test";
import { createYouTubeApiClient, normalizeYouTubeUploads, YOUTUBE_UPLOAD_CACHE_MS, YouTubeApiCooldownError } from "./youtube-api";
import { SourceFetchError } from "./source-fetch";

const channelId = "UCln9P4Qm3-EAY4aiEPmRwEA";
const playlistId = "UUln9P4Qm3-EAY4aiEPmRwEA";
const channelData = { items: [{ id: channelId, contentDetails: { relatedPlaylists: { uploads: playlistId } } }] };
const upload = { snippet: { title: "Video", description: "Summary", videoOwnerChannelId: channelId, videoOwnerChannelTitle: "Ado", publishedAt: "2026-10-05T10:00:00Z", thumbnails: { high: { url: "https://i.ytimg.com/image.jpg" } } }, contentDetails: { videoId: "dQw4w9WgXcQ", videoPublishedAt: "2026-09-01T10:00:00Z" } };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test("API normalization uses the video's real publication date, stable ID and owner", () => {
  const rows = normalizeYouTubeUploads({ items: [upload, upload, { ...upload, contentDetails: { videoId: "aaaaaaaaaaa" } }, { ...upload, snippet: { ...upload.snippet, videoOwnerChannelId: "UCbbbbbbbbbbbbbbbbbbbbbb" } }] }, channelId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].guid, "dQw4w9WgXcQ");
  assert.equal(rows[0].publishedAt?.toISOString(), "2026-09-01T10:00:00.000Z");
  assert.equal(rows[0].author, "Ado");
  assert.equal(rows[0].imageUrl, "https://i.ytimg.com/image.jpg");
});

test("API sync uses one videos-only list request and no channel/detail/search/history requests", async () => {
  const calls: URL[] = [];
  const client = createYouTubeApiClient("test-key", async input => {
    const url = new URL(String(input)); calls.push(url);
    return json(url.pathname.endsWith("/channels") ? channelData : { items: [upload], nextPageToken: "do-not-follow" });
  });
  const rows = await client.sync(channelId);
  assert.equal(rows.length, 1);
  assert.deepEqual(calls.map(url => url.pathname.split("/").at(-1)), ["playlistItems"]);
  assert.equal(calls[0].searchParams.get("maxResults"), "50");
  assert.equal(calls[0].searchParams.get("playlistId"), "UULF" + channelId.slice(2));
  assert.equal(calls.some(url => url.searchParams.has("pageToken")), false);
});

test("repeated and concurrent syncs share requests and refresh the video list when its cache expires", async () => {
  let now = 0;
  let calls = 0;
  const client = createYouTubeApiClient("test-key", async input => {
    calls++;
    await new Promise<void>(resolve => setImmediate(resolve));
    return json(String(input).includes("/channels?") ? channelData : { items: [upload] });
  }, () => now);
  await Promise.all([client.sync(channelId), client.sync(channelId), client.sync(channelId)]);
  assert.equal(calls, 1);
  await client.sync(channelId);
  assert.equal(calls, 1);
  now += YOUTUBE_UPLOAD_CACHE_MS;
  await client.sync(channelId);
  assert.equal(calls, 2);
});

for (const [status, reason, code] of [[403, "quotaExceeded", "API_QUOTA"], [400, "keyInvalid", "API_CONFIGURATION"], [403, "SERVICE_DISABLED", "API_CONFIGURATION"]] as const) {
  test(`${reason} activates a shared cooldown without retaining sensitive API messages`, async () => {
    let now = 0;
    let calls = 0;
    const client = createYouTubeApiClient("secret-key", async () => {
      calls++;
      return json({ error: { message: "private secret-key response", errors: [{ reason }], details: [{ reason }] } }, status);
    }, () => now);
    await assert.rejects(client.sync(channelId), error => error instanceof SourceFetchError && error.code === code && !error.message.includes("secret-key"));
    await assert.rejects(client.sync("UCbbbbbbbbbbbbbbbbbbbbbb"), YouTubeApiCooldownError);
    assert.equal(calls, 1);
    now += 15 * 60_000;
    await assert.rejects(client.sync(channelId), SourceFetchError);
    assert.equal(calls, 2);
  });
}

test("HTTP 429 with a non-JSON body also stops further API attempts", async () => {
  let calls = 0;
  const client = createYouTubeApiClient("test-key", async () => { calls++; return new Response("Rate limited", { status: 429 }); });
  await assert.rejects(client.sync(channelId), error => error instanceof SourceFetchError && error.code === "API_QUOTA" && error.status === 429);
  await assert.rejects(client.sync("UCbbbbbbbbbbbbbbbbbbbbbb"), YouTubeApiCooldownError);
  assert.equal(calls, 1);
});

test("one missing channel does not block other channels", async () => {
  const client = createYouTubeApiClient("test-key", async input => {
    const url = new URL(String(input));
    if (url.searchParams.get("playlistId") === "UULFbbbbbbbbbbbbbbbbbbbbbb") return json({}, 404);
    return json(url.pathname.endsWith("/channels") ? channelData : { items: [upload] });
  });
  await assert.rejects(client.sync("UCbbbbbbbbbbbbbbbbbbbbbb"), error => error instanceof SourceFetchError && error.status === 404);
  assert.equal((await client.sync(channelId)).length, 1);
});

test("timeouts and malformed API responses stay observable", async () => {
  const timeout = createYouTubeApiClient("test-key", async () => { throw new DOMException("private", "TimeoutError"); });
  await assert.rejects(timeout.sync(channelId), error => error instanceof SourceFetchError && error.code === "TIMEOUT");
  const malformed = createYouTubeApiClient("test-key", async () => json({ private: "payload" }));
  await assert.rejects(malformed.sync(channelId), error => error instanceof SourceFetchError && error.code === "INVALID_RESPONSE");
});

test("an API outage pauses retries briefly while allowing recovery after one minute", async () => {
  let calls = 0; let now = 0;
  const client = createYouTubeApiClient("test-key", async input => {
    calls++;
    if (now === 0) return json({ error: {} }, 503);
    return json(String(input).includes("/channels?") ? channelData : { items: [upload] });
  }, () => now);
  await assert.rejects(client.sync(channelId), error => error instanceof SourceFetchError && error.status === 503);
  await assert.rejects(client.sync("UCbbbbbbbbbbbbbbbbbbbbbb"), YouTubeApiCooldownError);
  assert.equal(calls, 1);
  now += 60_000;
  assert.equal((await client.sync(channelId)).length, 1);
  assert.equal(calls, 2);
});

test("Shorts cleanup requests only the Shorts playlist and follows explicit cursors", async () => {
  const calls: URL[] = [];
  const client = createYouTubeApiClient("test-key", async input => {
    const url = new URL(String(input)); calls.push(url);
    return json(url.searchParams.has("pageToken") ? { items: [{ contentDetails: { videoId: "bbbbbbbbbbb" } }] } : { items: [{ contentDetails: { videoId: "aaaaaaaaaaa" } }, { contentDetails: { videoId: "invalid" } }], nextPageToken: "next" });
  });
  assert.deepEqual(await client.shorts(channelId), { ids: ["aaaaaaaaaaa"], nextPageToken: "next" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("playlistId"), "UUSH" + channelId.slice(2));
  assert.equal(calls[0].searchParams.get("maxResults"), "50");
  assert.deepEqual(await client.shorts(channelId, "next"), { ids: ["bbbbbbbbbbb"] });
  assert.equal(calls[1].searchParams.get("pageToken"), "next");
  assert.deepEqual(await client.shorts(channelId), { ids: ["aaaaaaaaaaa"], nextPageToken: "next" });
  assert.equal(calls.length, 2);
});

test("a missing Shorts playlist is empty but blocked or malformed responses fail safely", async () => {
  const missing = createYouTubeApiClient("test-key", async () => json({}, 404));
  assert.deepEqual(await missing.shorts(channelId), { ids: [] });
  const blocked = createYouTubeApiClient("test-key", async () => json({}, 403));
  await assert.rejects(blocked.shorts(channelId), error => error instanceof SourceFetchError && error.status === 403);
  const malformed = createYouTubeApiClient("test-key", async () => json({}));
  await assert.rejects(malformed.shorts(channelId), SourceFetchError);
});

test("catch-up continues beyond 50 videos until the first known ID, refreshing known metadata without crawling history", async () => {
  const calls: URL[] = [];
  const makeUpload = (i: number) => ({ ...upload, contentDetails: { ...upload.contentDetails, videoId: String(i).padStart(11, "0") } });
  const client = createYouTubeApiClient("test-key", async input => {
    const url = new URL(String(input)); calls.push(url);
    const token = url.searchParams.get("pageToken");
    return json(token ? { items: [makeUpload(50), makeUpload(51), makeUpload(52), makeUpload(53)], nextPageToken: "must-not-fetch" } : { items: Array.from({ length: 50 }, (_, i) => makeUpload(i)), nextPageToken: "second" });
  });
  const knownPages: string[][] = [];
  const rows = await client.sync(channelId, { knownGuids: async ids => { knownPages.push(ids); return new Set([String(51).padStart(11, "0"), String(53).padStart(11, "0")]); } });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("pageToken"), "second");
  assert.equal(knownPages[0].length, 50);
  assert.equal(rows.length, 53);
  assert.equal(rows.some(row => row.guid === String(52).padStart(11, "0")), false);
  assert.equal(rows.at(-1)?.guid, String(53).padStart(11, "0"));
});

test("known first page uses only one request; no known IDs walks to the final page", async () => {
  let calls = 0;
  const client = createYouTubeApiClient("test-key", async input => {
    calls++;
    return json(new URL(String(input)).searchParams.has("pageToken") ? { items: [] } : { items: [upload], nextPageToken: "last" });
  });
  assert.equal((await client.sync(channelId, { knownGuids: async () => new Set([upload.contentDetails.videoId]) })).length, 1);
  assert.equal(calls, 1);
  assert.equal((await client.sync(channelId, { knownGuids: async () => new Set() })).length, 1);
  assert.equal(calls, 2);
});

test("catch-up failures and repeated page tokens never silently return a partial success", async () => {
  const failed = createYouTubeApiClient("test-key", async input => json(new URL(String(input)).searchParams.has("pageToken") ? {} : { items: [upload], nextPageToken: "next" }, new URL(String(input)).searchParams.has("pageToken") ? 500 : 200));
  await assert.rejects(failed.sync(channelId, { knownGuids: async () => new Set() }), SourceFetchError);
  const looping = createYouTubeApiClient("test-key", async () => json({ items: [upload], nextPageToken: "same" }));
  await assert.rejects(looping.sync(channelId, { knownGuids: async () => new Set() }), error => error instanceof SourceFetchError && error.code === "INVALID_RESPONSE");
});

test("catch-up respects its deadline before starting another page", async () => {
  let now = 0; let calls = 0;
  const client = createYouTubeApiClient("test-key", async () => { calls++; now += 10; return json({ items: [upload], nextPageToken: "next" }); }, () => now);
  await assert.rejects(client.sync(channelId, { knownGuids: async () => new Set(), deadlineMs: 10 }), /reportée/);
  assert.equal(calls, 1);
});
