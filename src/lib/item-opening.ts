import { youtubeVideoId } from "./video";
export function safeMediaUrl(value: string | null | undefined) {
  try { const url = new URL(value || ""); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : null; } catch { return null; }
}
export function itemOpening(item: { mediaType: string; url: string; audioUrl?: string | null }) {
  if (item.mediaType === "article") return { kind: "article" as const };
  if (item.mediaType === "podcast") { const audioUrl = safeMediaUrl(item.audioUrl); return audioUrl ? { kind: "podcast" as const, audioUrl } : { kind: "external" as const }; }
  const videoId = item.mediaType === "video" ? youtubeVideoId(item.url) : null;
  return videoId ? { kind: "youtube" as const, videoId } : { kind: "external" as const };
}
