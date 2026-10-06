export class ApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request(url: string, options?: RequestInit & { timeoutMs?: number }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("REQUEST_TIMEOUT")), options?.timeoutMs || 12_000);
  const external = options?.signal;
  const abort = () => controller.abort(external?.reason);
  external?.addEventListener("abort", abort, { once: true });
  if (external?.aborted) abort();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    // Keep the timeout and cancellation active through the response body read.
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      if (response.ok) throw new ApiError("Le serveur a renvoyé une réponse illisible. Réessaie.", response.status, "INVALID_RESPONSE");
      data = {};
    }
    if (!response.ok) throw new ApiError(data?.error || "Impossible de charger les données. Réessaie.", response.status, data?.code);
    return data;
  } catch (error) {
    if (controller.signal.reason instanceof Error && controller.signal.reason.message === "REQUEST_TIMEOUT") throw new ApiError("La requête a expiré. Réessaie.", undefined, "REQUEST_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
    external?.removeEventListener("abort", abort);
  }
}
