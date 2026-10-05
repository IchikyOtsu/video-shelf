export type SourceHealthInput = {
  active: boolean;
  lastSyncedAt: string | Date | null;
  lastSyncError: string | null;
  failureCount?: number;
  failureSince?: string | Date | null;
};
export function sourceHealth(source: SourceHealthInput, now = Date.now()) {
  if (!source.active) return { state: "paused", label: "En pause" };
  if (source.lastSyncError) {
    const since = source.failureSince
      ? new Date(source.failureSince).getTime()
      : now;
    return (source.failureCount || 0) >= 3 && now - since >= 3 * 86_400_000
      ? { state: "persistent", label: "Erreur persistante" }
      : { state: "temporary", label: "Temporairement indisponible" };
  }
  return source.lastSyncedAt
    ? { state: "ok", label: "OK" }
    : { state: "never", label: "Jamais synchronisée" };
}
