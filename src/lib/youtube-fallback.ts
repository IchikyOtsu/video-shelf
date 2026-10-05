import type { NormalizedItem } from "./sources";
import { fetchSourceText, SourceFetchError } from "./source-fetch";
import { youtubeChannelIdPattern } from "./youtube";
import { youtubeFormatPlaylist } from "./youtube-shorts";

type Node = Record<string, unknown>;
function object(value: unknown): Node { return value && typeof value === "object" ? value as Node : {}; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string {
  const node = object(value);
  return typeof node.simpleText === "string" ? node.simpleText : typeof node.content === "string" ? node.content : list(node.runs).map(run => object(run).text || "").join("");
}
function thumbnail(value: unknown): string | null {
  const node = object(value);
  const images = list(node.thumbnails).length ? list(node.thumbnails) : list(node.sources);
  const url = object(images.at(-1)).url;
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

export function youtubeFeedChannelId(feedUrl: string): string | null {
  try {
    const url = new URL(feedUrl);
    const id = url.searchParams.get("channel_id");
    return ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) && url.pathname === "/feeds/videos.xml" && id && youtubeChannelIdPattern.test(id) ? id : null;
  } catch { return null; }
}

export function parseYouTubeVideosPage(page: string, channelId: string): NormalizedItem[] {
  const json = page.match(/(?:var ytInitialData\s*=|window\["ytInitialData"\]\s*=)\s*({[\s\S]*?});\s*<\/script>/)?.[1];
  if (!json) throw new Error("La page des vidéos YouTube est inaccessible.");
  const root = object(JSON.parse(json));
  const metadata = object(object(root.metadata).channelMetadataRenderer);
  if (metadata.externalId !== channelId) throw new Error("La page YouTube ne correspond pas à la chaîne demandée.");
  const tabs = list(object(object(root.contents).twoColumnBrowseResultsRenderer).tabs).map(tab => object(object(tab).tabRenderer));
  const selected = tabs.find(tab => tab.selected === true);
  if (!selected || !object(selected.content).richGridRenderer) throw new Error("Impossible de lire la liste des vidéos YouTube.");
  const items: NormalizedItem[] = [];
  const seen = new Set<string>();
  for (const entry of list(object(object(selected.content).richGridRenderer).contents)) {
    // Only the selected tab's grid: no recommendations, Shorts shelves or playlists.
    const content = object(object(object(entry).richItemRenderer).content);
    const video = object(content.videoRenderer);
    const lockup = object(content.lockupViewModel);
    if (!video.videoId && lockup.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") continue;
    const id = video.videoId || lockup.contentId;
    const lockupMetadata = object(object(lockup.metadata).lockupMetadataViewModel);
    const title = text(video.title || lockupMetadata.title);
    const command = object(video.navigationEndpoint || object(object(lockup.rendererContext).commandContext).onTap);
    const navigation = object(command.innertubeCommand || command);
    const endpoint = object(navigation.commandMetadata);
    const path = object(endpoint.webCommandMetadata).url;
    if (navigation.reelWatchEndpoint || (typeof path === "string" && path.startsWith("/shorts/"))) continue;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    items.push({ guid: id, title, url: `https://www.youtube.com/watch?v=${id}`, mediaType: "video", author: typeof metadata.title === "string" ? metadata.title : null, imageUrl: thumbnail(video.thumbnail || object(object(lockup.contentImage).thumbnailViewModel).image), summary: null, duration: text(video.lengthText) || null, publishedAt: null });
  }
  // Avoid reporting a successful empty sync when YouTube changes its markup.
  if (!items.length) throw new Error("Aucune vidéo lisible sur la page YouTube. Le flux RSS reste indisponible.");
  return items;
}

export async function fetchYouTubeFeedWithFallback(feedUrl: string): Promise<{ xml: string } | { items: NormalizedItem[] }> {
  const channelId = youtubeFeedChannelId(feedUrl);
  // Never fall back to the mixed uploads feed: /watch URLs can also be Shorts.
  const rssUrl = channelId ? `https://www.youtube.com/feeds/videos.xml?playlist_id=${youtubeFormatPlaylist(channelId, "videos")}` : feedUrl;
  try {
    const response = await fetchSourceText(rssUrl, { "user-agent": "Shelf/1.0" });
    return { xml: response.text };
  } catch (error) {
    if (!(error instanceof SourceFetchError) || error.status !== 404 || !channelId) throw error;
    const response = await fetchSourceText(`https://www.youtube.com/channel/${channelId}/videos`, { "user-agent": "Mozilla/5.0", "accept-language": "en-US,en;q=0.9", cookie: "SOCS=CAI" });
    return { items: parseYouTubeVideosPage(response.text, channelId) };
  }
}
