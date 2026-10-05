import { SourceSyncDeferredError, SYNC_SOURCE_BUDGET_MS } from "./sync-control";
import type { SourceSyncInput } from "./sources";

export const SOURCE_SYNC_CONCURRENCY = 3;
export type SyncSummary = { synced: number; failed: number; imported: number; remaining?: string[] };

// Start only a fixed number of workers, even for a large source collection.
export async function syncSourceBatch(
  sources: readonly SourceSyncInput[],
  sync: (source: SourceSyncInput, context?: { deadlineMs: number }) => Promise<number>,
  options: { startBudgetMs?: number; now?: () => number } = {},
): Promise<SyncSummary> {
  const summary: SyncSummary = { synced: 0, failed: 0, imported: 0 };
  let next = 0;
  const now = options.now || Date.now;
  const stopStartingAt = options.startBudgetMs === undefined ? Infinity : now() + options.startBudgetMs;
  const deferred: string[] = [];
  async function worker() {
    while (next < sources.length && now() < stopStartingAt) {
      const source = sources[next++];
      try {
        const imported = await sync(source, options.startBudgetMs === undefined ? undefined : { deadlineMs: now() + SYNC_SOURCE_BUDGET_MS });
        summary.synced++;
        summary.imported += imported;
      } catch (error) {
        if (error instanceof SourceSyncDeferredError) { deferred.push(source.id); continue; }
        // syncSource logs and records the failure. Other sources still run.
        summary.failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SOURCE_SYNC_CONCURRENCY, sources.length) }, worker));
  if (options.startBudgetMs !== undefined || deferred.length) summary.remaining = [...deferred, ...sources.slice(next).map(source => source.id)];
  return summary;
}
