// Leave time for outstanding fetches, persistence and the HTTP response.
export const SYNC_BATCH_START_BUDGET_MS = 220_000;
export const SYNC_SOURCE_BUDGET_MS = 60_000;
export class SourceSyncDeferredError extends Error {
  constructor() { super("Actualisation reportée au prochain passage."); this.name = "SourceSyncDeferredError"; }
}
export function checkSyncDeadline(deadlineMs?: number, now = Date.now()) {
  if (deadlineMs !== undefined && now >= deadlineMs) throw new SourceSyncDeferredError();
}
