import type { NormalizedItem } from "./sources";
import { SourceFetchError, type SourceFetchErrorCode } from "./source-fetch";
import { youtubeChannelIdPattern } from "./youtube";
import { checkSyncDeadline } from "./sync-control";
import { youtubeFormatPlaylist } from "./youtube-shorts";

export const YOUTUBE_UPLOAD_CACHE_MS = 5 * 60_000;
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

// Success-only cache and single-flight requests scoped to this client.
export function createYouTubeApiClient(apiKey: string, fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  const cache = new Map<string, { value: Json; expires: number }>();
  const pending = new Map<string, Promise<Json>>();
  let cooldown: { until: number; code: SourceFetchErrorCode; status?: number } | undefined;

  async function get(path: string, params: Record<string, string>, ttl: number): Promise<Json> {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    url.search = new URLSearchParams({ ...params, key: apiKey }).toString();
    // The client already scopes its caches to one credential.
    const key = `${path}:${new URLSearchParams(params)}`;
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
        const response = await fetcher(url, { signal, cache: "no-store" });
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
    async sync(channelId: string, options: { knownGuids?: (ids: string[]) => Promise<ReadonlySet<string>>; deadlineMs?: number } = {}): Promise<NormalizedItem[]> {
      if (!youtubeChannelIdPattern.test(channelId)) throw new Error("Identifiant de chaîne YouTube invalide.");
      const rows: NormalizedItem[] = [];
      const visited = new Set<string>();
      let pageToken: string | undefined;
      do {
        checkSyncDeadline(options.deadlineMs, now());
        const data = await get("playlistItems", { part: "snippet,contentDetails", playlistId: youtubeFormatPlaylist(channelId, "videos"), maxResults: "50", fields: "nextPageToken,items(snippet(title,description,videoOwnerChannelId,videoOwnerChannelTitle,channelTitle,thumbnails),contentDetails(videoId,videoPublishedAt))", ...(pageToken ? { pageToken } : {}) }, YOUTUBE_UPLOAD_CACHE_MS);
        checkSyncDeadline(options.deadlineMs, now());
        const page = normalizeYouTubeUploads(data, channelId);
        // New sources intentionally import one page, without a historical crawl.
        if (!options.knownGuids) { rows.push(...page); break; }
        const known = await options.knownGuids(page.map(item => item.guid));
        checkSyncDeadline(options.deadlineMs, now());
        const boundary = page.findIndex(item => known.has(item.guid));
        if (boundary >= 0) {
          rows.push(...page.slice(0, boundary + 1), ...page.slice(boundary + 1).filter(item => known.has(item.guid)));
          break;
        }
        rows.push(...page);
        pageToken = typeof data.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : undefined;
        if (pageToken && visited.has(pageToken)) throw new SourceFetchError("INVALID_RESPONSE", "www.googleapis.com");
        if (pageToken) visited.add(pageToken);
      } while (pageToken);
      return rows;
    },
    async withoutShorts(channelId: string, rows: NormalizedItem[], options: { knownGuids?: (ids: string[]) => Promise<ReadonlySet<string>>; deadlineMs?: number } = {}) {
      if (!youtubeChannelIdPattern.test(channelId)) throw new Error("Identifiant de chaîne YouTube invalide.");
      checkSyncDeadline(options.deadlineMs, now());
      const known = options.knownGuids ? await options.knownGuids(rows.map(item => item.guid)) : new Set<string>();
      const candidates = rows.filter(item => !known.has(item.guid));
      // Metadata-only runs have nothing new to classify. Existing Shorts are
      // removed through the explicit ownership-checked cleanup operation.
      if (!candidates.length) return rows;
      const dates = candidates.map(item => item.publishedAt?.getTime()).filter((date): date is number => date !== undefined && Number.isFinite(date));
      const oldest = dates.length === candidates.length ? Math.min(...dates) : null;
      const shorts = new Set<string>(); const visited = new Set<string>();
      let pageToken: string | undefined;
      do {
        checkSyncDeadline(options.deadlineMs, now());
        let data: Json;
        try { data = await get("playlistItems", { part:"contentDetails", playlistId:youtubeFormatPlaylist(channelId,"shorts"), maxResults:"50", fields:"nextPageToken,items(contentDetails(videoId,videoPublishedAt))", ...(pageToken ? { pageToken } : {}) },YOUTUBE_UPLOAD_CACHE_MS); }
        catch (error) { if (error instanceof SourceFetchError && error.status === 404) break; throw error; }
        checkSyncDeadline(options.deadlineMs, now());
        const page = array(data.items).map(item => object(object(item).contentDetails));
        if (page.some(item => typeof item.videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(item.videoId))) throw new SourceFetchError("INVALID_RESPONSE", "www.googleapis.com");
        const pageDates = page.map(item => typeof item.videoPublishedAt === "string" ? Date.parse(item.videoPublishedAt) : NaN);
        for (const item of page) if (typeof item.videoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(item.videoId)) shorts.add(item.videoId);
        if (candidates.every(item => shorts.has(item.guid))) break;
        // Continue past 50 Shorts only while their publication window can
        // overlap new candidates. Missing dates cannot justify stopping early.
        if (oldest !== null && pageDates.length && pageDates.every(Number.isFinite) && Math.max(...pageDates) < oldest) break;
        pageToken = typeof data.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : undefined;
        if (pageToken && visited.has(pageToken)) throw new SourceFetchError("INVALID_RESPONSE","www.googleapis.com");
        if (pageToken) visited.add(pageToken);
      } while (pageToken);
      return rows.filter(item => !shorts.has(item.guid));
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
