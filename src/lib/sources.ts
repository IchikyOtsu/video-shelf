import { eq } from "drizzle-orm";
import { db } from "@/db";
import { items, sources } from "@/db/schema";
import { youtubeProvider } from "./feed";

export type SourceSyncInput = { id: string; kind: string; feedUrl: string };
export type NormalizedItem = {
  guid: string;
  title: string;
  url: string;
  summary?: string | null;
  author?: string | null;
  mediaType: string;
  duration?: string | null;
  imageUrl?: string | null;
  publishedAt?: Date | null;
};
export type SourceProvider = { sync(source: SourceSyncInput): Promise<NormalizedItem[]> };

export function deduplicateNormalizedItems(rows: NormalizedItem[]) {
  const seen = new Set<string>();
  const unique: NormalizedItem[] = [];
  for (const row of rows) {
    if (!row.guid || !row.url || seen.has(row.guid)) continue;
    seen.add(row.guid);
    unique.push(row);
  }
  return unique;
}

export function shortSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : "Actualisation impossible.";
  return message.replace(/\s+/g, " ").trim().slice(0, 240) || "Actualisation impossible.";
}

export async function runSourceSync(
  source: SourceSyncInput,
  provider: SourceProvider,
  persist: (rows: NormalizedItem[]) => Promise<number>,
  recordSuccess: () => Promise<void>,
  recordFailure: (message: string) => Promise<void>,
) {
  try {
    const imported = await persist(deduplicateNormalizedItems(await provider.sync(source)));
    await recordSuccess();
    return imported;
  } catch (error) {
    await recordFailure(shortSyncError(error));
    throw error;
  }
}

const providers: Record<string, SourceProvider> = { youtube: youtubeProvider };

export async function syncSource(source: SourceSyncInput) {
  if (!db) throw new Error("Database not connected");
  const database = db;
  const provider = providers[source.kind];
  if (!provider) throw new Error("Ce type de source ne peut pas encore être actualisé.");
  return runSourceSync(
    source,
    provider,
    async normalized => {
      if (!normalized.length) return 0;
      const inserted = await database.insert(items).values(normalized.map(item => ({ sourceId: source.id, ...item }))).onConflictDoNothing().returning({ id: items.id });
      return inserted.length;
    },
    async () => { await database.update(sources).set({ lastSyncedAt: new Date(), lastSyncError: null }).where(eq(sources.id, source.id)); },
    async message => { await database.update(sources).set({ lastSyncError: message }).where(eq(sources.id, source.id)); },
  );
}
