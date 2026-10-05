import { decodeXML } from "entities";
import { XMLParser } from "fast-xml-parser";
import type { ContentType } from "./library";
import type { NormalizedItem, SourceProvider, SourceSyncInput } from "./sources";
import { fetchSourceText } from "./source-fetch";
import { articleContent, contentUrl } from "./article-content";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: false, trimValues: true, stopNodes: ["*.content", "*.summary"] });
const list = <T,>(value: T | T[] | undefined | null) => value == null ? [] : Array.isArray(value) ? value : [value];
const attributes = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const text = (value: unknown): string => {
  const node = attributes(value);
  const raw = typeof value === "string" || typeof value === "number" ? String(value) : String(node["#text"] || "");
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return cdata ? cdata[1] : node["@_type"] === "html" ? decodeXML(raw) : raw;
};
const date = (value: unknown) => { const result = new Date(text(value)); return Number.isNaN(result.getTime()) ? null : result; };
const url = (value: unknown, base: string) => contentUrl(text(value), base);
const plain = (value: unknown, base: string) => articleContent(text(value), base).text;
function image(entry: Record<string, unknown>, base: string, html: string, fallback: string | null, htmlBase = base) {
  const group = attributes(entry["media:group"]);
  const candidates = [
    ...list(entry["media:thumbnail"]), ...list(group["media:thumbnail"]),
    ...list(entry["media:content"]), ...list(group["media:content"]),
    ...list(entry.enclosure), ...list(entry.link).filter(value => attributes(value)["@_rel"] === "enclosure"),
  ];
  for (const candidate of candidates) {
    const media = attributes(candidate);
    const type = text(media["@_type"]).toLowerCase();
    if ((media["@_width"] && Number(media["@_width"]) <= 5) || (media["@_height"] && Number(media["@_height"]) <= 5)) continue;
    if (type && !type.startsWith("image/")) continue;
    if (media["@_medium"] && media["@_medium"] !== "image") continue;
    const value = url(media["@_url"] || media["@_href"], base);
    if (value && (type.startsWith("image/") || media["@_medium"] === "image" || /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(value) || list(entry["media:thumbnail"]).includes(candidate) || list(group["media:thumbnail"]).includes(candidate))) return value;
  }
  const itunes = attributes(entry["itunes:image"]);
  const direct = attributes(entry.image);
  return url(itunes["@_href"] || direct.url || direct["@_href"] || direct["@_url"] || entry.image, base) || articleContent(html, htmlBase).images[0] || fallback;
}
function enclosure(entry: Record<string, unknown>, base: string) {
  const candidates = [...list(entry.enclosure), ...list(entry["media:content"]), ...list(attributes(entry["media:group"])["media:content"]), ...list(entry.link)];
  for (const candidate of candidates) {
    const value = attributes(candidate);
    const type = text(value["@_type"]).toLowerCase();
    const audio = type.startsWith("audio/") || value["@_medium"] === "audio" || (!type && /\.(?:mp3|m4a|ogg|wav)(?:[?#]|$)/i.test(text(value["@_url"] || value["@_href"])));
    if (audio) {
      const result = url(value["@_url"] || value["@_href"], base);
      if (result) return result;
    }
  }
  return null;
}
function atomLink(entry: Record<string, unknown>, base: string) {
  const links = list(entry.link).map(attributes);
  return url(links.find(link => !link["@_rel"] || link["@_rel"] === "alternate")?.["@_href"], base);
}
function normalizedItem(entry: Record<string, unknown>, base: string, fallback: string | null, atom: boolean): NormalizedItem | null {
  base = url(entry["@_xml:base"], base) || base;
  const audioUrl = enclosure(entry, base);
  const link = (atom ? atomLink(entry, base) : url(entry.link, base)) || audioUrl;
  const guid = text(atom ? entry.id : entry.guid || entry.id) || link || "";
  if (!guid || !link) return null;
  const html = text(atom ? entry.content || entry.summary : entry["content:encoded"] || entry.description);
  const description = text(atom ? entry.summary || entry.content : entry.description || entry["content:encoded"]);
  const author = atom ? attributes(list(entry.author)[0]).name || entry["dc:creator"] : entry["dc:creator"] || entry.author || entry["itunes:author"];
  return {
    guid, title: plain(entry.title, base) || "Sans titre", url: link, audioUrl,
    // Keep source HTML as inert text for later excerpts/reading estimates and
    // legacy image recovery. It is never inserted into the DOM as markup.
    summary: html || description || null,
    author: plain(author, base) || null, mediaType: audioUrl ? "podcast" : "article",
    duration: text(entry["itunes:duration"] || attributes(entry["media:content"])["@_duration"]) || null,
    imageUrl: image(entry, base, html, fallback, link),
    publishedAt: date(entry.published || entry.pubDate || entry["dc:date"] || entry.updated),
  };
}

export type RssInspection = { name: string; siteUrl: string | null; imageUrl: string | null; contentType: Exclude<ContentType, "all">; items: NormalizedItem[] };
export function parseRssOrAtom(xml: string, feedUrl: string): RssInspection {
  const root = parser.parse(xml) as { rss?: Record<string, unknown>; feed?: Record<string, unknown> };
  const channel = root.rss?.channel ? attributes(root.rss.channel) : undefined;
  const atom = root.feed;
  if (!channel && !atom) throw new Error("Ce lien ne semble pas être un flux RSS ou Atom.");
  const container = channel || atom || {};
  const base = url(container["@_xml:base"] || root.rss?.["@_xml:base"], feedUrl) || feedUrl;
  const siteUrl = channel ? url(channel.link, base) : atomLink(atom || {}, base);
  const imageUrl = image(container, base, "", url(atom?.logo || atom?.icon, base));
  const entries = list(channel ? channel.item : atom?.entry).map(entry => normalizedItem(attributes(entry), base, imageUrl, !channel));
  const items = entries.filter((item): item is NormalizedItem => Boolean(item));
  const name = plain(container.title, base) || new URL(feedUrl).hostname;
  return { name, siteUrl, imageUrl, contentType: items.some(item => item.mediaType === "podcast") ? "podcast" : "article", items };
}
export async function inspectRssFeed(feedUrl: string): Promise<RssInspection> {
  const parsed = new URL(feedUrl);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Ajoute une URL de flux RSS ou Atom valide.");
  const response = await fetchSourceText(parsed.toString(), { "user-agent": "Shelf/1.0", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" });
  return parseRssOrAtom(response.text, response.url);
}
export const rssProvider: SourceProvider = { contentType: "article", async sync(source: SourceSyncInput) { return (await inspectRssFeed(source.feedUrl)).items; } };
