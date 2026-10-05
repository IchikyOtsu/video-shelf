import { XMLParser } from "fast-xml-parser";
import type { NormalizedItem, SourceProvider } from "./sources";
import { fetchYouTubeFeedWithFallback, youtubeFeedChannelId } from "./youtube-fallback";
import { youtubeApiClient, YouTubeApiCooldownError } from "./youtube-api";
import { checkSyncDeadline, SourceSyncDeferredError } from "./sync-control";
import { SourceFetchError } from "./source-fetch";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: false });
const list = <T,>(value: T | T[] | undefined) => value ? (Array.isArray(value) ? value : [value]) : [];

type Backup = Awaited<ReturnType<typeof fetchYouTubeFeedWithFallback>>;
const backups = new Map<string, { value: Backup; expires: number }>();
const pendingBackups = new Map<string, Promise<Backup>>();
async function cachedBackup(feedUrl: string, scope: string) {
  const key = `${scope}:${youtubeFeedChannelId(feedUrl) || feedUrl}`;
  const cached = backups.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (cached) backups.delete(key);
  const pending = pendingBackups.get(key);
  if (pending) return pending;
  const request = fetchYouTubeFeedWithFallback(feedUrl);
  pendingBackups.set(key, request);
  try {
    const value = await request;
    if (backups.size >= 256) backups.delete(backups.keys().next().value!);
    backups.set(key, { value, expires: Date.now() + 5 * 60_000 });
    return value;
  } finally { pendingBackups.delete(key); }
}

export function isYouTubeShort(url: string) {
  try {
    const parsed = new URL(url);
    return ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(parsed.hostname) && /^\/shorts\//.test(parsed.pathname);
  } catch { return false; }
}

export function parseYouTubeFeed(xml: string): NormalizedItem[] {
  const feed = parser.parse(xml).feed;
  return list(feed?.entry).map((entry: Record<string, unknown>) => {
    const group = entry["media:group"] as Record<string, unknown> | undefined;
    const thumbnail = group?.["media:thumbnail"] as Record<string, string> | undefined;
    const links = list(entry.link as Record<string, string> | Record<string, string>[]);
    const link = links.find(item => item["@_rel"] === "alternate")?.["@_href"] || links[0]?.["@_href"];
    return { guid: String(entry["yt:videoId"] || entry.id || ""), title: String(entry.title || "Sans titre"), url: link || `https://www.youtube.com/watch?v=${entry["yt:videoId"]}`, summary: group ? String((group["media:description"] as string) || "") : null, author: String((entry.author as Record<string, string> | undefined)?.name || "") || null, mediaType: "video", imageUrl: thumbnail?.["@_url"] || null, publishedAt: entry.published ? new Date(String(entry.published)) : null };
  }).filter(item => item.guid && item.url && !isYouTubeShort(item.url));
}

export const youtubeProvider: SourceProvider = {
  contentType: "video",
  async sync(source, context = {}) {
    checkSyncDeadline(context.deadlineMs);
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelId = youtubeFeedChannelId(source.feedUrl);
    if (apiKey && channelId) {
      const started = performance.now();
      try { return await youtubeApiClient(apiKey).sync(channelId, context); }
      catch (error) {
        if (error instanceof SourceSyncDeferredError) throw error;
        checkSyncDeadline(context.deadlineMs);
        // A failed catch-up page must not silently mark a truncated RSS sync successful.
        if (context.knownGuids) throw error;
        if (!(error instanceof YouTubeApiCooldownError)) console.warn("YouTube API fallback", {
          kind: "youtube", hostname: "www.googleapis.com", status: error instanceof SourceFetchError ? error.status ?? null : null,
          error: error instanceof SourceFetchError ? error.code : "SYNC_ERROR", durationMs: Math.round(performance.now() - started),
        });
      }
    }
    // A backup can take two ten-second requests; reserve time before starting it.
    checkSyncDeadline(context.deadlineMs, Date.now() + 25_000);
    const response = await cachedBackup(source.feedUrl, apiKey ? "api" : "no-api");
    checkSyncDeadline(context.deadlineMs);
    return "xml" in response ? parseYouTubeFeed(response.xml) : response.items;
  },
};
