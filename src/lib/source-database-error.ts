export class SourceDatabaseError extends Error {
  readonly code: "DATABASE_SCHEMA_ERROR" | "DATABASE_ERROR";
  constructor(readonly databaseCode?: string) {
    const missingSchema = databaseCode === "42703" || databaseCode === "42P01";
    super(missingSchema ? "La base de données doit être mise à jour. Applique les migrations puis actualise cette source." : "Impossible d’enregistrer les contenus du flux. Réessaie.");
    this.name = "SourceDatabaseError";
    this.code = missingSchema ? "DATABASE_SCHEMA_ERROR" : "DATABASE_ERROR";
  }
}

// Drizzle wraps PostgreSQL errors with a query/parameter-bearing message.
// Inspect only the SQLSTATE and never expose that wrapper or its cause.
export function safeSourceSyncError(error: unknown): unknown {
  if (error instanceof SourceDatabaseError) return error;
  let current = error;
  let databaseError = false;
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 8 && current && typeof current === "object" && !visited.has(current); depth++) {
    visited.add(current);
    const value = current as { code?: unknown; query?: unknown; cause?: unknown; name?: unknown };
    if (typeof value.code === "string" && /^[0-9A-Z]{5}$/.test(value.code)) return new SourceDatabaseError(value.code);
    databaseError ||= typeof value.query === "string" || value.name === "DrizzleQueryError";
    current = value.cause;
  }
  return databaseError ? new SourceDatabaseError() : error;
}
