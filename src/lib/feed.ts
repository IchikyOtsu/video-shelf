import { XMLParser } from "fast-xml-parser";
import { db } from "@/db";
import { items } from "@/db/schema";

type YouTubeSource = { id: string; feedUrl: string };
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: false });
const list = <T,>(value: T | T[] | undefined) => value ? (Array.isArray(value) ? value : [value]) : [];

export async function syncYouTubeSource(source: YouTubeSource) {
  if (!db) throw new Error("Database not connected");
  const response = await fetch(source.feedUrl, { signal: AbortSignal.timeout(10000), next: { revalidate: 0 }, headers: { "user-agent": "Shelf/1.0" } });
  if (!response.ok) throw new Error("Le flux YouTube est inaccessible.");
  const feed = parser.parse(await response.text()).feed;
  const rows = list(feed?.entry).map((entry: Record<string, unknown>) => {
    const group = entry["media:group"] as Record<string, unknown> | undefined;
    const thumbnail = group?.["media:thumbnail"] as Record<string, string> | undefined;
    const links = list(entry.link as Record<string, string> | Record<string, string>[]);
    const link = links.find(item => item["@_rel"] === "alternate")?.["@_href"] || links[0]?.["@_href"];
    return { sourceId: source.id, guid: String(entry["yt:videoId"] || entry.id), title: String(entry.title || "Sans titre"), url: link || `https://www.youtube.com/watch?v=${entry["yt:videoId"]}`, summary: group ? String((group["media:description"] as string) || "") : null, author: String((entry.author as Record<string, string> | undefined)?.name || ""), mediaType: "video", imageUrl: thumbnail?.["@_url"] || null, publishedAt: entry.published ? new Date(String(entry.published)) : null };
  }).filter(row => row.guid && row.url);
  if (rows.length) await db.insert(items).values(rows).onConflictDoNothing();
  return rows.length;
}
