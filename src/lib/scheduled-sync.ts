import type { CronDigestStore, CronSummary } from "./cron-digest-store";
import { dailyCronRunId } from "./daily-digest";
import { prioritizeSyncSources } from "./cron-sync";
import { syncSourceBatch } from "./source-sync-batch";
import { SourceSyncDeferredError } from "./sync-control";
import type { SourceSyncInput } from "./sources";
import type { CronImportContext, SourceSyncResult } from "./item-import";

export async function runScheduledSync(store: CronDigestStore, deps: {
  token: string; now?: () => number; startedAt: number;
  sync(source: SourceSyncInput, options: { deadlineMs?: number; cron: CronImportContext }): Promise<SourceSyncResult>;
  deliver(runId: string, deadlineMs: number): Promise<{ emailsSent: number; emailsFailed: number; emailsDeferred: number }>;
}) {
  const now = deps.now || Date.now;
  const runId = dailyCronRunId(new Date(deps.startedAt));
  const run = await store.acquire(runId, deps.token);
  if (!run) return { runId, busy: true, synced: 0, failed: 0, imported: 0, skipped: 0, emailsSent: 0, emailsFailed: 0 };
  try {
    let summary: CronSummary = run.summary;
    if (run.phase === "syncing") {
      await store.seed(runId, deps.token);
      const sources = prioritizeSyncSources(await store.pendingSources(runId));
      await syncSourceBatch(sources, async (source, context) => {
        try {
          const result = await deps.sync(source, { deadlineMs: context?.deadlineMs, cron: { runId, leaseToken: deps.token } });
          await store.recordSource(runId, deps.token, source.id, "synced");
          return result.imported;
        } catch (error) {
          if (!(error instanceof SourceSyncDeferredError)) await store.recordSource(runId, deps.token, source.id, "failed");
          throw error;
        }
      }, { startBudgetMs: Math.max(0, 180_000 - (now() - deps.startedAt)), now });
      summary = await store.seal(runId, deps.token);
    }
    // This happens only after every running source worker has settled and the
    // immutable per-user outbox has been captured. Retries skip finished sync.
    let emails = { emailsSent: 0, emailsFailed: 0, emailsDeferred: 0 };
    try { emails = await deps.deliver(runId, deps.startedAt + 280_000); }
    catch { console.error("Digest delivery phase failed", { error: "DIGEST_STORE_ERROR" }); }
    return { runId, ...summary, ...emails };
  } finally {
    try { await store.release(runId, deps.token); }
    catch { console.error("Scheduled sync lease release failed", { error: "CRON_STORE_ERROR" }); }
  }
}
