import { XMLParser } from "fast-xml-parser";
import type { ContentType } from "./library";
import type { NormalizedItem, SourceProvider, SourceSyncInput } from "./sources";
import { fetchSourceText } from "./source-fetch";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: false, trimValues: true });
const list = <T,>(value: T | T[] | undefined | null) => value == null ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : value && typeof value === "object" ? String((value as Record<string, unknown>)["#text"] || "") : "";
const date = (value: unknown) => { const result = new Date(text(value)); return Number.isNaN(result.getTime()) ? null : result; };
function url(value: unknown, base: string) { try { const result = new URL(text(value), base); return ["http:", "https:"].includes(result.protocol) ? result.toString() : null; } catch { return null; } }
function attributes(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function image(entry: Record<string, unknown>, base: string) {
  const media = attributes(entry["media:thumbnail"] || entry["media:content"]);
  const itunes = attributes(entry["itunes:image"]);
  return url(itunes["@_href"] || media["@_url"] || entry.image, base);
}
function enclosure(entry: Record<string, unknown>, base: string) {
  const candidates = [...list(entry.enclosure), ...list(entry["media:content"]), ...list(entry.link)];
  for (const candidate of candidates) {
    const value = attributes(candidate);
    const type = text(value["@_type"]);
    if (type.startsWith("audio/") || value["@_rel"] === "enclosure") {
      const result = url(value["@_url"] || value["@_href"], base);
      if (result) return result;
    }
  }
  return null;
}
function rssItem(entry: Record<string, unknown>, base: string): NormalizedItem | null {
  const audioUrl = enclosure(entry, base);
  const link = url(entry.link, base) || audioUrl;
  const guid = text(entry.guid) || text(entry.id) || link || "";
  if (!guid || !link) return null;
  return { guid, title: text(entry.title) || "Sans titre", url: link, audioUrl, summary: text(entry["content:encoded"] || entry.description) || null, author: text(entry["dc:creator"] || entry.author || entry["itunes:author"]) || null, mediaType: audioUrl ? "podcast" : "article", duration: text(entry["itunes:duration"] || attributes(entry["media:content"])["@_duration"]) || null, imageUrl: image(entry, base), publishedAt: date(entry.pubDate || entry["dc:date"] || entry.published) };
}
function atomLink(entry: Record<string, unknown>, base: string) {
  const links = list(entry.link).map(attributes);
  return url(links.find(link => !link["@_rel"] || link["@_rel"] === "alternate")?.["@_href"] || links[0]?.["@_href"], base);
}
function atomItem(entry: Record<string, unknown>, base: string): NormalizedItem | null {
  const audioUrl = enclosure(entry, base);
  const link = atomLink(entry, base) || audioUrl;
  const guid = text(entry.id) || link || "";
  if (!guid || !link) return null;
  const author = attributes(entry.author);
  return { guid, title: text(entry.title) || "Sans titre", url: link, audioUrl, summary: text(entry.summary || entry.content) || null, author: text(author.name || entry["dc:creator"]) || null, mediaType: audioUrl ? "podcast" : "article", duration: text(entry["itunes:duration"] || attributes(entry["media:content"])["@_duration"]) || null, imageUrl: image(entry, base), publishedAt: date(entry.updated || entry.published) };
}

export type RssInspection = { name: string; siteUrl: string | null; contentType: Exclude<ContentType, "all">; items: NormalizedItem[] };
export function parseRssOrAtom(xml: string, feedUrl: string): RssInspection {
  const root = parser.parse(xml) as { rss?: { channel?: Record<string, unknown> }; feed?: Record<string, unknown> };
  const channel = root.rss?.channel;
  const atom = root.feed;
  if (!channel && !atom) throw new Error("Ce lien ne semble pas être un flux RSS ou Atom.");
  const entries = channel ? list(channel.item).map(item => rssItem(attributes(item), feedUrl)) : list(atom?.entry).map(entry => atomItem(attributes(entry), feedUrl));
  const items = entries.filter((item): item is NormalizedItem => Boolean(item));
  const name = text(channel?.title || atom?.title) || new URL(feedUrl).hostname;
  const siteUrl = channel ? url(channel.link, feedUrl) : atomLink(atom || {}, feedUrl);
  return { name, siteUrl, contentType: items.some(item => item.mediaType === "podcast") ? "podcast" : "article", items };
}
export async function inspectRssFeed(feedUrl: string): Promise<RssInspection> {
  const parsed = new URL(feedUrl);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Ajoute une URL de flux RSS ou Atom valide.");
  const response = await fetchSourceText(parsed.toString(), { "user-agent": "Shelf/1.0", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" });
  return parseRssOrAtom(response.text, response.url);
}
export const rssProvider: SourceProvider = { contentType: "article", async sync(source: SourceSyncInput) { return (await inspectRssFeed(source.feedUrl)).items; } };
