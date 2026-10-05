import type { NormalizedItem } from "./sources";
import { SourceFetchError, type SourceFetchErrorCode } from "./source-fetch";
import { youtubeChannelIdPattern } from "./youtube";
import { youtubeFormatPlaylist } from "./youtube-shorts";

export const YOUTUBE_UPLOAD_CACHE_MS = 5 * 60_000;
const CHANNEL_CACHE_MS = 7 * 24 * 60 * 60_000;
const API_COOLDOWN_MS = 15 * 60_000;
const MAX_CACHE_ENTRIES = 256;
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export class YouTubeApiCooldownError extends SourceFetchError {
  constructor(code: SourceFetchErrorCode, status?: number) { super(code, "www.googleapis.com", status); }
}

export function normalizeYouTubeUploads(data: unknown, channelId: string): NormalizedItem[] {
  const root = object(data);
  if (!Array.isArray(root.items)) throw new SourceFetchError("INVALID_RESPONSE", "www.googleapis.com");
  const result: NormalizedItem[] = [];
  const seen = new Set<string>();
  for (const item of root.items) {
    const snippet = object(object(item).snippet);
    const details = object(object(item).contentDetails);
    const id = details.videoId;
    // This is the video's publication time, not its addition time to a playlist.
    const publishedAt = typeof details.videoPublishedAt === "string" ? new Date(details.videoPublishedAt) : null;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(id) || seen.has(id) || !publishedAt || Number.isNaN(publishedAt.getTime()) || typeof snippet.title !== "string" || !snippet.title || (snippet.videoOwnerChannelId && snippet.videoOwnerChannelId !== channelId)) continue;
    seen.add(id);
    const thumbnails = object(snippet.thumbnails);
    const image = object(thumbnails.high || thumbnails.medium || thumbnails.default).url;
    result.push({ guid: id, title: snippet.title, url: `https://www.youtube.com/watch?v=${id}`, mediaType: "video", summary: typeof snippet.description === "string" ? snippet.description : null, author: typeof snippet.videoOwnerChannelTitle === "string" ? snippet.videoOwnerChannelTitle : typeof snippet.channelTitle === "string" ? snippet.channelTitle : null, imageUrl: typeof image === "string" && image.startsWith("https://") ? image : null, publishedAt });
  }
  return result;
}

