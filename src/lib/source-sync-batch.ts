import type { SourceSyncInput } from "./sources";

export const SOURCE_SYNC_CONCURRENCY = 3;
export type SyncSummary = { synced: number; failed: number; imported: number };

// Start only a fixed number of workers, even for a large source collection.
export async function syncSourceBatch(
  sources: readonly SourceSyncInput[],
  sync: (source: SourceSyncInput) => Promise<number>,
): Promise<SyncSummary> {
  const summary = { synced: 0, failed: 0, imported: 0 };
  let next = 0;
  async function worker() {
    while (next < sources.length) {
      const source = sources[next++];
      try {
        const imported = await sync(source);
        summary.synced++;
        summary.imported += imported;
      } catch {
        // syncSource logs and records the failure. Other sources still run.
        summary.failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SOURCE_SYNC_CONCURRENCY, sources.length) }, worker));
  return summary;
}
