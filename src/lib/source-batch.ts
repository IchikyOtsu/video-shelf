import { youtubeChannelIdPattern } from "./youtube";

export type YouTubeBatchInput = { kind: "youtube"; channelId: string; name: string };
export type YouTubeCandidate = YouTubeBatchInput & { feedUrl: string; siteUrl: string; contentType: "video" };
export type BatchFailure = { channelId?: string; name?: string; error: string; added?: boolean };

export function parseYouTubeBatch(body: unknown) {
  const raw = body && typeof body === "object" ? (body as { sources?: unknown }).sources : undefined;
  if (!Array.isArray(raw) || !raw.length || raw.length > 50) throw new Error("Sélectionne entre 1 et 50 chaînes.");
  const candidates: YouTubeCandidate[] = [];
  const failed: BatchFailure[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const channelId = typeof source.channelId === "string" ? source.channelId.trim() : "";
    const name = typeof source.name === "string" ? source.name.trim().slice(0, 200) : "";
    if (source.kind !== "youtube" || !youtubeChannelIdPattern.test(channelId) || !name) {
      failed.push({ channelId: channelId || undefined, name: name || undefined, error: "Chaîne YouTube invalide." });
      continue;
    }
    if (seen.has(channelId)) continue;
    seen.add(channelId);
    candidates.push({ kind: "youtube", channelId, name, contentType: "video", feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, siteUrl: `https://www.youtube.com/channel/${channelId}` });
  }
  return { candidates, failed };
}

export async function syncBatchSources<T extends { id: string; name: string }>(values: T[], syncer: (source: T) => Promise<number>) {
  const settled = await Promise.allSettled(values.map(async source => ({ source, imported: await syncer(source) })));
  const added: Array<{ source: T; imported: number }> = [];
  const failed: BatchFailure[] = [];
  for (let index = 0; index < settled.length; index++) {
    const result = settled[index];
    if (result.status === "fulfilled") added.push(result.value);
    else failed.push({ name: values[index].name, error: result.reason instanceof Error ? result.reason.message : "Synchronisation impossible.", added: true });
  }
  return { added, failed, imported: added.reduce((total, result) => total + result.imported, 0) };
}
