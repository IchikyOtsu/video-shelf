import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { itemStates, items, sources } from "@/db/schema";
import { youtubeProvider } from "./feed";
import { rssProvider } from "./rss";
import type { ContentType } from "./library";
import { deterministicItemStateId } from "./item-state";
import { checkSyncDeadline, SourceSyncDeferredError, SYNC_SOURCE_BUDGET_MS } from "./sync-control";
import { metadataUpdateSet } from "./item-sync-update";
import { logSourceSyncFailure } from "./source-fetch";

export type SourceSyncInput = { id: string; userId?: string; kind: string; feedUrl: string };
export type NormalizedItem = {
  guid: string;
  title: string;
  url: string;
  audioUrl?: string | null;
  summary?: string | null;
  author?: string | null;
  mediaType: string;
  duration?: string | null;
  imageUrl?: string | null;
  publishedAt?: Date | null;
};
export type SourceSyncContext = { knownGuids?: (ids: string[]) => Promise<ReadonlySet<string>>; deadlineMs?: number };
export type SourceProvider = { contentType: Exclude<ContentType, "all">; sync(source: SourceSyncInput, context?: SourceSyncContext): Promise<NormalizedItem[]> };

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

export function initialImportStates(userId: string, itemIds: string[], initialImport: boolean) {
  return initialImport ? itemIds.map(itemId => ({ id: deterministicItemStateId(userId, itemId), userId, itemId, read: true })) : [];
}

export async function runSourceSync(
  source: SourceSyncInput,
  provider: SourceProvider,
  persist: (rows: NormalizedItem[]) => Promise<number>,
  recordSuccess: () => Promise<void>,
  recordFailure: (message: string) => Promise<void>,
  context?: SourceSyncContext,
) {
  const started = performance.now();
  try {
    checkSyncDeadline(context?.deadlineMs);
    const rows = deduplicateNormalizedItems(await provider.sync(source, context));
    checkSyncDeadline(context?.deadlineMs);
    const imported = await persist(rows);
    await recordSuccess();
    return imported;
  } catch (error) {
    if (error instanceof SourceSyncDeferredError) throw error;
    logSourceSyncFailure(source, error, Math.round(performance.now() - started));
    try { await recordFailure(shortSyncError(error)); }
    catch (recordError) { logSourceSyncFailure(source, recordError, Math.round(performance.now() - started)); }
    throw error;
  }
}

const providers: Record<string, SourceProvider> = { youtube: youtubeProvider, rss: rssProvider };

export function getSourceProvider(kind: string) {
  return providers[kind];
}

export async function syncSource(source: SourceSyncInput, { initialImport = false, deadlineMs = Date.now() + SYNC_SOURCE_BUDGET_MS }: { initialImport?: boolean; deadlineMs?: number } = {}) {
  if (!db) throw new Error("Database not connected");
  const database = db;
  checkSyncDeadline(deadlineMs);
  const resolved = getSourceProvider(source.kind) || { contentType: "article" as const, async sync() { throw new Error("Ce type de source ne peut pas encore être actualisé."); } };
  const context: SourceSyncContext = { deadlineMs };
  const provider: SourceProvider = {
    contentType: resolved.contentType,
    async sync(input) {
      if (!initialImport && source.kind === "youtube" && (await database.select({ id: items.id }).from(items).where(eq(items.sourceId, source.id)).limit(1)).length) {
        context.knownGuids = async ids => {
          if (!ids.length) return new Set<string>();
          const known = await database.select({ guid: items.guid }).from(items).where(and(eq(items.sourceId, source.id), inArray(items.guid, ids)));
          return new Set(known.map(item => item.guid));
        };
      }
      checkSyncDeadline(deadlineMs);
      return resolved.sync(input, context);
    },
  };
  return runSourceSync(
    source,
    provider,
    async normalized => {
      if (!normalized.length) return 0;
      const changed = await database.insert(items).values(normalized.map(item => ({ sourceId: source.id, ...item })))
        .onConflictDoUpdate({
          target: [items.sourceId, items.guid],
          set: metadataUpdateSet(),
        }).returning({ id: items.id, inserted: sql<boolean>`xmax = 0` });
      // Metadata updates preserve IDs, creation time and all user state.
      const inserted = changed.filter(item => item.inserted);
      if (initialImport && !source.userId) throw new Error("Initial source import requires an owner.");
      const states = initialImportStates(source.userId || "", inserted.map(item => item.id), initialImport);
      if (states.length) await database.insert(itemStates).values(states);
      return inserted.length;
    },
    async () => { await database.update(sources).set({ lastSyncedAt: new Date(), lastSyncError: null }).where(eq(sources.id, source.id)); },
    async message => { await database.update(sources).set({ lastSyncError: message }).where(eq(sources.id, source.id)); },
    context,
  );
}
