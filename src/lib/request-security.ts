export function trustedMutation(request: Request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site")
    return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
export function sessionPurpose(payload: { purpose?: unknown }) {
  // Keep existing session cookies valid; temporary challenges are never sessions.
  return payload.purpose === undefined || payload.purpose === "session";
}
