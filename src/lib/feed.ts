import { XMLParser } from "fast-xml-parser";
import type { NormalizedItem, SourceProvider } from "./sources";
import { fetchYouTubeFeedWithFallback } from "./youtube-fallback";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: false });
const list = <T,>(value: T | T[] | undefined) => value ? (Array.isArray(value) ? value : [value]) : [];

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
  async sync(source) {
    const response = await fetchYouTubeFeedWithFallback(source.feedUrl);
    return "xml" in response ? parseYouTubeFeed(response.xml) : response.items;
  },
};