// Success-only cache plus single-flight requests, shared across sources/accounts
// on a warm instance. Next's Data Cache also reuses stable channel lookups.
export function createYouTubeApiClient(apiKey: string, fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  const cache = new Map<string, { value: Json; expires: number }>();
  const pending = new Map<string, Promise<Json>>();
  let cooldown: { until: number; code: SourceFetchErrorCode; status?: number } | undefined;

  async function get(path: string, params: Record<string, string>, ttl: number): Promise<Json> {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    url.search = new URLSearchParams({ ...params, key: apiKey }).toString();
    const key = url.toString();
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.value;
    if (cached) cache.delete(key);
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    if (cooldown && cooldown.until > now()) throw new YouTubeApiCooldownError(cooldown.code, cooldown.status);
    const request = (async () => {
      const signal = AbortSignal.timeout(10_000);
      try {
        // Uploads must be fresh when the local cache expires: stale-while-
        // revalidate could otherwise make the daily cron import yesterday's list.
        const response = await fetcher(url, path === "channels" ? { signal, next: { revalidate: ttl / 1000 } } : { signal, cache: "no-store" });
        let data: Json;
        try { data = object(await response.json()); }
        catch {
          if (signal.aborted) throw new SourceFetchError("TIMEOUT", url.hostname);
          if (response.ok) throw new SourceFetchError("INVALID_RESPONSE", url.hostname, response.status);
          data = {};
        }
        if (!response.ok) {
          // Classify only known reason codes. Never retain/log upstream messages.
          const reasons = [...array(object(data.error).errors), ...array(object(data.error).details)].map(error => object(error).reason);
          const quota = response.status === 429 || reasons.some(reason => ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(String(reason)));
          const configuration = reasons.some(reason => ["keyInvalid", "accessNotConfigured", "ipRefererBlocked", "forbidden", "dailyLimitExceededUnreg", "API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED", "SERVICE_DISABLED"].includes(String(reason)));
          if (quota || configuration) {
            const code = quota ? "API_QUOTA" : "API_CONFIGURATION";
            cooldown = { until: now() + API_COOLDOWN_MS, code, status: response.status };
            throw new SourceFetchError(code, url.hostname, response.status);
          }
          throw new SourceFetchError("HTTP_ERROR", url.hostname, response.status);
        }
        if (!Array.isArray(data.items)) throw new SourceFetchError("INVALID_RESPONSE", url.hostname);
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
        cache.set(key, { value: data, expires: now() + ttl });
        return data;
      } catch (error) {
        if (error instanceof SourceFetchError) {
          if ((error.status ?? 0) >= 500 || error.code === "TIMEOUT") cooldown = { until: now() + 60_000, code: error.code, status: error.status };
          throw error;
        }
        const code = signal.aborted || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) ? "TIMEOUT" : "NETWORK_ERROR";
        cooldown = { until: now() + 60_000, code };
        throw new SourceFetchError(code, url.hostname);
      }
    })();
    pending.set(key, request);
    try { return await request; } finally { pending.delete(key); }
  }

  return {
    async sync(channelId: string): Promise<NormalizedItem[]> {
      if (!youtubeChannelIdPattern.test(channelId)) throw new Error("Identifiant de chaîne YouTube invalide.");
      const channelData = await get("channels", { part: "contentDetails", id: channelId, fields: "items(id,contentDetails/relatedPlaylists/uploads)" }, CHANNEL_CACHE_MS);
      const channel = array(channelData.items).map(object).find(item => item.id === channelId);
      if (!channel) throw new SourceFetchError("HTTP_ERROR", "www.googleapis.com", 404);
      const uploads = object(object(channel.contentDetails).relatedPlaylists).uploads;
      if (typeof uploads !== "string" || !/^[A-Za-z0-9_-]{10,128}$/.test(uploads)) throw new SourceFetchError("INVALID_RESPONSE", "www.googleapis.com");
      const data = await get("playlistItems", { part: "snippet,contentDetails", playlistId: youtubeFormatPlaylist(channelId, "videos"), maxResults: "50", fields: "items(snippet(title,description,videoOwnerChannelId,videoOwnerChannelTitle,channelTitle,thumbnails),contentDetails(videoId,videoPublishedAt))" }, YOUTUBE_UPLOAD_CACHE_MS);
      // Only one page. No historical crawl and no per-video requests.
      return normalizeYouTubeUploads(data, channelId);
    },
    async shorts(channelId: string, pageToken?: string): Promise<{ ids: string[]; nextPageToken?: string }> {
      try {
        const data = await get("playlistItems", { part: "contentDetails", playlistId: youtubeFormatPlaylist(channelId, "shorts"), maxResults: "50", fields: "nextPageToken,items(contentDetails/videoId)", ...(pageToken ? { pageToken } : {}) }, YOUTUBE_UPLOAD_CACHE_MS);
        const ids = array(data.items).map(item => object(object(item).contentDetails).videoId).filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id));
        return { ids, ...(typeof data.nextPageToken === "string" && data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}) };
      } catch (error) {
        // A channel without Shorts can have no Shorts playlist.
        if (error instanceof SourceFetchError && error.status === 404) return { ids: [] };
        throw error;
      }
    },
  };
}

let shared: { key: string; client: ReturnType<typeof createYouTubeApiClient> } | undefined;
export function youtubeApiClient(key: string) {
  if (!shared || shared.key !== key) shared = { key, client: createYouTubeApiClient(key) };
  return shared.client;
}
