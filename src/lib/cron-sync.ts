export const CRON_SYNC_MIN_INTERVAL_MS = 60 * 60_000;

export function cronSyncDue(lastSyncedAt: Date | null, now = new Date()) {
  return !lastSyncedAt || lastSyncedAt.getTime() <= now.getTime() - CRON_SYNC_MIN_INTERVAL_MS;
}
