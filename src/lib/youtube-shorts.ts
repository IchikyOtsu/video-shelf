import { youtubeChannelIdPattern } from "./youtube";
import { youtubeVideoId } from "./video";

export function youtubeFormatPlaylist(channelId: string, format: "videos" | "shorts") {
  if (!youtubeChannelIdPattern.test(channelId)) throw new Error("Identifiant de chaîne YouTube invalide.");
  return (format === "videos" ? "UULF" : "UUSH") + channelId.slice(2);
}

export function confirmedShortItemIds(rows: { id: string; url: string }[], shortVideoIds: readonly string[]) {
  const shorts = new Set(shortVideoIds);
  return rows.filter(row => {
    const id = youtubeVideoId(row.url);
    return id && (shorts.has(id) || /^https?:\/\/(?:www\.|m\.)?youtube\.com\/shorts\//i.test(row.url));
  }).map(row => row.id);
}
