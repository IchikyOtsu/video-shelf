export type SourceFetchErrorCode = "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR" | "API_QUOTA" | "API_CONFIGURATION" | "INVALID_RESPONSE";

export class SourceFetchError extends Error {
  readonly code: SourceFetchErrorCode;
  readonly hostname: string;
  readonly status?: number;

  constructor(code: SourceFetchErrorCode, hostname: string, status?: number) {
    super(code === "HTTP_ERROR" ? `Flux inaccessible (HTTP ${status}).` : code === "TIMEOUT" ? "Le délai de récupération du flux a expiré." : code === "API_QUOTA" ? "Le quota de l’API YouTube est temporairement épuisé." : code === "API_CONFIGURATION" ? "La configuration de l’API YouTube a été refusée." : code === "INVALID_RESPONSE" ? "Le serveur a renvoyé une réponse illisible." : "Impossible de joindre le serveur du flux.");
    this.name = "SourceFetchError";
    this.code = code;
    this.hostname = hostname;
    this.status = status;
  }
}

export function sourceHostname(feedUrl: string) {
  try { return new URL(feedUrl).hostname; } catch { return "invalid-host"; }
}

// Cover response body reads as well as headers with the same timeout.
export async function fetchSourceText(feedUrl: string, headers: HeadersInit = {}, timeoutMs = 10_000) {
  const hostname = sourceHostname(feedUrl);
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(feedUrl, { signal, headers, cache: "no-store" });
    if (!response.ok) throw new SourceFetchError("HTTP_ERROR", sourceHostname(response.url || feedUrl), response.status);
    return { text: await response.text(), url: response.url || feedUrl };
  } catch (error) {
    if (error instanceof SourceFetchError) throw error;
    throw new SourceFetchError(signal.aborted || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) ? "TIMEOUT" : "NETWORK_ERROR", hostname);
  }
}

export function logSourceSyncFailure(source: { kind: string; feedUrl: string }, error: unknown, durationMs: number) {
  // Never log URLs, query strings, response bodies, arbitrary messages or owners.
  console.error("Source sync failed", {
    kind: /^[a-z0-9_-]{1,40}$/i.test(source.kind) ? source.kind : "unknown",
    hostname: error instanceof SourceFetchError ? error.hostname : sourceHostname(source.feedUrl),
    status: error instanceof SourceFetchError ? error.status ?? null : null,
    error: error instanceof SourceFetchError ? error.code : "SYNC_ERROR",
    durationMs,
  });
}
