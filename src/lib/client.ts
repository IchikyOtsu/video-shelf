export async function request(url: string, options?: RequestInit & { timeoutMs?: number }) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(new Error("REQUEST_TIMEOUT")), options?.timeoutMs || 12_000); const external = options?.signal;
  const abort = () => controller.abort(external?.reason); external?.addEventListener("abort", abort, { once: true });
  let response: Response;
  try { response = await fetch(url, { ...options, signal: controller.signal }); } catch (error) { if (controller.signal.reason instanceof Error && controller.signal.reason.message === "REQUEST_TIMEOUT") throw new Error("REQUEST_TIMEOUT"); throw error; } finally { clearTimeout(timeout); external?.removeEventListener("abort", abort); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Impossible de charger les données. Réessaie.");
  return data;
}
