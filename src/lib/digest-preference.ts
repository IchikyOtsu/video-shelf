export function parseDigestPreference(value: unknown): boolean {
  if (!value || typeof value !== "object" || typeof (value as { enabled?: unknown }).enabled !== "boolean") throw new Error("Préférence invalide.");
  return (value as { enabled: boolean }).enabled;
}
