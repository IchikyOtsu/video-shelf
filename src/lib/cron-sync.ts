export const CRON_SYNC_MIN_INTERVAL_MS = 60 * 60_000;

export function cronSyncDue(lastSyncedAt: Date | null, now = new Date()) {
  return !lastSyncedAt || lastSyncedAt.getTime() <= now.getTime() - CRON_SYNC_MIN_INTERVAL_MS;
}

// Persisted success timestamps make unfinished work survive cold starts. A
// stable ID breaks ties without depending on the database's incidental order.
export function prioritizeSyncSources<T extends { id: string; lastSyncedAt: Date | null }>(sources: readonly T[]): T[] {
  return [...sources].sort((a, b) => {
    const left = a.lastSyncedAt?.getTime() ?? -Infinity;
    const right = b.lastSyncedAt?.getTime() ?? -Infinity;
    if (left !== right) return left < right ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
